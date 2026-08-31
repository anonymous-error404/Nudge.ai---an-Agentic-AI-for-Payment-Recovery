import Anthropic from "@anthropic-ai/sdk";
import { NotificationChannel } from "../enums";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a customer communication specialist for a payments platform.
Your job is to write short, empathetic, and effective recovery messages.

Rules:
- SMS: MAXIMUM 160 characters. Direct, warm, one clear CTA.
- Email: 3-5 sentences. Friendly subject line + body. One CTA.
- WhatsApp: Conversational tone, 2-3 short sentences. Emoji optional.

Never mention competitor payment methods. Never sound robotic or threatening.
Always include a clear next step for the customer.`;

export interface NotificationContent {
  subject?: string;   // for email
  body: string;
  channel: NotificationChannel;
}

/**
 * Agent 3 — Notification Writer Agent.
 * Called by the worker AFTER Agent 1 decides send_notification.
 * Generates channel-appropriate copy for the notification.
 */
export async function runNotificationWriterAgent(params: {
  failureCategory: string;
  channel: NotificationChannel;
  amountBucket: string;
  merchantName?: string;
}): Promise<NotificationContent> {
  const { failureCategory, channel, amountBucket, merchantName = "the merchant" } = params;

  const prompt = `Write a payment recovery ${channel} message for this situation:
- Failure reason: ${failureCategory}
- Amount range: ₹${amountBucket}
- Merchant: ${merchantName}
- Channel: ${channel}

${channel === "sms" ? "STRICT LIMIT: 160 characters maximum for the message body." : ""}
${channel === "email" ? "Include a subject line on the first line prefixed with 'Subject: '" : ""}

Return only the message content, nothing else.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",  // cheaper model for creative writing task
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Parse email subject if present
  if (channel === NotificationChannel.Email && rawText.startsWith("Subject:")) {
    const lines = rawText.split("\n");
    const subject = lines[0].replace("Subject:", "").trim();
    const body = lines.slice(1).join("\n").trim();
    return { subject, body, channel };
  }

  return { body: rawText, channel };
}
