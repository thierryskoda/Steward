/** Parse and serialize transcript checkpoint values. */
import { z } from "zod";
import type { ITranscriptCheckpoint } from "./transcript.types.js";

const V1_PREFIX = '{"v":1,"offset":';

const CheckpointV1Schema = z.object({
  v: z.literal(1),
  offset: z.number().min(0),
});

export function parseTranscriptCheckpoint(raw: string | null): ITranscriptCheckpoint | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = safeParseJson(trimmed);
    if (parsed === null) return null;
    const result = CheckpointV1Schema.safeParse(parsed);
    return result.success ? { offset: result.data.offset } : null;
  }
  return null;
}

export function serializeTranscriptCheckpoint(offset: number): string {
  return `${V1_PREFIX}${offset}}`;
}

function safeParseJson(s: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(s);
    return parsed;
  } catch {
    return null;
  }
}
