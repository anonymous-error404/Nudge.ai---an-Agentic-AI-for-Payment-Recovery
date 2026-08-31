import {
  upsertPayment,
  classifyFailure,
  createFailureEvent,
} from "../repositories/paymentStore";
import { handlePaymentFailure } from "../services/recoveryOrchestrator";
import crypto from "crypto";
import { prisma } from "../lib/prismaClient";
import { FailureCategory } from "../enums";
import type { FailureScenario } from "../types";
import { Request, Response } from "express";

const FAILURE_SCENARIOS: Record<string, FailureScenario> = {
  insufficient_funds: {
    label: "Insufficient Funds",
    description: "UPI debit fails — account balance too low at time of payment",
    method: "upi",
    errorCode: "BAD_REQUEST_ERROR",
    errorDescription:
      "Your payment failed because of insufficient funds. Please try again with another payment method.",
    errorSource: "customer",
    errorStep: "payment_authentication",
    errorReason: "payment_failed",
    // these things should be decided by AI, and tell mcp client to do this
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
    description:
      "Customer opened checkout but cancelled before completing payment",
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
    description:
      "Issuing bank returned generic decline (DNH) during card authorization",
    method: "card",
    errorCode: "GATEWAY_ERROR",
    errorDescription:
      "Your payment was declined by the bank. Please try again or use a different payment method.",
    errorSource: "bank",
    errorStep: "payment_authorization",
    errorReason: "payment_failed",
    expectedCategory: FailureCategory.DoNotHonor,
    expectedRecovery:
      "delayed → send_notification (email: suggest alt. method)",
  },
  psp_timeout: {
    label: "PSP / Network Timeout",
    description:
      "Multi-hop PSP–NPCI–bank timeout; status unknown — must reconcile before retry",
    method: "upi",
    errorCode: "GATEWAY_ERROR",
    errorDescription:
      "Payment failed due to a timeout between the payment gateway and bank. Please try again.",
    errorSource: "gateway",
    errorStep: "payment_authorization",
    errorReason: "payment_failed",
    expectedCategory: FailureCategory.PspTimeout,
    expectedRecovery: "immediate → retry_payment (after reconciliation)",
  },
};

class FailureSimulatorController {
  async simulate_failure(req: Request, res: Response) {
    const { failureType, customerId, productId } = req.body as {
      failureType?: string;
      customerId?: string;
      productId?: string;
    };

    if (!failureType || !FAILURE_SCENARIOS[failureType]) {
      return res.status(400).json({
        success: false,
        error: `Unknown failureType. Valid values: ${Object.keys(FAILURE_SCENARIOS).join(", ")}`,
      });
    }

    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({
        success: false,
        error:
          "WEBHOOK_SECRET not set in .env — required to sign simulated webhook",
      });
    }

    const scenario = FAILURE_SCENARIOS[failureType];

    try {
      // 1. Pick a customer and product (use provided or pick random from DB)
      const customer = customerId
        ? await prisma.customer.findUnique({ where: { id: customerId } })
        : await prisma.customer.findFirst({ orderBy: { createdAt: "asc" } });

      const product = productId
        ? await prisma.product.findUnique({ where: { id: productId } })
        : await prisma.product.findFirst({ orderBy: { createdAt: "asc" } });

      if (!customer || !product) {
        return res
          .status(404)
          .json({ success: false, error: "Customer or product not found" });
      }

      // 2. Create a real order in our DB
      const fakeRazorpayOrderId = `order_sim_${failureType}_${Date.now()}`;
      const order = await prisma.order.create({
        data: {
          customerId: customer.id,
          productId: product.id,
          amount: product.price,
          status: "created",
          razorpayOrderId: fakeRazorpayOrderId,
        },
      });

      // 3. Build a Razorpay-shaped payment.failed webhook payload
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

      // 4. Sign the payload exactly as Razorpay does (HMAC-SHA256 of raw JSON body)
      const rawBody = JSON.stringify(webhookPayload);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      // 5. Self-POST to /webhook/razorpay to validate the signature pipeline
      //    (fire-and-forget — we don't wait on it for the result)
      const port = process.env.PORT ?? 3000;
      fetch(`http://localhost:${port}/webhook/razorpay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: rawBody,
      }).catch((e) => console.warn("Simulator webhook self-POST error:", e));

      // 6. Run the pipeline directly (same code the webhook calls) so we get
      //    the result synchronously without polling races.
      const payment = await upsertPayment({
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

      const { category, rootCause } = classifyFailure({
        errorCode: scenario.errorCode,
        errorReason: scenario.errorReason,
        errorSource: scenario.errorSource,
        errorStep: scenario.errorStep,
        errorDescription: scenario.errorDescription,
      });

      const { event: failureEvent, isNew } = await createFailureEvent({
        paymentId: payment.id,
        category,
        rootCause,
      });

      let recoveryDecision = null;
      if (isNew && failureEvent) {
        recoveryDecision = await handlePaymentFailure(
          failureEvent.id,
          category,
          payment.id,
        );
      }

      // Re-fetch with full includes for the response
      const failureEventFull = await prisma.failureEvent.findUnique({
        where: { id: failureEvent!.id },
        include: {
          recoveryActions: { orderBy: { attemptNumber: "asc" } },
          payment: { include: { order: true } },
        },
      });

      console.log(
        `🧪 Simulated ${failureType} | order=${order.id} | payment=${fakePaymentId} | category=${category} | recovery=${recoveryDecision?.action}`,
      );

      res.json({
        success: true,
        data: {
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
        },
      });
    } catch (err) {
      console.error("Simulator error:", err);
      res.status(500).json({ success: false, error: String(err) });
    }
  }

  getFailureScenarios(req: Request, res: Response) {
    res.json({
      success: true,
      data: Object.entries(FAILURE_SCENARIOS).map(([key, s]) => ({
        key,
        label: s.label,
        description: s.description,
        method: s.method,
        expectedCategory: s.expectedCategory,
        expectedRecovery: s.expectedRecovery,
      })),
    });
  }
}

export default new FailureSimulatorController();
