import { ActionType, NotificationChannel, RecoveryOutcome } from "./enums";

// ─── Inbound from merchant MCP client ────────────────────────────────────────

/** Groq/OpenAI-style tool schema — used natively in the agent without conversion */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

export interface FailureContext {
  failure_event_id: string;   // real merchant-side ID — passed so AI can call query_failure_context correctly
  customer_id: string;        // internal merchant customer ID — needed for notification tool calls (not PII)
  customer_name: string;
  order_status: string;
  failure_category: string;
  amount_bucket: string;      // kept for decision-rule risk bucketing
  attempt_count: number;
  days_since_failure: number;
  payment_method: string;
  previous_actions: string[];
  order_details: {
    order_id: string;
    product_name: string;
    product_description?: string;
    amount_rupees: number;    // exact amount in INR (not paise)
    currency: string;
  } | null;
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
  isFollowUp?: boolean;          // Flag for FollowUpPoller jobs
  isImmediateRecovery?: boolean; // Flag for checkout jobs
  followUpScheduleId?: string;
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
