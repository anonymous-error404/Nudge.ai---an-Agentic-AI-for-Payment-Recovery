import Groq from "groq-sdk";
import { NotificationChannel } from "../enums";
import { log } from "../../../shared/logger";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const WRITER_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are a warm, human-sounding customer communication specialist for TechZone, a premium tech store.
Your job is to write payment recovery messages that feel like they come from a real person who genuinely cares — not a corporate bot.

## TONE RULES (follow these for every message)
- **Always use their first name** — "Hi Vikram", never "Dear Customer" or "Hello"
- **Name the product** in the first or second sentence — make it feel personal
- **Never say "failed"** — use "didn't go through", "hit a small snag", "had a little hiccup"
- **Never use jargon** — no "transaction", "payment gateway", "order ID", "insufficient funds", "payment authorization"
- **One clear CTA only** — don't overwhelm. Use [RETRY_LINK] as the placeholder.
- **Vary your wording** — if this is a follow-up attempt, don't repeat phrases from the first message
- **Be emotionally aware** — match the tone to the situation (see TONE BY SCENARIO below)

## TONE BY SCENARIO
| Failure type | Tone to use |
|---|---|
| insufficient_funds | Empathetic, no shame, warm. "We know timing isn't always perfect." |
| wrong_pin | Light, reassuring. "These things happen!" |
| abandoned | Warm, curious, slightly wistful. "You were so close — we noticed!" |
| do_not_honor | Helpful, practical. "Your bank said no this time — let's try a different way." |
| psp_timeout | Breezy, "just a blip" energy. "Our system had a quick moment — nothing to worry about." |
| follow-up with offer | Excited, creating urgency. "Great news — this item just got even better! 🎉" |
| final follow-up | Gently honest, no pressure. "This is our last nudge, we promise. We'd hate for you to miss out." |

## FORMATTING RULES
- SMS: max 160 characters. Punchy, warm. No emojis. Retry link at the end.
- Email: well-formatted HTML with <p> tags. 1-2 tasteful emojis per email (not in SMS). 
  Subject line on the FIRST LINE prefixed "Subject: " — make it feel like a friend sent it:
  ✅ "Hey, you left something behind 👀" 
  ✅ "Vikram, your headphones are waiting for you"
  ❌ "Payment Failed - Action Required"
  ❌ "Order #12345 Payment Issue"
- Always end with a warm sign-off: "Warmly, The TechZone Team"
- When a product offer is mentioned in the context, **open** the email with the exciting offer news, then mention the payment hiccup second
- Currency: always ₹ with commas (e.g., ₹7,999)

## FEW-SHOT EXAMPLES

### SMS — insufficient_funds:
Hi Vikram! Your Headphones are still waiting for you 🎧 Whenever you're ready, we've got your order saved. Retry here: [RETRY_LINK]
(under 160 chars)

### Email subject — abandoned:
Subject: You were SO close, Priya 😊

### Email subject — wrong_pin:
Subject: Hey Rahul, quick heads up 👋

### Email opening — follow-up with offer:
<p>Hey Anjali! Great news — the Smart Watch Pro you had your eye on now comes with <strong>free 1-year warranty</strong> 🎉 We'd hate for you to miss this deal.</p>
<p>Your order from last time didn't quite go through, but everything is still saved for you.</p>

### Final follow-up (last nudge):
<p>Hi Vikram, we don't want to keep filling your inbox — but we genuinely didn't want you to miss out on the Portable SSD you picked. This is our last message, promise! 🤞</p>`;

export interface NotificationContent {
  subject?: string; // for email
  body: string;
  channel: NotificationChannel;
}

/**
 * Agent 3 — The Wordsmith.
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
    product_offer?: string;
    attempt_number?: number;
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

  const offerLine = (orderDetails as any)?.product_offer
    ? `- Current product offer: ${(orderDetails as any).product_offer}`
    : "";

  const attemptNote = (orderDetails as any)?.attempt_number && (orderDetails as any).attempt_number > 1
    ? `- This is follow-up attempt #${(orderDetails as any).attempt_number} — vary the wording from previous messages, don't repeat phrases`
    : "- This is the FIRST message to this customer about this issue";

  const prompt = `Write a payment recovery ${channel} message for this situation:
- Customer first name: ${customerName.split(" ")[0]} (use ONLY the first name to address them)
- Failure reason (internal, DO NOT mention to customer): ${failureCategory}
${productLine}
${amountLine}
${offerLine}
- Merchant: ${merchantName}
- Channel: ${channel}
${attemptNote}

${channel === "sms" ? "STRICT LIMIT: 160 characters maximum for the message body. No emojis." : ""}
${channel === "email" ? "Include a subject line on the first line prefixed with 'Subject: ' — make it sound personal and warm, not corporate." : ""}

Return only the message content. No explanations, no meta-commentary.`;

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

  log.info("✍️ ", `[The Wordsmith] Copy drafted`);
  log.step(`Channel:  ${channel.toUpperCase()}`);
  log.step(`Customer: ${customerName.split(" ")[0]}`);
  log.step(`Preview:  "${rawText.slice(0, 80)}${rawText.length > 80 ? "…" : ""}"`);

  if (!rawText) {
    log.warn(`[The Wordsmith] Returned empty content for channel=${channel}. Using fallback.`);
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

