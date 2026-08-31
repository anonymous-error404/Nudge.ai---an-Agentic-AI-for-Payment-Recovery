import { Router, Request, Response } from "express";
import crypto from "crypto";
import {
  upsertPayment,
  updateOrderStatus,
  getOrderByRazorpayId,
  classifyFailure,
  createFailureEvent,
} from "../repositories/paymentStore";
import { handlePaymentFailure } from "../services/recoveryOrchestrator";
import type { RazorpayWebhookEvent } from "../types";

const router = Router();

function verifyWebhookSignature(req: Request): boolean {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("WEBHOOK_SECRET not set — rejecting webhook");
    return false;
  }

  const signature = req.headers["x-razorpay-signature"] as string;
  if (!signature) {
    console.error("Missing x-razorpay-signature header");
    return false;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    console.error("rawBody not captured — check server.ts middleware order");
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex"),
  );
}

// ─── Webhook endpoint ────────────────────────────────────────────────────────

/**
 * POST /webhook/razorpay
 *
 * Receives Razorpay webhook events. Per design doc requirements:
 * - Verifies HMAC-SHA256 signature (non-negotiable)
 * - ACKs immediately with HTTP 200 (Razorpay retries on non-200)
 * - Writes to DB asynchronously after ACK
 *
 * Handles:
 *   payment.failed       → logs payment + creates failure_event
 *   payment.authorized   → logs payment as authorized
 *   payment.captured     → updates order to paid
 *   order.paid           → marks order as paid
 */
router.post("/webhook/razorpay", async (req: Request, res: Response) => {
  // 1. Verify signature FIRST — reject immediately if invalid
  if (!verifyWebhookSignature(req)) {
    console.warn("⚠️  Webhook signature verification FAILED — rejecting");
    return res.status(400).json({ error: "Invalid signature" });
  }

  // 2. ACK immediately — Razorpay will retry if we take too long or return non-200
  res.status(200).json({ status: "ok" });

  // We will add job queue here, for different events
  // 3. Process event asynchronously (after ACK)
  const event = req.body as RazorpayWebhookEvent;
  const eventType = event.event;

  console.log(`📨 Webhook received: ${eventType}`);

  try {
    switch (eventType) {
      case "payment.failed":
        await handlePaymentFailed(event);
        break;
      case "payment.authorized":
        await handlePaymentAuthorized(event);
        break;
      case "payment.captured":
        await handlePaymentCaptured(event);
        break;
      case "order.paid":
        await handleOrderPaid(event);
        break;
      default:
        console.log(`ℹ️  Unhandled event type: ${eventType}`);
    }
  } catch (err) {
    // Don't let async processing errors bubble up — the 200 ACK is already sent
    console.error(`❌ Error processing webhook event ${eventType}:`, err);
  }
});

// ─── Event handlers ──────────────────────────────────────────────────────────

async function handlePaymentFailed(event: RazorpayWebhookEvent) {
  const payload = event.payload.payment?.entity;
  if (!payload) return;

  const razorpayOrderId = payload.order_id;
  const order = razorpayOrderId
    ? await getOrderByRazorpayId(razorpayOrderId)
    : null;

  if (!order) {
    console.warn(
      `⚠️  No local order found for razorpay_order_id: ${razorpayOrderId}`,
    );
    return;
  }

  // Update order status
  if (razorpayOrderId) {
    await updateOrderStatus(razorpayOrderId, "failed");
  }

  // Upsert payment record
  const payment = await upsertPayment({
    orderId: order.id,
    razorpayPaymentId: payload.id,
    status: "failed",
    method: payload.method,
    errorCode: payload.error_code,
    errorReason: payload.error_reason,
    errorSource: payload.error_source,
    errorStep: payload.error_step,
    errorDescription: payload.error_description,
  });

  // Classify the failure and create failure_event (idempotent — frontend may have already done this)
  const { category, rootCause } = classifyFailure({
    errorCode: payload.error_code,
    errorReason: payload.error_reason,
    errorSource: payload.error_source,
    errorStep: payload.error_step,
    errorDescription: payload.error_description,
  });

  const { event: failureEvent, isNew } = await createFailureEvent({
    paymentId: payment.id,
    category,
    rootCause,
  });

  // Only invoke the orchestrator if this is the first time this failure is seen.
  // If the frontend already called POST /api/payment/failed, isNew will be false
  // and the recovery action is already logged — no need to call again.
  if (isNew && failureEvent) {
    await handlePaymentFailure(failureEvent.id, category, payment.id);
    console.log(
      `💥 Webhook: payment failed + orchestrator invoked: payment=${payload.id} | category=${category} | order=${order.id}`,
    );
  } else {
    console.log(
      `💥 Webhook: payment failed (already handled by frontend): payment=${payload.id} | category=${category}`,
    );
  }
}

async function handlePaymentAuthorized(event: RazorpayWebhookEvent) {
  const payload = event.payload.payment?.entity;
  if (!payload || !payload.order_id) return;

  await updateOrderStatus(payload.order_id, "attempted");
  await upsertPayment({
    orderId: (await getOrderByRazorpayId(payload.order_id))?.id ?? "",
    razorpayPaymentId: payload.id,
    status: "authorized",
    method: payload.method,
  });

  console.log(`✅ Payment authorized: ${payload.id}`);
}

async function handlePaymentCaptured(event: RazorpayWebhookEvent) {
  const payload = event.payload.payment?.entity;
  if (!payload || !payload.order_id) return;

  const order = await getOrderByRazorpayId(payload.order_id);
  if (!order) return;

  await updateOrderStatus(payload.order_id, "paid");
  await upsertPayment({
    orderId: order.id,
    razorpayPaymentId: payload.id,
    status: "captured",
    method: payload.method,
  });

  console.log(
    `💰 Payment captured: ${payload.id} — order ${order.id} marked paid`,
  );
}

async function handleOrderPaid(event: RazorpayWebhookEvent) {
  const orderPayload = event.payload.order?.entity;
  if (!orderPayload) return;

  await updateOrderStatus(orderPayload.id, "paid");
  console.log(`📦 Order paid: razorpay_order_id=${orderPayload.id}`);
}

export default router;
