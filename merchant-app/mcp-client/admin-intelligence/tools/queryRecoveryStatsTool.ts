import { prisma } from "../../../src/lib/prismaClient";

export const queryRecoveryStatsSchema = {
  type: "function" as const,
  function: {
    name: "query_recovery_stats",
    description: "Get aggregate payment recovery statistics for a time period.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of past days to include (default 7)" },
      },
      required: [],
    },
  },
};

export async function executeQueryRecoveryStats(args: { days?: number }) {
  const days = args.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.failureEvent.findMany({
    where: { detectedAt: { gte: since } },
    include: {
      recoveryActions: true,
      payment: {
        include: {
          order: {
            include: {
              customer: { select: { id: true } },
              product: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const total = events.length;
  let recoveredCount = 0;
  let totalRecoveredPaise = 0;
  const hoursToRecover: number[] = [];

  // Real recovery = same customer later placed a PAID order for the same product
  // AFTER the failure was detected. Actions dispatched ≠ money recovered.
  for (const e of events) {
    const order = e.payment?.order;
    if (!order?.customer?.id || !order?.product?.id) continue;
    if (e.recoveryActions.length === 0) continue;

    const repurchase = await prisma.order.findFirst({
      where: {
        id: order.id,
        status: "paid",
      },
      orderBy: { createdAt: "asc" },
    });

    if (repurchase) {
      recoveredCount++;
      totalRecoveredPaise += repurchase.amount;
      hoursToRecover.push(
        (repurchase.updatedAt.getTime() - e.detectedAt.getTime()) / 3600000,
      );
    }
  }

  // In-progress: actions taken but no confirmed repurchase yet
  const inProgressCount = events.filter(
    (e) => e.recoveryActions.length > 0,
  ).length - recoveredCount;

  // At-risk: failure events where the money is still outstanding
  const totalAtRiskPaise = events.reduce(
    (s, e) => s + (e.payment?.order?.amount ?? 0),
    0,
  ) - totalRecoveredPaise;

  const avgHoursToRecover =
    hoursToRecover.length > 0
      ? hoursToRecover.reduce((a, b) => a + b, 0) / hoursToRecover.length
      : 0;

  return {
    periodDays: days,
    totalEvents: total,
    recoveredCount,
    inProgressCount: Math.max(0, inProgressCount),
    atRiskCount: total - recoveredCount,
    totalRecoveredPaise,
    totalRecoveredRupees: Math.round(totalRecoveredPaise / 100),
    totalAtRiskPaise: Math.max(0, totalAtRiskPaise),
    totalAtRiskRupees: Math.round(Math.max(0, totalAtRiskPaise) / 100),
    recoveryRatePct:
      total > 0
        ? parseFloat(((recoveredCount / total) * 100).toFixed(1))
        : 0,
    avgHoursToRecover: parseFloat(avgHoursToRecover.toFixed(1)),
    dataNote:
      "Recovered = the failed order was successfully paid after a retry. " +
      "In Progress = AI sent a recovery action but customer has not yet paid.",
  };
}

