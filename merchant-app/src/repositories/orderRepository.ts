import { prisma } from "../lib/prismaClient";

export class OrderRepository {
  async findAllWithDetails() {
    return prisma.order.findMany({
      include: {
        customer: true,
        product: true,
        payments: {
          include: { failureEvents: { include: { recoveryActions: true } } },
        },
      },
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
}

export const orderRepository = new OrderRepository();
