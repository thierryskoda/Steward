/**
 * Builds the only filesystem view exposed to the next-commitment agent. The view contains
 * bounded copies of Git-visible text files plus host-produced Git state. A fresh metadata-only
 * Git repository forms the sandbox boundary; original Git data, ignored files, common
 * sensitive/local paths, dependency output, symlinks, and other Steward runs are never copied.
 */
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { AppError } from "../../core/app-error.js";
import { ERR_NEXT_COMMITMENT_REVIEW_SNAPSHOT } from "../../core/error-codes.js";
import {
  isGeneratedOrDependencyGitPath,
  isLikelyBinaryGitPath,
} from "../../core/git/git-content-policy.js";
import { buildGitDelta, listGitProjectFiles } from "../../core/git/git-delta.js";
import { buildSanitizedGitProcessEnv } from "../../core/git/git-process-env.js";
import type { IGitSnapshot } from "../../core/git/git-snapshot.js";

const REVIEW_WORKSPACE_DIR = "review-workspace";
const REVIEW_EVIDENCE_DIR = ".steward-review-evidence";
const MAX_REVIEW_FILES = 20_000;
const MAX_REVIEW_FILE_BYTES = 2 * 1024 * 1024;
const MAX_REVIEW_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_GIT_STATE_PATHS = 1_000;
const MAX_GIT_DIFF_FILES = 100;
const MAX_GIT_DIFF_PATCH_CHARS = 500_000;

const SENSITIVE_BASENAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "secret.txt",
  "secrets.json",
  "secrets.txt",
  "secrets.yaml",
  "secrets.yml",
]);

const SENSITIVE_PATH_SEGMENTS = new Set([".aws", ".gnupg", ".kube", ".ssh"]);

const SENSITIVE_OR_LOCAL_EXTENSIONS = [
  ".db",
  ".db-journal",
  ".db-shm",
  ".db-wal",
  ".jks",
  ".key",
  ".keystore",
  ".log",
  ".p12",
  ".pem",
  ".pfx",
  ".sqlite",
  ".sqlite3",
] as const;

type IExcludedReason =
  | "binary"
  | "generated-or-dependency"
  | "invalid-path"
  | "not-regular-file"
  | "oversized"
  | "sensitive-or-local"
  | "snapshot-cap"
  | "symlink"
  | "unreadable";

type IExcludedCounts = Record<IExcludedReason, number>;

export type INextCommitmentReviewWorkspace = {
  workspacePath: string;
  evidenceDir: string;
  gitStatePath: string;
  includedFileCount: number;
  includedBytes: number;
  includedPaths: string[];
  excludedCounts: IExcludedCounts;
  truncated: boolean;
};

function emptyExcludedCounts(): IExcludedCounts {
  return {
    binary: 0,
    "generated-or-dependency": 0,
    "invalid-path": 0,
    "not-regular-file": 0,
    oversized: 0,
    "sensitive-or-local": 0,
    "snapshot-cap": 0,
    symlink: 0,
    unreadable: 0,
  };
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function isSensitiveOrLocalPath(path: string): boolean {
  const normalized = path.toLowerCase().replaceAll("\\", "/");
  const name = basename(normalized);
  if (normalized.split("/").some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment))) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (SENSITIVE_BASENAMES.has(name)) return true;
  return SENSITIVE_OR_LOCAL_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function isAllowedReviewPathByName(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.includes("\0") &&
    !normalized.split("/").some((segment) => segment === "..") &&
    !normalized
      .split("/")
      .some((segment) => segment.toLowerCase() === REVIEW_EVIDENCE_DIR.toLowerCase()) &&
    !isGeneratedOrDependencyGitPath(normalized) &&
    !isSensitiveOrLocalPath(normalized) &&
    !isLikelyBinaryGitPath(normalized)
  );
}

function readRegularFileWithoutFollowingFinalSymlink(
  path: string,
  expected: Pick<Stats, "dev" | "ino" | "size">
): Buffer {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const file = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const stat = fstatSync(file);
    if (
      !stat.isFile() ||
      stat.dev !== expected.dev ||
      stat.ino !== expected.ino ||
      stat.size !== expected.size ||
      stat.size > MAX_REVIEW_FILE_BYTES
    ) {
      throw new Error("Review source changed type or size during capture");
    }
    const content = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < content.length) {
      const bytesRead = readSync(file, content, offset, content.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== expected.size) throw new Error("Review source changed size during capture");
    return content;
  } finally {
    closeSync(file);
  }
}

