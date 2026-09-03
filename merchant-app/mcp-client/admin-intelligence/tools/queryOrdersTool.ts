import { prisma } from "../../../src/lib/prismaClient";

export const queryOrdersSchema = {
  type: "function" as const,
  function: {
    name: "query_orders",
    description: "Query orders with optional status filter. Returns anonymized order data (no customer PII).",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["paid", "failed", "attempted", "created"], description: "Filter by order status" },
        limit: { type: "number", description: "Max results to return (default 20, max 100)" },
      },
      required: [],
    },
  },
};

export async function executeQueryOrders(args: { status?: string; limit?: number }) {
  const limit = Math.min(args.limit ?? 20, 100);
  const orders = await prisma.order.findMany({
    where: args.status ? { status: args.status } : undefined,
    take: limit,
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true } } },
  });
  return {
    orders: orders.map((o) => ({
      orderId: o.id,
      status: o.status,
      amountPaise: o.amount,
      amountRupees: Math.round(o.amount / 100),
      productName: o.product.name,
      createdAt: o.createdAt.toISOString(),
    })),
    total: orders.length,
  };
}
