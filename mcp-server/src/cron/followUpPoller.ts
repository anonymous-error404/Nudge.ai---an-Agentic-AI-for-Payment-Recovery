import { prisma } from "../lib/prismaClient";
import { recoveryQueue } from "../queue/jobQueue";
import { FailureContext } from "../types";
import { log, toIST } from '../../../shared/logger';

export function startFollowUpPoller() {
  const POLL_INTERVAL = 30 * 1000; // 30 seconds

  setInterval(async () => {
    try {
      log.info("🕒", "Checking database for any due follow-up jobs...");

      const dueSchedules = await prisma.followUpSchedule.findMany({
        where: {
          status: "PENDING",
          nextExecutionAt: { lte: new Date() },
        },
        include: {
          failureEvent: true,
        },
      });

      if (dueSchedules.length === 0) {
        log.step("No follow-ups are due right now. Will check again in 30s.");
        return;
      }

      log.info("🚀", `Found ${dueSchedules.length} due follow-up(s) — queuing jobs now`);

      for (const schedule of dueSchedules) {
        // Mark as IN_PROGRESS immediately to prevent duplicate queueing on next tick
        await prisma.followUpSchedule.update({
          where: { id: schedule.id },
          data: { status: "IN_PROGRESS" },
        });

        await recoveryQueue.add(`followup-${schedule.id}`, {
          merchantId: schedule.merchantId,
          merchantCallbackUrl: process.env.MERCHANT_CALLBACK_URL ?? "http://localhost:3000/mcp",
          externalRef: schedule.failureEvent.externalRef,
          failureEventId: schedule.failureEvent.id,
          isFollowUp: true,
          followUpScheduleId: schedule.id,
          context: {
            failure_event_id: schedule.failureEvent.externalRef,
            customer_id: "unknown",
            customer_name: "unknown",
            order_status: "unknown",
            failure_category: schedule.failureEvent.classifiedCategory,
            amount_bucket: schedule.failureEvent.amountBucket,
            attempt_count: 0,
            days_since_failure: 0,
            payment_method: schedule.failureEvent.paymentMethod,
            previous_actions: [],
            order_details: null,
          } as FailureContext,
          toolSchemas: [],
        });

        log.step(`Follow-up job queued for failure event: ${schedule.failureEvent.externalRef}`);
      }
    } catch (error) {
      log.error("Follow-up poller encountered an error", error);
    }
  }, POLL_INTERVAL);
}
