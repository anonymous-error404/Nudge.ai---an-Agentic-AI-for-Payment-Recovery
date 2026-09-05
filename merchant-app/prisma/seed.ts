/**
 * Seed script for the mock merchant app.
 *
 * Creates:
 *  - 5 customers
 *  - 8 products
 *  - 7 orders (2 paid + 5 failed)
 *  - 5 pre-seeded failed payments covering all 5 failure categories
 *  - 5 failure_events (2 pending, 3 escalated with full recovery chains)
 *
 * These pre-seeded failures are ready for the AI recovery agent and admin dashboard demo.
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
      update: {
        imageUrl: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?q=80&w=800&auto=format&fit=crop",
        offers: "Free carrying case worth ₹499 on purchase today!",
      },
      create: {
        id: "prod_001",
        name: "Wireless Noise-Cancelling Headphones",
        description: "Premium over-ear headphones with 30hr battery life and active noise cancellation.",
        price: 799900,
        imageUrl: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?q=80&w=800&auto=format&fit=crop",
        stock: 50,
        offers: "Free carrying case worth ₹499 on purchase today!",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_002" },
      update: {
        imageUrl: "https://images.unsplash.com/photo-1595225476474-87563907a212?q=80&w=800&auto=format&fit=crop",
        offers: "10% off on UPI payments — save ₹350!",
      },
      create: {
        id: "prod_002",
        name: "Mechanical Gaming Keyboard",
        description: "RGB backlit mechanical keyboard with tactile switches and anti-ghosting.",
        price: 349900,
        imageUrl: "https://images.unsplash.com/photo-1595225476474-87563907a212?q=80&w=800&auto=format&fit=crop",
        stock: 30,
        offers: "10% off on UPI payments — save ₹350!",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_003" },
      update: {
        imageUrl: "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?q=80&w=800&auto=format&fit=crop",
        offers: "Free 1-year extended warranty (worth ₹1,299) included!",
      },
      create: {
        id: "prod_003",
        name: "Smart Watch Pro",
        description: "Health monitoring smartwatch with GPS, SpO2, and 7-day battery.",
        price: 1299900,
        imageUrl: "https://images.unsplash.com/photo-1579586337278-3befd40fd17a?q=80&w=800&auto=format&fit=crop",
        stock: 25,
        offers: "Free 1-year extended warranty (worth ₹1,299) included!",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_004" },
      update: {
        imageUrl: "https://images.unsplash.com/photo-1621330396173-e41b1cafd17f?q=80&w=800&auto=format&fit=crop",
        offers: "Buy 2 get 15% off — perfect for home + office setup!",
      },
      create: {
        id: "prod_004",
        name: "USB-C Hub 7-in-1",
        description: "Multi-port hub with HDMI, USB 3.0, SD card, and 100W PD charging.",
        price: 149900,
        imageUrl: "https://images.unsplash.com/photo-1621330396173-e41b1cafd17f?q=80&w=800&auto=format&fit=crop",
        stock: 100,
        offers: "Buy 2 get 15% off — perfect for home + office setup!",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_005" },
      update: {
        imageUrl: "https://images.unsplash.com/photo-1531492746076-161ca9bcad58?q=80&w=800&auto=format&fit=crop",
        offers: "Limited time: free USB-C cable (₹299 value) with every order!",
      },
      create: {
        id: "prod_005",
        name: "Portable SSD 1TB",
        description: "Ultra-fast portable SSD with 1050MB/s read speeds and shock resistance.",
        price: 599900,
        imageUrl: "https://images.unsplash.com/photo-1531492746076-161ca9bcad58?q=80&w=800&auto=format&fit=crop",
        stock: 40,
        offers: "Limited time: free USB-C cable (₹299 value) with every order!",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_006" },
      update: {
        imageUrl: "https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?q=80&w=800&auto=format&fit=crop",
        offers: "Free 2-year accidental damage protection included!",
      },
      create: {
        id: "prod_006",
        name: "Laptop Stand Aluminium",
        description: "Ergonomic aluminium laptop stand, adjustable height, compatible with all 10-17 inch laptops.",
        price: 249900,
        imageUrl: "https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?q=80&w=800&auto=format&fit=crop",
        stock: 60,
        offers: "Free 2-year accidental damage protection included!",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_007" },
      update: {
        imageUrl: "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?q=80&w=800&auto=format&fit=crop",
        offers: "Buy with any keyboard - get 10% off at checkout!",
      },
      create: {
        id: "prod_007",
        name: "Wireless Ergonomic Mouse",
        description: "Precision wireless mouse with ergonomic design, 90-day battery life, and silent clicks.",
        price: 199900,
        imageUrl: "https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?q=80&w=800&auto=format&fit=crop",
        stock: 80,
        offers: "Buy with any keyboard - get 10% off at checkout!",
      },
    }),
    prisma.product.upsert({
      where: { id: "prod_008" },
      update: {
        imageUrl: "https://images.unsplash.com/photo-1606400082777-ef05f3c5cde2?q=80&w=800&auto=format&fit=crop",
        offers: "Flat Rs.500 off on orders above Rs.3,999 - use code TECH500!",
      },
      create: {
        id: "prod_008",
        name: "True Wireless Earbuds Pro",
        description: "ANC earbuds with 32hr total battery, IPX5 water resistance, and crystal-clear calls.",
        price: 399900,
        imageUrl: "https://images.unsplash.com/photo-1606400082777-ef05f3c5cde2?q=80&w=800&auto=format&fit=crop",
        stock: 45,
        offers: "Flat Rs.500 off on orders above Rs.3,999 - use code TECH500!",
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

  // ─── Failed orders (5 events) ───────────────────────────────────
  
  const now = Date.now();

  // 1. INSUFFICIENT_FUNDS — Customer: Arjun, Product: SSD
  //    ESCALATED: Max attempts reached over several days.
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
      errorDescription: "[ESCALATED] Your payment failed because of insufficient funds. Please try again with another payment method.",
    },
  });
  const fe001 = await prisma.failureEvent.upsert({
    where: { id: "fe_001" },
    update: { status: "escalated" },
    create: {
      id: "fe_001",
      paymentId: failPay1.id,
      classifiedCategory: "insufficient_funds",
      rootCause: "Customer UPI account had insufficient balance. Multiple recovery attempts failed over 10 days. Escalated for human review.",
      status: "escalated"
    },
  });
  // Actions for fe_001
  const actions1 = [
    { id: "ra_001_01", actionType: "send_notification", channel: "sms", attempt: 1, reasoning: "Immediate follow up via SMS.", delayDays: 10 },
    { id: "ra_001_02", actionType: "send_notification", channel: "email", attempt: 2, reasoning: "Payday follow up email.", delayDays: 7 },
    { id: "ra_001_03", actionType: "send_notification", channel: "email", attempt: 3, reasoning: "Final discount reminder.", delayDays: 3 },
    { id: "ra_001_04", actionType: "escalate_to_human", channel: null, attempt: 4, reasoning: "Max recovery attempts reached. Escalating to human for manual outreach.", delayDays: 1 }
  ];
  for (const act of actions1) {
    await prisma.recoveryAction.upsert({
      where: { id: act.id },
      update: {},
      create: {
        id: act.id, failureEventId: fe001.id, actionType: act.actionType, channel: act.channel, outcome: "success",
        attemptNumber: act.attempt, agentReasoning: act.reasoning, executedAt: new Date(now - act.delayDays * 24 * 60 * 60 * 1000)
      }
    });
  }

  // 2. WRONG_PIN — Customer: Priya, Product: Keyboard
  //    PENDING: Ready for agent to pick up
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
  //    PENDING: Cart-abandonment nudge
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
  //    ESCALATED: Customer bank consistently returns do not honor
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
      errorDescription: "[ESCALATED] Your payment was declined by the bank. Please try again or use a different payment method.",
    },
  });
  const fe004 = await prisma.failureEvent.upsert({
    where: { id: "fe_004" },
    update: { status: "escalated" },
    create: {
      id: "fe_004",
      paymentId: failPay4.id,
      classifiedCategory: "do_not_honor",
      rootCause: "Issuing bank returned generic Do Not Honor decline. Recovery exhausted.",
      status: "escalated"
    },
  });
  // Actions for fe_004
  const actions4 = [
    { id: "ra_004_01", actionType: "send_notification", channel: "email", attempt: 1, reasoning: "Initial email proposing alternative payment link.", delayDays: 2 },
    { id: "ra_004_02", actionType: "send_notification", channel: "email", attempt: 2, reasoning: "Follow up email proposing alternative payment link.", delayDays: 1 },
    { id: "ra_004_03", actionType: "escalate_to_human", channel: null, attempt: 3, reasoning: "Bank consistently declines. Escalate to merchant support to reach out personally.", delayDays: 0.1 }
  ];
  for (const act of actions4) {
    await prisma.recoveryAction.upsert({
      where: { id: act.id },
      update: {},
      create: {
        id: act.id, failureEventId: fe004.id, actionType: act.actionType, channel: act.channel, outcome: "success",
        attemptNumber: act.attempt, agentReasoning: act.reasoning, executedAt: new Date(now - act.delayDays * 24 * 60 * 60 * 1000)
      }
    });
  }

  // 5. PSP_TIMEOUT — Customer: Vikram, Product: USB Hub
  //    ESCALATED: Needs manual reconciliation
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
      errorDescription: "[ESCALATED] Payment failed due to a timeout between the payment gateway and bank. Manual reconciliation required.",
    },
  });
  const fe005 = await prisma.failureEvent.upsert({
    where: { id: "fe_005" },
    update: { status: "escalated" },
    create: {
      id: "fe_005",
      paymentId: failPay5.id,
      classifiedCategory: "psp_timeout",
      rootCause: "Multi-hop PSP-NPCI-bank timeout (error_source=gateway). Status unknown.",
      status: "escalated"
    },
  });
  // Actions for fe_005
  const actions5 = [
    { id: "ra_005_01", actionType: "do_nothing", channel: null, attempt: 1, reasoning: "Reconciliation period (waiting for PSP response).", delayDays: 1 },
    { id: "ra_005_02", actionType: "escalate_to_human", channel: null, attempt: 2, reasoning: "Gateway status remains ambiguous. Escalate for manual intervention to avoid double-charging the customer.", delayDays: 0.1 }
  ];
  for (const act of actions5) {
    await prisma.recoveryAction.upsert({
      where: { id: act.id },
      update: {},
      create: {
        id: act.id, failureEventId: fe005.id, actionType: act.actionType, channel: act.channel, outcome: "success",
        attemptNumber: act.attempt, agentReasoning: act.reasoning, executedAt: new Date(now - act.delayDays * 24 * 60 * 60 * 1000)
      }
    });
  }

  console.log("✅ Created 5 failed orders (3 escalated, 2 pending)");

  // Clean up any extra seed events (like fe_006, fe_007) if they exist from previous runs
  await prisma.recoveryAction.deleteMany({ where: { failureEventId: { in: ["fe_006", "fe_007"] } } }).catch(() => {});
  await prisma.failureEvent.deleteMany({ where: { id: { in: ["fe_006", "fe_007"] } } }).catch(() => {});
  await prisma.payment.deleteMany({ where: { id: { in: ["pay_fail_006", "pay_fail_007"] } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: ["order_fail_006", "order_fail_007"] } } }).catch(() => {});

  console.log("\n📊 Seed summary:");
  console.log("   Customers:      5");
  console.log("   Products:       8");
  console.log("   Orders:         7 (2 paid, 5 failed)");
  console.log("   Payments:       7 (2 captured, 5 failed)");
  console.log("   Failure events: 5 (2 pending, 3 escalated)");
  console.log("\n🔍 Failure categories seeded:");
  console.log("   1. insufficient_funds  → ESCALATED (Arjun — Max attempts reached)");
  console.log("   2. wrong_pin           → PENDING   (Priya — Ready for AI agent)");
  console.log("   3. abandoned           → PENDING   (Ravi — Ready for AI agent)");
  console.log("   4. do_not_honor        → ESCALATED (Sneha — Bank decline max retries)");
  console.log("   5. psp_timeout         → ESCALATED (Vikram — Manual recon needed)");
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
