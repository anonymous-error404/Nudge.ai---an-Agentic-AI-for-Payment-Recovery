import Groq from "groq-sdk";
import { NotificationChannel } from "../enums";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const WRITER_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are an expert customer communication specialist for TechZone, a premium tech store.
Your job is to write short, empathetic, and highly converting payment recovery messages.

CRITICAL RULES:
1. TONE: Be warm, empathetic, and professional. Never sound robotic or threatening.
2. DISCRETION: NEVER explicitly state blunt failure reasons like "insufficient funds", "low balance", or "wrong pin". This embarrasses the customer. Instead, soften it (e.g., "There was a temporary issue processing your payment", "Your bank couldn't authorize the transaction").
3. CURRENCY: Always format currency nicely with commas and the Rupee symbol (e.g., ₹7,999 instead of Rs.7999).
4. FORMATTING:
   - SMS: MAXIMUM 160 characters. Direct, one clear CTA.
   - WhatsApp: Conversational tone, 2-3 short sentences. Emojis encouraged.
   - Email: MUST output well-formatted HTML. Use <p> tags, <br>, and wrap the CTA in a clean <a href="[RETRY_LINK]" style="..."> button. Include a polite sign-off (e.g., "Best, TechZone Support").
5. CTA: Always include a clear call-to-action placeholder "[RETRY_LINK]" instructing them to retry the payment.`;

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
  customerName?: string;
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
    merchantName = "TechZone",
    customerName = "Customer",
    orderDetails,
  } = params;

  // Use specific product info if available, fall back to generic amount bucket
  const productLine = orderDetails
    ? `- Product: ${orderDetails.product_name}${orderDetails.product_description ? ` (${orderDetails.product_description})` : ""}`
    : `- Amount range: ${amountBucket}`;
  const amountLine = orderDetails
    ? `- Exact amount: ${orderDetails.amount_rupees} ${orderDetails.currency}`
    : "";

  const prompt = `Write a payment recovery ${channel} message for this situation:
- Customer Name: ${customerName} (Address them by their name)
- Failure reason: ${failureCategory}
${productLine}
${amountLine}
- Merchant: ${merchantName}
- Channel: ${channel}

${channel === "sms" ? "STRICT LIMIT: 160 characters maximum for the message body." : ""}
${channel === "email" ? "Include a subject line on the first line prefixed with 'Subject: '" : ""}

Return only the message content, nothing else.`;

  // We enforce length via the prompt rather than max_tokens, 
  // because some proxy models cut off immediately if max_tokens is too low.
  const maxTokens = 1024;

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
