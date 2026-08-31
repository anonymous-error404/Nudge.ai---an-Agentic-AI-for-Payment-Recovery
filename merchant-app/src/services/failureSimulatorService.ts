import { prisma } from "../lib/prismaClient";
import { FailureCategory } from "../enums";
import type { FailureScenario } from "../types";
import { orderRepository } from "../repositories/orderRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { failureEventRepository } from "../repositories/failureEventRepository";
import { failureClassifierService } from "./failureClassifierService";
import { handlePaymentFailure } from "./recoveryOrchestrator";
import crypto from "crypto";

export const FAILURE_SCENARIOS: Record<string, FailureScenario> = {
  insufficient_funds: {
    label: "Insufficient Funds",
    description: "UPI debit fails — account balance too low at time of payment",
    method: "upi",
    errorCode: "BAD_REQUEST_ERROR",
    errorDescription: "Your payment failed because of insufficient funds. Please try again with another payment method.",
    errorSource: "customer",
    errorStep: "payment_authentication",
    errorReason: "payment_failed",
    expectedCategory: FailureCategory.InsufficientFunds,
    expectedRecovery: "delayed → send_notification (SMS reminder)",
  },
  wrong_pin: {
    label: "Wrong UPI PIN",
    description: "Customer entered incorrect UPI PIN during authentication",
    method: "upi",
    errorCode: "BAD_REQUEST_ERROR",
    errorDescription: "Payment failed because incorrect UPI PIN was entered.",
    errorSource: "customer",
    errorStep: "payment_authentication",
    errorReason: "payment_failed",
    expectedCategory: FailureCategory.WrongPin,
    expectedRecovery: "immediate → retry_payment (re-open modal)",
  },
  abandoned: {
    label: "Checkout Abandoned",
    description: "Customer opened checkout but cancelled before completing payment",
    method: "upi",
    errorCode: "BAD_REQUEST_ERROR",
    errorDescription: "Payment cancelled by customer.",
    errorSource: "customer",
    errorStep: "payment_initiation",
    errorReason: "payment_cancelled",
    expectedCategory: FailureCategory.Abandoned,
    expectedRecovery: "delayed → send_notification (email nudge)",
  },
  do_not_honor: {
    label: "Bank Do Not Honor",
    description: "Issuing bank returned generic decline (DNH) during card authorization",
    method: "card",
    errorCode: "GATEWAY_ERROR",
    errorDescription: "Your payment was declined by the bank. Please try again or use a different payment method.",
    errorSource: "bank",
    errorStep: "payment_authorization",
    errorReason: "payment_failed",
    expectedCategory: FailureCategory.DoNotHonor,
    expectedRecovery: "delayed → send_notification (email: suggest alt. method)",
  },
  psp_timeout: {
    label: "PSP / Network Timeout",
    description: "Multi-hop PSP–NPCI–bank timeout; status unknown — must reconcile before retry",
    method: "upi",
    errorCode: "GATEWAY_ERROR",
    errorDescription: "Payment failed due to a timeout between the payment gateway and bank. Please try again.",
    errorSource: "gateway",
    errorStep: "payment_authorization",
    errorReason: "payment_failed",
    expectedCategory: FailureCategory.PspTimeout,
    expectedRecovery: "immediate → retry_payment (after reconciliation)",
  },
};

class FailureSimulatorService {
  getScenarios() {
    return Object.entries(FAILURE_SCENARIOS).map(([key, s]) => ({
      key,
      label: s.label,
      description: s.description,
      method: s.method,
      expectedCategory: s.expectedCategory,
      expectedRecovery: s.expectedRecovery,
    }));
  }

  async simulateFailure(failureType: string, customerId?: string, productId?: string) {
    if (!FAILURE_SCENARIOS[failureType]) {
      throw new Error(`Unknown failureType. Valid values: ${Object.keys(FAILURE_SCENARIOS).join(", ")}`);
    }

    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("WEBHOOK_SECRET not set in .env — required to sign simulated webhook");
    }

