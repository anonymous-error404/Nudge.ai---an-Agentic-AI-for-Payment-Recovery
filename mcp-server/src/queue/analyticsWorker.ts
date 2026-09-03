import { Worker, Job } from "bullmq";
import { redisConnection } from "./jobQueue";
import { runMerchantIntelligenceAgent } from "../agents/merchantIntelligenceAgent";

/** Shape of a job pushed onto the analytics-jobs queue */
export interface AnalyticsJobPayload {
  sessionId: string;
  message: string;
  merchantId: string;
}

const MERCHANT_APP_BASE = "http://localhost:3000";
const QUEUE_NAME = "analytics-jobs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fetch available analytics tool schemas from the merchant app. */
async function fetchAnalyticsToolSchemas(): Promise<any[]> {
  const res = await fetch(
    `${MERCHANT_APP_BASE}/api/admin/analytics-tool-schemas`,
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch analytics tool schemas: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as any;
  // Support both a bare array and an object with a schemas/tools key
  if (Array.isArray(json)) return json;
  return json.schemas ?? json.tools ?? [];
}

/** Execute a single tool call by POSTing to the merchant app. */
async function callAnalyticsTool(tool: string, args: any): Promise<any> {
  const res = await fetch(
    `${MERCHANT_APP_BASE}/api/admin/analytics-tool-call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Analytics tool call failed (${tool}): ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

/** Send the final agent response (or an error message) back to the chat session. */
async function sendChatResponse(
  sessionId: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${MERCHANT_APP_BASE}/api/admin/chat/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, content }),
  });
  if (!res.ok) {
    console.error(
      `\u26a0\ufe0f Failed to deliver chat response for session ${sessionId}: ${res.status} ${await res.text()}`,
    );
  }
}

// ─── Job processor ───────────────────────────────────────────────────────────

async function processAnalyticsJob(
  job: Job<AnalyticsJobPayload>,
): Promise<void> {
  const { sessionId, message, merchantId } = job.data;

  console.log(
    `\n\ud83d\udcca Processing analytics job: ${job.id} | session=${sessionId} | merchant=${merchantId}`,
  );

  try {
    // 1. Fetch the tool schemas from the merchant app
    let toolSchemas: any[] = [];
    try {
      toolSchemas = await fetchAnalyticsToolSchemas();
      console.log(`   Loaded ${toolSchemas.length} analytics tool schemas.`);
    } catch (e) {
      console.error("   Failed to fetch analytics tool schemas:", e);
      // Proceed with an empty tool list; the agent will respond without tools
    }

    // 2. Run the MerchantIntelligenceAgent agentic loop
    const finalResponse = await runMerchantIntelligenceAgent({
      message,
      toolSchemas,
      callTool: callAnalyticsTool,
    });

    // 3. Send the final response back to the chat session
    await sendChatResponse(sessionId, finalResponse);
    console.log(`\u2705 Analytics job ${job.id} complete.`);
  } catch (err) {
    console.error(`\u274c Analytics job ${job.id} failed:`, err);

    // Attempt to notify the chat session about the error
    try {
      await sendChatResponse(
        sessionId,
        "I encountered an error while processing your request. Please try again in a moment.",
      );
    } catch (notifyErr) {
      console.error(
        "   Could not deliver error response to chat session:",
        notifyErr,
      );
    }
  }
}

// ─── Worker bootstrap ────────────────────────────────────────────────────────

export function startAnalyticsWorker(): void {
  const worker = new Worker<AnalyticsJobPayload>(
    QUEUE_NAME,
    processAnalyticsJob,
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on("completed", (job) =>
    console.log(`\u2705 BullMQ analytics job ${job.id} completed`),
  );
  worker.on("failed", (job, err) =>
    console.log(`\u274c BullMQ analytics job ${job?.id} failed: ${err}`),
  );

  console.log(
    `\ud83d\udcca Analytics worker listening on queue: ${QUEUE_NAME}`,
  );
}
