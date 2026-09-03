import { Router } from "express";
import { analyticsController } from "./analyticsController";
import { analyticsAgentController } from "./analyticsAgentController";

const router = Router();

// ── Analytics REST (admin-gated) ─────────────────────────────────────
router.get("/api/admin/analytics/summary", analyticsController.getSummary.bind(analyticsController));
router.get("/api/admin/analytics/failure-breakdown", analyticsController.getFailureBreakdown.bind(analyticsController));
router.get("/api/admin/analytics/recovery-proof", analyticsController.getRecoveryProof.bind(analyticsController));
router.get("/api/admin/analytics/customer-risk", analyticsController.getCustomerRisk.bind(analyticsController));

// ── Merchant AI Chat ─────────────────────────────────────────────────
router.post("/api/admin/chat", analyticsAgentController.handleChat.bind(analyticsAgentController));
router.get("/api/admin/chat/stream/:sessionId", analyticsAgentController.streamResponse.bind(analyticsAgentController));
router.post("/api/admin/chat/respond", analyticsAgentController.receiveResponse.bind(analyticsAgentController));

// ── MCP Worker callbacks ─────────────────────────────────────────────
router.post("/api/admin/analytics-tool-call", analyticsAgentController.handleToolCall.bind(analyticsAgentController));
router.get("/api/admin/analytics-tool-schemas", analyticsAgentController.getToolSchemas.bind(analyticsAgentController));

export default router;
