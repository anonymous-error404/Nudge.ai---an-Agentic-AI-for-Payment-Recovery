/**
 * Recovery Orchestrator
 *
 * Stub for the MCP agent + Claude decision logic.
 * Deterministic rules decide immediate vs. delayed recovery.
 * When the MCP agent is built, replace the routing block with a Claude tool-use call.
 */

import { FailureCategory, RecoveryType, RecoveryActionType, RecoveryOutcome, NotificationChannel } from "../enums";
import { RecoveryDecision } from "../types";
import { failureEventRepository } from "../repositories/failureEventRepository";
import { mcpClient } from "./recoveryAgentMCPClientService";

// Re-export so callers that imported these from here still work
export type { RecoveryDecision };
export { RecoveryType, RecoveryActionType };

/** Maximum retry attempts before escalating. Enforced here (guardrail), not by Claude. */
const MAX_RETRY_ATTEMPTS = 3;

/** Categories where immediate recovery is appropriate (re-prompt during checkout). */
const IMMEDIATE_RECOVERY_CATEGORIES: FailureCategory[] = [
  FailureCategory.WrongPin,    // Just mistyped — retry right now
  FailureCategory.PspTimeout,  // Network glitch — retry after reconciliation check
];

/** Categories that must never be auto-retried. */
const NO_RETRY_CATEGORIES: FailureCategory[] = [
  FailureCategory.FraudBlock,
];

export async function handlePaymentFailure(
  failureEventId: string,
  category: FailureCategory,
  paymentId: string
): Promise<RecoveryDecision> {
  // ── Guardrail: check existing attempt count ───────────────────────────────
  const existingActions = await failureEventRepository.getRecoveryActionsByFailureEventId(failureEventId);
  const attemptNumber = existingActions.length + 1;

  // ── Guardrail: escalate if max attempts exceeded ──────────────────────────
  if (attemptNumber > MAX_RETRY_ATTEMPTS) {
    await logAction(failureEventId, {
      failureEventId,
      actionType: RecoveryActionType.EscalateToHuman,
      outcome: RecoveryOutcome.Pending,
      attemptNumber,
      agentReasoning: `Max recovery attempts (${MAX_RETRY_ATTEMPTS}) exceeded for category=${category}. Escalating.`,
    });
    return {
      recoveryType: RecoveryType.None,
      action: RecoveryActionType.EscalateToHuman,
      message: "Maximum recovery attempts reached. Our team will review this payment.",
    };
  }

  // ── No-retry categories ───────────────────────────────────────────────────
  if (NO_RETRY_CATEGORIES.includes(category)) {
    await logAction(failureEventId, {
      failureEventId,
      actionType: RecoveryActionType.DoNothing,
      outcome: RecoveryOutcome.Pending,
      attemptNumber,
      agentReasoning: `Fraud/risk block (category=${category}). Policy: do not retry, flag only.`,
    });
    return {
      recoveryType: RecoveryType.None,
      action: RecoveryActionType.DoNothing,
      message: "This payment could not be processed. Please contact your bank.",
    };
  }

  // ── Immediate recovery ────────────────────────────────────────────────────
  if (IMMEDIATE_RECOVERY_CATEGORIES.includes(category)) {
    await logAction(failureEventId, {
      failureEventId,
      actionType: RecoveryActionType.RetryPayment,
      outcome: RecoveryOutcome.Pending,
      attemptNumber,
      agentReasoning: `Immediate retry appropriate for category=${category}. Frontend will re-open checkout.`,
    });
    return {
      recoveryType: RecoveryType.Immediate,
      action: RecoveryActionType.RetryPayment,
      message: getImmediateMessage(category),
    };
  }

  // ── Delayed recovery → hand off to MCP server + Claude ───────────────────────
  // Claude will decide: send_notification, retry_payment, or escalate_to_human.
  // Result comes back asynchronously via POST /mcp/job-complete.
  const { jobId } = await mcpClient.submitRecoveryJob(failureEventId, category, paymentId);

  // Log a pending recovery action locally so the merchant DB tracks the attempt
  const channel = getNotificationChannel(category);
  await logAction(failureEventId, {
    failureEventId,
    actionType: RecoveryActionType.SendNotification, // placeholder — updated by job-complete callback
    channel,
    outcome: RecoveryOutcome.Pending,
    attemptNumber,
    agentReasoning: `Submitted to MCP server for AI decision. Job: ${jobId}`,
  });

  return {
    recoveryType: RecoveryType.Delayed,
    action: RecoveryActionType.SendNotification,
    message: getDelayedMessage(category),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAction(
  failureEventId: string,
  params: {
    failureEventId: string;
    actionType: RecoveryActionType;
    channel?: NotificationChannel;
    outcome: RecoveryOutcome;
    attemptNumber: number;
    agentReasoning?: string;
  }
) {
  return failureEventRepository.createRecoveryAction({
    failureEventId,
    actionType: params.actionType,
    channel: params.channel,
    outcome: params.outcome,
    attemptNumber: params.attemptNumber,
    agentReasoning: params.agentReasoning,
  });
}

function getImmediateMessage(category: FailureCategory): string {
  switch (category) {
    case FailureCategory.WrongPin:   return "Incorrect PIN entered. Please try again with the correct UPI PIN.";
    case FailureCategory.PspTimeout: return "Payment timed out due to a network issue. Please try again.";
    default:                         return "Please try your payment again.";
  }
}

function getDelayedMessage(category: FailureCategory): string {
  switch (category) {
    case FailureCategory.InsufficientFunds: return "Payment failed due to insufficient funds. We'll send you a reminder to complete your purchase.";
    case FailureCategory.DoNotHonor:        return "Your bank declined this payment. We'll follow up with alternative payment options.";
    case FailureCategory.Abandoned:         return "Your cart is saved. We'll send you a reminder to complete your purchase.";
    default:                                return "We'll follow up about your payment shortly.";
  }
}

function getNotificationChannel(category: FailureCategory): NotificationChannel {
  switch (category) {
    case FailureCategory.InsufficientFunds: return NotificationChannel.SMS;
    case FailureCategory.Abandoned:         return NotificationChannel.Email;
    default:                                return NotificationChannel.Email;
  }
}
