import { recoveryQueue } from "../queue/recoveryQueue";
import { failureEventRepo } from "../repositories/failureEventRepo";
import { recoveryActionRepo } from "../repositories/recoveryActionRepo";
import { prisma } from "../lib/prismaClient";
import { ActionType, RecoveryOutcome } from "../enums";
import type { RecoveryJobInput } from "./validationSchemas";
import type { RecoveryJobPayload, FailureContext } from "../types";
import { runCheckoutUIAgent } from "../agents/checkoutUIAgent";

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
      return {
        isNew: false,
        message: "Already processing this failure event",
      };
    }

    // 2. Run the ultra-fast UI Agent Synchronously
    const uiMessage = await runCheckoutUIAgent(
      payload.context as FailureContext,
    );

    // 3. Enqueue the asynchronous tool-using job
    const job = await recoveryQueue.add(`immediate-${event.id}`, {
      ...payload,
      failureEventId: event.id,
      isImmediateRecovery: true,
    } as RecoveryJobPayload);

    // 4. Create recovery_action row for audit
    await recoveryActionRepo.create({
      merchantId: payload.merchantId,
      failureEventId: event.id,
      jobId: job.id!,
      attemptNumber: payload.context.attempt_count + 1,
    });

    console.log(
      `📥 Instant checkout UI returned for ${payload.externalRef}. Queued immediate recovery job ${job.id}.`,
    );

    return {
      isNew: true,
      uiMessage,
    };
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
