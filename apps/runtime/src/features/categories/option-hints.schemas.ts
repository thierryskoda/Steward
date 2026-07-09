import { z } from "zod";

export const OPTION_HINTS_SCHEMA_VERSION = 1;

export const OptionHintTriggerSchema = z.enum([
  "rejected_reason",
  "manual_override",
  "duplicate_option_shape",
]);

export const OptionHintSchema = z
  .object({
    id: z.string().min(1),
    categoryId: z.string().min(1),
    trigger: OptionHintTriggerSchema,
    antiPattern: z.string().min(1),
    instruction: z.string().min(1),
    confidence: z.number().min(0).max(1),
    createdAt: z.number(),
    evidenceItemId: z.string().min(1),
    keywords: z.array(z.string().min(1)).max(12).optional(),
  })
  .strict();

export const OptionHintsFileSchema = z
  .object({
    schemaVersion: z.literal(OPTION_HINTS_SCHEMA_VERSION),
    hints: z.array(OptionHintSchema),
  })
  .strict();

export type IOptionHint = z.infer<typeof OptionHintSchema>;
export type IOptionHintTrigger = z.infer<typeof OptionHintTriggerSchema>;
export type IOptionHintsFile = z.infer<typeof OptionHintsFileSchema>;
