import { prisma } from "../../../src/lib/prismaClient";
import { log } from '../../../../shared/logger';

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
  await prisma.payment.update({
    where: { id: args.payment_id },
    data: { errorDescription: `[ESCALATED] ${args.reason}` },
  }).catch(() => {}); // non-critical if payment not found

  log.section("🚨", "Payment escalated to human review", `Reason: ${args.reason}`);

  return {
    success: true,
    message: `Escalated to human review: ${args.reason}`,
  };
}



