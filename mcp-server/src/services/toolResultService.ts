import { redisConnection, toolResultKey } from "../queue/jobQueue";

class ToolResultService {
  /**
   * Publishes a tool execution result to Redis so the waiting worker can pick it up.
   * The worker polls this key via waitForToolResult().
   */
  async publish(jobId: string, result: Record<string, unknown>): Promise<void> {
    const key = toolResultKey(jobId);
    // Set with 60s TTL — if worker doesn't pick it up by then, it's already failed
    await redisConnection.set(key, JSON.stringify(result), "EX", 60);
    console.log(`📨 Tool result published for job ${jobId}`);
  }
}

export const toolResultService = new ToolResultService();

