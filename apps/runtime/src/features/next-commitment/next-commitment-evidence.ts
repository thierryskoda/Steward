/** Validates configured locators and model-reported provenance before persistence. */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { INextCommitmentResult } from "@steward/contracts/schemas";
import { AppError } from "../../core/app-error.js";
import { ERR_NEXT_COMMITMENT_EVIDENCE } from "../../core/error-codes.js";
import { buildSanitizedGitProcessEnv } from "../../core/git/git-process-env.js";

const FORBIDDEN_PROJECT_PATH_SEGMENTS = new Set([
  ".git",
  ".steward",
  "node_modules",
  "dist",
  "build",
]);

function normalizeRelativeLocator(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  if (normalized.length === 0 || normalized.includes("\0")) return null;
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("~")) {
    return null;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return null;
  return normalized.replace(/^\.\//, "");
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function hasForbiddenSegment(path: string): boolean {
  return path.split("/").some((segment) => {
    const normalizedSegment = segment.toLowerCase();
    if (FORBIDDEN_PROJECT_PATH_SEGMENTS.has(normalizedSegment)) return true;
    return normalizedSegment === ".env" || normalizedSegment.startsWith(".env.");
  });
}

function isGitObservable(projectRoot: string, path: string): boolean {
  const result = spawnSync(
    "git",
    ["-c", "core.fsmonitor=false", "check-ignore", "--quiet", "--", path],
    {
      cwd: projectRoot,
      env: buildSanitizedGitProcessEnv(),
      stdio: "ignore",
    }
  );
  return result.status === 1;
}

function validatedProjectFile(projectRoot: string, locator: string): string | null {
  const normalized = normalizeRelativeLocator(locator);
  if (normalized === null || normalized === "." || hasForbiddenSegment(normalized)) return null;
  const root = realpathSync(projectRoot);
  const candidate = resolve(root, normalized);
  if (!isContained(root, candidate) || !existsSync(candidate)) return null;
  const realCandidate = realpathSync(candidate);
  if (!isContained(root, realCandidate) || !statSync(realCandidate).isFile()) return null;
  if (!isGitObservable(root, normalized)) return null;
  return normalized;
}

function fail(reason: string, context: Record<string, unknown>): never {
  throw new AppError(
    "Next commitment result cited evidence outside its captured review scope",
    ERR_NEXT_COMMITMENT_EVIDENCE,
    { reason, ...context }
  );
}

export function validateConfiguredContextPatterns(args: {
  projectRoot: string;
  patterns: string[];
}): string[] {
  const validated: string[] = [];
  for (const pattern of args.patterns) {
    const normalized = normalizeRelativeLocator(pattern);
    if (normalized === null || normalized === "." || hasForbiddenSegment(normalized)) continue;
    const containsGlob = ["*", "?", "{", "["].some((token) => normalized.includes(token));
    if (!containsGlob && validatedProjectFile(args.projectRoot, normalized) === null) continue;
    if (!validated.includes(normalized)) validated.push(normalized);
  }
  return validated;
}

export function assertNextCommitmentResultProvenance(args: {
  result: INextCommitmentResult;
  projectRoot: string;
  manifestTaskIds: readonly string[];
  reviewedProjectPaths: readonly string[];
  exposedProjectPaths: readonly string[];
  exposedTaskIds: readonly string[];
  projectStateInspected: boolean;
  taskManifestInspected: boolean;
}): void {
  const manifestTaskIds = new Set(args.manifestTaskIds);
  const reviewedProjectPaths = new Set(args.reviewedProjectPaths);
  const exposedProjectPaths = new Set(args.exposedProjectPaths);
  const exposedTaskIds = new Set(args.exposedTaskIds);
  const inspectedTaskIds = new Set(args.result.inspectedTaskIds);
  if (inspectedTaskIds.size !== args.result.inspectedTaskIds.length) {
    fail("duplicate_inspected_task_id", {});
  }
  for (const taskId of inspectedTaskIds) {
    if (!manifestTaskIds.has(taskId)) fail("task_not_in_manifest", { taskId });
    if (!exposedTaskIds.has(taskId)) fail("task_not_read_through_broker", { taskId });
  }
  for (const taskId of exposedTaskIds) {
    if (!inspectedTaskIds.has(taskId)) fail("broker_task_read_not_reported", { taskId });
  }

  const inspectedProjectPaths = new Set(args.result.inspectedProjectPaths);
  if (inspectedProjectPaths.size !== args.result.inspectedProjectPaths.length) {
    fail("duplicate_inspected_project_path", {});
  }
  for (const path of inspectedProjectPaths) {
    if (path === ".") {
      if (!args.projectStateInspected) fail("project_state_not_read_through_broker", {});
      continue;
    }
    if (!reviewedProjectPaths.has(path)) {
      fail("project_path_not_in_review_snapshot", { path });
    }
    if (validatedProjectFile(args.projectRoot, path) === null) {
      fail("invalid_project_path", { path });
    }
    if (!exposedProjectPaths.has(path)) fail("project_path_not_read_through_broker", { path });
  }
  for (const path of exposedProjectPaths) {
    if (!inspectedProjectPaths.has(path)) fail("broker_project_path_read_not_reported", { path });
  }
  if (args.projectStateInspected && !inspectedProjectPaths.has(".")) {
    fail("broker_project_state_read_not_reported", {});
  }

  const evidenceLocators = new Set<string>();
  for (const evidence of args.result.evidence) {
    const evidenceKey = `${evidence.source}:${evidence.location}`;
    if (evidenceLocators.has(evidenceKey)) {
      fail("duplicate_evidence_locator", { source: evidence.source, location: evidence.location });
    }
    evidenceLocators.add(evidenceKey);

    if (evidence.source === "codex-task") {
      if (!manifestTaskIds.has(evidence.location) || !inspectedTaskIds.has(evidence.location)) {
        fail("uncorroborated_task_evidence", { taskId: evidence.location });
      }
      continue;
    }
    if (evidence.source === "task-manifest") {
      if (evidence.location !== "recent-codex-tasks.json") {
        fail("invalid_task_manifest_locator", { location: evidence.location });
      }
      if (!args.taskManifestInspected) fail("task_manifest_not_read_through_broker", {});
      continue;
    }
    if (!inspectedProjectPaths.has(evidence.location)) {
      fail("uninspected_project_evidence", { path: evidence.location });
    }
    if (
      evidence.location !== "." &&
      validatedProjectFile(args.projectRoot, evidence.location) === null
    ) {
      fail("invalid_project_evidence", { path: evidence.location });
    }
  }

  if (args.result.status === "recommendation" && evidenceLocators.size < 2) {
    fail("insufficient_distinct_evidence", { evidenceCount: evidenceLocators.size });
  }
}
