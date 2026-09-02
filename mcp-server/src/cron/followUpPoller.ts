import { prisma } from "../lib/prismaClient";
import { recoveryQueue } from "../queue/recoveryQueue";
import { FailureContext } from "../types";

export function startFollowUpPoller() {
  const POLL_INTERVAL = 30 * 1000; // 30 seconds for testing (was 5 mins)

  setInterval(async () => {
    try {
      console.log("🕒 [Cron] Checking for due follow-ups...");

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
        console.log("   ↳ No due follow-ups found at this time.");
        return;
      }

      console.log(`🕒 [Cron] Found ${dueSchedules.length} due follow-ups. Queuing jobs...`);

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
          // We provide a dummy context that the worker MUST refresh before passing to the AI
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
          toolSchemas: [], // Worker will attach schemas
        });
      }
    } catch (error) {
      console.error("❌ [Cron] Error polling follow-ups:", error);
    }
  }, POLL_INTERVAL);
}
