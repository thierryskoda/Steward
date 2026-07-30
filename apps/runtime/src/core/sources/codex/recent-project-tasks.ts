/**
 * Discovers bounded Codex task references for one exact project root.
 * The task index is the user-visible task whitelist; session metadata proves project ownership.
 */
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_TRANSCRIPT_FILES_SCANNED = 10_000;
const MAX_SESSION_META_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_INDEX_BYTES = 5 * 1024 * 1024;

const SessionIndexEntrySchema = z
  .object({
    id: z.string().min(1).max(256),
    thread_name: z.string().min(1).max(2_000),
    updated_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

const SessionMetaLineSchema = z
  .object({
    type: z.literal("session_meta"),
    payload: z
      .object({
        id: z.string().min(1).max(256),
        session_id: z.string().min(1).max(256).optional(),
        cwd: z.string().min(1).max(4_096),
        source: z.string().max(256),
        parent_thread_id: z.string().nullable().optional(),
        thread_source: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type IRecentProjectTask = {
  id: string;
  title: string;
  updatedAt: number;
  transcriptPath: string;
  transcriptBytes: number;
};

export type IRecentProjectTaskDiscovery = {
  tasks: IRecentProjectTask[];
  eligibleTaskCount: number;
  truncated: boolean;
  scanTruncated: boolean;
};

type IDiscoverRecentProjectTasksArgs = {
  codexHome: string;
  projectRoot: string;
  capturedAt: number;
  lookbackDays: number;
  maxTasks: number;
};

type IIndexedTask = {
  id: string;
  title: string;
  updatedAt: number;
};

function readBoundedTail(path: string, maxBytes: number): string | null {
  try {
    const size = statSync(path).size;
    const bytesToRead = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const file = openSync(path, "r");
    try {
      readSync(file, buffer, 0, bytesToRead, size - bytesToRead);
    } finally {
      closeSync(file);
    }
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

function readRecentIndex(args: {
  codexHome: string;
  cutoff: number;
  capturedAt: number;
}): Map<string, IIndexedTask> {
  const raw = readBoundedTail(join(args.codexHome, "session_index.jsonl"), MAX_SESSION_INDEX_BYTES);
  const indexed = new Map<string, IIndexedTask>();
  if (raw === null) return indexed;

  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const result = SessionIndexEntrySchema.safeParse(parsed);
    if (!result.success) continue;
    const updatedAt = Date.parse(result.data.updated_at);
    if (updatedAt < args.cutoff || updatedAt > args.capturedAt) continue;
    const existing = indexed.get(result.data.id);
    if (existing !== undefined && existing.updatedAt > updatedAt) continue;
    indexed.set(result.data.id, {
      id: result.data.id,
      title: result.data.thread_name,
      updatedAt,
    });
  }
  return indexed;
}

function listTranscriptPaths(codexHome: string): {
  paths: string[];
  scanTruncated: boolean;
} {
  type IPendingPath = { kind: "directory"; path: string } | { kind: "transcript"; path: string };

  // This is a LIFO walk: active sessions are popped before archives, and sorted
  // children are pushed oldest-first so the newest candidate is inspected next.
  const pending: IPendingPath[] = [
    { kind: "directory", path: join(codexHome, "archived_sessions") },
    { kind: "directory", path: join(codexHome, "sessions") },
  ];
  const paths: string[] = [];

  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) break;
    if (next.kind === "transcript") {
      if (paths.length >= MAX_TRANSCRIPT_FILES_SCANNED) {
        return { paths, scanTruncated: true };
      }
      paths.push(next.path);
      continue;
    }

    let entries;
    try {
      entries = readdirSync(next.path, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name)
      );
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(next.path, entry.name);
      if (entry.isDirectory()) {
        pending.push({ kind: "directory", path });
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      pending.push({ kind: "transcript", path });
    }
  }

  return { paths, scanTruncated: false };
}

function readSessionMeta(path: string): z.infer<typeof SessionMetaLineSchema> | null {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return null;
  }
  if (size <= 0) return null;

  let parsed: unknown;
  try {
    const file = openSync(path, "r");
    const chunks: Buffer[] = [];
    let offset = 0;
    try {
      while (offset < Math.min(size, MAX_SESSION_META_BYTES)) {
        const bytesToRead = Math.min(4_096, size - offset, MAX_SESSION_META_BYTES - offset);
        const buffer = Buffer.alloc(bytesToRead);
        const bytesRead = readSync(file, buffer, 0, bytesToRead, offset);
        if (bytesRead === 0) break;
        const newlineIndex = buffer.indexOf(10, 0);
        chunks.push(buffer.subarray(0, newlineIndex === -1 ? bytesRead : newlineIndex));
        offset += bytesRead;
        if (newlineIndex !== -1) break;
      }
    } finally {
      closeSync(file);
    }
    const firstLine = Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
    if (firstLine.length === 0) return null;
    parsed = JSON.parse(firstLine);
  } catch {
    return null;
  }
  const result = SessionMetaLineSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function findIndexedTaskForTranscript(
  transcriptPath: string,
  indexed: ReadonlyMap<string, IIndexedTask>
): IIndexedTask | undefined {
  const fileName = basename(transcriptPath);
  if (!fileName.endsWith(".jsonl")) return undefined;
  const stem = fileName.slice(0, -".jsonl".length);
  let separatorIndex = stem.indexOf("-");
  while (separatorIndex !== -1) {
    const candidateId = stem.slice(separatorIndex + 1);
    const indexedTask = indexed.get(candidateId);
    if (indexedTask !== undefined) return indexedTask;
    separatorIndex = stem.indexOf("-", separatorIndex + 1);
  }
  return undefined;
}

function isExactProjectRoot(left: string, right: string): boolean {
  if (!isAbsolute(left) || !isAbsolute(right)) return left === right;
  return resolve(left) === resolve(right);
}

function isUserOwnedRootTask(metadata: z.infer<typeof SessionMetaLineSchema>): boolean {
  if (metadata.payload.parent_thread_id != null) return false;
  if (
    metadata.payload.session_id !== undefined &&
    metadata.payload.session_id !== metadata.payload.id
  ) {
    return false;
  }
  const threadSource = metadata.payload.thread_source;
  return threadSource === undefined || threadSource === null || threadSource === "user";
}

export function discoverRecentProjectTasks(
  args: IDiscoverRecentProjectTasksArgs
): IRecentProjectTaskDiscovery {
  if (args.lookbackDays <= 0 || args.maxTasks <= 0) {
    throw new Error("lookbackDays and maxTasks must be positive");
  }
  const cutoff = args.capturedAt - args.lookbackDays * DAY_MS;
  const indexed = readRecentIndex({
    codexHome: args.codexHome,
    cutoff,
    capturedAt: args.capturedAt,
  });
  const transcriptScan = listTranscriptPaths(args.codexHome);
  const eligible: IRecentProjectTask[] = [];

  for (const transcriptPath of transcriptScan.paths) {
    const matchingIndexEntry = findIndexedTaskForTranscript(transcriptPath, indexed);
    if (matchingIndexEntry === undefined) continue;
    const metadata = readSessionMeta(transcriptPath);
    if (metadata === null) continue;
    if (metadata.payload.id !== matchingIndexEntry.id) continue;
    if (!transcriptPath.endsWith(`-${matchingIndexEntry.id}.jsonl`)) continue;
    if (!isUserOwnedRootTask(metadata)) continue;
    if (!isExactProjectRoot(metadata.payload.cwd, args.projectRoot)) continue;
    eligible.push({
      ...matchingIndexEntry,
      transcriptPath,
      transcriptBytes: statSync(transcriptPath).size,
    });
  }

  eligible.sort(
    (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)
  );
  return {
    tasks: eligible.slice(0, args.maxTasks),
    eligibleTaskCount: eligible.length,
    truncated: eligible.length > args.maxTasks,
    scanTruncated: transcriptScan.scanTruncated,
  };
}
