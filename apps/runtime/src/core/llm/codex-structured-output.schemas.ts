import { z } from "zod";

export const CodexStructuredOutputEnvelopeSchema = z
  .object({
    result: z.unknown(),
  })
  .strict();
