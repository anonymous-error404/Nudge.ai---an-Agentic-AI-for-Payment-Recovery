/**
 * types.ts
 *
 * All shared interfaces and complex types used across the merchant app.
 * Import from here — never re-define these inline elsewhere.
 *
 * Enumeratable values (RecoveryType, FailureCategory, etc.) live in enums.ts.
 */

import {
  FailureCategory,
  RecoveryType,
  RecoveryActionType,
  NotificationChannel,
  RecoveryOutcome,
} from "./enums";

// ─── Razorpay API shapes ──────────────────────────────────────────────────────

/** Razorpay payment entity (from webhook or Payment Fetch API) */
export interface RazorpayPaymentEntity {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id?: string;
  method?: string;
  error_code?: string;
  error_description?: string;
  error_source?: string;
  error_step?: string;
  error_reason?: string;
}

/** Razorpay order entity (from webhook payload) */
export interface RazorpayOrderEntity {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
}

/** Top-level Razorpay webhook event envelope */
export interface RazorpayWebhookEvent {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    order?: { entity: RazorpayOrderEntity };
  };
  created_at: number;
}

/** Parameters for creating a Razorpay Order via the Orders API */
export interface CreateOrderParams {
  amount: number; // in paise
  currency?: string;
  receipt: string; // your internal order ID
  notes?: Record<string, string>;
}

// ─── Payment store ────────────────────────────────────────────────────────────

/** Parameters for upserting a payment record in the DB */
export interface UpsertPaymentParams {
  id?: string;
  orderId: string;
  razorpayPaymentId?: string | null;
  status: string;
  method?: string | null;
  errorCode?: string | null;
  errorReason?: string | null;
  errorSource?: string | null;
  errorStep?: string | null;
  errorDescription?: string | null;
}

/** Input to the failure classifier */
export interface ClassifyFailureInput {
  errorCode?: string | null;
  errorReason?: string | null;
  errorSource?: string | null;
  errorStep?: string | null;
  errorDescription?: string | null;
}

/** Output of the failure classifier */
export interface ClassifyFailureResult {
  category: FailureCategory;
  rootCause: string;
}

// ─── Recovery orchestration ───────────────────────────────────────────────────

/**
 * The decision returned by handlePaymentFailure().
 *
 * recoveryType:  immediate → frontend re-opens checkout modal now
 *                delayed   → notification/retry scheduled for later
 *                none      → no automated recovery (fraud block, escalation)
 *
 * action:        the specific MCP tool that was (or will be) invoked
 * message:       human-readable explanation suitable for showing to the customer
 */
export interface RecoveryDecision {
  recoveryType: RecoveryType;
  action: RecoveryActionType;
  message: string;
}

/**
 * A single recovery action log entry.
 * Mirrors the recovery_actions DB row shape (without Prisma-generated fields).
 */
export interface RecoveryActionLog {
  failureEventId: string;
  actionType: RecoveryActionType;
  channel?: NotificationChannel;
  outcome: RecoveryOutcome;
  attemptNumber: number;
  agentReasoning?: string;
}

// ─── Dev simulator ────────────────────────────────────────────────────────────

/** Definition of one simulated failure scenario (used by devSimulator.ts) */
export interface FailureScenario {
  label: string;
  description: string;
  method: string;
  errorCode: string;
  errorDescription: string;
  errorSource: string;
  errorStep: string;
  errorReason: string;
  expectedCategory: FailureCategory;
  expectedRecovery: string;
}
