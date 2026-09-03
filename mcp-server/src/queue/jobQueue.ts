import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { RecoveryJobPayload } from "../types";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ─── Shared Redis connection (used by all BullMQ queues and workers) ──────────
export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// ─── Recovery Jobs Queue ──────────────────────────────────────────────────────
export const RECOVERY_QUEUE_NAME = "recovery-jobs";

export const recoveryQueue = new Queue<RecoveryJobPayload>(
  RECOVERY_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  },
);

// ─── Analytics Jobs Queue ─────────────────────────────────────────────────────
export const ANALYTICS_QUEUE_NAME = "analytics-jobs";

export const analyticsQueue = new Queue(ANALYTICS_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

// ─── Redis key helpers ────────────────────────────────────────────────────────

/**
 * Redis key used to signal tool results back to the waiting recovery worker.
 * Pattern: mcp:tool-result:<jobId>
 */
export function toolResultKey(jobId: string) {
  return `mcp:tool-result:${jobId}`;
}

/**
 * Wait for a tool result to be published to Redis (by /api/tool-results endpoint).
 * Times out after 30 seconds - if merchant doesn't respond, the job fails.
 */
export async function waitForToolResult(
  jobId: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const key = toolResultKey(jobId);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const rawResult = await redisConnection.getdel(key);
    if (rawResult) {
      return JSON.parse(rawResult) as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Tool result timeout for job ${jobId} after ${timeoutMs}ms`);
}
