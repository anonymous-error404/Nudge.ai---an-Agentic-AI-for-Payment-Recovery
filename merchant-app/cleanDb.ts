import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function clean() {
  console.log("Cleaning merchant app database...");
  await prisma.recoveryAction.deleteMany({});
  await prisma.failureEvent.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.analyticsChatSession.deleteMany({});
  console.log("✅ Cleared all transaction data (orders, payments, failures, actions, chats).");
  
  // Customers and Products are kept as they are reference data
}

clean().catch(console.error).finally(() => prisma.$disconnect());
