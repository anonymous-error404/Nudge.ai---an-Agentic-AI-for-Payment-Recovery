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

  // Aggregate by customerId - NO names, NO emails
  const byCustomer: Record<string, { failureCount: number; atRiskPaise: number; lastFailureAt: Date }> = {};

  for (const e of events) {
    const customerId = e.payment?.order?.customer?.id;
    const productId = e.payment?.order?.product?.id;
    if (!customerId) continue;

    if (!byCustomer[customerId]) {
      byCustomer[customerId] = { failureCount: 0, atRiskPaise: 0, lastFailureAt: e.detectedAt };
    }
    byCustomer[customerId].failureCount++;
    if (e.detectedAt > byCustomer[customerId].lastFailureAt) {
      byCustomer[customerId].lastFailureAt = e.detectedAt;
    }

    // A failure is "at-risk" only if the customer hasn't since repurchased the same product
    let isConfirmedRecovery = false;
    if (productId && e.recoveryActions.length > 0) {
      const repurchase = await prisma.order.findFirst({
        where: {
          id: e.payment?.order?.id,
          status: "paid",
        },
        select: { id: true },
      });
      isConfirmedRecovery = !!repurchase;
    }
    if (!isConfirmedRecovery) byCustomer[customerId].atRiskPaise += e.payment?.order?.amount ?? 0;
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

