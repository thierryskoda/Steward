import { z } from "zod";

export const ipcErrorPayloadSchema = z.object({
  kind: z.string(),
  message: z.string(),
  code: z.string().optional(),
  details: z.string().optional(),
});

export type IRuntimeIpcError = z.infer<typeof ipcErrorPayloadSchema>;