    const scenario = FAILURE_SCENARIOS[failureType];

    const customer = customerId
      ? await prisma.customer.findUnique({ where: { id: customerId } })
      : await prisma.customer.findFirst({ orderBy: { createdAt: "asc" } });

    const product = productId
      ? await prisma.product.findUnique({ where: { id: productId } })
      : await prisma.product.findFirst({ orderBy: { createdAt: "asc" } });

    if (!customer || !product) {
      throw new Error("Customer or product not found");
    }

    const fakeRazorpayOrderId = `order_sim_${failureType}_${Date.now()}`;
    const order = await orderRepository.create({
      customerId: customer.id,
      productId: product.id,
      amount: product.price,
      status: "created",
      razorpayOrderId: fakeRazorpayOrderId,
    });

    const fakePaymentId = `pay_sim_${failureType}_${Date.now()}`;
    const webhookPayload = {
      entity: "event",
      account_id: "acc_test_simulator",
      event: "payment.failed",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: fakePaymentId,
            entity: "payment",
            amount: product.price,
            currency: "INR",
            status: "failed",
            order_id: fakeRazorpayOrderId,
            method: scenario.method,
            error_code: scenario.errorCode,
            error_description: scenario.errorDescription,
            error_source: scenario.errorSource,
            error_step: scenario.errorStep,
            error_reason: scenario.errorReason,
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };

    const rawBody = JSON.stringify(webhookPayload);
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const port = process.env.PORT ?? 3000;
    fetch(`http://localhost:${port}/webhook/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": signature,
      },
      body: rawBody,
    }).catch((e) => console.warn("Simulator webhook self-POST error:", e));

    const payment = await paymentRepository.upsertPayment({
      orderId: order.id,
      razorpayPaymentId: fakePaymentId,
      status: "failed",
      method: scenario.method,
      errorCode: scenario.errorCode,
      errorReason: scenario.errorReason,
      errorSource: scenario.errorSource,
      errorStep: scenario.errorStep,
      errorDescription: scenario.errorDescription,
    });

    const { category, rootCause } = failureClassifierService.classify({
      errorCode: scenario.errorCode,
      errorReason: scenario.errorReason,
      errorSource: scenario.errorSource,
      errorStep: scenario.errorStep,
      errorDescription: scenario.errorDescription,
    });

    const { event: failureEvent, isNew } = await failureEventRepository.createIdempotent({
      paymentId: payment.id,
      category,
      rootCause,
    });

    let recoveryDecision = null;
    if (isNew && failureEvent) {
      recoveryDecision = await handlePaymentFailure(failureEvent.id, category, payment.id);
    }

    const failureEventFull = await failureEventRepository.getById(failureEvent!.id);

    console.log(`🧪 Simulated ${failureType} | order=${order.id} | payment=${fakePaymentId} | category=${category} | recovery=${recoveryDecision?.action}`);

    return {
      scenario: {
        failureType,
        label: scenario.label,
        expectedCategory: scenario.expectedCategory,
        expectedRecovery: scenario.expectedRecovery,
      },
      order: {
        id: order.id,
        razorpayOrderId: fakeRazorpayOrderId,
        amount: product.price,
      },
      payment: { id: fakePaymentId },
      recoveryDecision,
      failureEvent: failureEventFull
        ? {
            id: failureEventFull.id,
            classifiedCategory: failureEventFull.classifiedCategory,
            rootCause: failureEventFull.rootCause,
            recoveryActions: failureEventFull.recoveryActions.map((a) => ({
              actionType: a.actionType,
              outcome: a.outcome,
              attemptNumber: a.attemptNumber,
              agentReasoning: a.agentReasoning,
            })),
          }
        : null,
    };
  }
}

export const failureSimulatorService = new FailureSimulatorService();
