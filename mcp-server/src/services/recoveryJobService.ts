import { recoveryQueue } from "../queue/recoveryQueue";
import { failureEventRepo } from "../repositories/failureEventRepo";
import { recoveryActionRepo } from "../repositories/recoveryActionRepo";
import { prisma } from "../lib/prismaClient";
import type { RecoveryJobInput } from "./validationSchemas";
import type { RecoveryJobPayload } from "../types";

class RecoveryJobService {
  /**
   * Submit a new recovery job.
   * Idempotent — same (merchantId + externalRef) is never processed twice.
   */
  async submitJob(payload: RecoveryJobInput) {
    // 1. Idempotent failure event log in MCP server audit DB
    const { event, isNew } = await failureEventRepo.createIdempotent({
      merchantId: payload.merchantId,
      externalRef: payload.externalRef,
      classifiedCategory: payload.context.failure_category,
      amountBucket: payload.context.amount_bucket,
      paymentMethod: payload.context.payment_method,
    });

    if (!isNew) {
      // Already logged — find the existing job
      const existingAction = await prisma.recoveryAction.findFirst({
        where: { failureEventId: event.id },
        orderBy: { createdAt: "desc" },
      });
      return {
        isNew: false,
        jobId: existingAction?.jobId ?? null,
        message: "Already processing this failure event",
      };
    }

    // 2. Enqueue recovery job into BullMQ
    const job = await recoveryQueue.add("recover", {
      ...payload,
      failureEventId: event.id,
    } as RecoveryJobPayload);

    const jobId = job.id!;

    // 3. Create pending recovery_action row in audit DB
    await recoveryActionRepo.create({
      merchantId: payload.merchantId,
      failureEventId: event.id,
      jobId,
      attemptNumber: payload.context.attempt_count + 1,
    });

    console.log(
      `📥 Enqueued recovery job ${jobId} | merchant=${payload.merchantId} | category=${payload.context.failure_category}`
    );

    return { isNew: true, jobId, message: "Recovery job accepted and queued" };
  }

  /**
   * Get the current status of a recovery job by its BullMQ job ID.
   */
  async getJobStatus(jobId: string) {
    const action = await recoveryActionRepo.getByJobId(jobId);
    if (!action) return null;

    return {
      jobId: action.jobId,
      status: action.outcome,
      actionType: action.actionType,
      agentReasoning: action.agentReasoning,
      notificationContent: action.notificationContent,
      executedAt: action.executedAt,
    };
  }

  /**
   * Aggregate audit log across all merchants (or scoped to one).
   */
  async getAuditData(merchantId?: string) {
    const [events, summary] = await Promise.all([
      failureEventRepo.findAll(merchantId),
      recoveryActionRepo.getAuditSummary(merchantId),
    ]);
    return { events, summary };
  }
}

export const recoveryJobService = new RecoveryJobService();
