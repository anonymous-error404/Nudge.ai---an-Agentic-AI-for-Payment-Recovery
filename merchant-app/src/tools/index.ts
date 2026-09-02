/**
 * Tool Registry
 *
 * Centralises:
 *  1. The JSON schemas sent to the MCP server (and on to AI)
 *  2. The executor functions called when the server relays a tool call back
 */

import { sendNotificationSchema, executeSendNotification } from "./sendNotificationTool";
import { queryFailureContextSchema, executeQueryFailureContext } from "./queryFailureContextTool";
import { escalateToHumanSchema, executeEscalateToHuman } from "./escalateToHumanTool";
import { doNothingSchema, executeDoNothing } from "./doNothingTool";

// ─── Schemas sent to MCP server (these become AI's tool list) ─────────────

export const TOOL_SCHEMAS = [
  queryFailureContextSchema,   // AI should call this first to gather context
  sendNotificationSchema,
  escalateToHumanSchema,
  doNothingSchema,
];

// ─── Executor registry ────────────────────────────────────────────────────────

type ToolArgs = Record<string, unknown>;
type ToolResult = Record<string, unknown>;

const TOOL_EXECUTORS: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
  send_notification:      (args) => executeSendNotification(args as any),
  query_failure_context:  (args) => executeQueryFailureContext(args as any),
  escalate_to_human:      (args) => executeEscalateToHuman(args as any),
  do_nothing:             (args) => executeDoNothing(args as any),
};

/**
 * Execute a tool by name with the args relayed from the MCP server.
 * Throws if the tool name is not registered.
 */
export async function executeTool(toolName: string, args: ToolArgs): Promise<ToolResult> {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) {
    throw new Error(`Unknown tool: ${toolName}. Registered: ${Object.keys(TOOL_EXECUTORS).join(", ")}`);
  }
  console.log(`🔧 Executing tool: ${toolName}`, args);
  const result = await executor(args);
  console.log(`✅ Tool result [${toolName}]:`, result);
  return result;
}
