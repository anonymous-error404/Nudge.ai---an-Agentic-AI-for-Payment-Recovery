import { FailureCategory } from "../enums";
import { ClassifyFailureInput, ClassifyFailureResult } from "../types";

export class FailureClassifierService {
  /**
   * Classifies a Razorpay error payload into one of the known FailureCategory values.
   * This is a deterministic rule-based classifier — not the LLM.
   */
  classify(params: ClassifyFailureInput): ClassifyFailureResult {
    const { errorCode, errorReason, errorSource, errorStep, errorDescription } = params;
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
}

export const failureClassifierService = new FailureClassifierService();
