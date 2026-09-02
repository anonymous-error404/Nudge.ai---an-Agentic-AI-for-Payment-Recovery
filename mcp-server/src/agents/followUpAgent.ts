import Groq from "groq-sdk";
import { FailureContext, ToolSchema } from "../types";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are an intelligent payment recovery follow-up agent.
A customer previously had a payment fail. This is a delayed follow-up job.
First, USE YOUR TOOLS to check if the order has been paid.
If it is paid, simply finish.
If it is still unpaid:
1. Use the 'draft_notification_copy' tool to ask your expert copywriter subagent to write a highly persuasive follow-up email.
2. Once the subagent returns the text, use the 'send_notification' tool to send it.
After sending the email, decide if you should schedule another follow-up. 
If yes, call the 'schedule_next_follow_up' tool with the minutes delay (e.g., 1440 for 24 hours).
If you think the lead is completely dead, just don't schedule another.
You must actually EXECUTE the tools. Do not just describe what you will do.`;

export async function runFollowUpAgent(
  initialContext: FailureContext,
  availableTools: ToolSchema[],
  onToolCall: (toolName: string, args: any) => Promise<any>
) {
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Customer Name: ${initialContext.customer_name}
Customer ID: ${initialContext.customer_id}
Failure Category: ${initialContext.failure_category}
Failure Event ID: ${initialContext.failure_event_id}
Product: ${initialContext.order_details?.product_name || "unknown"}
Status: ${initialContext.order_status}
Check the latest context first!`,
    },
  ];

  const MAX_TURNS = 5;
  for (let i = 0; i < MAX_TURNS; i++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: availableTools,
      tool_choice: "auto",
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;

    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const toolCall of msg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        console.log(`🤖 Agent calling tool: ${toolCall.function.name}`, args);
        
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
      break; // No more tool calls, agent is done
    }
  }

  return { status: "completed" };
}
