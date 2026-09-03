import { RazorpayWebhookEvent } from "../types";
import { orderRepository } from "../repositories/orderRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { failureEventRepository } from "../repositories/failureEventRepository";
import { failureClassifierService } from "./failureClassifierService";
import { handlePaymentFailure } from "../../mcp-client/recovery-intelligence/recoveryOrchestrator";

class WebhookService {
  async processEvent(
    event: RazorpayWebhookEvent,
  ): Promise<{ uiMessage?: string }> {
    const eventType = event.event;
    console.log(`📨 Webhook received: ${eventType}`);

    try {
      switch (eventType) {
        case "payment.failed":
          return await this.handlePaymentFailed(event);
        case "payment.authorized":
          await this.handlePaymentAuthorized(event);
          break;
        case "payment.captured":
          await this.handlePaymentCaptured(event);
          break;
        case "order.paid":
          await this.handleOrderPaid(event);
          break;
        default:
          console.log(`ℹ️  Unhandled event type: ${eventType}`);
      }
    } catch (err) {
      console.error(`❌ Error processing webhook event ${eventType}:`, err);
    }
    return {};
  }

  private async handlePaymentFailed(
    event: RazorpayWebhookEvent,
  ): Promise<{ uiMessage?: string }> {
    const payload = event.payload.payment?.entity;
    if (!payload) return {};

    const razorpayOrderId = payload.order_id;
    const order = razorpayOrderId
      ? await orderRepository.findByRazorpayId(razorpayOrderId)
      : null;

    if (!order) {
      console.warn(
        `⚠️  No local order found for razorpay_order_id: ${razorpayOrderId}`,
      );
      return {};
    }

    if (razorpayOrderId) {
      await orderRepository.updateStatusByRazorpayId(razorpayOrderId, "failed");
    }

    const payment = await paymentRepository.upsertPayment({
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

    const { category, rootCause } = failureClassifierService.classify({
      errorCode: payload.error_code,
      errorReason: payload.error_reason,
      errorSource: payload.error_source,
      errorStep: payload.error_step,
      errorDescription: payload.error_description,
    });

    const { event: failureEvent, isNew } =
      await failureEventRepository.createIdempotent({
        orderId: order.id,
        paymentId: payment.id,
        category,
        rootCause,
      });

    if (isNew && failureEvent) {
      // Await the orchestrator — its uiMessage travels back through the webhook response
      const decision = await handlePaymentFailure(
        failureEvent.id,
        category,
        payment.id,
      );
      console.log(
        `💥 Webhook: payment failed + orchestrator invoked: payment=${payload.id} | category=${category} | order=${order.id}`,
      );
      return { uiMessage: decision.uiMessage };
    } else {
      console.log(
        `💥 Webhook: payment failed (duplicate — already handled): payment=${payload.id} | category=${category}`,
      );
      return {};
    }
  }

  private async handlePaymentAuthorized(event: RazorpayWebhookEvent) {
    const payload = event.payload.payment?.entity;
    if (!payload || !payload.order_id) return;

    await orderRepository.updateStatusByRazorpayId(
      payload.order_id,
      "attempted",
    );
    const order = await orderRepository.findByRazorpayId(payload.order_id);
    if (order) {
      await paymentRepository.upsertPayment({
        orderId: order.id,
        razorpayPaymentId: payload.id,
        status: "authorized",
        method: payload.method,
      });
    }

    console.log(`✅ Payment authorized: ${payload.id}`);
  }

  private async handlePaymentCaptured(event: RazorpayWebhookEvent) {
    const payload = event.payload.payment?.entity;
    if (!payload || !payload.order_id) return;

    const order = await orderRepository.findByRazorpayId(payload.order_id);
    if (!order) return;

    await orderRepository.updateStatusByRazorpayId(payload.order_id, "paid");
    await paymentRepository.upsertPayment({
      orderId: order.id,
      razorpayPaymentId: payload.id,
      status: "captured",
      method: payload.method,
    });

    console.log(
      `💰 Payment captured: ${payload.id} — order ${order.id} marked paid`,
    );
  }

  private async handleOrderPaid(event: RazorpayWebhookEvent) {
    const orderPayload = event.payload.order?.entity;
    if (!orderPayload) return;

    await orderRepository.updateStatusByRazorpayId(orderPayload.id, "paid");
    console.log(`📦 Order paid: razorpay_order_id=${orderPayload.id}`);
  }
}

export const webhookService = new WebhookService();
