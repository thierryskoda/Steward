/**
 * Config-driven rules snapshot: read source docs from ruleSources, hash content,
 * reuse DB snapshot when hash/version match, else run extractor and persist.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { z } from "zod";
import { AppError } from "../../core/app-error.js";
import { ERR_RULES_SNAPSHOT_EXTRACT } from "../../core/error-codes.js";
import {
  NOT_A_FILE,
  OUTSIDE_REPO_OR_INVALID,
  READ_FAILED_DETAILS,
} from "../../core/failure-reason-codes.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import {
  readGeneratedSnapshot,
  writeGeneratedSnapshot,
} from "../context/generated-snapshot-store.js";
export type IConfigWithRuleSources = { ruleSources?: string[] };
import {
  RULES_SNAPSHOT_EXTRACTION_FAILED,
  RULES_SNAPSHOT_REGENERATED,
  RULES_SNAPSHOT_REGENERATING,
  RULES_SNAPSHOT_REUSED,
  RULES_SNAPSHOT_SOURCE_PATH_INVALID,
  RULES_SNAPSHOT_SOURCES_EMPTY,
} from "./categories-log-events.js";

export const EXTRACTOR_VERSION = "1";

export type IRulesSnapshotCategoryEntry = {
  categoryId: string;
  rulePath: string;
  ruleContent: string;
};

export type ISourceDocEntry = { path: string; content: string };

const categoryEntrySchema = z.object({
  categoryId: z.string().min(1),
  rulePath: z.string(),
  ruleContent: z.string(),
});

const snapshotSchema = z.object({
  sourcesHash: z.string(),
  extractorVersion: z.string(),
  generatedAt: z.number(),
  categories: z.array(categoryEntrySchema),
});

export type IRulesSnapshot = z.infer<typeof snapshotSchema>;

function isRepoRelativeSafe(projectRoot: string, relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/").replace(/\/+/g, "/").trim();
  if (normalized.startsWith("..") || normalized.includes("/..") || normalized.includes("../")) {
    return false;
  }
  const resolved = resolve(projectRoot, normalized);
  return resolved.startsWith(resolve(projectRoot)) && resolved.length > resolve(projectRoot).length;
}

/**
 * Resolves ruleSources to existing repo-relative files and reads full content.
 * Logs and skips invalid paths; returns only valid entries.
 */
