import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.recoveryAction.deleteMany({});
  await prisma.failureEvent.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.order.deleteMany({});
  console.log('Merchant app: Order, Payment, Failure, and Recovery records cleared.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
