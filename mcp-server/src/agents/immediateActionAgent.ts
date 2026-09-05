import Groq from "groq-sdk";
import { FailureContext, ToolSchema } from "../types";
import { log } from '../../../shared/logger';

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are a payment recovery agent running asynchronously right after a payment failure.
The customer has already seen an error on the UI.

Your job:
1. Use 'draft_notification_copy' to ask your expert copywriter subagent to write an SMS. If an Offer is listed, you MUST pass it exactly in the 'product_offer' parameter!
2. Use 'send_notification' to send that SMS (channel: sms) immediately reassuring the customer.
3. Use 'schedule_next_follow_up' to schedule a DELAYED EMAIL follow-up based on the failure category:

SMART SCHEDULING PLAYBOOK (use this to pick delay_minutes):
- insufficient_funds  → first followup scheduled in 60 minutes (1 hour, they may have just topped up), next followup in 1440 minutes (24 hours, they may have forgotten) and the later followups can be done near to upcoming payday(like first of the month or 15th of the month).
- wrong_pin          → schedule first few follow-ups in 120 minutes (2 hours, customer likely just forgot), and keep delaying subsequent follow-ups by suitable intervals (like 4 hours, 8 hours, 24 hours) until the customer successfully pays or the order is cancelled or escalated.
- abandoned          → schedule first few follow-ups in 240 minutes (4 hours, they were browsing), then keep delaying subsequent follow-ups by suitable intervals (like 8 hours, 24 hours) until the customer successfully pays or the order is cancelled or escalated.
- do_not_honor       → schedule follow-ups in 1440 minutes (24 hours, bank may have temporarily blocked)
- psp_timeout        → schedule first few follow-ups in 60 minutes (1 hour, transient network issue), then keep delaying subsequent follow-ups by suitable intervals (like 4 hours, 8 hours, 24 hours) until the customer successfully pays or the order is cancelled or escalated.
- fraud_block        → DO NOT send any customer-facing notification. DO NOT schedule a follow-up. Call 'escalate_to_human' immediately.

You MUST execute the tools. DO NOT try to write the SMS copy yourself — always delegate to 'draft_notification_copy' first.
The copywriter will handle the tone — your job is just to coordinate.

CRITICAL — when calling 'send_notification' after 'draft_notification_copy':
- Pass the EXACT 'body' text from draft_notification_copy as the 'content' parameter.
- Pass the EXACT 'subject' text from draft_notification_copy as the 'subject' parameter (email only).
- Do NOT paraphrase, shorten, or rewrite the copy. The customer must receive the expert-written version word for word.

CRITICAL FINAL STEP:
You MUST call 'schedule_next_follow_up' after sending the notification. DO NOT finish your turn without scheduling the next follow-up. If you forget this, the recovery campaign will completely stall.`;

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
Product: ${context.order_details?.product_name || "unknown"}
Offer: ${context.order_details?.product_offer || "None"}`,
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
        log.toolOrdered(`[The Strategist] ${toolCall.function.name}`, args);

        try {
          const result = await onToolCall(toolCall.function.name, args);
          log.toolResult(toolCall.function.name, result);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          log.error(`Tool "${toolCall.function.name}" execution failed`, err);
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
