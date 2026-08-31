import { Router } from "express";
import { mcpCallbackController } from "../controllers/mcpCallbackController";

const router = Router();

/**
 * POST /mcp/tool-call
 * MCP server relays Claude's chosen tool — we execute it here.
 */
router.post(
  "/mcp/tool-call",
  mcpCallbackController.handleToolCall.bind(mcpCallbackController)
);

/**
 * POST /mcp/job-complete
 * MCP server notifies us Claude has finished — update merchant DB.
 */
router.post(
  "/mcp/job-complete",
  mcpCallbackController.handleJobComplete.bind(mcpCallbackController)
);

export default router;
