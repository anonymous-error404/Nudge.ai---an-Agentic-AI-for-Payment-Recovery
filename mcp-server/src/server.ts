import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import recoveryJobsRouter from "./routes/recoveryJobsRoutes";
import toolResultsRouter from "./routes/toolResultsRoutes";
import analyticsSubmitRouter from "./routes/analyticsSubmitRoute";
import { startRecoveryWorker } from "./queue/recoveryWorker";
import { startAnalyticsWorker } from "./queue/analyticsWorker";
import { startFollowUpPoller } from "./cron/followUpPoller";

const app = express();
const PORT = process.env.PORT ?? 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use(recoveryJobsRouter);
app.use(toolResultsRouter);
app.use(analyticsSubmitRouter); // POST /analytics/submit

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mcp-server",
    timestamp: new Date().toISOString(),
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🧠 MCP Server running at http://localhost:${PORT}`);
  console.log(`   Health:       http://localhost:${PORT}/health`);
  console.log(`   Recovery API: http://localhost:${PORT}/api/recovery-jobs`);
  console.log(`   Audit log:    http://localhost:${PORT}/api/audit\n`);
});

// ─── Start BullMQ Worker & Poller ──────────────────────────────────────────────
startRecoveryWorker();
startAnalyticsWorker();
startFollowUpPoller();

export default app;

