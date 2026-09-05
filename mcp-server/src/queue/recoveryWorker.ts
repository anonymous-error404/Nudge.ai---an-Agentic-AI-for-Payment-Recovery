import { Worker, Job } from "bullmq";
import { recoveryQueue, redisConnection } from "./jobQueue";
import { RecoveryJobPayload } from "../types";
import { recoveryActionRepo } from "../repositories/recoveryActionRepo";
import { ActionType, RecoveryOutcome } from "../enums";
import { runFollowUpAgent } from "../agents/followUpAgent";
import { runImmediateActionAgent } from "../agents/immediateActionAgent";
import { runNotificationWriterAgent } from "../agents/notificationWriterAgent";
import { prisma } from "../lib/prismaClient";
import { log, toIST } from '../../../shared/logger';

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
      log.info("🔌", `Fetching available tools from MCP Client at ${merchantCallbackUrl}/tools`);
      const res = await fetch(`${merchantCallbackUrl}/tools`);
      if (res.ok) {
        const json = (await res.json()) as any;
        toolSchemas = json.schemas || [];
        log.step(`Loaded ${toolSchemas.length} tool(s) from MCP Client`);
      }
    } catch (e) {
      log.error("Could not fetch tool schemas from MCP Client", e);
    }
  }

  log.section(
    isImmediateRecovery ? "⚡" : "🔄",
    isImmediateRecovery
      ? `New immediate recovery job started`
      : isFollowUp
        ? `Follow-up recovery job started`
        : `Recovery job started`,
    `category="${context.failure_category}" | jobId=${jobId}`,
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
              product_offer: {
                type: "string",
                description: "Any active product offer or discount code you found in context",
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
        const agentName = isImmediateRecovery ? "The Strategist" : "The Tracker";
        log.scheduled(`Follow-up job scheduled by ${agentName}`, nextExecutionAt);
        return {
          success: true,
          message: `Next follow-up scheduled at ${toIST(nextExecutionAt)} (IST)`,
        };
      }

      if (tool === "draft_notification_copy") {
        log.info("✍️", `Calling Notification Writer Agent to draft ${args.channel.toUpperCase()} copy for customer "${args.customer_name || context.customer_name}"`);

        // Use the args provided by the AI if available, otherwise fallback to stale job context
        const orderDetails =
          args.product_name && args.amount
            ? {
                product_name: args.product_name,
                amount_rupees: args.amount,
                currency: "INR",
                product_offer: args.product_offer || context.order_details?.product_offer || undefined,
              }
            : context.order_details ? { ...context.order_details, product_offer: args.product_offer || context.order_details.product_offer || undefined } : null;

        const copy = await runNotificationWriterAgent({
          failureCategory: context.failure_category,
          channel: args.channel as any,
          amountBucket: context.amount_bucket,
          customerName: args.customer_name || context.customer_name,
          orderDetails: orderDetails,
        });
        log.step(`Notification copy drafted — subject: "${copy.subject || "(SMS)"}"`);
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
      log.success(`Immediate recovery job complete — jobId=${jobId}`);
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
          attemptNumber: 1,
        })
        .catch((e) => log.warn(`Could not create action record: ${e}`));
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
        .catch((e) => log.warn(`Could not mark action complete: ${e}`));

      log.success(`Follow-up recovery job complete — jobId=${jobId}`);
      return;
    }

    log.warn(`Job ${jobId} format unrecognised — not a follow-up or immediate job.`);
  } catch (err) {
    log.error(`Recovery job failed — jobId=${jobId}`, err);
    if (isFollowUp && followUpScheduleId) {
      const rescheduleAt = new Date(Date.now() + 5 * 60000);
      await prisma.followUpSchedule.update({
        where: { id: followUpScheduleId },
        data: {
          status: "PENDING",
          nextExecutionAt: rescheduleAt,
        },
      });
      log.scheduled("Failed follow-up rescheduled for retry", rescheduleAt);
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
    log.success(`BullMQ job ${job.id} processed successfully`),
  );
  worker.on("failed", (job, err) =>
    log.error(`BullMQ job ${job?.id} failed`, err),
  );
}

