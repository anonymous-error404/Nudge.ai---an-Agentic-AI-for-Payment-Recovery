import { Request, Response } from "express";
import { RazorpayWebhookEvent } from "../types";
import { webhookService } from "../services/webhookService";

class WebhookController {
  async handleWebhook(req: Request, res: Response) {
    res.status(200).json({ status: "ok" });
    const event = req.body as RazorpayWebhookEvent;
    // Process event asynchronously after ACK
    webhookService.processEvent(event);
  }
}

export const webhookController = new WebhookController();
