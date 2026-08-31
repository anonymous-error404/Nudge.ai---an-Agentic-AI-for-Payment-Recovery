import { Request, Response } from "express";
import { prisma } from "../lib/prismaClient";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
} from "../services/razorpay";
import { orderRepository } from "../repositories/orderRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { failureEventRepository } from "../repositories/failureEventRepository";
import { failureClassifierService } from "../services/failureClassifierService";
import { handlePaymentFailure } from "../services/recoveryOrchestrator";
import crypto from "crypto";

class CheckoutController {
  async checkout(req: Request, res: Response) {
    const { productId, customerId } = req.body as {
      productId?: string;
      customerId?: string;
    };

    if (!productId || !customerId) {
      return res
        .status(400)
        .json({
          success: false,
          error: "productId and customerId are required",
        });
    }

    try {
      const [product, customer] = await Promise.all([
        prisma.product.findUnique({ where: { id: productId } }),
        prisma.customer.findUnique({ where: { id: customerId } }),
      ]);

      if (!product)
        return res
          .status(404)
          .json({ success: false, error: "Product not found" });
      if (!customer)
        return res
          .status(404)
          .json({ success: false, error: "Customer not found" });
      if (product.stock <= 0)
        return res
          .status(400)
          .json({ success: false, error: "Product out of stock" });

      const order = await orderRepository.create({
        customerId: customer.id,
        productId: product.id,
        amount: product.price,
        status: "created",
      });

      const razorpayOrder = await createRazorpayOrder({
        amount: product.price,
        currency: "INR",
        receipt: order.id,
        notes: { product_name: product.name, customer_email: customer.email },
      });

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
  }

  async getPaymentStatus(req: Request, res: Response) {
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
  }

  async verifyPayment(req: Request, res: Response) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res
        .status(400)
        .json({
          success: false,
          error: "Missing payment verification parameters",
        });
    }

    try {
      const keySecret = process.env.RAZORPAY_KEY_SECRET!;
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Payment signature verification failed",
          });
      }

      const order = await orderRepository.findByRazorpayId(razorpay_order_id);

      if (order) {
        await orderRepository.updateStatusByRazorpayId(
          razorpay_order_id,
          "paid",
        );
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
  }

  async handlePaymentFailed(req: Request, res: Response) {
    const { razorpay_order_id, razorpay_payment_id, error, method } = req.body;

    if (!razorpay_order_id) {
      return res
        .status(400)
        .json({ success: false, error: "razorpay_order_id is required" });
    }

    try {
      const order = await orderRepository.findByRazorpayId(razorpay_order_id);
      if (!order) {
        return res
          .status(404)
          .json({ success: false, error: "Order not found" });
      }

      await orderRepository.updateStatusByRazorpayId(
        razorpay_order_id,
        "failed",
      );
      const payment = await paymentRepository.upsertPayment({
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

      const { category, rootCause } = failureClassifierService.classify({
        errorCode: error?.code,
        errorReason: error?.reason,
        errorSource: error?.source,
        errorStep: error?.step,
        errorDescription: error?.description,
      });

      const { event: failureEvent, isNew } =
        await failureEventRepository.createIdempotent({
          paymentId: payment.id,
          category,
          rootCause,
        });

      let decision;
      if (isNew && failureEvent) {
        decision = await handlePaymentFailure(
          failureEvent.id,
          category,
          payment.id,
        );
      } else {
        decision = {
          recoveryType: "delayed",
          action: "send_notification",
          message: "Payment failed. We'll follow up shortly.",
        };
      }

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
  }
}

export const checkoutController = new CheckoutController();
