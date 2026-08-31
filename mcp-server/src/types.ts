import { ActionType, NotificationChannel, RecoveryOutcome } from "./enums";

// ─── Inbound from merchant MCP client ────────────────────────────────────────

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface FailureContext {
  failure_category: string;
  amount_bucket: string;
  attempt_count: number;
  days_since_failure: number;
  payment_method: string;
  previous_actions: string[];
}

export interface RecoveryJobRequest {
  merchantId: string;
  merchantCallbackUrl: string;   // e.g. http://localhost:3000/mcp
  externalRef: string;           // merchant's own failure_event ID
  context: FailureContext;
  toolSchemas: ToolSchema[];
}

// ─── Job queue payload ───────────────────────────────────────────────────────

export interface RecoveryJobPayload extends RecoveryJobRequest {
  failureEventId: string;        // MCP server's own FailureEvent ID
}

// ─── Tool call relay (server → client) ───────────────────────────────────────

export interface ToolCallMessage {
  jobId: string;
  tool: string;
  args: Record<string, unknown>;
}

// ─── Tool result (client → server) ───────────────────────────────────────────

export interface ToolResultPayload {
  jobId: string;
  result: Record<string, unknown>;
}

// ─── Job complete (server → client) ──────────────────────────────────────────

export interface JobCompleteMessage {
  jobId: string;
  actionType: ActionType | null;
  outcome: RecoveryOutcome;
  agentReasoning: string | null;
  notificationContent?: string | null;
}
