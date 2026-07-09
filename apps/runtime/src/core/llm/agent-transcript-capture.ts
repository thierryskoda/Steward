/**
 * Resolves Cursor agent transcript paths and parses JSONL entries. Used to feed transcript content into mutation outcome evaluation and continual-learning; invoked when a mutation run finishes or when building context for resume.
 */
import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";
import { getRuntimeLogger } from "../logger.js";
import { AGENT_TRANSCRIPT_ENTRY_PARSE_FAILED } from "../runtime-log-events.js";
import {
  transcriptEntrySchema,
  type ITranscriptEntry,
} from "./agent-transcript-capture.schemas.js";

export type { ITranscriptEntry } from "./agent-transcript-capture.schemas.js";

export type ITranscriptPathKind = "flat" | "nested";

export type ITranscriptPathCandidate = {
  kind: ITranscriptPathKind;
  path: string;
};

export type ITranscriptPathResolution = {
  resolvedPath?: string;
  checked: Array<ITranscriptPathCandidate & { exists: boolean }>;
};

const AGENT_CLI_CMD = "agent";
const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export function readTranscriptEntries(path: string): ITranscriptEntry[] | undefined {
  if (!existsSync(path)) return undefined;
  const log = getRuntimeLogger();
  try {
    const raw = readFileSync(path, "utf-8");
    const entries: ITranscriptEntry[] = [];
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        log.warn({
          event: AGENT_TRANSCRIPT_ENTRY_PARSE_FAILED,
          transcriptPath: path,
          lineIndex: i + 1,
          reason: "json_parse",
        });
        continue;
      }
      const result = transcriptEntrySchema.safeParse(parsed);
      if (result.success) {
        entries.push(result.data);
      } else {
        log.warn({
          event: AGENT_TRANSCRIPT_ENTRY_PARSE_FAILED,
          transcriptPath: path,
          lineIndex: i + 1,
          reason: "schema",
          zodError: result.error.flatten(),
        });
      }
    }
    return entries.length > 0 ? entries : undefined;
  } catch {
    return undefined;
  }
}

export function createChatId(): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(AGENT_CLI_CMD, ["create-chat"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", () => {
      const combined = `${stdout}\n${stderr}`.trim();
      const match = combined.match(UUID_REGEX);
      resolve(match?.[0] ?? null);
    });
    proc.on("error", () => {
      resolve(null);
    });
  });
}
