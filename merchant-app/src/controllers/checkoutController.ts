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
import { failureSimulatorService } from "../services/failureSimulatorService";
import crypto from "crypto";

class CheckoutController {
  async simulateCheckout(req: Request, res: Response) {
    const { productId, customerId, outcome, scenarioKey } = req.body as {
      productId?: string;
      customerId?: string;
      outcome?: "success" | "fail";
      scenarioKey?: string;
    };

    if (!productId || !customerId || !outcome) {
      return res.status(400).json({
        success: false,
        error: "productId, customerId, and outcome are required",
      });
    }

    if (!["success", "fail"].includes(outcome)) {
      return res
        .status(400)
        .json({ success: false, error: "outcome must be 'success' or 'fail'" });
    }

    try {
      const result = await failureSimulatorService.simulateCheckout({
        productId,
        customerId,
        outcome: outcome as "success" | "fail",
        scenarioKey,
      });
      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error("Error in simulateCheckout:", err);
      const status =
        err.message.includes("not found") ||
        err.message.includes("required") ||
        err.message.includes("out of stock")
          ? 400
          : 500;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  async checkout(req: Request, res: Response) {
    const { productId, customerId, quantity: rawQty } = req.body as {
      productId?: string;
      customerId?: string;
      quantity?: number;
    };
    const quantity = Math.max(1, Number(rawQty) || 1);

    if (!productId || !customerId) {
      return res.status(400).json({
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
        return res.status(404).json({ success: false, error: "Product not found" });
      if (!customer)
        return res.status(404).json({ success: false, error: "Customer not found" });
      if (product.stock < quantity)
        return res.status(400).json({ success: false, error: `Only ${product.stock} unit(s) left in stock` });

      const totalAmount = product.price * quantity;

      // ── Idempotency: reuse an existing open order for same customer+product+quantity ──
      let existingOrder = await orderRepository.findOpenOrderForCustomerProduct(customerId, productId);
      let order: any;

      if (existingOrder && existingOrder.quantity === quantity) {
        // Reuse — refresh amount to current price
        console.log(`🔄 Reusing open order ${existingOrder.id} for customer=${customerId} product=${productId}`);
        order = await orderRepository.update(existingOrder.id, {
          amount: totalAmount,
          status: "attempted",
        });
      } else {
        // Create fresh (quantity changed or no open order)
        order = await orderRepository.create({
          customerId: customer.id,
          productId: product.id,
          quantity,
          amount: totalAmount,
          status: "created",
        });
      }

      const razorpayOrder = await createRazorpayOrder({
        amount: totalAmount,
        currency: "INR",
        receipt: order!.id,
        notes: { product_name: product.name, customer_email: customer.email },
      });

      await prisma.order.update({
        where: { id: order!.id },
        data: { razorpayOrderId: razorpayOrder.id },
      });

      res.json({
        success: true,
        data: {
          orderId: order!.id,
          retryToken: (order as any).retryToken,
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
      res.status(500).json({ success: false, error: "Failed to create checkout" });
    }
  }

  async getOrderByRetryToken(req: Request, res: Response) {
    const { token } = req.params;
    try {
      const order = await orderRepository.findByRetryToken(token);
      if (!order)
        return res.status(404).json({ success: false, error: "Order not found" });

      // Only allow retry on non-paid orders
      if (order.status === "paid")
        return res.status(400).json({ success: false, error: "Order is already paid" });

      const product = order.product as any;
      const customer = order.customer as any;

      res.json({
        success: true,
        data: {
          orderId: order.id,
          retryToken: order.retryToken,
          status: order.status,
          quantity: order.quantity,
          originalAmount: order.amount, // paise at time of original order
          currentPrice: product.price,  // latest unit price in paise
          currentTotal: product.price * order.quantity, // refreshed total
          stockAvailable: product.stock >= order.quantity,
          product: {
            id: product.id,
            name: product.name,
            description: product.description,
            imageUrl: product.imageUrl,
            stock: product.stock,
          },
          customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
          },
        },
      });
    } catch (err) {
      console.error("Error fetching order by retry token:", err);
      res.status(500).json({ success: false, error: "Failed to fetch order" });
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
      return res.status(400).json({
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
        return res.status(400).json({
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
          orderId: order.id,
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
          uiMessage: "Payment failed. Please try again.",
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
