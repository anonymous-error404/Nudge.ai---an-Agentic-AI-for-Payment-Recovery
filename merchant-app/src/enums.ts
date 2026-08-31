/**
 * enums.ts
 *
 * All enumerable constant sets used across the merchant app.
 * Import from here — never re-define these inline elsewhere.
 */

// ─── Payment / Order lifecycle ────────────────────────────────────────────────

export enum OrderStatus {
  Created = "created",
  Attempted = "attempted",
  Paid = "paid",
  Failed = "failed",
}

export enum PaymentStatus {
  Created = "created",
  Authorized = "authorized",
  Captured = "captured",
  Failed = "failed",
}

export enum PaymentMethod {
  UPI = "upi",
  Card = "card",
  Netbanking = "netbanking",
  Wallet = "wallet",
}

// ─── Razorpay error codes ─────────────────────────────────────────────────────

export enum RazorpayErrorCode {
  BadRequest = "BAD_REQUEST_ERROR",
  GatewayError = "GATEWAY_ERROR",
  ServerError = "SERVER_ERROR",
}

export enum RazorpayErrorSource {
  Customer = "customer",
  Bank = "bank",
  Gateway = "gateway",
  Razorpay = "razorpay",
  Business = "business",
}

export enum RazorpayErrorStep {
  PaymentInitiation = "payment_initiation",
  PaymentAuthentication = "payment_authentication",
  PaymentAuthorization = "payment_authorization",
}

export enum RazorpayErrorReason {
  PaymentFailed = "payment_failed",
  PaymentCancelled = "payment_cancelled",
  RiskCheck = "risk_check",
}

// ─── Failure classification ───────────────────────────────────────────────────

/**
 * The 8 classified failure categories.
 * Maps directly to the failure taxonomy in Section 2 of the system design doc.
 *
 * Recovery posture per category:
 *   insufficient_funds → delayed retry (payday-aware) + suggest alt. method
 *   wrong_pin          → immediate retry prompt
 *   abandoned          → cart-abandonment nudge
 *   do_not_honor       → short-delay retry → alt. method
 *   psp_timeout        → reconcile first, then auto-retry
 *   fraud_block        → do_nothing + escalate (NEVER retry)
 *   mandate_revoked    → re-registration (NEVER retry)
 *   unknown            → escalate to human
 */
export enum FailureCategory {
  InsufficientFunds = "insufficient_funds",
  WrongPin = "wrong_pin",
  Abandoned = "abandoned",
  DoNotHonor = "do_not_honor",
  PspTimeout = "psp_timeout",
  FraudBlock = "fraud_block",
  MandateRevoked = "mandate_revoked",
  Unknown = "unknown",
}

// ─── Recovery orchestration ───────────────────────────────────────────────────

/**
 * Whether the recovery action should happen right now (during checkout)
 * or be scheduled for later (nudge via notification).
 */
export enum RecoveryType {
  Immediate = "immediate", // Re-open checkout modal now
  Delayed = "delayed", // Schedule notification / retry
  None = "none", // No recovery (fraud block, escalation)
}

/**
 * The set of actions the orchestrator (and later AI) can take.
 * Maps 1:1 to the MCP tool schemas in Section 5 of the system design doc.
 */
export enum RecoveryActionType {
  RetryPayment = "retry_payment",
  SendNotification = "send_notification",
  EscalateToHuman = "escalate_to_human",
  DoNothing = "do_nothing",
}

// ─── Notification ─────────────────────────────────────────────────────────────

export enum NotificationChannel {
  SMS = "sms",
  Email = "email",
  WhatsApp = "whatsapp",
}

// ─── Outcome tracking ─────────────────────────────────────────────────────────

export enum RecoveryOutcome {
  Pending = "pending",
  Success = "success",
  Failed = "failed",
  Skipped = "skipped",
}
