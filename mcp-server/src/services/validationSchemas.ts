import { z } from "zod";

// ─── Request Validation Schemas ───────────────────────────────────────────────

export const RecoveryJobSchema = z.object({
  merchantId: z.string().min(1),
  merchantCallbackUrl: z.string().url(),
  externalRef: z.string().min(1),
  context: z.object({
    failure_category: z.string(),
    amount_bucket: z.string(),
    attempt_count: z.number().int().min(0),
    days_since_failure: z.number().min(0),
    payment_method: z.string(),
    previous_actions: z.array(z.string()),
  }),
  toolSchemas: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      input_schema: z.object({
        type: z.literal("object"),
        properties: z.record(z.any()),
        required: z.array(z.string()).optional(),
      }),
    }),
  ),
});

export const ToolResultSchema = z.object({
  jobId: z.string().min(1),
  result: z.record(z.unknown()),
});

export type RecoveryJobInput = z.infer<typeof RecoveryJobSchema>;
export type ToolResultInput = z.infer<typeof ToolResultSchema>;
