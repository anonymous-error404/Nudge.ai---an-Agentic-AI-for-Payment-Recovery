import { Router } from "express";
import { mcpCallbackController } from "../controllers/mcpCallbackController";

const router = Router();

/**
 * POST /mcp/tool-call
 * MCP server relays AI-chosen tool — we execute it here.
 */
router.post(
  "/mcp/tool-call",
  mcpCallbackController.handleToolCall.bind(mcpCallbackController),
);

/**
 * POST /mcp/job-complete
 * MCP server notifies us AI has finished — update merchant DB.
 */
router.post(
  "/mcp/job-complete",
  mcpCallbackController.handleJobComplete.bind(mcpCallbackController),
);

import { TOOL_SCHEMAS } from "../tools";

/**
 * GET /mcp/tools
 * Allows the MCP server (cron job) to dynamically fetch the merchant's supported tools.
 */
router.get("/mcp/tools", (req, res) => {
  res.json({ schemas: TOOL_SCHEMAS });
});

export default router;
