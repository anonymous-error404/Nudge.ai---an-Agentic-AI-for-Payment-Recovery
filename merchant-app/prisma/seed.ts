/**
 * Seed script for the mock merchant app.
 *
 * Creates:
 *  - 5 customers
 *  - 5 products
 *  - 10 orders (mix of paid + failed)
 *  - 5 pre-seeded failed payments covering all 5 failure categories
 *  - 5 failure_events (one per failed payment)
 *
 * These pre-seeded failures are ready for the AI recovery agent to pick up.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Customers ──────────────────────────────────────────────────────────────
  const customers = await Promise.all([
    prisma.customer.upsert({
      where: { email: "arjun.sharma@example.com" },
      update: {},
      create: {
        name: "Arjun Sharma",
        phone: "+919876543210",
        email: "arjun.sharma@example.com",
        notificationPreferences: "email,sms",
      },
    }),
    prisma.customer.upsert({
      where: { email: "priya.patel@example.com" },
      update: {},
      create: {
        name: "Priya Patel",
        phone: "+919123456789",
        email: "priya.patel@example.com",
        notificationPreferences: "email,whatsapp",
      },
    }),
    prisma.customer.upsert({
      where: { email: "ravi.kumar@example.com" },
      update: {},
      create: {
        name: "Ravi Kumar",
        phone: "+917654321098",
        email: "ravi.kumar@example.com",
        notificationPreferences: "sms",
      },
    }),
    prisma.customer.upsert({
      where: { email: "sneha.iyer@example.com" },
      update: {},
      create: {
        name: "Sneha Iyer",
        phone: "+918765432109",
        email: "sneha.iyer@example.com",
        notificationPreferences: "email",
      },
    }),
    prisma.customer.upsert({
      where: { email: "vikram.nair@example.com" },
      update: {},
      create: {
        name: "Vikram Nair",
        phone: "+916543210987",
        email: "vikram.nair@example.com",
        notificationPreferences: "email,sms,whatsapp",
      },
    }),
  ]);

  console.log(`✅ Created ${customers.length} customers`);

  // ─── Products ───────────────────────────────────────────────────────────────
  const products = await Promise.all([
    prisma.product.upsert({
      where: { id: "prod_001" },
      update: {},
      create: {
        id: "prod_001",
        name: "Wireless Noise-Cancelling Headphones",
        description: "Premium over-ear headphones with 30hr battery life and active noise cancellation.",
        price: 799900, // ₹7,999
        imageUrl: "https://placehold.co/400x300/1a1a2e/ffffff?text=Headphones",
        stock: 50,
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_002" },
      update: {},
      create: {
        id: "prod_002",
        name: "Mechanical Gaming Keyboard",
        description: "RGB backlit mechanical keyboard with tactile switches and anti-ghosting.",
        price: 349900, // ₹3,499
        imageUrl: "https://placehold.co/400x300/16213e/ffffff?text=Keyboard",
        stock: 30,
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_003" },
      update: {},
      create: {
        id: "prod_003",
        name: "Smart Watch Pro",
        description: "Health monitoring smartwatch with GPS, SpO2, and 7-day battery.",
        price: 1299900, // ₹12,999
        imageUrl: "https://placehold.co/400x300/0f3460/ffffff?text=SmartWatch",
        stock: 25,
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_004" },
      update: {},
      create: {
        id: "prod_004",
        name: "USB-C Hub 7-in-1",
        description: "Multi-port hub with HDMI, USB 3.0, SD card, and 100W PD charging.",
        price: 149900, // ₹1,499
        imageUrl: "https://placehold.co/400x300/533483/ffffff?text=USB+Hub",
        stock: 100,
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_005" },
      update: {},
      create: {
        id: "prod_005",
        name: "Portable SSD 1TB",
        description: "Ultra-fast portable SSD with 1050MB/s read speeds and shock resistance.",
        price: 599900, // ₹5,999
        imageUrl: "https://placehold.co/400x300/e94560/ffffff?text=SSD",
        stock: 40,
      },
    }),
  ]);

  console.log(`✅ Created ${products.length} products`);

  // ─── Successful orders (2) ──────────────────────────────────────────────────
  const successOrder1 = await prisma.order.upsert({
    where: { id: "order_success_001" },
    update: {},
    create: {
      id: "order_success_001",
      customerId: customers[0].id,
      productId: products[0].id,
      amount: products[0].price,
      status: "paid",
      razorpayOrderId: "order_seed_success_001",
    },
  });

  await prisma.payment.upsert({
    where: { id: "pay_success_001" },
    update: {},
    create: {
      id: "pay_success_001",
      orderId: successOrder1.id,
      razorpayPaymentId: "pay_seed_success_001",
      status: "captured",
      method: "upi",
    },
  });

  const successOrder2 = await prisma.order.upsert({
    where: { id: "order_success_002" },
    update: {},
    create: {
      id: "order_success_002",
      customerId: customers[1].id,
      productId: products[2].id,
      amount: products[2].price,
      status: "paid",
      razorpayOrderId: "order_seed_success_002",
    },
  });

  await prisma.payment.upsert({
    where: { id: "pay_success_002" },
    update: {},
    create: {
      id: "pay_success_002",
      orderId: successOrder2.id,
      razorpayPaymentId: "pay_seed_success_002",
      status: "captured",
      method: "card",
    },
  });

  console.log("✅ Created 2 successful orders");

  // ─── Failed orders — 5 failure categories ───────────────────────────────────

  // 1. INSUFFICIENT_FUNDS — Customer: Arjun, Product: SSD
  //    Recovery posture: Delayed retry (payday-aware) + suggest alt. method
  const failOrder1 = await prisma.order.upsert({
    where: { id: "order_fail_001" },
    update: {},
    create: {
      id: "order_fail_001",
      customerId: customers[0].id,
      productId: products[4].id,
      amount: products[4].price,
      status: "failed",
      razorpayOrderId: "order_seed_fail_001",
    },
  });
  const failPay1 = await prisma.payment.upsert({
    where: { id: "pay_fail_001" },
    update: {},
    create: {
      id: "pay_fail_001",
      orderId: failOrder1.id,
      razorpayPaymentId: "pay_seed_fail_001",
      status: "failed",
      method: "upi",
      errorCode: "BAD_REQUEST_ERROR",
      errorReason: "payment_failed",
      errorSource: "customer",
      errorStep: "payment_authentication",
      errorDescription: "Your payment failed because of insufficient funds. Please try again with another payment method.",
    },
  });
  await prisma.failureEvent.upsert({
    where: { id: "fe_001" },
    update: {},
    create: {
      id: "fe_001",
      paymentId: failPay1.id,
      classifiedCategory: "insufficient_funds",
      rootCause: "Customer UPI account had insufficient balance at time of debit. Razorpay error_reason=payment_failed, error_source=customer.",
    },
  });

  // 2. WRONG_PIN — Customer: Priya, Product: Keyboard
  //    Recovery posture: Immediate retry prompt
  const failOrder2 = await prisma.order.upsert({
    where: { id: "order_fail_002" },
    update: {},
    create: {
      id: "order_fail_002",
      customerId: customers[1].id,
      productId: products[1].id,
      amount: products[1].price,
      status: "failed",
      razorpayOrderId: "order_seed_fail_002",
    },
  });
  const failPay2 = await prisma.payment.upsert({
    where: { id: "pay_fail_002" },
    update: {},
    create: {
      id: "pay_fail_002",
      orderId: failOrder2.id,
      razorpayPaymentId: "pay_seed_fail_002",
      status: "failed",
      method: "upi",
      errorCode: "BAD_REQUEST_ERROR",
      errorReason: "payment_failed",
      errorSource: "customer",
      errorStep: "payment_authentication",
      errorDescription: "Payment failed because incorrect UPI PIN was entered.",
    },
  });
  await prisma.failureEvent.upsert({
    where: { id: "fe_002" },
    update: {},
    create: {
      id: "fe_002",
      paymentId: failPay2.id,
      classifiedCategory: "wrong_pin",
      rootCause: "Customer entered incorrect UPI PIN. Immediate re-attempt is safe.",
    },
  });

  // 3. ABANDONED — Customer: Ravi, Product: Smartwatch
  //    Recovery posture: Cart-abandonment nudge
  const failOrder3 = await prisma.order.upsert({
    where: { id: "order_fail_003" },
    update: {},
    create: {
      id: "order_fail_003",
      customerId: customers[2].id,
      productId: products[2].id,
      amount: products[2].price,
      status: "attempted",
      razorpayOrderId: "order_seed_fail_003",
    },
  });
  const failPay3 = await prisma.payment.upsert({
    where: { id: "pay_fail_003" },
    update: {},
    create: {
      id: "pay_fail_003",
      orderId: failOrder3.id,
      razorpayPaymentId: null,
      status: "failed",
      method: null,
      errorCode: "BAD_REQUEST_ERROR",
      errorReason: "payment_cancelled",
      errorSource: "customer",
      errorStep: "payment_initiation",
      errorDescription: "Payment cancelled by customer.",
    },
  });
  await prisma.failureEvent.upsert({
    where: { id: "fe_003" },
    update: {},
    create: {
      id: "fe_003",
      paymentId: failPay3.id,
      classifiedCategory: "abandoned",
      rootCause: "Customer initiated checkout but cancelled/dropped off before completing payment. Order stuck in attempted state.",
    },
  });

  // 4. DO_NOT_HONOR — Customer: Sneha, Product: Headphones
  //    Recovery posture: Short-delay retry then suggest alt. method
  const failOrder4 = await prisma.order.upsert({
    where: { id: "order_fail_004" },
    update: {},
    create: {
      id: "order_fail_004",
      customerId: customers[3].id,
      productId: products[0].id,
      amount: products[0].price,
      status: "failed",
      razorpayOrderId: "order_seed_fail_004",
    },
  });
  const failPay4 = await prisma.payment.upsert({
    where: { id: "pay_fail_004" },
    update: {},
    create: {
      id: "pay_fail_004",
      orderId: failOrder4.id,
      razorpayPaymentId: "pay_seed_fail_004",
      status: "failed",
      method: "card",
      errorCode: "GATEWAY_ERROR",
      errorReason: "payment_failed",
      errorSource: "bank",
      errorStep: "payment_authorization",
      errorDescription: "Your payment was declined by the bank. Please try again or use a different payment method.",
    },
  });
  await prisma.failureEvent.upsert({
    where: { id: "fe_004" },
    update: {},
    create: {
      id: "fe_004",
      paymentId: failPay4.id,
      classifiedCategory: "do_not_honor",
      rootCause: "Issuing bank returned generic Do Not Honor decline (error_source=bank, error_step=payment_authorization). Short-delay retry appropriate before suggesting alt. method.",
    },
  });

  // 5. PSP_TIMEOUT — Customer: Vikram, Product: USB Hub
  //    Recovery posture: Safe to auto-retry (status check first)
  const failOrder5 = await prisma.order.upsert({
    where: { id: "order_fail_005" },
    update: {},
    create: {
      id: "order_fail_005",
      customerId: customers[4].id,
      productId: products[3].id,
      amount: products[3].price,
      status: "failed",
      razorpayOrderId: "order_seed_fail_005",
    },
  });
  const failPay5 = await prisma.payment.upsert({
    where: { id: "pay_fail_005" },
    update: {},
    create: {
      id: "pay_fail_005",
      orderId: failOrder5.id,
      razorpayPaymentId: "pay_seed_fail_005",
      status: "failed",
      method: "upi",
      errorCode: "GATEWAY_ERROR",
      errorReason: "payment_failed",
      errorSource: "gateway",
      errorStep: "payment_authorization",
      errorDescription: "Payment failed due to a timeout between the payment gateway and bank. Please try again.",
    },
  });
  await prisma.failureEvent.upsert({
    where: { id: "fe_005" },
    update: {},
    create: {
      id: "fe_005",
      paymentId: failPay5.id,
      classifiedCategory: "psp_timeout",
      rootCause: "Multi-hop PSP-NPCI-bank timeout (error_source=gateway). Reconciliation via Payment Fetch API required before retry to prevent double-charge.",
    },
  });

  console.log("✅ Created 5 failed orders with failure_events");
  console.log("\n📊 Seed summary:");
  console.log("   Customers:      5");
  console.log("   Products:       5");
  console.log("   Orders:         7 (2 paid, 5 failed)");
  console.log("   Payments:       7 (2 captured, 5 failed)");
  console.log("   Failure events: 5");
  console.log("\n🔍 Failure categories seeded:");
  console.log("   1. insufficient_funds  → Delayed retry + alt. method");
  console.log("   2. wrong_pin           → Immediate retry prompt");
  console.log("   3. abandoned           → Cart-abandonment nudge");
  console.log("   4. do_not_honor        → Short-delay retry → alt. method");
  console.log("   5. psp_timeout         → Reconcile first, then auto-retry");
  console.log("\n✨ Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