export function readSourceDocs(projectRoot: string, ruleSources: string[]): ISourceDocEntry[] {
  const log = getRuntimeLogger();
  const root = resolve(projectRoot);
  const entries: ISourceDocEntry[] = [];

  for (const rel of ruleSources) {
    const normalized = rel.trim().replaceAll("\\", "/");
    if (!normalized) continue;
    if (!isRepoRelativeSafe(projectRoot, normalized)) {
      log.info({
        event: RULES_SNAPSHOT_SOURCE_PATH_INVALID,
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
          event: RULES_SNAPSHOT_SOURCE_PATH_INVALID,
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
        event: RULES_SNAPSHOT_SOURCE_PATH_INVALID,
        path: normalized,
        reason: READ_FAILED_DETAILS,
      });
      continue;
    }
    entries.push({ path: normalized, content });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Deterministic hash over sorted path+content for cache key.
 */
export function computeSourcesHash(entries: ISourceDocEntry[]): string {
  const payload = entries.map((e) => `${e.path}\n${e.content}`).join("\n---\n");
  return createHash("sha256").update(payload, "utf-8").digest("hex").slice(0, 32);
}

export function loadSnapshot(projectRoot: string): IRulesSnapshot | null {
  void projectRoot;
  return readGeneratedSnapshot({ kind: "rules", schema: snapshotSchema })?.payload ?? null;
}

export function writeSnapshot(projectRoot: string, snapshot: IRulesSnapshot): void {
  void projectRoot;
  writeGeneratedSnapshot({
    kind: "rules",
    sourcesHash: snapshot.sourcesHash,
    generatorVersion: snapshot.extractorVersion,
    payload: snapshot,
  });
}

export function validateCategoriesPayload(
  raw: unknown
): { ok: true; data: IRulesSnapshotCategoryEntry[] } | { ok: false; issues: z.ZodIssue[] } {
  const result = z.array(categoryEntrySchema).safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, issues: result.error.issues };
}

export type IEnsureRulesSnapshotDeps = {
  runExtractor: (args: {
    projectRoot: string;
    sourceEntries: ISourceDocEntry[];
  }) => Promise<IRulesSnapshotCategoryEntry[]>;
  getRuleSources: (config: IConfigWithRuleSources) => string[];
};

/**
 * Returns categories from snapshot cache or runs extractor and persists.
 * If ruleSources is empty: logs warning and returns empty array.
 */
export async function ensureRulesSnapshot(args: {
  projectRoot: string;
  config: IConfigWithRuleSources;
  deps: IEnsureRulesSnapshotDeps;
}): Promise<IRulesSnapshotCategoryEntry[]> {
  const { projectRoot, config, deps } = args;
  const log = getRuntimeLogger();
  const sources = deps.getRuleSources(config);

  if (sources.length === 0) {
    log.info({
      event: RULES_SNAPSHOT_SOURCES_EMPTY,
      projectRoot,
    });
    return [];
  }

  const sourceEntries = readSourceDocs(projectRoot, sources);
  if (sourceEntries.length === 0) {
    log.info({
      event: RULES_SNAPSHOT_SOURCES_EMPTY,
      projectRoot,
      note: "ruleSources configured but no valid files could be read",
    });
    return [];
  }

  const hash = computeSourcesHash(sourceEntries);
  const existing = loadSnapshot(projectRoot);

  if (
    existing &&
    existing.sourcesHash === hash &&
    existing.extractorVersion === EXTRACTOR_VERSION
  ) {
    log.info({
      event: RULES_SNAPSHOT_REUSED,
      projectRoot,
      sourcesHash: hash,
      categoryCount: existing.categories.length,
    });
    return existing.categories;
  }

  const reason = !existing
    ? "no existing snapshot"
    : existing.sourcesHash !== hash
      ? "rule source content or paths changed (sourcesHash mismatch)"
      : "extractor version changed";
  log.info({
    event: RULES_SNAPSHOT_REGENERATING,
    projectRoot,
    reason,
    sourcesHash: hash,
    sourcePaths: sourceEntries.map((e) => e.path),
  });

  let categories: IRulesSnapshotCategoryEntry[];
  try {
    categories = await deps.runExtractor({ projectRoot, sourceEntries });
  } catch (error) {
    logError(error, {
      event: RULES_SNAPSHOT_EXTRACTION_FAILED,
      component: "categories",
      operation: "rulesSnapshotExtract",
      projectRoot,
    });
    throw error;
  }

  const validated = validateCategoriesPayload(categories);
  if (!validated.ok) {
    const issues = validated.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    const message = issues.join("; ");
    log.info({
      event: RULES_SNAPSHOT_EXTRACTION_FAILED,
      projectRoot,
      error: `Invalid extractor output: ${message}`,
    });
    throw new AppError(
      `Rules snapshot extractor returned invalid categories: ${message}`,
      ERR_RULES_SNAPSHOT_EXTRACT,
      { projectRoot, issues }
    );
  }
  categories = validated.data;

  const snapshot: IRulesSnapshot = {
    sourcesHash: hash,
    extractorVersion: EXTRACTOR_VERSION,
    generatedAt: Date.now(),
    categories,
  };
  writeSnapshot(projectRoot, snapshot);
  log.info({
    event: RULES_SNAPSHOT_REGENERATED,
    projectRoot,
    sourcesHash: hash,
    categoryCount: categories.length,
  });
  return categories;
}
