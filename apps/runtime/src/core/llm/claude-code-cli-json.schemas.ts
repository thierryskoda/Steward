import { z } from "zod";

export const claudeCodeCliErrorSchema = z.union([
  z.string(),
  z
    .object({
      message: z.string().optional(),
    })
    .passthrough(),
]);

export const claudeCodeCliJsonResultSchema = z
  .object({
    type: z.string().optional(),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    result: z.string().optional(),
    session_id: z.string().min(1).optional(),
    duration_ms: z.number().optional(),
    duration_api_ms: z.number().optional(),
    error: claudeCodeCliErrorSchema.optional(),
  })
  .passthrough();
