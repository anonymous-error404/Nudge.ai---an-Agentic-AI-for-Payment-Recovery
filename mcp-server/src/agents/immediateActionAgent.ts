import Groq from "groq-sdk";
import { FailureContext, ToolSchema } from "../types";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are a payment recovery agent running asynchronously right after a payment failure.
The customer has already seen an error on the UI.
Your job is to:
1. Use the 'draft_notification_copy' tool to ask your expert copywriter subagent to write the SMS for you.
2. Once the subagent returns the drafted text, use the 'send_notification' tool to send that SMS reassuring the customer that no money was deducted. Keep it under 160 characters.
3. Use the 'schedule_next_follow_up' tool to schedule a delayed email (e.g. 30 or 60 minutes) to nudge them to retry later. If it's a permanent failure (like fraud), do not schedule a follow-up.

You MUST execute the tools. DO NOT try to write the SMS copy yourself, always delegate to 'draft_notification_copy' first.`;

export async function runImmediateActionAgent(
  context: FailureContext,
  availableTools: ToolSchema[],
  onToolCall: (toolName: string, args: any) => Promise<any>,
) {
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Customer Name: ${context.customer_name}
Customer ID: ${context.customer_id}
Failure Category: ${context.failure_category}
Failure Event ID: ${context.failure_event_id}
Product: ${context.order_details?.product_name || "unknown"}`,
    },
  ];

  const MAX_TURNS = 5;
  for (let i = 0; i < MAX_TURNS; i++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: availableTools as any,
      tool_choice: "auto",
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;

    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const toolCall of msg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        console.log(
          `🤖 ImmediateActionAgent calling tool: ${toolCall.function.name}`,
          args,
        );

        try {
          const result = await onToolCall(toolCall.function.name, args);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: String(err) }),
          });
        }
      }
    } else {
      break;
    }
  }

  return { status: "completed" };
}