function isUtf8Text(content: Buffer): boolean {
  if (content.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

function writeGitState(args: {
  path: string;
  projectRoot: string;
  projectSnapshot: IGitSnapshot;
  includedFileCount: number;
  includedBytes: number;
  excludedCounts: IExcludedCounts;
  truncated: boolean;
  includedPaths: ReadonlySet<string>;
}): void {
  const includedChangedEntries = args.projectSnapshot.entries.filter(
    (entry) =>
      args.includedPaths.has(entry.path) ||
      (entry.status === "D" && isAllowedReviewPathByName(entry.path))
  );
  const diffEntries = includedChangedEntries
    .filter((entry) => entry.status !== "??")
    .slice(0, MAX_GIT_DIFF_FILES);
  const delta = buildGitDelta(
    args.projectRoot,
    {
      ...args.projectSnapshot,
      entries: diffEntries,
    },
    {
      isExcluded: (path) =>
        !args.includedPaths.has(path) &&
        !includedChangedEntries.some((entry) => entry.status === "D" && entry.path === path),
    }
  );
  let remainingPatchChars = MAX_GIT_DIFF_PATCH_CHARS;
  const boundedDelta = delta.map((entry) => {
    const patch = entry.patch;
    if (patch === null) return entry;
    const includedPatch = patch.slice(0, remainingPatchChars);
    remainingPatchChars -= includedPatch.length;
    return {
      ...entry,
      patch: includedPatch.length === 0 ? null : includedPatch,
      patchTruncated: includedPatch.length < patch.length,
    };
  });
  const boundedChangedPaths = includedChangedEntries.slice(0, MAX_GIT_STATE_PATHS);
  const state = {
    schemaVersion: 1,
    selectedProjectRoot: args.projectRoot,
    headSha: args.projectSnapshot.headSha,
    worktreeHash: args.projectSnapshot.hash,
    changedPaths: boundedChangedPaths.map((entry) => ({
      path: entry.path,
      status: entry.status,
      ...(entry.renameFrom === undefined ? {} : { renameFrom: entry.renameFrom }),
    })),
    changedPathsTruncated: boundedChangedPaths.length < includedChangedEntries.length,
    diffEvidence: boundedDelta,
    diffEvidenceTruncated:
      includedChangedEntries.filter((entry) => entry.status !== "??").length > MAX_GIT_DIFF_FILES ||
      remainingPatchChars === 0,
    reviewSnapshot: {
      includedFileCount: args.includedFileCount,
      includedBytes: args.includedBytes,
      excludedCounts: args.excludedCounts,
      truncated: args.truncated,
    },
  } as const;
  writeFileSync(args.path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function failReviewSnapshot(
  reason: string,
  context: Record<string, unknown>,
  cause?: unknown
): never {
  throw new AppError(
    "Steward could not build a safe project review snapshot.",
    ERR_NEXT_COMMITMENT_REVIEW_SNAPSHOT,
    { reason, ...context },
    cause === undefined ? undefined : { cause }
  );
}

function getTemporaryRoots(): string[] {
  const candidates = [tmpdir(), "/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp"];
  return [
    ...new Set(
      candidates
        .filter((candidate) => existsSync(candidate))
        .map((candidate) => realpathSync(candidate))
    ),
  ];
}

export function findContainingTemporaryRoot(path: string): string | undefined {
  const realPath = realpathSync(path);
  return getTemporaryRoots().find((candidate) => isContained(candidate, realPath));
}

export function assertNextCommitmentReviewProjectRootSupported(projectRoot: string): void {
  const realProjectRoot = realpathSync(projectRoot);
  const temporaryRoot = findContainingTemporaryRoot(realProjectRoot);
  if (temporaryRoot !== undefined) {
    failReviewSnapshot("temporary_project_root_unsupported", {
      projectRoot: realProjectRoot,
      temporaryRoot,
    });
  }
  for (const relativePath of [".steward", ".steward/tmp", ".steward/tmp/runs"]) {
    const candidate = resolve(realProjectRoot, relativePath);
    if (!existsSync(candidate)) continue;
    if (lstatSync(candidate).isSymbolicLink()) {
      failReviewSnapshot("symlinked_steward_runtime_path", { path: candidate });
    }
    const realCandidate = realpathSync(candidate);
    if (
      !isContained(realProjectRoot, realCandidate) ||
      findContainingTemporaryRoot(realCandidate) !== undefined
    ) {
      failReviewSnapshot("unsafe_steward_runtime_path", { path: candidate, realCandidate });
    }
  }
}

export function assertNextCommitmentRunRootSupported(args: {
  projectRoot: string;
  runRoot: string;
}): void {
  assertNextCommitmentReviewProjectRootSupported(args.projectRoot);
  const realProjectRoot = realpathSync(args.projectRoot);
  const realRunRoot = realpathSync(args.runRoot);
  const temporaryRoot = findContainingTemporaryRoot(realRunRoot);
  if (!isContained(realProjectRoot, realRunRoot) || temporaryRoot !== undefined) {
    failReviewSnapshot("unsafe_run_root", {
      projectRoot: realProjectRoot,
      runRoot: realRunRoot,
      temporaryRoot,
    });
  }
}

function initializeWorkspaceBoundary(workspacePath: string): void {
  const gitEnv = buildSanitizedGitProcessEnv();
  try {
    execFileSync(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "init.templateDir=", "init", "--quiet"],
      {
        cwd: workspacePath,
        env: gitEnv,
        stdio: "ignore",
      }
    );
  } catch (error) {
    failReviewSnapshot("workspace_boundary_init_failed", { workspacePath }, error);
  }

  let reportedRoot: string;
  try {
    reportedRoot = realpathSync(
      execFileSync("git", ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"], {
        cwd: workspacePath,
        encoding: "utf8",
        env: gitEnv,
      }).trim()
    );
  } catch (error) {
    failReviewSnapshot("workspace_boundary_verification_failed", { workspacePath }, error);
  }
  const expectedRoot = realpathSync(workspacePath);
  if (reportedRoot !== expectedRoot) {
    failReviewSnapshot("workspace_boundary_mismatch", { expectedRoot, reportedRoot });
  }
}

export function createNextCommitmentReviewWorkspace(args: {
  projectRoot: string;
  runRoot: string;
  projectSnapshot: IGitSnapshot;
}): INextCommitmentReviewWorkspace {
  assertNextCommitmentRunRootSupported({ projectRoot: args.projectRoot, runRoot: args.runRoot });
  const projectRoot = realpathSync(args.projectRoot);
  const workspacePath = resolve(args.runRoot, REVIEW_WORKSPACE_DIR);
  const evidenceDir = resolve(workspacePath, REVIEW_EVIDENCE_DIR);
  mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

  const excludedCounts = emptyExcludedCounts();
  let includedFileCount = 0;
  let includedBytes = 0;
  let truncated = false;
  const includedPaths = new Set<string>();

  for (const path of listGitProjectFiles(projectRoot)) {
    const normalized = path.replaceAll("\\", "/");
    const sourcePath = resolve(projectRoot, normalized);
    if (
      normalized.length === 0 ||
      normalized.includes("\0") ||
      normalized.split("/").includes("..") ||
      !isContained(projectRoot, sourcePath)
    ) {
      excludedCounts["invalid-path"] += 1;
      continue;
    }
    if (
      normalized
        .split("/")
        .some((segment) => segment.toLowerCase() === REVIEW_EVIDENCE_DIR.toLowerCase()) ||
      isGeneratedOrDependencyGitPath(normalized)
    ) {
      excludedCounts["generated-or-dependency"] += 1;
      continue;
    }
    if (isSensitiveOrLocalPath(normalized)) {
      excludedCounts["sensitive-or-local"] += 1;
      continue;
    }
    if (isLikelyBinaryGitPath(normalized)) {
      excludedCounts.binary += 1;
      continue;
    }

    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(sourcePath);
    } catch {
      excludedCounts.unreadable += 1;
      continue;
    }
    if (stat.isSymbolicLink()) {
      excludedCounts.symlink += 1;
      continue;
    }
    if (!stat.isFile()) {
      excludedCounts["not-regular-file"] += 1;
      continue;
    }
    if (stat.size > MAX_REVIEW_FILE_BYTES) {
      excludedCounts.oversized += 1;
      continue;
    }
    if (
      includedFileCount >= MAX_REVIEW_FILES ||
      includedBytes + stat.size > MAX_REVIEW_TOTAL_BYTES
    ) {
      excludedCounts["snapshot-cap"] += 1;
      truncated = true;
      continue;
    }

    try {
      const realSourcePath = realpathSync(sourcePath);
      if (!isContained(projectRoot, realSourcePath)) {
        excludedCounts["invalid-path"] += 1;
        continue;
      }
      const content = readRegularFileWithoutFollowingFinalSymlink(realSourcePath, stat);
      if (!isUtf8Text(content)) {
        excludedCounts.binary += 1;
        continue;
      }
      if (includedBytes + content.length > MAX_REVIEW_TOTAL_BYTES) {
        excludedCounts["snapshot-cap"] += 1;
        truncated = true;
        continue;
      }
      const destinationPath = resolve(workspacePath, normalized);
      if (!isContained(workspacePath, destinationPath)) {
        excludedCounts["invalid-path"] += 1;
        continue;
      }
      mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
      writeFileSync(destinationPath, content, { flag: "wx", mode: 0o400 });
      includedFileCount += 1;
      includedBytes += content.length;
      includedPaths.add(normalized);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        failReviewSnapshot("destination_collision", { path: normalized }, error);
      }
      excludedCounts.unreadable += 1;
    }
  }

  const gitStatePath = resolve(evidenceDir, "git-state.json");
  try {
    writeGitState({
      path: gitStatePath,
      projectRoot,
      projectSnapshot: args.projectSnapshot,
      includedFileCount,
      includedBytes,
      excludedCounts,
      truncated,
      includedPaths,
    });
  } catch (error) {
    failReviewSnapshot("git_state_write_failed", { gitStatePath }, error);
  }
  initializeWorkspaceBoundary(workspacePath);

  return {
    workspacePath,
    evidenceDir,
    gitStatePath,
    includedFileCount,
    includedBytes,
    includedPaths: [...includedPaths],
    excludedCounts,
    truncated,
  };
}
