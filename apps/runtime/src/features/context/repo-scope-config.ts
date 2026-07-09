import { z } from "zod";
import { AppError } from "../../core/app-error.js";
import { ERR_CONFIG_INVALID, ERR_CONFIG_MISSING } from "../../core/error-codes.js";
import { REPO_SCOPE_CONFIG_LOADED } from "../../core/runtime-log-events.js";
import { getRuntimeLogger } from "../../core/logger.js";
import type { IApprovalMode } from "@steward/contracts/schemas";
import {
  CONFIG_SCHEMA_VERSION,
  PROJECT_CONFIG_DEFAULT_FEATURES,
  ProjectConfigSchema,
  readProjectConfig,
  writeProjectConfig as writeProjectConfigToDb,
} from "../config/project-config-store.js";
import { readGeneratedSnapshot, writeGeneratedSnapshot } from "./generated-snapshot-store.js";

export type { IApprovalMode };

/** Project-scoped feature toggles (runtime flow controls). */
export type IFeatureFlags = {
  genericFindingEnabled: boolean;
  rulesWorkflowEnabled: boolean;
  continualLearningEnabled: boolean;
  optionHintsEnabled: boolean;
};

/** User-owned config: rule sources, approval mode, project context, feature toggles. */
export type IRepoScopeConfig = {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  ruleSources: string[];
  approvalMode: IApprovalMode;
  projectContext: string[];
  features: IFeatureFlags;
};

/** Exported as the DB-backed project config schema. */
export const configSchema = ProjectConfigSchema;

const generatedExcludeSchema = z
  .object({
    exclude: z.array(z.string()),
  })
  .strict();

export type IGeneratedExcludeConfig = z.infer<typeof generatedExcludeSchema>;

export function getRuleSources(config: IRepoScopeConfig): string[] {
  return config.ruleSources;
}

export function getProjectContextSources(config: IRepoScopeConfig): string[] {
  return config.projectContext;
}

export function getApprovalMode(config: IRepoScopeConfig): IApprovalMode {
  return config.approvalMode;
}

export function getFeatureFlags(config: IRepoScopeConfig): IFeatureFlags {
  return config.features;
}

/** Defaults for feature flags when initializing project config. */
export const FEATURE_FLAGS_DEFAULTS: IFeatureFlags = {
  ...PROJECT_CONFIG_DEFAULT_FEATURES,
};

/** Load user config from SQLite. Throws if config is missing. */
export async function loadStrictCtoConfigFromDb(projectRoot: string): Promise<IRepoScopeConfig> {
  void projectRoot;
  const config = readProjectConfig();
  getRuntimeLogger().info({
    event: "Repo-scope loading config",
    exists: config !== null,
  });
  if (!config) {
    throw new AppError(
      "Repo scope config missing. Initialize the project config before starting feature workflows.",
      ERR_CONFIG_MISSING,
      { projectRoot }
    );
  }
  getRuntimeLogger().info({
    event: REPO_SCOPE_CONFIG_LOADED,
    projectContextCount: config.projectContext.length,
    ruleSourcesCount: config.ruleSources.length,
  });
  return config;
}

function loadGeneratedExcludeOrNull(projectRoot: string): string[] | null {
  void projectRoot;
  const snapshot = readGeneratedSnapshot({ kind: "exclude", schema: generatedExcludeSchema });
  return snapshot && snapshot.payload.exclude.length > 0 ? snapshot.payload.exclude : null;
}

/** Exclude list from the DB-backed generated exclude snapshot. */
export function getExclude(projectRoot: string): string[] {
  return loadGeneratedExcludeOrNull(projectRoot) ?? [];
}

function matchesExcludePattern(args: { name: string; pattern: string }): boolean {
  const { name, pattern } = args;
  if (pattern.startsWith("*.")) {
    return name.endsWith(pattern.slice(1));
  }
  return name === pattern;
}

function toPathSegments(path: string): string[] {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

/** Ignore matcher from the DB-backed generated exclude snapshot. */
export function getIgnoreMatcher(projectRoot: string): (path: string) => boolean {
  const exclude = getExclude(projectRoot);
  return (path: string) => {
    const segments = toPathSegments(path);
    if (segments.length === 0) return false;
    return exclude.some((pattern) =>
      segments.some((segment) => matchesExcludePattern({ name: segment, pattern }))
    );
  };
}

function matchesProjectContextGlob(relPath: string, pattern: string): boolean {
  const p = pattern.replaceAll("\\", "/");
  const path = relPath.replaceAll("\\", "/");
  if (!p.includes("*")) return path === p;
  if (p.endsWith("/**/*.md") || p.endsWith("/**/*.txt")) {
    const dir = p.slice(0, p.indexOf("/**"));
    return path.startsWith(dir + "/") && (path.endsWith(".md") || path.endsWith(".txt"));
  }
  if (p === "*.md" || p === "*.txt") return path.endsWith(".md") || path.endsWith(".txt");
  const parts = p.split("*");
  if (parts.length === 2) {
    const [before, after] = parts;
    return (
      path.startsWith(before ?? "") &&
      path.endsWith(after ?? "") &&
      path.length >= (before?.length ?? 0) + (after?.length ?? 0)
    );
  }
  return false;
}

export function pathMatchesProjectContext(
  path: string,
  config: Pick<IRepoScopeConfig, "projectContext">
): boolean {
  const normalized = path.replaceAll("\\", "/");
  return config.projectContext.some((pattern) =>
    matchesProjectContextGlob(normalized, pattern.replaceAll("\\", "/"))
  );
}

/** Reads user config from SQLite. Returns null only when not initialized. */
export function readRepoScopeConfigFromDisk(projectRoot: string): IRepoScopeConfig | null {
  void projectRoot;
  return readProjectConfig();
}

/** Write full repo-scope config to SQLite. Validates with configSchema before writing. */
export function writeRepoScopeConfig(projectRoot: string, config: IRepoScopeConfig): void {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    throw new AppError(
      "Invalid config shape for write",
      ERR_CONFIG_INVALID,
      {
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
      { cause: parsed.error.issues }
    );
  }
  void projectRoot;
  writeProjectConfigToDb(parsed.data);
}

/** Write generated exclude to SQLite snapshot state. */
export function writeGeneratedExclude(projectRoot: string, exclude: string[]): void {
  void projectRoot;
  writeGeneratedSnapshot({
    kind: "exclude",
    sourcesHash: "manual",
    generatorVersion: "1",
    payload: { exclude },
  });
}
