import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export function verifyWebhookSignature(req: Request, res: Response, next: NextFunction) {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("WEBHOOK_SECRET not set — rejecting webhook");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const signature = req.headers["x-razorpay-signature"] as string;
  if (!signature) {
    console.error("Missing x-razorpay-signature header");
    return res.status(400).json({ error: "Missing signature" });
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    console.error("rawBody not captured — check server.ts middleware order");
    return res.status(500).json({ error: "rawBody missing" });
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex"),
  );

  if (!isValid) {
    console.warn("⚠️  Webhook signature verification FAILED — rejecting");
    return res.status(400).json({ error: "Invalid signature" });
  }

  next();
}
