/** Append-only incremental reader for transcript JSONL files using byte-offset checkpoints. */
import { existsSync, readFileSync, statSync } from "fs";
import { randomUUID } from "crypto";
import type { CursorEvent } from "../types.js";
import type { ITranscriptCheckpoint } from "./transcript.types.js";
import { transcriptLineSchema, extractTextFromTranscriptLine } from "./transcript.schemas.js";

export type IReadResult = {
  events: Array<CursorEvent & { metadata: Record<string, unknown> }>;
  nextOffset: number;
};

/**
 * Read new content from path from the given checkpoint. If checkpoint is null and file exists,
 * returns no events and nextOffset = file size (skip history). Handles truncation by resetting to 0.
 */
export function readTranscriptAppend(
  path: string,
  checkpoint: ITranscriptCheckpoint | null,
  pathForMetadata: string = path
): IReadResult {
  if (!existsSync(path)) {
    return { events: [], nextOffset: 0 };
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { events: [], nextOffset: 0 };
  }
  if (size === 0) {
    return { events: [], nextOffset: 0 };
  }

  const raw = readFileSync(path, "utf-8");
  const fullLength = Buffer.byteLength(raw, "utf-8");

  if (checkpoint === null) {
    return { events: [], nextOffset: fullLength };
  }

  const offset = checkpoint.offset;
  if (offset >= fullLength) {
    return { events: [], nextOffset: fullLength };
  }
  if (offset < 0) {
    return readTranscriptAppend(path, null, pathForMetadata);
  }

  const tail = raw.slice(offset);
  const lines = tail.split(/\r?\n/);
  const events: IReadResult["events"] = [];
  const lineCountBeforeOffset = raw.slice(0, offset).split(/\r?\n/).length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNum = lineCountBeforeOffset + i + 1;
    if (i === 0 && line.trim() === "") continue;
    const ev = parseLineToEvent(line.trim(), pathForMetadata, lineNum);
    if (ev) events.push(ev);
  }
  const nextOffset = fullLength;
  return { events, nextOffset };
}

function parseLineToEvent(
  trimmed: string,
  path: string,
  lineNum: number
): (CursorEvent & { metadata: Record<string, unknown> }) | null {
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = transcriptLineSchema.safeParse(parsed);
  if (!result.success) return null;
  const content = extractTextFromTranscriptLine(result.data);
  return {
    id: randomUUID(),
    source: "transcript",
    role: result.data.role,
    content,
    timestamp: Date.now(),
    metadata: { path, lineNum },
  };
}
