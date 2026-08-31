// ─── MCP Server Enums ─────────────────────────────────────────────────────────

export enum RecoveryOutcome {
  Pending    = "pending",
  InProgress = "in_progress",
  Success    = "success",
  Failed     = "failed",
  Skipped    = "skipped",
}

export enum ActionType {
  RetryPayment    = "retry_payment",
  SendNotification = "send_notification",
  EscalateToHuman = "escalate_to_human",
  DoNothing       = "do_nothing",
}

export enum NotificationChannel {
  SMS      = "sms",
  Email    = "email",
  WhatsApp = "whatsapp",
}

export enum AmountBucket {
  Low      = "0-500",
  Medium   = "500-1000",
  High     = "1000-5000",
  VeryHigh = "5000+",
}
