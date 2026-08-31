import { prisma } from "../lib/prismaClient";
import { FailureCategory } from "../enums";
import {
  UpsertPaymentParams,
  ClassifyFailureInput,
  ClassifyFailureResult,
  RecoveryActionLog,
} from "../types";

// Re-export so existing callers that imported UpsertPaymentParams from here still work
export type { UpsertPaymentParams };

// ─── Payment upsert ──────────────────────────────────────────────────────────

export async function upsertPayment(params: UpsertPaymentParams) {
  if (params.razorpayPaymentId) {
    return prisma.payment.upsert({
      where: { razorpayPaymentId: params.razorpayPaymentId },
      update: {
        status: params.status,
        errorCode: params.errorCode,
        errorReason: params.errorReason,
        errorSource: params.errorSource,
        errorStep: params.errorStep,
        errorDescription: params.errorDescription,
        method: params.method,
      },
      create: {
        orderId: params.orderId,
        razorpayPaymentId: params.razorpayPaymentId,
        status: params.status,
        method: params.method,
        errorCode: params.errorCode,
        errorReason: params.errorReason,
        errorSource: params.errorSource,
        errorStep: params.errorStep,
        errorDescription: params.errorDescription,
      },
    });
  }

  // No razorpayPaymentId yet (e.g. abandoned checkout) — create fresh
  return prisma.payment.create({
    data: {
      orderId: params.orderId,
      razorpayPaymentId: null,
      status: params.status,
      method: params.method,
      errorCode: params.errorCode,
      errorReason: params.errorReason,
      errorSource: params.errorSource,
      errorStep: params.errorStep,
      errorDescription: params.errorDescription,
    },
  });
}

// ─── Order status update ─────────────────────────────────────────────────────

export async function updateOrderStatus(
  razorpayOrderId: string,
  status: string,
) {
  return prisma.order.updateMany({
    where: { razorpayOrderId },
    data: { status },
  });
}

export async function getOrderByRazorpayId(razorpayOrderId: string) {
  return prisma.order.findUnique({
    where: { razorpayOrderId },
    include: { customer: true, product: true },
  });
}

// ─── Failure classifier ──────────────────────────────────────────────────────

/**
 * Classifies a Razorpay error payload into one of the known FailureCategory values.
 * This is a deterministic rule-based classifier — not the LLM.
 */
export function classifyFailure(
  params: ClassifyFailureInput,
): ClassifyFailureResult {
  const { errorCode, errorReason, errorSource, errorStep, errorDescription } =
    params;
  const desc = (errorDescription ?? "").toLowerCase();
  const reason = (errorReason ?? "").toLowerCase();

  // Fraud / risk block — must NOT retry
  if (
    desc.includes("fraud") ||
    desc.includes("risk") ||
    reason.includes("fraud") ||
    reason.includes("risk_check")
  ) {
    return {
      category: FailureCategory.FraudBlock,
      rootCause: `Issuer/PSP fraud risk block. error_code=${errorCode}, error_source=${errorSource}. Do not retry.`,
    };
  }

  // Insufficient funds
  if (
    desc.includes("insufficient") ||
    reason.includes("insufficient_funds") ||
    desc.includes("low balance")
  ) {
    return {
      category: FailureCategory.InsufficientFunds,
      rootCause: `Customer account had insufficient funds. error_source=${errorSource}, error_step=${errorStep}.`,
    };
  }

  // Wrong PIN
  if (desc.includes("incorrect") && desc.includes("pin")) {
    return {
      category: FailureCategory.WrongPin,
      rootCause: `Customer entered incorrect UPI PIN. Immediate retry is safe.`,
    };
  }

  // Manual cancellation / abandonment
  if (
    reason.includes("payment_cancelled") ||
    desc.includes("cancelled") ||
    desc.includes("cancel")
  ) {
    return {
      category: FailureCategory.Abandoned,
      rootCause: `Customer cancelled the payment. Cart-abandonment nudge appropriate.`,
    };
  }

  // Do Not Honor (bank-side generic decline)
  if (
    errorSource === "bank" &&
    errorStep === "payment_authorization" &&
    errorCode === "GATEWAY_ERROR"
  ) {
    return {
      category: FailureCategory.DoNotHonor,
      rootCause: `Issuing bank returned generic Do Not Honor decline. error_source=bank, error_step=payment_authorization. Short-delay retry then suggest alt. method.`,
    };
  }

  // PSP / network timeout
  if (
    errorSource === "gateway" ||
    (errorCode === "GATEWAY_ERROR" && errorStep === "payment_authorization")
  ) {
    return {
      category: FailureCategory.PspTimeout,
      rootCause: `Gateway/NPCI/bank timeout. error_source=${errorSource}. Reconcile via Payment Fetch API before retry.`,
    };
  }

  return {
    category: FailureCategory.Unknown,
    rootCause: `Unclassified failure. error_code=${errorCode}, error_reason=${errorReason}, error_source=${errorSource}.`,
  };
}

// ─── Failure event creation ──────────────────────────────────────────────────

/**
 * Idempotent failure event creation.
 * Returns { event, isNew } — orchestrator should only be invoked when isNew === true.
 */
export async function createFailureEvent(params: {
  paymentId: string;
  category: FailureCategory;
  rootCause: string;
}): Promise<{
  event: Awaited<ReturnType<typeof prisma.failureEvent.findFirst>>;
  isNew: boolean;
}> {
  const existing = await prisma.failureEvent.findFirst({
    where: { paymentId: params.paymentId },
    include: { recoveryActions: true },
  });

  if (existing) {
    console.log(
      `⚠️  Failure event already exists for payment ${params.paymentId} — skipping duplicate`,
    );
    return { event: existing, isNew: false };
  }

  const event = await prisma.failureEvent.create({
    data: {
      paymentId: params.paymentId,
      classifiedCategory: params.category,
      rootCause: params.rootCause,
    },
    include: { recoveryActions: true },
  });

  return { event, isNew: true };
}

// ─── Query helpers (for the recovery agent / MCP tools later) ────────────────

export async function getPendingFailureEvents() {
  return prisma.failureEvent.findMany({
    where: { recoveryActions: { none: {} } },
    include: {
      payment: {
        include: { order: { include: { customer: true, product: true } } },
      },
    },
    orderBy: { detectedAt: "asc" },
  });
}

export async function getFailureEventById(id: string) {
  return prisma.failureEvent.findUnique({
    where: { id },
    include: {
      payment: {
        include: { order: { include: { customer: true, product: true } } },
      },
      recoveryActions: { orderBy: { attemptNumber: "asc" } },
    },
  });
}

export async function createRecoveryAction(params: RecoveryActionLog) {
  return prisma.recoveryAction.create({
    data: {
      failureEventId: params.failureEventId,
      actionType: params.actionType,
      channel: params.channel,
      outcome: params.outcome,
      attemptNumber: params.attemptNumber,
      agentReasoning: params.agentReasoning,
    },
  });
}
