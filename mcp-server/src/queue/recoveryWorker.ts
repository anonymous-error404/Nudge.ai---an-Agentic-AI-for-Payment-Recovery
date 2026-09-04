import { Worker, Job } from "bullmq";
import { recoveryQueue, redisConnection } from "./jobQueue";
import { RecoveryJobPayload } from "../types";
import { recoveryActionRepo } from "../repositories/recoveryActionRepo";
import { ActionType, RecoveryOutcome } from "../enums";
import { runFollowUpAgent } from "../agents/followUpAgent";
import { runImmediateActionAgent } from "../agents/immediateActionAgent";
import { runNotificationWriterAgent } from "../agents/notificationWriterAgent";
import { prisma } from "../lib/prismaClient";

/**
 * ─── TOOL RELAY ──────────────────────────────────────────────────────────────
 */
async function relayToolCallToMerchant(
  jobId: string,
  merchantCallbackUrl: string,
  toolName: string,
  args: any,
  failureEventId?: string,
): Promise<any> {
  const res = await fetch(`${merchantCallbackUrl}/tool-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, tool: toolName, args, failureEventId }),
  });

  if (!res.ok) {
    throw new Error(`Merchant tool error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * ─── WORKER PROCESSING ────────────────────────────────────────────────────────
 */
async function processRecoveryJob(job: Job<RecoveryJobPayload>) {
  let {
    merchantId,
    merchantCallbackUrl,
    failureEventId,
    externalRef, // <-- Extract externalRef
    context,
    toolSchemas,
    isFollowUp,
    followUpScheduleId,
    isImmediateRecovery,
  } = job.data;
  const jobId = job.id!;

  toolSchemas = toolSchemas || [];

  if (toolSchemas.length === 0) {
    try {
      console.log(`fetching tools from ${merchantCallbackUrl}/tools`);
      const res = await fetch(`${merchantCallbackUrl}/tools`);
      if (res.ok) {
        const json = (await res.json()) as any;
        toolSchemas = json.schemas || [];
      }
    } catch (e) {
      console.error("Failed to fetch tool schemas from merchant:", e);
    }
  }

  console.log(
    `\n⚙️  Processing recovery job: ${jobId} | isFollowUp=${!!isFollowUp} | isImmediate=${!!isImmediateRecovery} | category=${context.failure_category}`,
  );

  try {
    const internalTools = [
      ...toolSchemas,
      {
        type: "function",
        function: {
          name: "schedule_next_follow_up",
          description:
            "Schedules the next follow-up in X minutes. Use this if the customer hasn't paid yet and you want to try again later.",
          parameters: {
            type: "object",
            properties: {
              delay_minutes: { type: "number" },
            },
            required: ["delay_minutes"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "draft_notification_copy",
          description:
            "Calls the expert Notification Writer subagent to draft highly persuasive copy. You MUST pass the customer_name, product_name, and amount if you learned them from query_failure_context.",
          parameters: {
            type: "object",
            properties: {
              channel: { type: "string", enum: ["sms", "email", "whatsapp"] },
              customer_name: {
                type: "string",
                description: "Customer's actual name",
              },
              product_name: {
                type: "string",
                description: "Exact product name",
              },
              amount: {
                type: "number",
                description: "Exact amount in INR (not paise)",
              },
            },
            required: ["channel"],
          },
        },
      },
    ];

    const handleInternalTool = async (tool: string, args: any) => {
      if (tool === "schedule_next_follow_up") {
        const nextExecutionAt = new Date(
          Date.now() + args.delay_minutes * 60000,
        );
        await prisma.followUpSchedule.create({
          data: {
            merchantId,
            failureEventId,
            nextExecutionAt,
          },
        });
        return {
          success: true,
          message: `Scheduled next follow-up at ${nextExecutionAt.toISOString()}`,
        };
      }

      if (tool === "draft_notification_copy") {
        console.log(
          `🤖 Delegating copy drafting to NotificationWriterAgent for channel: ${args.channel}`,
        );

        // Use the args provided by the AI if available, otherwise fallback to stale job context
        const orderDetails =
          args.product_name && args.amount
            ? {
                product_name: args.product_name,
                amount_rupees: args.amount,
                currency: "INR",
                product_offer: context.order_details?.product_offer ?? undefined,
              }
            : context.order_details ? { ...context.order_details, product_offer: context.order_details.product_offer ?? undefined } : null;

        const copy = await runNotificationWriterAgent({
          failureCategory: context.failure_category,
          channel: args.channel as any,
          amountBucket: context.amount_bucket,
          customerName: args.customer_name || context.customer_name,
          orderDetails: orderDetails,
        });
        return { success: true, subject: copy.subject, body: copy.body };
      }

      return relayToolCallToMerchant(
        jobId,
        merchantCallbackUrl,
        tool,
        args,
        externalRef, // Use merchant's actual ID
      );
    };

    if (isImmediateRecovery) {
      // ── Immediate Agent Loop ──────────────────────────────────────────────────
      await runImmediateActionAgent(
        context,
        internalTools as any,
        handleInternalTool,
      );

      await recoveryActionRepo.markComplete(jobId, {
        actionType: ActionType.SendNotification,
        outcome: RecoveryOutcome.Success,
        agentReasoning: "Immediate recovery tools executed",
      });
      console.log(`✅ Immediate recovery job ${jobId} complete.`);
      return;
    }

    if (isFollowUp && followUpScheduleId) {
      // ── Follow-Up Agent Loop ──────────────────────────────────────────────────

      // Ensure a RecoveryAction row exists for this follow-up job so we can log it
      await recoveryActionRepo
        .create({
          merchantId,
          failureEventId,
          jobId,
          attemptNumber: 1, // Follow-up is technically a subsequent attempt, but 1 is fine for the log
        })
        .catch((e) => console.warn("Action already exists:", e));
      await recoveryActionRepo.markInProgress(jobId).catch(() => {});

      let lastActionTaken = "do_nothing";
      let agentReasoningContext = "Executed follow-up sequence";

      // Wrap the internal tool handler to track what action the AI took
      const followUpHandleInternalTool = async (tool: string, args: any) => {
        if (
          tool !== "query_failure_context" &&
          tool !== "draft_notification_copy"
        ) {
          lastActionTaken = tool;
        }
        return handleInternalTool(tool, args);
      };

      await runFollowUpAgent(
        context,
        internalTools as any,
        followUpHandleInternalTool,
      );

      // Mark this schedule as completed
      await prisma.followUpSchedule.update({
        where: { id: followUpScheduleId },
        data: { status: "COMPLETED" },
      });

      await recoveryActionRepo
        .markComplete(jobId, {
          actionType: lastActionTaken as ActionType,
          outcome: RecoveryOutcome.Success,
          agentReasoning: agentReasoningContext,
        })
        .catch((e) => console.warn("Failed to mark action complete:", e));

      console.log(`✅ Follow-up job ${jobId} complete.`);
      return;
    }

    console.log(
      `Job ${jobId} is not a follow-up or immediate. Unknown format.`,
    );
  } catch (err) {
    console.error(`❌ Job ${jobId} failed:`, err);
    if (isFollowUp && followUpScheduleId) {
      await prisma.followUpSchedule.update({
        where: { id: followUpScheduleId },
        data: {
          status: "PENDING",
          nextExecutionAt: new Date(Date.now() + 5 * 60000),
        },
      });
      console.log(`Rescheduled failed follow-up job to run in 5 minutes.`);
    }
  }
}

export function startRecoveryWorker() {
  const worker = new Worker<RecoveryJobPayload>(
    "recovery-jobs",
    processRecoveryJob,
    {
      connection: redisConnection,
      concurrency: 3,
    },
  );
  worker.on("completed", (job) =>
    console.log(`✅ BullMQ job ${job.id} completed`),
  );
  worker.on("failed", (job, err) =>
    console.log(`❌ BullMQ job ${job?.id} failed: ${err}`),
  );
}

