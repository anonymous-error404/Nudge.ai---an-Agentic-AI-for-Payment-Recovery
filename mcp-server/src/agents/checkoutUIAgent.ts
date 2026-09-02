import Groq from "groq-sdk";
import { FailureContext } from "../types";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b"; // Reverted to your preferred proxy model

const SYSTEM_PROMPT = `You are a real-time checkout recovery assistant.
A customer just had a payment fail on a merchant's website.
Return ONLY a brief, polite, and helpful text message to show on the red error banner on the checkout page.
Do not use markdown. Do not include any other text.`;

export async function runCheckoutUIAgent(
  context: FailureContext,
): Promise<string> {
  const prompt = `Failure Category: ${context.failure_category}
Attempt Count: ${context.attempt_count}
Product: ${context.order_details?.product_name || "unknown"}

Provide the UI message.`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    return (
      response.choices[0]?.message?.content ||
      "Your payment failed. Please try again."
    );
  } catch (error) {
    console.error("Error in CheckoutUIAgent:", error);
    return "Your payment failed. Please try again.";
  }
}
