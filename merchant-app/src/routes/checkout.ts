import { Router, Request, Response } from "express";
import { prisma } from "../lib/prismaClient";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
} from "../services/razorpay";
import {
  upsertPayment,
  updateOrderStatus,
  getOrderByRazorpayId,
  classifyFailure,
  createFailureEvent,
} from "../repositories/paymentStore";
import { handlePaymentFailure } from "../services/recoveryOrchestrator";

const router = Router();

/**
 * POST /api/checkout
 *
 * Creates a Razorpay Order for a product purchase.
 * The frontend uses the returned order_id + key_id to open Razorpay Checkout.js.
 *
 * Body: { productId: string, customerId: string }
 */
router.post("/api/checkout", async (req: Request, res: Response) => {
  const { productId, customerId } = req.body as {
    productId?: string;
    customerId?: string;
  };

  if (!productId || !customerId) {
    return res.status(400).json({
      success: false,
      error: "productId and customerId are required",
    });
  }

  try {
    // Fetch product and customer
    const [product, customer] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.customer.findUnique({ where: { id: customerId } }),
    ]);

    if (!product) {
      return res
        .status(404)
        .json({ success: false, error: "Product not found" });
    }
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, error: "Customer not found" });
    }
    if (product.stock <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Product out of stock" });
    }

    // Create our internal order first
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        productId: product.id,
        amount: product.price,
        status: "created",
      },
    });

    // Create Razorpay Order
    const razorpayOrder = await createRazorpayOrder({
      amount: product.price,
      currency: "INR",
      receipt: order.id,
      notes: {
        product_name: product.name,
        customer_email: customer.email,
      },
    });

    // Update our order with the Razorpay order ID
    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: razorpayOrder.id },
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        productName: product.name,
      },
    });
  } catch (err) {
    console.error("Error creating checkout:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create checkout" });
  }
});

/**
 * GET /api/payment/:razorpayPaymentId/status
 *
 * Reconciliation endpoint — fetches the live status of a payment from Razorpay.
 * Used by the recovery agent before any retry to prevent double-charging.
 * This is the "Payment Fetch API" integration from Section 7 of the design doc.
 */
router.get(
  "/api/payment/:razorpayPaymentId/status",
  async (req: Request, res: Response) => {
    const { razorpayPaymentId } = req.params;

    try {
      const payment = await fetchRazorpayPayment(razorpayPaymentId);
      res.json({
        success: true,
        data: {
          id: payment.id,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          orderId: payment.order_id,
          errorCode: payment.error_code,
          errorDescription: payment.error_description,
          errorSource: payment.error_source,
          errorStep: payment.error_step,
          errorReason: payment.error_reason,
        },
      });
    } catch (err) {
      console.error("Error fetching payment status:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch payment status" });
    }
  },
);

/**
 * POST /api/payment/verify
 *
 * Verifies payment signature after successful Razorpay Checkout.
 * Called by the frontend after successful payment to confirm and update order status.
 *
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
router.post("/api/payment/verify", async (req: Request, res: Response) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      success: false,
      error: "Missing payment verification parameters",
    });
  }

  try {
    // Verify the payment signature
    const crypto = await import("crypto");
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Payment signature verification failed",
      });
    }

    // Update order status and create payment record
    const order = await prisma.order.findUnique({
      where: { razorpayOrderId: razorpay_order_id },
    });

    if (order) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "paid" },
      });

      await prisma.payment.upsert({
        where: { razorpayPaymentId: razorpay_payment_id },
        update: { status: "captured" },
        create: {
          orderId: order.id,
          razorpayPaymentId: razorpay_payment_id,
          status: "captured",
        },
      });
    }

    res.json({
      success: true,
      message: "Payment verified and order updated",
      data: { razorpay_payment_id, razorpay_order_id },
    });
  } catch (err) {
    console.error("Error verifying payment:", err);
    res
      .status(500)
      .json({ success: false, error: "Payment verification failed" });
  }
});

/**
 * POST /api/payment/failed
 *
 * Called by the frontend immediately when Razorpay Checkout.js fires the
 * payment.failed event. This is the "fast path" — it runs before the webhook
 * arrives (which can take seconds to minutes).
 *
 * Flow:
 *   1. Receive failure payload from the browser
 *   2. Upsert payment record + update order status
 *   3. Classify the failure (deterministic rules)
 *   4. Create failure_event (idempotent — webhook may arrive later)
 *   5. Call handlePaymentFailure() → get RecoveryDecision
 *   6. Return decision to frontend so it can act immediately
 *
 * Body: {
 *   razorpay_order_id: string
 *   razorpay_payment_id: string
 *   error: { code, description, source, step, reason, metadata }
 *   method?: string
 * }
 */
router.post("/api/payment/failed", async (req: Request, res: Response) => {
  const { razorpay_order_id, razorpay_payment_id, error, method } =
    req.body as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      error?: {
        code?: string;
        description?: string;
        source?: string;
        step?: string;
        reason?: string;
        metadata?: { order_id?: string; payment_id?: string };
      };
      method?: string;
    };

  if (!razorpay_order_id) {
    return res
      .status(400)
      .json({ success: false, error: "razorpay_order_id is required" });
  }

  try {
    // 1. Find our internal order
    const order = await getOrderByRazorpayId(razorpay_order_id);
    if (!order) {
      console.warn(
        `⚠️  No local order for razorpay_order_id=${razorpay_order_id}`,
      );
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // 2. Update order status + upsert payment record
    await updateOrderStatus(razorpay_order_id, "failed");
    const payment = await upsertPayment({
      orderId: order.id,
      razorpayPaymentId: razorpay_payment_id ?? null,
      status: "failed",
      method: method ?? null,
      errorCode: error?.code ?? null,
      errorReason: error?.reason ?? null,
      errorSource: error?.source ?? null,
      errorStep: error?.step ?? null,
      errorDescription: error?.description ?? null,
    });

    // 3. Classify the failure
    const { category, rootCause } = classifyFailure({
      errorCode: error?.code,
      errorReason: error?.reason,
      errorSource: error?.source,
      errorStep: error?.step,
      errorDescription: error?.description,
    });

    // 4. Create failure_event (idempotent — webhook may arrive and call this too)
    const { event: failureEvent, isNew } = await createFailureEvent({
      paymentId: payment.id,
      category,
      rootCause,
    });

    // 5. Call handlePaymentFailure() (only if this is the first time we're seeing it)
    //    If isNew is false, a recovery action was already logged — return the existing decision.
    let decision;
    if (isNew && failureEvent) {
      decision = await handlePaymentFailure(
        failureEvent.id,
        category,
        payment.id,
      );
    } else {
      // Already handled — return a neutral delayed response
      decision = {
        recoveryType: "delayed" as const,
        action: "send_notification" as const,
        message: "Payment failed. We'll follow up shortly.",
      };
    }

    console.log(
      `💥 Frontend payment failure handled: payment=${razorpay_payment_id} | category=${category} | recovery=${decision.recoveryType} | action=${decision.action}`,
    );

    res.json({
      success: true,
      data: {
        paymentId: payment.id,
        failureEventId: failureEvent?.id,
        category,
        decision,
      },
    });
  } catch (err) {
    console.error("Error handling payment failure:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to process payment failure" });
  }
});

export default router;
