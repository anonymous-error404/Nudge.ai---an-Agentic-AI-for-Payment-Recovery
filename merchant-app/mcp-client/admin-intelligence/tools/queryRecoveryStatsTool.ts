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
      payment: { include: { order: true } },
    },
  });

  const total = events.length;
  const recovered = events.filter((e) => e.recoveryActions.some((a) => a.outcome === "success"));
  const atRisk = events.filter((e) => !e.recoveryActions.some((a) => a.outcome === "success"));

  const totalRecoveredPaise = recovered.reduce((s, e) => s + (e.payment?.order?.amount ?? 0), 0);
  const totalAtRiskPaise = atRisk.reduce((s, e) => s + (e.payment?.order?.amount ?? 0), 0);

  const hoursToRecover: number[] = [];
  for (const e of recovered) {
    const successAction = e.recoveryActions.find((a) => a.outcome === "success");
    if (successAction) {
      const hrs = (successAction.executedAt.getTime() - e.detectedAt.getTime()) / 3600000;
      hoursToRecover.push(hrs);
    }
  }
  const avgHoursToRecover = hoursToRecover.length > 0
    ? hoursToRecover.reduce((a, b) => a + b, 0) / hoursToRecover.length
    : 0;

  return {
    periodDays: days,
    totalEvents: total,
    recoveredCount: recovered.length,
    atRiskCount: atRisk.length,
    totalRecoveredPaise,
    totalRecoveredRupees: Math.round(totalRecoveredPaise / 100),
    totalAtRiskPaise,
    totalAtRiskRupees: Math.round(totalAtRiskPaise / 100),
    recoveryRatePct: total > 0 ? parseFloat(((recovered.length / total) * 100).toFixed(1)) : 0,
    avgHoursToRecover: parseFloat(avgHoursToRecover.toFixed(1)),
  };
}
