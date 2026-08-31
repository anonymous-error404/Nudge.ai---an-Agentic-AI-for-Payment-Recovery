import { prisma } from "../lib/prismaClient";
import { FailureCategory } from "../enums";
import { RecoveryActionLog } from "../types";

export class FailureEventRepository {
  async createIdempotent(params: {
    paymentId: string;
    category: FailureCategory;
    rootCause: string;
  }) {
    const existing = await prisma.failureEvent.findFirst({
      where: { paymentId: params.paymentId },
      include: { recoveryActions: true },
    });

    if (existing) {
      return { event: existing, isNew: false };
    }

    const event = await prisma.failureEvent.create({
      data: {
        paymentId: params.paymentId,
        classifiedCategory: params.category,
        rootCause: params.rootCause,
      },
      include: { recoveryActions: true },
    });

    return { event, isNew: true };
  }

  async findAll() {
    return prisma.failureEvent.findMany({
      include: {
        payment: {
          include: {
            order: { include: { customer: true, product: true } },
          },
        },
        recoveryActions: { orderBy: { attemptNumber: "asc" } },
      },
      orderBy: { detectedAt: "desc" },
    });
  }

  async getPending() {
    return prisma.failureEvent.findMany({
      where: { recoveryActions: { none: {} } },
      include: {
        payment: {
          include: { order: { include: { customer: true, product: true } } },
        },
      },
      orderBy: { detectedAt: "asc" },
    });
  }

  async getById(id: string) {
    return prisma.failureEvent.findUnique({
      where: { id },
      include: {
        payment: {
          include: { order: { include: { customer: true, product: true } } },
        },
        recoveryActions: { orderBy: { attemptNumber: "asc" } },
      },
    });
  }

  async createRecoveryAction(params: RecoveryActionLog) {
    return prisma.recoveryAction.create({
      data: {
        failureEventId: params.failureEventId,
        actionType: params.actionType,
        channel: params.channel,
        outcome: params.outcome,
        attemptNumber: params.attemptNumber,
        agentReasoning: params.agentReasoning,
      },
    });
  }

  async getRecoveryActionsByFailureEventId(failureEventId: string) {
    return prisma.recoveryAction.findMany({
      where: { failureEventId },
      orderBy: { attemptNumber: "desc" },
    });
  }

  async getRecoveryActionsByJobId(jobId: string) {
    return prisma.recoveryAction.findMany({
      where: { agentReasoning: { contains: jobId } }, // fallback — jobId stored in reasoning field
    });
  }

  async updateRecoveryActionOutcome(
    id: string,
    params: {
      outcome: string;
      actionType?: string;
      agentReasoning?: string;
    }
  ) {
    return prisma.recoveryAction.update({
      where: { id },
      data: {
        outcome: params.outcome,
        actionType: params.actionType as any ?? undefined,
        agentReasoning: params.agentReasoning,
      },
    });
  }
}

export const failureEventRepository = new FailureEventRepository();
