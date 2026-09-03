/**
 * Analytics Agent Orchestrator
 * Submits analytics chat jobs to the MCP server via HTTP.
 * The MCP server enqueues them onto the analytics-jobs BullMQ queue.
 */

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3001";

export const analyticsAgentOrchestrator = {
  async enqueueJob(sessionId: string, message: string): Promise<void> {
    const res = await fetch(`${MCP_SERVER_URL}/analytics/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message, merchantId: "default" }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MCP server rejected analytics job: ${res.status} ${body}`);
    }

    console.log(`📊 Analytics job submitted to MCP server | session=${sessionId}`);
  },
};
