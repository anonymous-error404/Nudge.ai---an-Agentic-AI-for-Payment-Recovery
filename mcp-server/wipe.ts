import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.recoveryAction.deleteMany({});
  await prisma.failureEvent.deleteMany({});
  console.log('MCP Server: FailureEvent and RecoveryAction records cleared.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
