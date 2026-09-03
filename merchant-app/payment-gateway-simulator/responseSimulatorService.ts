import { prisma } from "../src/lib/prismaClient";
import { FailureCategory } from "../src/enums";
import type { FailureScenario } from "../src/types";
import { orderRepository } from "../src/repositories/orderRepository";
import { paymentRepository } from "../src/repositories/paymentRepository";
import { failureEventRepository } from "../src/repositories/failureEventRepository";
import { failureClassifierService } from "../src/services/failureClassifierService";
import crypto from "crypto";

export const FAILURE_SCENARIOS: Record<string, FailureScenario> = {
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

class ResponseSimulatorService {
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

  async simulateGatewayResponse(params: {
    productId: string;
    customerId: string;
    outcome: "success" | "fail";
    scenarioKey?: string;
  }) {
    const { productId, customerId, outcome, scenarioKey } = params;

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!product) throw new Error("Product not found");
    if (!customer) throw new Error("Customer not found");

    const quantity = 1; // checkout page currently orders 1 unit; extend later if needed
    if (product.stock < quantity) throw new Error("Product out of stock");

    const totalAmount = product.price * quantity;

    // ── Idempotency: reuse an existing open order for same customer+product ──
    let existingOrder = await orderRepository.findOpenOrderForCustomerProduct(
      customer.id,
      product.id,
    );

    let order: any;
    let fakeRazorpayOrderId: string;

    if (existingOrder && existingOrder.quantity === quantity) {
      // Reuse — refresh amount to current price
      console.log(
        `🔄 [Simulated Checkout] Reusing open order ${existingOrder.id}`,
      );
      fakeRazorpayOrderId = `order_ck_${outcome}_${Date.now()}`;
      order = await orderRepository.update(existingOrder.id, {
        amount: totalAmount,
        status: "attempted",
        razorpayOrderId: fakeRazorpayOrderId,
      });
    } else {
      fakeRazorpayOrderId = `order_ck_${outcome}_${Date.now()}`;
      order = await orderRepository.create({
        customerId: customer.id,
        productId: product.id,
        quantity,
        amount: totalAmount,
        status: "created",
        razorpayOrderId: fakeRazorpayOrderId,
      });
    }

    // ─── SUCCESS PATH ────────────────────────────────────────────────────────
    if (outcome === "success") {
      const fakeRazorpayPaymentId = `pay_ck_success_${Date.now()}`;
      const webhookSecret = process.env.WEBHOOK_SECRET;

      if (webhookSecret) {
        const webhookPayload = {
          entity: "event",
          account_id: "acc_test_simulator",
          event: "payment.captured",
          contains: ["payment"],
          payload: {
            payment: {
              entity: {
                id: fakeRazorpayPaymentId,
                entity: "payment",
                amount: totalAmount,
                currency: "INR",
                status: "captured",
                order_id: fakeRazorpayOrderId,
                method: "upi",
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
        }).catch((e) =>
          console.warn(
            "Simulated success webhook self-POST skipped:",
            e.message,
          ),
        );
      }

      console.log(
        `✅ [Simulated Checkout] SUCCESS | order=${order.id} | payment=${fakeRazorpayPaymentId} | webhook_fired`,
      );
      return {
        outcome: "success" as const,
        order: {
          id: order.id,
          razorpayOrderId: fakeRazorpayOrderId,
          amount: totalAmount,
        },
        payment: { id: fakeRazorpayPaymentId },
      };
    }

        // ─── FAILURE PATH ────────────────────────────────────────────────────────
    if (!scenarioKey || !FAILURE_SCENARIOS[scenarioKey]) {
      throw new Error(
        `scenarioKey is required for outcome=fail. Valid: ${Object.keys(FAILURE_SCENARIOS).join(", ")}`,
      );
    }
    const scenario = FAILURE_SCENARIOS[scenarioKey];
    const fakeRazorpayPaymentId = "pay_ck_fail_${scenarioKey}_${Date.now()}";

    // Fire the signed webhook self-POST
    // The webhook handler (webhookService.ts) owns the full DB write + classification
    // + AI orchestration pipeline. We let it handle everything to avoid race conditions.
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const webhookPayload = {
        entity: "event",
        account_id: "acc_test_simulator",
        event: "payment.failed",
        contains: ["payment"],
        payload: {
          payment: {
            entity: {
              id: fakeRazorpayPaymentId,
              entity: "payment",
              amount: totalAmount,
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
      fetch("http://localhost:${port}/webhook/razorpay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: rawBody,
      }).catch((e) =>
        console.warn("Simulated failure webhook self-POST skipped:", e.message),
      );
    }

    console.log(
      "❌ [Simulated Checkout] FAILURE | order=${order.id} | payment=${fakeRazorpayPaymentId} | webhook_fired",
    );

    return {
      outcome: "fail" as const,
      order: {
        id: order.id,
        razorpayOrderId: fakeRazorpayOrderId,
        amount: totalAmount,
      },
      payment: {
        id: fakeRazorpayPaymentId,
        errorCode: scenario.errorCode,
        errorReason: scenario.errorReason,
        errorSource: scenario.errorSource,
        errorStep: scenario.errorStep,
        errorDescription: scenario.errorDescription,
      },
    };
  }
}

export const responseSimulatorService = new ResponseSimulatorService();
