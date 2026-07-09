/**
 * Project-context snapshot: read docs from config projectContext, hash content,
 * reuse DB snapshot when hash/version match, else run extractor and persist.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { z } from "zod";
import {
  NOT_A_FILE,
  OUTSIDE_REPO_OR_INVALID,
  READ_FAILED_DETAILS,
} from "../../core/failure-reason-codes.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { readGeneratedSnapshot, writeGeneratedSnapshot } from "./generated-snapshot-store.js";
import {
  PROJECT_CONTEXT_SNAPSHOT_EXTRACTION_FAILED,
  PROJECT_CONTEXT_SNAPSHOT_REGENERATED,
  PROJECT_CONTEXT_SNAPSHOT_REGENERATING,
  PROJECT_CONTEXT_SNAPSHOT_REUSED,
  PROJECT_CONTEXT_SNAPSHOT_SOURCE_PATH_INVALID,
  PROJECT_CONTEXT_SNAPSHOT_SOURCES_EMPTY,
} from "./context-log-events.js";

export const EXTRACTOR_VERSION = "1";

export type ISourceDocEntry = { path: string; content: string };

const snapshotSchema = z.object({
  sourcesHash: z.string(),
  extractorVersion: z.string(),
  generatedAt: z.number(),
  projectContextText: z.string(),
});

export type IProjectContextSnapshot = z.infer<typeof snapshotSchema>;

function isRepoRelativeSafe(projectRoot: string, relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/").replace(/\/+/g, "/").trim();
  if (normalized.startsWith("..") || normalized.includes("/..") || normalized.includes("../")) {
    return false;
  }
  const resolved = resolve(projectRoot, normalized);
  return resolved.startsWith(resolve(projectRoot)) && resolved.length > resolve(projectRoot).length;
}

export function readProjectContextSourceDocs(
  projectRoot: string,
  sources: string[]
): ISourceDocEntry[] {
  const log = getRuntimeLogger();
  const root = resolve(projectRoot);
  const entries: ISourceDocEntry[] = [];

  for (const rel of sources) {
    const normalized = rel.trim().replaceAll("\\", "/");
    if (!normalized) continue;
    if (!isRepoRelativeSafe(projectRoot, normalized)) {
      log.info({
        event: PROJECT_CONTEXT_SNAPSHOT_SOURCE_PATH_INVALID,
        path: normalized,
        reason: OUTSIDE_REPO_OR_INVALID,
      });
      continue;
    }
    const fullPath = join(root, normalized);
    if (!existsSync(fullPath)) continue;
    try {
      if (!statSync(fullPath).isFile()) {
        log.info({
          event: PROJECT_CONTEXT_SNAPSHOT_SOURCE_PATH_INVALID,
          path: normalized,
          reason: NOT_A_FILE,
        });
        continue;
      }
    } catch {
      continue;
    }
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      log.info({
        event: PROJECT_CONTEXT_SNAPSHOT_SOURCE_PATH_INVALID,
        path: normalized,
        reason: READ_FAILED_DETAILS,
      });
      continue;
    }
    entries.push({ path: normalized, content });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function computeSourcesHash(entries: ISourceDocEntry[]): string {
  const payload = entries.map((e) => `${e.path}\n${e.content}`).join("\n---\n");
  return createHash("sha256").update(payload, "utf-8").digest("hex").slice(0, 32);
}

export function loadProjectContextSnapshot(projectRoot: string): IProjectContextSnapshot | null {
  void projectRoot;
  return (
    readGeneratedSnapshot({ kind: "project-context", schema: snapshotSchema })?.payload ?? null
  );
}

function writeProjectContextSnapshot(projectRoot: string, snapshot: IProjectContextSnapshot): void {
  void projectRoot;
  writeGeneratedSnapshot({
    kind: "project-context",
    sourcesHash: snapshot.sourcesHash,
    generatorVersion: snapshot.extractorVersion,
    payload: snapshot,
  });
}

export type IConfigWithProjectContext = { projectContext?: string[] };

export type IEnsureProjectContextSnapshotDeps = {
  runExtractor: (args: {
    projectRoot: string;
    sourceEntries: ISourceDocEntry[];
  }) => Promise<string>;
  getProjectContextSources: (config: IConfigWithProjectContext) => string[];
};

/**
 * Returns project context text from snapshot cache or runs extractor and persists.
 * If projectContext is empty: logs warning and returns empty string.
 */
export async function ensureProjectContextSnapshot(args: {
  projectRoot: string;
  config: IConfigWithProjectContext;
  deps: IEnsureProjectContextSnapshotDeps;
}): Promise<string> {
  const { projectRoot, config, deps } = args;
  const log = getRuntimeLogger();
  const sources = deps.getProjectContextSources(config);

  if (sources.length === 0) {
    log.info({
      event: PROJECT_CONTEXT_SNAPSHOT_SOURCES_EMPTY,
      projectRoot,
    });
    return "";
  }

  const sourceEntries = readProjectContextSourceDocs(projectRoot, sources);
  if (sourceEntries.length === 0) {
    log.info({
      event: PROJECT_CONTEXT_SNAPSHOT_SOURCES_EMPTY,
      projectRoot,
      note: "projectContext configured but no valid files could be read",
    });
    return "";
  }

  const hash = computeSourcesHash(sourceEntries);
  const existing = loadProjectContextSnapshot(projectRoot);

  if (
    existing &&
    existing.sourcesHash === hash &&
    existing.extractorVersion === EXTRACTOR_VERSION
  ) {
    log.info({
      event: PROJECT_CONTEXT_SNAPSHOT_REUSED,
      projectRoot,
      sourcesHash: hash,
    });
    return existing.projectContextText;
  }

  const reason = !existing
    ? "no existing snapshot"
    : existing.sourcesHash !== hash
      ? "source content or paths changed (sourcesHash mismatch)"
      : "extractor version changed";
  log.info({
    event: PROJECT_CONTEXT_SNAPSHOT_REGENERATING,
    projectRoot,
    reason,
    sourcesHash: hash,
    sourcePaths: sourceEntries.map((e) => e.path),
  });

  let projectContextText: string;
  try {
    projectContextText = await deps.runExtractor({ projectRoot, sourceEntries });
  } catch (error) {
    logError(error, {
      event: PROJECT_CONTEXT_SNAPSHOT_EXTRACTION_FAILED,
      component: "context",
      operation: "projectContextSnapshotExtract",
      projectRoot,
    });
    throw error;
  }

  const snapshot: IProjectContextSnapshot = {
    sourcesHash: hash,
    extractorVersion: EXTRACTOR_VERSION,
    generatedAt: Date.now(),
    projectContextText: projectContextText ?? "",
  };
  writeProjectContextSnapshot(projectRoot, snapshot);
  log.info({
    event: PROJECT_CONTEXT_SNAPSHOT_REGENERATED,
    projectRoot,
    sourcesHash: hash,
  });
  return snapshot.projectContextText;
}
