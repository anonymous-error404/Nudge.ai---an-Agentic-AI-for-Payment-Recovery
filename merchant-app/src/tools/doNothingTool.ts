/**
 * do_nothing tool
 * Explicitly records that no recovery action should be taken.
 * Forces Claude to make an active choice rather than falling silent.
 */

export const doNothingSchema = {
  name: "do_nothing",
  description:
    "Explicitly records that no automated recovery action should be taken for this failure. " +
    "Use for fraud blocks, mandate revocations, or cases where any intervention would make things worse. " +
    "This creates a clean audit trail of the non-action decision.",
  input_schema: {
    type: "object" as const,
    properties: {
      payment_id: {
        type: "string",
        description: "The merchant-side payment ID.",
      },
      reason: {
        type: "string",
        description: "Why no recovery action should be taken.",
      },
    },
    required: ["payment_id", "reason"],
  },
};

export async function executeDoNothing(args: {
  payment_id: string;
  reason: string;
}): Promise<{ success: boolean; message: string }> {
  console.log(`\n🚫 [DO_NOTHING] No recovery for payment ${args.payment_id}`);
  console.log(`   Reason: ${args.reason}`);
  return { success: true, message: `No action taken: ${args.reason}` };
}
