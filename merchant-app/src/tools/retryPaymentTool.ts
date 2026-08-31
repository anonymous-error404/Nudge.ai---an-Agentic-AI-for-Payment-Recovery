/**
 * retry_payment tool
 * Creates a new Razorpay order for the failed payment and returns a checkout link.
 */
import { prisma } from "../lib/prismaClient";
import { createRazorpayOrder } from "../services/razorpay";

export const retryPaymentSchema = {
  type: "function" as const,
  function: {
    name: "retry_payment",
    description:
      "Creates a fresh Razorpay checkout link for a failed payment so the customer can retry. " +
      "Use for immediate retry cases (wrong PIN, PSP timeout) or when the customer signals intent to pay again.",
    parameters: {
      type: "object" as const,
      properties: {
        payment_id: {
          type: "string",
          description: "The merchant-side payment ID that failed.",
        },
        delay_minutes: {
          type: "number",
          description: "Minutes to wait before presenting the retry link (0 = immediate).",
        },
      },
      required: ["payment_id"],
    },
  },
};

export async function executeRetryPayment(args: {
  payment_id: string;
  delay_minutes?: number;
}): Promise<{ success: boolean; checkoutUrl?: string; message: string }> {
  try {
    // Look up the original payment + order to get amount and customer
    const payment = await prisma.payment.findUnique({
      where: { id: args.payment_id },
      include: {
        order: { include: { customer: true, product: true } },
      },
    });

    if (!payment || !payment.order) {
      return { success: false, message: `Payment ${args.payment_id} not found` };
    }

    const { order } = payment;

    // Create a fresh Razorpay order for the same amount
    const razorpayOrder = await createRazorpayOrder({
      amount: order.amount,
      currency: "INR",
      receipt: order.id,
      notes: {
        retry_for_payment: args.payment_id,
        product_name: order.product?.name ?? "",
      },
    });

    // Update the order with the new Razorpay order ID
    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: razorpayOrder.id, status: "created" },
    });

    const port = process.env.PORT ?? 3000;
    const checkoutUrl = `http://localhost:${port}/product?orderId=${order.id}&retryPaymentId=${args.payment_id}`;

    console.log(`\n🔄 [RETRY] New Razorpay order created: ${razorpayOrder.id}`);
    console.log(`   Checkout URL: ${checkoutUrl}`);

    return { success: true, checkoutUrl, message: `Retry order created: ${razorpayOrder.id}` };
  } catch (err) {
    return { success: false, message: `Retry failed: ${String(err)}` };
  }
}
