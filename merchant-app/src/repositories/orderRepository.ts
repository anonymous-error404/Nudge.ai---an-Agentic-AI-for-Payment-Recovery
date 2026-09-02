import { prisma } from "../lib/prismaClient";

const ORDER_INCLUDE = {
  customer: true,
  product: true,
  payments: {
    include: { failureEvents: { include: { recoveryActions: true } } },
  },
} as const;

export class OrderRepository {
  async findAllWithDetails() {
    return prisma.order.findMany({
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: any) {
    return prisma.order.create({ data });
  }

  async updateStatusByRazorpayId(razorpayOrderId: string, status: string) {
    return prisma.order.updateMany({
      where: { razorpayOrderId },
      data: { status },
    });
  }

  async findByRazorpayId(razorpayOrderId: string) {
    return prisma.order.findUnique({
      where: { razorpayOrderId },
      include: { customer: true, product: true },
    });
  }

  async findById(id: string) {
    return prisma.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
  }

  async findByRetryToken(retryToken: string) {
    return prisma.order.findUnique({
      where: { retryToken },
      include: { customer: true, product: true },
    });
  }

  /**
   * Returns the most recent non-paid order for a given customer + product pair.
   * Used to enforce idempotency — a failed/abandoned order can be retried
   * instead of creating a duplicate.
   */
  async findOpenOrderForCustomerProduct(customerId: string, productId: string) {
    return prisma.order.findFirst({
      where: {
        customerId,
        productId,
        status: { in: ["created", "attempted", "failed"] },
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, data: Partial<{ status: string; amount: number; razorpayOrderId: string; quantity: number }>) {
    return prisma.order.update({ where: { id }, data });
  }
}

export const orderRepository = new OrderRepository();
