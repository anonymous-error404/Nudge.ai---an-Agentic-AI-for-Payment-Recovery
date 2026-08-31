import Razorpay from "razorpay";
import { CreateOrderParams } from "../types";

// Re-export so existing callers importing from here still work
export type { CreateOrderParams };

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  throw new Error(
    "Missing Razorpay credentials. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env",
  );
}

// Singleton Razorpay client
export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Creates a Razorpay Order via the Orders API.
 * Returns the Razorpay order object including id, amount, currency.
 */
export async function createRazorpayOrder(params: CreateOrderParams) {
  const order = await razorpay.orders.create({
    amount: params.amount,
    currency: params.currency ?? "INR",
    receipt: params.receipt,
    notes: params.notes ?? {},
  });
  return order;
}

/**
 * Fetches a payment by Razorpay payment ID.
 * Used for reconciliation before any recovery action (guards against double-charge).
 */
export async function fetchRazorpayPayment(razorpayPaymentId: string) {
  const payment = await razorpay.payments.fetch(razorpayPaymentId);
  return payment;
}

/**
 * Fetches all payments for a given Razorpay order ID.
 * Useful for checking if an order has a pending/captured payment before retrying.
 */
export async function fetchOrderPayments(razorpayOrderId: string) {
  const result = await razorpay.orders.fetchPayments(razorpayOrderId);
  return result;
}
