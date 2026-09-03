import { Request, Response } from "express";
import { RazorpayWebhookEvent } from "../types";
import { webhookService } from "../services/webhookService";

class WebhookController {
  async handleWebhook(req: Request, res: Response) {
    let event: RazorpayWebhookEvent;
    if (Buffer.isBuffer(req.body)) {
      event = JSON.parse(req.body.toString("utf8")) as RazorpayWebhookEvent;
    } else {
      event = req.body as RazorpayWebhookEvent;
    }
    // Process synchronously so self-POST callers (simulator) can read the uiMessage
    const result = await webhookService.processEvent(event);
    res.status(200).json({ status: "ok", ...result });
  }
}

export const webhookController = new WebhookController();
