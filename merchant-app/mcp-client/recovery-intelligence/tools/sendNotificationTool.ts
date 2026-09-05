/**
 * send_notification tool
 * Mock implementation — logs to console and returns success.
 * Replace with real SMS/email provider (Twilio, SendGrid, etc.) when going live.
 *
 * Injects a retry_url into the notification content so customers can
 * click straight back into their failed order.
 */

import { prisma } from "../../../src/lib/prismaClient";
import { emailService } from "../../../src/services/emailService";
import { log } from '../../../../shared/logger';

export const sendNotificationSchema = {
  type: "function" as const,
  function: {
    name: "send_notification",
    description:
      "Sends a payment recovery nudge to the customer via the specified channel (email). " +
      "Use for delayed recovery: insufficient funds, abandoned cart, do-not-honor bank declines.",
    parameters: {
      type: "object" as const,
      properties: {
        customer_id: {
          type: "string",
          description: "The merchant-side customer ID to notify.",
        },
        channel: {
          type: "string",
          enum: ["sms", "email", "whatsapp"],
          description: "Delivery channel for the notification. (Note: SMS/WhatsApp will be simulated via test email).",
        },
        template: {
          type: "string",
          description:
            "Template key or free-text message hint. Ignored if 'content' is provided.",
        },
        content: {
          type: "string",
          description:
            "The FULL verbatim message body to send. Copy this EXACTLY from the 'body' field returned by draft_notification_copy. Do NOT paraphrase or shorten it.",
        },
        subject: {
          type: "string",
          description:
            "Email subject line. Only used when channel is 'email'. Copy this EXACTLY from the 'subject' field returned by draft_notification_copy.",
        },
      },
      required: ["customer_id", "channel", "template"],
    },
  },
};

const BASE_URL = process.env.MERCHANT_BASE_URL ?? "http://localhost:3000";

export async function executeSendNotification(args: {
  customer_id: string;
  channel: string;
  template: string;
  content?: string;   // injected by Agent 3 before delivery
  subject?: string;   // email subject from Agent 3
}): Promise<{ success: boolean; channel: string; message: string; retryUrl?: string }> {

  // ── Retrieve customer email ──────────────────────────────────────────────────
  const customer = await prisma.customer.findUnique({
    where: { id: args.customer_id }
  });

  if (!customer) {
    return { success: false, channel: args.channel, message: "Customer not found" };
  }

  // ── Build retry URL from the customer's most recent failed order ──────────
  let retryUrl: string | undefined;
  try {
    const latestFailedOrder = await prisma.order.findFirst({
      where: {
        customerId: args.customer_id,
        status: { in: ["failed", "attempted"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { retryToken: true },
    });
    if (latestFailedOrder) {
      retryUrl = `${BASE_URL}/retry?token=${latestFailedOrder.retryToken}`;
    }
  } catch (e) {
    log.warn(`Could not build retry URL: ${(e as Error).message}`);
  }

  // ── Append retry URL to notification body if we have one ─────────────────
  let body = args.content ?? args.template;
  let htmlBody = body.replace(/\n/g, '<br>');
  if (retryUrl) {
    htmlBody += `<br><br><a href="${retryUrl}" style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:4px;">Retry your payment</a>`;
    body = body.trimEnd() + `\n\nRetry your payment here: ${retryUrl}`;
  }

  let successMsg = `Notification sent via ${args.channel} (mock)`;

  if (args.channel === "email") {
    log.info("📬", `Sending recovery email to ${customer.email} via SMTP...`);
    const subject = args.subject || "Payment Failed - Action Required";
    const result = await emailService.sendEmail(customer.email, subject, htmlBody);

    if (result.success) {
      successMsg = `Email sent successfully. Preview URL: ${result.previewUrl}`;
    } else {
      successMsg = `Failed to send email: ${result.error}`;
    }
  } else if (args.channel === "sms" || args.channel === "whatsapp") {
    log.notificationSent(args.channel, customer.name, body.slice(0, 100));
    successMsg = `Mock ${args.channel.toUpperCase()} logged to console successfully.`;
  }

  return {
    success: true,
    channel: args.channel,
    message: successMsg,
    retryUrl,
  };
}




