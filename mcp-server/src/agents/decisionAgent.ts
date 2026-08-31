import Anthropic from "@anthropic-ai/sdk";
import type { FailureContext, ToolSchema } from "../types";
import { ActionType } from "../enums";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an AI payment recovery agent for a merchant platform. 
Your job is to analyze failed payment events and decide on the best recovery action.

You will receive:
- A failure context with classified category, amount, attempt history
- A set of tools the merchant app can execute

Your decision rules:
- "wrong_pin" or "psp_timeout" with low attempt_count: prefer retry_payment
- "insufficient_funds": prefer send_notification (SMS — short, empathetic, include payday timing hint)
- "abandoned": prefer send_notification (Email — friendly cart reminder)
- "do_not_honor": prefer send_notification (Email — suggest alternate payment method)
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
 * Runs the Claude tool-use loop.
 * When Claude picks a tool, this function returns — the WORKER handles actual relay to merchant.
 * The worker calls this step-by-step via the generator-style interface.
 */
export async function runDecisionAgent(
  context: FailureContext,
  toolSchemas: ToolSchema[],
  onToolCall: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
): Promise<DecisionAgentResult> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Analyze this payment failure and decide on the recovery action:

${JSON.stringify(context, null, 2)}

Use the available tools to gather more context if needed, then execute exactly one recovery action.`,
    },
  ];

  console.log("Messages: ", messages);

  let agentReasoning = "";
  let actionType: ActionType | null = null;
  let toolCallArgs: Record<string, unknown> = {};

  // Tool-use loop
  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolSchemas as Anthropic.Tool[],
      messages,
    });

    console.log(response);

    // Capture any text reasoning
    for (const block of response.content) {
      if (block.type === "text") {
        agentReasoning += block.text + "\n";
      }
    }

    // Done — no more tool calls
    if (response.stop_reason === "end_turn") {
      break;
    }

    // Process tool calls
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      console.log(toolUseBlocks);

      // Add assistant message to history
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`🤖 Agent 1 picked tool: ${toolUse.name}`, toolUse.input);

        // Track the final action tool (not query tools)
        if (toolUse.name !== "query_failure_context") {
          actionType = toolUse.name as ActionType;
          toolCallArgs = toolUse.input as Record<string, unknown>;
        }

        // Relay tool call to merchant app and await result
        const result = await onToolCall(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
        console.log(toolResults);
      }

      // Feed tool results back to Claude
      messages.push({ role: "user", content: toolResults });
    }
  }

  return { actionType, agentReasoning: agentReasoning.trim(), toolCallArgs };
}
