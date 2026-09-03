import { prisma } from "../../../src/lib/prismaClient";

export const rankCustomersSchema = {
  type: "function" as const,
  function: {
    name: "rank_customers_by_failures",
    description: "Rank customers anonymously by number of payment failures and total amount at risk.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of customers to return (default 10)" },
      },
      required: [],
    },
  },
};

export async function executeRankCustomers(args: { limit?: number }) {
  const limit = Math.min(args.limit ?? 10, 50);

  const events = await prisma.failureEvent.findMany({
    include: {
      recoveryActions: true,
      payment: { include: { order: { include: { customer: { select: { id: true } } } } } },
    },
  });

  // Aggregate by customerId - NO names, NO emails
  const byCustomer: Record<string, { failureCount: number; atRiskPaise: number; lastFailureAt: Date }> = {};
  for (const e of events) {
    const customerId = e.payment?.order?.customer?.id;
    if (!customerId) continue;
    const isRecovered = e.recoveryActions.some((a) => a.outcome === "success");
    if (!byCustomer[customerId]) {
      byCustomer[customerId] = { failureCount: 0, atRiskPaise: 0, lastFailureAt: e.detectedAt };
    }
    byCustomer[customerId].failureCount++;
    if (!isRecovered) byCustomer[customerId].atRiskPaise += e.payment?.order?.amount ?? 0;
    if (e.detectedAt > byCustomer[customerId].lastFailureAt) {
      byCustomer[customerId].lastFailureAt = e.detectedAt;
    }
  }

  const ranked = Object.values(byCustomer)
    .sort((a, b) => b.failureCount - a.failureCount)
    .slice(0, limit)
    .map((c, i) => ({
      rank: i + 1,
      anonymizedLabel: `Customer #${i + 1}`,
      failureCount: c.failureCount,
      totalAtRiskPaise: c.atRiskPaise,
      totalAtRiskRupees: Math.round(c.atRiskPaise / 100),
      lastFailureAt: c.lastFailureAt.toISOString(),
    }));

  return { customers: ranked };
}
