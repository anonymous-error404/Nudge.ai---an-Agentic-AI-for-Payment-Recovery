import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Wiping merchant-app tables...");
  await prisma.recoveryAction.deleteMany({});
  await prisma.failureEvent.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.order.deleteMany({});
  console.log("Wiped orders, payments, failure events, and recovery actions.");
}

main().finally(async () => await prisma.$disconnect());
