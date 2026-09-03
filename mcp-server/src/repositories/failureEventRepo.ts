import { prisma } from "../lib/prismaClient";
import type { FailureContext } from "../types";

export class FailureEventRepository {
  /**
   * Idempotent create — same (merchantId + externalRef) never logged twice.
   * Returns { event, isNew }.
   */
  async createIdempotent(params: {
    merchantId: string;
    externalRef: string;
    classifiedCategory: string;
    amountBucket: string;
    paymentMethod: string;
  }) {
    const existing = await prisma.failureEvent.findUnique({
      where: {
        merchantId_externalRef: {
          merchantId: params.merchantId,
          externalRef: params.externalRef,
        },
      },
    });

    if (existing) {
      return { event: existing, isNew: false };
    }

    const event = await prisma.failureEvent.create({
      data: {
        merchantId: params.merchantId,
        externalRef: params.externalRef,
        classifiedCategory: params.classifiedCategory,
        amountBucket: params.amountBucket,
        paymentMethod: params.paymentMethod,
      },
    });

    return { event, isNew: true };
  }

  async getById(id: string) {
    return prisma.failureEvent.findUnique({
      where: { id },
      include: { recoveryActions: { orderBy: { createdAt: "asc" } } },
    });
  }

  async findAll(merchantId?: string) {
    return prisma.failureEvent.findMany({
      where: merchantId ? { merchantId } : undefined,
      include: { recoveryActions: { orderBy: { createdAt: "asc" } } },
      orderBy: { detectedAt: "desc" },
    });
  }
}

export const failureEventRepo = new FailureEventRepository();

