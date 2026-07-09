import { z } from "zod";

/**
 * Schema for one line of a Cursor Agent transcript JSONL file.
 * Source of truth: example files under .cursor/projects/.../agent-transcripts/
 */
const transcriptMessageContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const transcriptMessageSchema = z.object({
  content: z.array(transcriptMessageContentPartSchema),
});

export const transcriptEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  message: transcriptMessageSchema,
});

export type ITranscriptEntry = z.infer<typeof transcriptEntrySchema>;
