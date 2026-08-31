import { Worker, Job } from "bullmq";
import {
  redisConnection,
  QUEUE_NAME,
  waitForToolResult,
  toolResultKey,
} from "./recoveryQueue";
import { recoveryActionRepo } from "../repositories/recoveryActionRepo";
import { runDecisionAgent } from "../agents/decisionAgent";
import { runNotificationWriterAgent } from "../agents/notificationWriterAgent";
import { RecoveryOutcome, ActionType, NotificationChannel } from "../enums";
import type {
  RecoveryJobPayload,
  ToolCallMessage,
  JobCompleteMessage,
} from "../types";

const MERCHANT_CALLBACK_TIMEOUT = 30_000; // 30s for merchant to execute a tool

async function relayToolCallToMerchant(
  jobId: string,
  merchantCallbackUrl: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body: ToolCallMessage = { jobId, tool, args };

  console.log(
    `📡 Relaying tool call [${tool}] to merchant callback: ${merchantCallbackUrl}/tool-call`,
  );

  const res = await fetch(`${merchantCallbackUrl}/tool-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000), // 10s for merchant to ACK the relay
  });

  if (!res.ok) {
    throw new Error(
      `Merchant callback rejected tool call: ${res.status} ${await res.text()}`,
    );
  }

  // Now wait for merchant to POST the result back to /api/tool-results
  return waitForToolResult(jobId, MERCHANT_CALLBACK_TIMEOUT);
}

async function notifyJobComplete(
  merchantCallbackUrl: string,
  payload: JobCompleteMessage,
): Promise<void> {
  await fetch(`${merchantCallbackUrl}/job-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) =>
    console.warn("Failed to notify merchant of job complete:", e),
  );
}

async function processRecoveryJob(job: Job<RecoveryJobPayload>) {
  const {
    merchantId,
    merchantCallbackUrl,
    failureEventId,
    context,
    toolSchemas,
  } = job.data;
  const jobId = job.id!;

  console.log(
    `\n⚙️  Processing recovery job: ${jobId} | merchant=${merchantId} | category=${context.failure_category}`,
  );

  // Mark in-progress
  await recoveryActionRepo.markInProgress(jobId);

  try {
    // ── Agent 1: Recovery Decision Agent ──────────────────────────────────────
    const { actionType, agentReasoning, toolCallArgs } = await runDecisionAgent(
      context,
      toolSchemas,
      async (tool, args) => {
        // This callback is called each time AI picks a tool
        return relayToolCallToMerchant(jobId, merchantCallbackUrl, tool, args);
      },
    );

    // ── Agent 3: Notification Writer (if action = send_notification) ──────────
    let notificationContent: string | undefined;

    if (actionType === ActionType.SendNotification) {
      const channel =
        (toolCallArgs.channel as NotificationChannel) ??
        NotificationChannel.Email;
      console.log(
        `✍️  Invoking Agent 3 (Notification Writer) for channel: ${channel}`,
      );

      const written = await runNotificationWriterAgent({
        failureCategory: context.failure_category,
        channel,
        amountBucket: context.amount_bucket,
        orderDetails: context.order_details ?? null,
      });

      notificationContent = written.subject
        ? `Subject: ${written.subject}\n\n${written.body}`
        : written.body;

      console.log(`📝 Agent 3 wrote:\n${notificationContent}`);

      // Relay the written content back to merchant so they can actually send it
      await relayToolCallToMerchant(
        jobId,
        merchantCallbackUrl,
        "deliver_notification",
        {
          ...toolCallArgs,
          content: notificationContent,
          subject: written.subject,
        },
      ).catch((e) => console.warn("deliver_notification relay failed:", e));
    }

    // ── Log outcome ───────────────────────────────────────────────────────────
    await recoveryActionRepo.markComplete(jobId, {
      actionType,
      outcome: RecoveryOutcome.Success,
      agentReasoning,
      notificationContent,
    });

    const completeMsg: JobCompleteMessage = {
      jobId,
      actionType,
      outcome: RecoveryOutcome.Success,
      agentReasoning,
      notificationContent,
    };

    await notifyJobComplete(merchantCallbackUrl, completeMsg);

    console.log(
      `✅ Job ${jobId} complete | action=${actionType} | outcome=success`,
    );
  } catch (err) {
    console.error(`❌ Job ${jobId} failed:`, err);

    await recoveryActionRepo.markComplete(jobId, {
      actionType: null,
      outcome: RecoveryOutcome.Failed,
      agentReasoning: `Worker error: ${String(err)}`,
    });

    await notifyJobComplete(merchantCallbackUrl, {
      jobId,
      actionType: null,
      outcome: RecoveryOutcome.Failed,
      agentReasoning: `Worker error: ${String(err)}`,
    });

    throw err; // let BullMQ handle retry
  }
}

export function startRecoveryWorker() {
  const worker = new Worker<RecoveryJobPayload>(
    QUEUE_NAME,
    processRecoveryJob,
    {
      connection: redisConnection,
      concurrency: 3, // max 3 AI calls at a time
    },
  );

  worker.on("completed", (job) => {
    console.log(`✅ BullMQ job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ BullMQ job ${job?.id} failed:`, err.message);
  });

  console.log("🔄 Recovery Worker started (concurrency=3)");
  return worker;
}
