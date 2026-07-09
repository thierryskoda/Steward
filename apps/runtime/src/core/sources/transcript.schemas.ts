/**
 * Single source of truth for one line of a Cursor agent transcript JSONL file.
 * Used by the shared transcript ingestion pipeline and by both rules and continual-learning.
 */
import { z } from "zod";

const transcriptMessageContentPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const transcriptMessageSchema = z.object({
  content: z.array(transcriptMessageContentPartSchema).optional(),
});

/** One JSONL line: role + optional message with content array. Supports user, assistant, system. */
export const transcriptLineSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  message: transcriptMessageSchema.optional(),
});

export type ITranscriptLine = z.infer<typeof transcriptLineSchema>;

export function extractTextFromTranscriptLine(line: ITranscriptLine): string {
  const content = line.message?.content;
  if (!content || !Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } =>
      Boolean(
        c &&
        typeof c === "object" &&
        (c as { type?: string }).type === "text" &&
        typeof (c as { text?: string }).text === "string"
      )
    )
    .map((c) => c.text)
    .join("");
}
