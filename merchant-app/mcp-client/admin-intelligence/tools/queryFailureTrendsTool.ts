import { prisma } from "../../../src/lib/prismaClient";

export const queryFailureTrendsSchema = {
  type: "function" as const,
  function: {
    name: "query_failure_trends",
    description: "Get payment failure trends grouped by failure category for a time period.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of past days to include (default 7)" },
      },
      required: [],
    },
  },
};

export async function executeQueryFailureTrends(args: { days?: number }) {
  const days = args.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.failureEvent.findMany({
    where: { detectedAt: { gte: since } },
    include: { payment: { include: { order: true } } },
  });

  const grouped: Record<string, { count: number; totalAmountPaise: number }> = {};
  for (const e of events) {
    if (!grouped[e.classifiedCategory]) {
      grouped[e.classifiedCategory] = { count: 0, totalAmountPaise: 0 };
    }
    grouped[e.classifiedCategory].count++;
    grouped[e.classifiedCategory].totalAmountPaise += e.payment?.order?.amount ?? 0;
  }

  const result = Object.entries(grouped)
    .map(([category, stats]) => ({
      category,
      count: stats.count,
      totalAmountPaise: stats.totalAmountPaise,
      totalAmountRupees: Math.round(stats.totalAmountPaise / 100),
    }))
    .sort((a, b) => b.count - a.count);

  return { periodDays: days, breakdown: result, totalEvents: events.length };
}
