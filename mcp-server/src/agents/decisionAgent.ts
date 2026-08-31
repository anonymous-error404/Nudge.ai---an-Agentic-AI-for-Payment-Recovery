import Groq from "groq-sdk";
import type { FailureContext, ToolSchema } from "../types";
import { ActionType } from "../enums";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

// openai/gpt-oss-120b — most capable model available on this account with tool calling support
const DECISION_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are an AI payment recovery agent for a merchant platform.
Your job is to analyze failed payment events and decide on the best recovery action.

You will receive a JSON context object containing:
- failure_event_id: the real failure event ID — use this EXACTLY when calling query_failure_context
- customer_id: the real customer ID — use this EXACTLY when calling send_notification or escalate_to_human
- failure_category, amount_bucket, attempt_count, payment_method, previous_actions

IMPORTANT — always use the exact IDs from the context. Never make up or guess IDs.

Your decision rules:
- "wrong_pin" or "psp_timeout" with low attempt_count: prefer retry_payment
- "insufficient_funds": prefer send_notification (channel: "sms")
- "abandoned": prefer send_notification (channel: "email")
- "do_not_honor": prefer send_notification (channel: "email")
- "fraud_block": always use do_nothing — never retry fraud blocks
- attempt_count >= 3: prefer escalate_to_human regardless of category

You may call query_failure_context first if you need more information before deciding.
Always choose exactly ONE final action tool. Explain your reasoning briefly.`;

export interface DecisionAgentResult {
  actionType: ActionType | null;
  agentReasoning: string;
  toolCallArgs: Record<string, unknown>;
}

/**
 * Agent 1 — Recovery Decision Agent.
 * Runs the Groq (Llama 3.3 70B) tool-use loop.
 * toolSchemas are already in Groq/OpenAI format — passed directly, no conversion needed.
 */
export async function runDecisionAgent(
  context: FailureContext,
  toolSchemas: ToolSchema[],
  onToolCall: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
): Promise<DecisionAgentResult> {
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: `Analyze this payment failure and decide on the recovery action:\n\n${JSON.stringify(context, null, 2)}\n\nUse the available tools to gather more context if needed, then execute exactly one recovery action.`,
    },
  ];

  let agentReasoning = "";
  let actionType: ActionType | null = null;
  let toolCallArgs: Record<string, unknown> = {};

  // Tool-use loop
  while (true) {
    const response = await client.chat.completions.create({
      model: DECISION_MODEL,
      messages,
      tools: toolSchemas as Groq.Chat.ChatCompletionTool[],
      tool_choice: "auto",
      max_tokens: 1024,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // Capture any text reasoning
    if (assistantMessage.content) {
      agentReasoning += assistantMessage.content + "\n";
    }

    // Add assistant turn to history
    messages.push(assistantMessage);

    // Done — no more tool calls
    if (
      choice.finish_reason === "stop" ||
      !assistantMessage.tool_calls?.length
    ) {
      break;
    }

    // Process tool calls
    if (
      choice.finish_reason === "tool_calls" &&
      assistantMessage.tool_calls?.length
    ) {
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(
          toolCall.function.arguments ?? "{}",
        ) as Record<string, unknown>;

        console.log(`🤖 Agent 1 picked tool: ${toolName}`, toolArgs);

        // Track the final action tool (not query tools)
        if (toolName !== "query_failure_context") {
          actionType = toolName as ActionType;
          toolCallArgs = toolArgs;
        }

        // Relay tool call to merchant app and await result
        const result = await onToolCall(toolName, toolArgs);

        // Feed tool result back into message history (OpenAI/Groq format)
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }
  }

  return { actionType, agentReasoning: agentReasoning.trim(), toolCallArgs };
}
