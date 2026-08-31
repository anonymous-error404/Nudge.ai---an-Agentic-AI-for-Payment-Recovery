import { Router } from "express";
import { webhookController } from "../controllers/webhookController";
import { verifyWebhookSignature } from "../middleware/verifyWebhookSignature";

const router = Router();

router.post("/webhook/razorpay", verifyWebhookSignature, webhookController.handleWebhook.bind(webhookController));

export default router;
