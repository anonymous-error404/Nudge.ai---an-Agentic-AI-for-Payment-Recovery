import { prisma } from "../lib/prismaClient";
import { RecoveryOutcome, ActionType } from "../enums";

export class RecoveryActionRepository {
  async create(params: {
    merchantId: string;
    failureEventId: string;
    jobId: string;
    attemptNumber: number;
  }) {
    return prisma.recoveryAction.create({
      data: {
        merchantId: params.merchantId,
        failureEventId: params.failureEventId,
        jobId: params.jobId,
        attemptNumber: params.attemptNumber,
        outcome: RecoveryOutcome.Pending,
      },
    });
  }

  async markInProgress(jobId: string) {
    return prisma.recoveryAction.update({
      where: { jobId },
      data: { outcome: RecoveryOutcome.InProgress },
    });
  }

  async markComplete(
    jobId: string,
    params: {
      actionType: ActionType | null;
      outcome: RecoveryOutcome;
      agentReasoning?: string;
      notificationContent?: string;
    }
  ) {
    return prisma.recoveryAction.update({
      where: { jobId },
      data: {
        actionType: params.actionType,
        outcome: params.outcome,
        agentReasoning: params.agentReasoning,
        notificationContent: params.notificationContent,
        executedAt: new Date(),
      },
    });
  }

  async getByJobId(jobId: string) {
    return prisma.recoveryAction.findUnique({ where: { jobId } });
  }

  async getAuditSummary(merchantId?: string) {
    const where = merchantId ? { merchantId } : {};
    const [total, byOutcome, byAction] = await Promise.all([
      prisma.recoveryAction.count({ where }),
      prisma.recoveryAction.groupBy({
        by: ["outcome"],
        where,
        _count: { outcome: true },
      }),
      prisma.recoveryAction.groupBy({
        by: ["actionType"],
        where: { ...where, actionType: { not: null } },
        _count: { actionType: true },
      }),
    ]);
    return { total, byOutcome, byAction };
  }
}

export const recoveryActionRepo = new RecoveryActionRepository();
