import { Request, Response } from "express";
import { analyticsAgentOrchestrator } from "./analyticsAgentOrchestrator";
import { ANALYTICS_TOOL_SCHEMAS, executeAnalyticsTool } from "./tools";

// ─────────────────────────────────────────────────────────────────────
// In-memory SSE response store
// Key: sessionId → null (pending) | string (ready)
// ─────────────────────────────────────────────────────────────────────
const pendingResponses = new Map<string, string | null>();

export function setAnalyticsResponse(sessionId: string, content: string): void {
  pendingResponses.set(sessionId, content);
}

function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

class AnalyticsAgentController {
  /**
   * POST /api/admin/chat
   * Accepts { message } from the merchant, enqueues an analytics job,
   * and returns a sessionId for SSE streaming.
   */
  async handleChat(req: Request, res: Response) {
    if (!req.session?.user || req.session.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      return res.status(400).json({ success: false, error: "message is required" });
    }

    const sessionId = generateSessionId();
    pendingResponses.set(sessionId, null); // null = pending

    try {
      await analyticsAgentOrchestrator.enqueueJob(sessionId, message.trim());
      res.json({ success: true, sessionId });
    } catch (err: any) {
      pendingResponses.delete(sessionId);
      res.status(500).json({ success: false, error: "Failed to enqueue analytics job: " + err.message });
    }
  }

  /**
   * GET /api/admin/chat/stream/:sessionId
   * SSE endpoint — streams the AI response back to the browser as it arrives.
   */
  streamResponse(req: Request, res: Response) {
    const { sessionId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send a heartbeat immediately so the browser knows the connection is open
    res.write(": heartbeat\n\n");

    let attempts = 0;
    const MAX_WAIT_MS = 120000; // 2 minutes
    const POLL_MS = 800;
    const maxAttempts = Math.floor(MAX_WAIT_MS / POLL_MS);

    const interval = setInterval(() => {
      attempts++;
      const content = pendingResponses.get(sessionId);

      if (content !== null && content !== undefined) {
        // Response is ready — stream it in chunks of ~80 chars for a "streaming" feel
        const chunkSize = 80;
        for (let i = 0; i < content.length; i += chunkSize) {
          const chunk = content.slice(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ type: "delta", content: chunk })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        clearInterval(interval);
        pendingResponses.delete(sessionId);
        res.end();
        return;
      }

      if (attempts >= maxAttempts) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Agent timed out. Please try again." })}\n\n`);
        clearInterval(interval);
        pendingResponses.delete(sessionId);
        res.end();
      }
    }, POLL_MS);

    req.on("close", () => {
      clearInterval(interval);
    });
  }

  /**
   * POST /api/admin/chat/respond
   * Called by the MCP analytics worker once the AI has finished.
   */
  receiveResponse(req: Request, res: Response) {
    const { sessionId, content } = req.body as { sessionId?: string; content?: string };
    if (!sessionId || content === undefined) {
      return res.status(400).json({ success: false, error: "sessionId and content are required" });
    }
    setAnalyticsResponse(sessionId, content);
    res.json({ success: true });
  }

  /**
   * POST /api/admin/analytics-tool-call
   * Called by the MCP analytics worker to execute a tool.
   */
  async handleToolCall(req: Request, res: Response) {
    const { tool, args } = req.body as { tool?: string; args?: Record<string, unknown> };
    if (!tool) {
      return res.status(400).json({ success: false, error: "tool name required" });
    }
    try {
      const result = await executeAnalyticsTool(tool, args ?? {});
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/admin/analytics-tool-schemas
   * Called by the MCP analytics worker to get available tool definitions.
   */
  getToolSchemas(_req: Request, res: Response) {
    res.json({ schemas: ANALYTICS_TOOL_SCHEMAS });
  }
}

export const analyticsAgentController = new AnalyticsAgentController();
