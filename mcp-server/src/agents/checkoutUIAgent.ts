import Groq from "groq-sdk";
import { FailureContext } from "../types";
import { log } from '../../../shared/logger';

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `You are a checkout recovery specialist who writes the message shown on a payment error banner.
A customer just had a payment fail on a premium tech e-commerce store called TechZone.

Your job is to write ONE short, warm, human message for the red error banner on the checkout page.

Rules:
- Sound like a real person, not a machine. Never say "payment failed" or "transaction declined".
- Be empathetic, warm, and briefly helpful. Examples of good tone:
  - "Hmm, that didn't go through — but no worries, your cart is still saved. Want to give it another try?"
  - "Looks like your bank said no this time. Try a different card or UPI — we've got you!"
  - "That payment hit a small snag. Give it another shot, we've got your back."
  - "Oops, something got in the way there! Your items are still here — just try again."
- Maximum 20 words. No markdown. No emojis. No jargon (no "transaction", "gateway", "authorization").
- Return ONLY the message text. Nothing else.`;

export async function runCheckoutUIAgent(
  context: FailureContext,
): Promise<string> {
  const prompt = `Failure Category: ${context.failure_category}
Attempt Count: ${context.attempt_count}
Product: ${context.order_details?.product_name || "unknown"}

Write the error banner message.`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 60,
    });

    const msg =
      response.choices[0]?.message?.content?.trim() ||
      "That didn't go through — your cart is saved. Give it another try!";

    log.step(`Checkout UI message generated: "${msg}"`);
    return msg;
  } catch (error) {
    log.error("The Concierge failed, using fallback message", error);
    return "That didn't go through — your cart is saved. Give it another try!";
  }
}
