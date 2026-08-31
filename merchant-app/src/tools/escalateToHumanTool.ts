/**
 * escalate_to_human tool
 * Flags a failure event for manual merchant review.
 */
import { prisma } from "../lib/prismaClient";

export const escalateToHumanSchema = {
  type: "function" as const,
  function: {
    name: "escalate_to_human",
    description:
      "Flags this failure event for manual merchant review instead of automated recovery. " +
      "Use when: max retry attempts exceeded, fraud suspected, or the situation is ambiguous " +
      "and automation would risk over-charging or harassing the customer.",
    parameters: {
      type: "object" as const,
      properties: {
        payment_id: {
          type: "string",
          description: "The merchant-side payment ID to escalate.",
        },
        reason: {
          type: "string",
          description: "Why automated recovery should not proceed. This will appear in the merchant dashboard.",
        },
      },
      required: ["payment_id", "reason"],
    },
  },
};

export async function executeEscalateToHuman(args: {
  payment_id: string;
  reason: string;
}): Promise<{ success: boolean; message: string }> {
  // Mark the payment with an escalation note (we can add an escalated flag to schema later)
  await prisma.payment.update({
    where: { id: args.payment_id },
    data: { errorDescription: `[ESCALATED] ${args.reason}` },
  }).catch(() => {}); // non-critical if payment not found

  console.log(`\n🚨 [ESCALATE] Payment ${args.payment_id} flagged for human review`);
  console.log(`   Reason: ${args.reason}`);

  return {
    success: true,
    message: `Escalated to human review: ${args.reason}`,
  };
}
