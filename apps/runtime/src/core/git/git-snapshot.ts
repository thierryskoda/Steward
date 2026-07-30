import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "fs";
import { isAbsolute, relative, resolve } from "path";
import { getRuntimeLogger } from "../logger.js";
import { GIT_SNAPSHOT_STATUS_FAILED } from "../runtime-log-events.js";
import { AppError } from "../app-error.js";
import { ERR_GIT_DELTA } from "../error-codes.js";
import { isGeneratedOrDependencyGitPath, isLikelyBinaryGitPath } from "./git-content-policy.js";
import { buildSanitizedGitProcessEnv } from "./git-process-env.js";

const MAX_CONTENT_FINGERPRINT_BYTES = 2 * 1024 * 1024;

export type IGitStatusCode =
  | "M" // modified
  | "A" // added
  | "D" // deleted
  | "R" // renamed
  | "C" // copied
  | "??" // untracked
  | "!!" // ignored
  | "U"; // unmerged

const GIT_STATUS_CODES: readonly IGitStatusCode[] = ["M", "A", "D", "R", "C", "??", "!!", "U"];

function isGitStatusCode(s: string): s is IGitStatusCode {
  return (GIT_STATUS_CODES as readonly string[]).includes(s);
}

function toGitStatusCode(s: string): IGitStatusCode {
  if (isGitStatusCode(s)) return s;
  return "M";
}

export type IGitStatusEntry = {
  readonly path: string;
  readonly status: IGitStatusCode;
  readonly contentFingerprint: string | null;
  readonly renameFrom?: string;
};

export type IGitSnapshot = {
  readonly headSha: string | null;
  readonly entries: readonly IGitStatusEntry[];
  readonly hash: string;
};

function runGit(
  args: string[],
  cwd: string
): { stdout: string; stderr: string; code: number | null } {
  const proc = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "utf-8",
    env: buildSanitizedGitProcessEnv(),
  });
  return {
    stdout: proc.stdout ?? "",
    stderr: (proc.stderr ?? "").trim(),
    code: proc.status,
  };
}

function assertRequiredGitProjectRoot(projectRoot: string): void {
  const result = runGit(["rev-parse", "--show-toplevel"], projectRoot);
  let actualRoot: string | null = null;
  try {
    if (result.code === 0 && result.stdout.trim().length > 0) {
      actualRoot = realpathSync(result.stdout.trim());
    }
  } catch {
    actualRoot = null;
  }
  const expectedRoot = realpathSync(projectRoot);
  if (actualRoot !== expectedRoot) {
    throw new AppError("Git repository root does not match the selected project.", ERR_GIT_DELTA, {
      projectRoot: expectedRoot,
      actualRoot,
      command: "git -c core.fsmonitor=false rev-parse --show-toplevel",
      code: result.code,
      stderr: result.stderr.slice(0, 1_000),
    });
  }
}

function getHeadSha(cwd: string): string | null {
  const r = runGit(["rev-parse", "--verify", "HEAD"], cwd);
  const headSha = r.stdout.trim();
  if (r.code !== 0 || headSha.length === 0) return null;
  return headSha;
}

function parsePorcelainRecords(output: string): Array<Omit<IGitStatusEntry, "contentFingerprint">> {
  const tokens = output.split("\0");
  const entries: Array<Omit<IGitStatusEntry, "contentFingerprint">> = [];
  let index = 0;
  while (index < tokens.length) {
    const record = tokens[index];
    index += 1;
    if (record === undefined || record.length < 4 || record[2] !== " ") continue;
    const xy = record.slice(0, 2);
    const path = record.slice(3);
    if (path.length === 0) continue;
    const statusValue =
      xy === "??"
        ? "??"
        : xy === "!!"
          ? "!!"
          : xy.includes("U")
            ? "U"
            : xy[0] === "R" || xy[0] === "C"
              ? xy[0]
              : (xy.trim()[0] ?? "M");
    const status = toGitStatusCode(statusValue);
    if (status === "R" || status === "C") {
      const renameFrom = tokens[index];
      index += 1;
      entries.push({ path, status, ...(renameFrom ? { renameFrom } : {}) });
      continue;
    }
    entries.push({ path, status });
  }
  return entries;
}

function isStewardRuntimePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return normalized === ".steward" || normalized.startsWith(".steward/");
}

function buildHash(headSha: string | null, entries: readonly IGitStatusEntry[]): string {
  const payload = JSON.stringify({
    headSha,
    entries: entries
      .map((entry) => [entry.path, entry.status, entry.renameFrom, entry.contentFingerprint])
      .sort(),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function hashValue(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function metadataFingerprint(args: {
  fileType: "directory" | "file" | "other" | "symlink";
  mode: number;
  modifiedAtMs: number;
  size: number;
  symlinkTargetHash?: string;
}): string {
  return hashValue(JSON.stringify(args));
}

function resolveContainedPath(projectRoot: string, path: string): string | null {
  const fullPath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, fullPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return fullPath;
}

export function fingerprintGitProjectPath(projectRoot: string, path: string): string | null {
  const fullPath = resolveContainedPath(projectRoot, path);
  if (fullPath === null) return null;

  try {
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      return metadataFingerprint({
        fileType: "symlink",
        mode: stat.mode,
        modifiedAtMs: stat.mtimeMs,
        size: stat.size,
        symlinkTargetHash: hashValue(readlinkSync(fullPath)),
      });
    }

    const fileType = stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
    const metadata = {
      fileType,
      mode: stat.mode,
      modifiedAtMs: stat.mtimeMs,
      size: stat.size,
    } as const;
    const mustUseMetadata =
      !stat.isFile() ||
      stat.size > MAX_CONTENT_FINGERPRINT_BYTES ||
      isLikelyBinaryGitPath(path) ||
      isGeneratedOrDependencyGitPath(path);
    if (mustUseMetadata) return metadataFingerprint(metadata);
    return hashValue(readFileSync(fullPath));
  } catch {
    return null;
  }
}

function fingerprintWorktreeEntry(
  projectRoot: string,
  entry: Omit<IGitStatusEntry, "contentFingerprint">
): string | null {
  if (entry.status === "D") return null;
  return (
    fingerprintGitProjectPath(projectRoot, entry.path) ?? hashValue("worktree-entry-unreadable")
  );
}

function collectGitSnapshotInternal(projectRoot: string, failOnStatusError: boolean): IGitSnapshot {
  if (failOnStatusError) assertRequiredGitProjectRoot(projectRoot);
  const headSha = getHeadSha(projectRoot);
  const r = runGit(["status", "--porcelain=v1", "-z", "-uall"], projectRoot);
  if (r.code !== 0) {
    if (failOnStatusError) {
      throw new AppError(
        "Git status failed while capturing required project evidence.",
        ERR_GIT_DELTA,
        {
          projectRoot,
          command: "git status --porcelain=v1 -z -uall",
          code: r.code,
          stderr: r.stderr.slice(0, 1_000),
        }
      );
    }
    getRuntimeLogger().warn({
      event: GIT_SNAPSHOT_STATUS_FAILED,
      projectRoot,
      code: r.code,
      stderr: r.stderr || undefined,
    });
    return {
      headSha,
      entries: [],
      hash: buildHash(headSha, []),
    };
  }
  const entries: IGitStatusEntry[] = [];
  for (const parsedEntry of parsePorcelainRecords(r.stdout)) {
    if (
      isStewardRuntimePath(parsedEntry.path) ||
      (parsedEntry.renameFrom !== undefined && isStewardRuntimePath(parsedEntry.renameFrom))
    ) {
      continue;
    }
    entries.push({
      ...parsedEntry,
      contentFingerprint: fingerprintWorktreeEntry(projectRoot, parsedEntry),
    });
  }
  const hash = buildHash(headSha, entries);
  return { headSha, entries, hash };
}

export function collectGitSnapshot(projectRoot: string): IGitSnapshot {
  return collectGitSnapshotInternal(projectRoot, false);
}

/** Next-commitment decisions require trustworthy change detection and therefore fail closed. */
export function collectRequiredGitSnapshot(projectRoot: string): IGitSnapshot {
  return collectGitSnapshotInternal(projectRoot, true);
}
