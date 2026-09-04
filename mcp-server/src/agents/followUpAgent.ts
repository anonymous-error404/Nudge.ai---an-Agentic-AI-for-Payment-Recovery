import Groq from "groq-sdk";
import { FailureContext, ToolSchema } from "../types";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are an intelligent payment recovery follow-up agent.
A customer previously had a payment fail. This is a delayed follow-up job.

Your workflow:
1. First, use 'query_failure_context' to check the current order status and how many attempts have already been made.
2. If the order is already paid, simply finish — do nothing more.
3. If still unpaid, check the previous_recovery_attempts count:
   - ALL categories: max 7 attempts total (1 immediate SMS/email + up to 6 follow-up emails with increasing delays)
   - If AT OR ABOVE 7 attempts → call 'escalate_to_human' instead of sending another notification.
   - Keep increasing the delay between follow-ups as attempts grow (e.g. attempt 2: a few hours, attempt 3: 1 day, attempt 4: 3 days, attempt 5: 1 week, etc.)
4. If below max attempts:
   a. Use 'draft_notification_copy' to write a persuasive follow-up EMAIL. Instruct the copywriter it's a follow-up (attempt #N) so they vary the wording.
   b. Use 'send_notification' to send the email.
   c. Decide whether to schedule another follow-up (use 'schedule_next_follow_up' if warranted).

IMPORTANT: 'escalate_to_human' means the case is flagged for a human support agent to review. It is NOT resolved or completed — the order is still unpaid.

You must actually EXECUTE the tools. Do not just describe what you will do.`;

export async function runFollowUpAgent(
  initialContext: FailureContext,
  availableTools: ToolSchema[],
  onToolCall: (toolName: string, args: any) => Promise<any>,
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

