import { z } from "zod";

export const CursorEventSchema = z.object({
  id: z.string(),
  source: z.enum(["transcript", "sqlite"]),
  role: z.enum(["user", "assistant", "system"]).optional(),
  content: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type CursorEvent = z.infer<typeof CursorEventSchema>;
