import Groq from "groq-sdk";
import { NotificationChannel } from "../enums";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Use the same capable model — gpt-oss-20b returns empty content for some prompts
const WRITER_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are a customer communication specialist for a payments platform.
Your job is to write short, empathetic, and effective recovery messages.

Rules:
- SMS: MAXIMUM 160 characters. Direct, warm, one clear CTA.
- Email: 3-5 sentences. Friendly subject line + body. One CTA.
- WhatsApp: Conversational tone, 2-3 short sentences. Emoji optional.

Never mention competitor payment methods. Never sound robotic or threatening.
Always include a clear next step for the customer.`;

export interface NotificationContent {
  subject?: string; // for email
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
  orderDetails?: {
    product_name: string;
    product_description?: string;
    amount_rupees: number;
    currency: string;
  } | null;
}): Promise<NotificationContent> {
  const {
    failureCategory,
    channel,
    amountBucket,
    merchantName = "the merchant",
    orderDetails,
  } = params;

  // Use specific product info if available, fall back to generic amount bucket
  const productLine = orderDetails
    ? `- Product: ${orderDetails.product_name}${orderDetails.product_description ? ` (${orderDetails.product_description})` : ""}`
    : `- Amount range: Rs. ${amountBucket}`;
  const amountLine = orderDetails
    ? `- Exact amount: Rs. ${orderDetails.amount_rupees} ${orderDetails.currency}`
    : "";

  const prompt = `Write a payment recovery ${channel} message for this situation:
- Failure reason: ${failureCategory}
${productLine}
${amountLine}
- Merchant: ${merchantName}
- Channel: ${channel}

${channel === "sms" ? "STRICT LIMIT: 160 characters maximum for the message body." : ""}
${channel === "email" ? "Include a subject line on the first line prefixed with 'Subject: '" : ""}

Return only the message content, nothing else.`;

  // Token limits per channel: SMS is tiny, email needs room for subject + body
  const maxTokens =
    channel === NotificationChannel.SMS      ? 80  :
    channel === NotificationChannel.WhatsApp ? 200 :
    800; // email

  const response = await client.chat.completions.create({
    model: WRITER_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  const rawText = (response.choices[0].message.content ?? "").trim();

  // Debug: log finish_reason and raw content length to understand model behaviour
  console.log(`🔍 Agent 3 raw response | finish_reason=${response.choices[0].finish_reason} | content_length=${rawText.length} | preview="${rawText.slice(0, 80)}"`);

  if (!rawText) {
    console.warn(`⚠️  Agent 3 returned empty content for channel=${channel}. Using fallback template.`);
    return getFallbackContent(failureCategory, channel);
  }

  // Parse email subject if present
  if (channel === NotificationChannel.Email && rawText.startsWith("Subject:")) {
    const lines = rawText.split("\n");
    const subject = lines[0].replace("Subject:", "").trim();
    const body = lines.slice(1).join("\n").trim();
    return { subject, body, channel };
  }

  return { body: rawText, channel };
}

function getFallbackContent(failureCategory: string, channel: NotificationChannel): NotificationContent {
  const templates: Record<string, Record<NotificationChannel, { subject?: string; body: string }>> = {
    insufficient_funds: {
      [NotificationChannel.SMS]:      { body: "Hi! Your recent payment didn't go through due to low balance. Complete your purchase when ready. We've saved your cart!" },
      [NotificationChannel.Email]:    { subject: "Your payment needs attention", body: "We noticed your recent payment couldn't be processed due to insufficient funds. Your cart is saved — complete your purchase whenever you're ready." },
      [NotificationChannel.WhatsApp]: { body: "Hey! 👋 Your payment didn't go through. No worries — your cart is saved. Try again when you're ready!" },
    },
    abandoned: {
      [NotificationChannel.SMS]:      { body: "You left something in your cart! Complete your purchase now before it sells out." },
      [NotificationChannel.Email]:    { subject: "You forgot something!", body: "Looks like you left some items in your cart. We've saved them for you — come back and complete your purchase!" },
      [NotificationChannel.WhatsApp]: { body: "Hey! 🛒 You left items in your cart. They're waiting for you — want to complete your purchase?" },
    },
    do_not_honor: {
      [NotificationChannel.SMS]:      { body: "Your payment was declined by your bank. Try a different card or UPI to complete your purchase." },
      [NotificationChannel.Email]:    { subject: "Let's try a different payment method", body: "Your bank declined the payment. This can happen for various reasons. Try a different card, UPI, or net banking to complete your order." },
      [NotificationChannel.WhatsApp]: { body: "Your bank declined the payment 😕 Try another payment method and we'll have your order sorted!" },
    },
  };

  const categoryTemplates = templates[failureCategory] ?? templates["do_not_honor"];
  const template = categoryTemplates[channel];
  return { ...template, channel };
}
