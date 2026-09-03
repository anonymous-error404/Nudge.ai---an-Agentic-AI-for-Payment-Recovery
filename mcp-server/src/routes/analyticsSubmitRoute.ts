import { Router, Request, Response } from "express";
import { analyticsQueue } from "../queue/jobQueue";

const router = Router();

/**
 * POST /analytics/submit
 * Merchant app calls this to enqueue an analytics chat job.
 * Body: { sessionId: string, message: string, merchantId: string }
 */
router.post("/analytics/submit", async (req: Request, res: Response) => {
  const { sessionId, message, merchantId } = req.body as {
    sessionId?: string;
    message?: string;
    merchantId?: string;
  };

  if (!sessionId || !message) {
    return res.status(400).json({ success: false, error: "sessionId and message are required" });
  }

  try {
    await analyticsQueue.add(
      "analytics-query",
      { sessionId, message, merchantId: merchantId ?? "default" },
    );
    console.log(`📊 Analytics job enqueued | session=${sessionId}`);
    res.json({ success: true, sessionId });
  } catch (err: any) {
    console.error("Failed to enqueue analytics job:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
