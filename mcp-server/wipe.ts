import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Wiping mcp-server tables...");
  await prisma.recoveryAction.deleteMany({});
  await prisma.followUpSchedule.deleteMany({});
  await prisma.failureEvent.deleteMany({});
  console.log("Wiped failure events, follow up schedules, and recovery actions.");
}

main().finally(async () => await prisma.$disconnect());
