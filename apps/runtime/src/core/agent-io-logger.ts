import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const AGENTS_DIR = "agents";
const DEFAULT_MAX_FILES_PER_AGENT = 500;

function sanitizeAgentId(agentId: string): string {
  return agentId.replace(/[/\\:*?"<>|]/g, "_") || "unknown";
}

function trimOldFiles(agentDir: string, maxFiles: number): void {
  if (!existsSync(agentDir)) return;
  const entries = readdirSync(agentDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => ({
      path: join(agentDir, e.name),
      mtime: statSync(join(agentDir, e.name)).mtimeMs,
    }));
  if (files.length <= maxFiles) return;
  files.sort((a, b) => a.mtime - b.mtime);
  const toDelete = files.length - maxFiles;
  for (let i = 0; i < toDelete; i++) {
    try {
      unlinkSync(files[i]!.path);
    } catch {
      // ignore
    }
  }
}

type IAgentIORecord = {
  ts: string;
  agentId: string;
  model: string;
  workspace: string;
  prompt: string;
  promptTokensApprox?: number;
  execution: {
    code: number | null;
    reason: string;
    runtimeMs?: number;
    outputText: string;
    diagnosticText: string;
    providerMeta?: {
      type: string;
      subtype?: string;
      isError?: boolean;
      durationMs?: number;
      durationApiMs?: number;
      sessionId?: string;
      requestId?: string;
    };
  };
  parsedOutput?: unknown;
  parseError?: string;
  recovery?: {
    attempted: boolean;
    reason?: string;
    succeeded?: boolean;
  };
  transcript?: {
    chatId: string;
    path: string;
    entries: unknown[];
  };
};

export function logAgentIO(
  basePath: string,
  record: IAgentIORecord,
  opts?: { maxFilesPerAgent?: number }
): void {
  try {
    const maxFiles = opts?.maxFilesPerAgent ?? DEFAULT_MAX_FILES_PER_AGENT;
    const safeId = sanitizeAgentId(record.agentId);
    const agentDir = join(basePath, AGENTS_DIR, safeId);
    mkdirSync(agentDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = randomBytes(4).toString("hex");
    const fileName = `${ts}_${suffix}.json`;
    const filePath = join(agentDir, fileName);
    const { prompt, ...rest } = record;
    const forWrite = {
      ...rest,
      promptLines: prompt.split("\n"),
    };
    writeFileSync(filePath, JSON.stringify(forWrite, null, 2), "utf-8");
    trimOldFiles(agentDir, maxFiles);
  } catch {
    // ignore - best-effort, never throw into runtime path
  }
}
