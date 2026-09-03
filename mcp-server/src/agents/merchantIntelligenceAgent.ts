import Groq from "groq-sdk";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are an intelligent analytics assistant for a Razorpay payment recovery platform.
You have access to real-time data tools to answer merchant questions about their payment failures and recoveries.

## Data Integrity Rules (CRITICAL — never violate these)
- "Recovered" means the failed order was successfully paid after a retry.
  It does NOT mean an email or SMS was sent. Sending a notification is "In Progress", not "Recovered".
- The tool data includes a dataNote field that explains definitions. Always respect it.
- NEVER report payments as recovered unless recoveredCount > 0 from the tool.
- If recoveredCount is 0 and inProgressCount > 0, say clearly: "The AI has sent recovery actions but no
  customer has repurchased yet. Recovery rate is 0%."

## Response Style (ALWAYS follow this)
- Respond in clear, flowing PROSE — like a knowledgeable human analyst explaining the situation.
- DO NOT just dump a raw markdown table and stop. Use tables only to supplement your explanation.
- Structure every response as: (1) a plain-English summary of what the data shows, (2) what it means for
  the merchant, (3) what to watch or do next — unless the question doesn't warrant all three.
- Highlight important numbers inline in your prose (e.g., "The AI sent notifications to 2 customers,
  but none have repurchased yet — recovery rate stands at 0%.").
- NEVER mention the names of the tools you use (e.g., do not say "I will use the query_failure_trends tool").
- NEVER give technical advice like "Run this tool". The merchant is a non-technical business owner. If you want to suggest an action, suggest a business action (e.g. "You can ask me to rank your customers by failure count to spot repeat offenders", or "Consider adjusting your retry timing").
- Be honest about gaps. If the data shows no recoveries, say so plainly and explain what "In Progress" means.

## Format & Privacy Rules
- Express currency as ₹ with comma formatting (e.g., ₹7,999). Convert from paise by dividing by 100.
- Express percentages to 1 decimal place.
- NEVER expose customer names, emails, or phone numbers. Use anonymized labels only (Customer #1, etc.).
- Always use tools to fetch real data before answering. Never make up numbers.
- If a question is outside your data scope, say so clearly.`;

export interface MerchantIntelligenceAgentParams {
  message: string;
  toolSchemas: any[];
  callTool: (tool: string, args: any) => Promise<any>;
}

/**
 * MerchantIntelligenceAgent \u2014 multi-turn tool-calling AI loop.
 * Accepts a merchant chat query, runs an agentic loop using the provided
 * tool schemas and callTool executor, and returns the final text answer.
 *
 * Max 8 tool calls are allowed before forcing a final text answer.
 */
export async function runMerchantIntelligenceAgent({
  message,
  toolSchemas,
  callTool,
}: MerchantIntelligenceAgentParams): Promise<string> {
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];

  const MAX_TOOL_CALLS = 8;
  let toolCallCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hasTools = toolSchemas.length > 0 && toolCallCount < MAX_TOOL_CALLS;

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      ...(hasTools ? { tools: toolSchemas as any, tool_choice: "auto" } : {}),
    });

    const msg = response.choices[0]?.message;
    if (!msg) {
      return "I was unable to generate a response. Please try again.";
    }

    messages.push(msg);

    // If the model wants to call tools, execute them and continue the loop
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const toolCall of msg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        console.log(
          `\ud83d\udd0d MerchantIntelligenceAgent calling tool: ${toolCall.function.name}`,
          args,
        );
        toolCallCount++;

        let result: any;
        try {
          result = await callTool(toolCall.function.name, args);
        } catch (err) {
          result = { error: String(err) };
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // If we have exhausted the max tool calls, inject a forcing message
      // and let the next iteration return a text response without tools
      if (toolCallCount >= MAX_TOOL_CALLS) {
        console.warn(
          `\u26a0\ufe0f  MerchantIntelligenceAgent reached max tool calls (${MAX_TOOL_CALLS}). Forcing final answer.`,
        );
        messages.push({
          role: "user",
          content:
            "You have used the maximum number of tool calls. Please provide a final answer based on the data you have gathered so far.",
        });
      }

      continue;
    }

    // No tool calls \u2014 model returned a text response; return it
    return msg.content?.trim() || "No response generated.";
  }
}
