import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import type { IGitStatusEntry, IGitSnapshot } from "./git-snapshot.js";
import { isLikelyBinaryGitPath } from "./git-content-policy.js";
import { AppError } from "../app-error.js";
import { ERR_GIT_DELTA } from "../error-codes.js";
import { buildSanitizedGitProcessEnv } from "./git-process-env.js";

const MAX_PATCH_CHARS = 50000;

export type IGitDeltaFile = {
  path: string;
  status: string;
  isUntracked: boolean;
  isBinary: boolean;
  added: number;
  deleted: number;
  patch: string | null;
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
    stdout: (proc.stdout ?? "").trim(),
    stderr: (proc.stderr ?? "").trim(),
    code: proc.status,
  };
}

function parseNumstatLine(line: string): { added: number; deleted: number } {
  const parts = line.split(/\s+/);
  const added = Number.parseInt(parts[0] ?? "-", 10);
  const deleted = Number.parseInt(parts[1] ?? "-", 10);
  return {
    added: Number.isFinite(added) ? added : 0,
    deleted: Number.isFinite(deleted) ? deleted : 0,
  };
}

function truncatePatch(patch: string): string {
  if (patch.length <= MAX_PATCH_CHARS) return patch;
  return (
    patch.slice(0, MAX_PATCH_CHARS) +
    `\n...TRUNCATED (${patch.length - MAX_PATCH_CHARS} chars omitted)`
  );
}

function enrichTrackedFile(projectRoot: string, entry: IGitStatusEntry): IGitDeltaFile {
  const path = entry.path;
  const isBinary = isLikelyBinaryGitPath(path);
  let added = 0;
  let deleted = 0;
  let patch: string | null = null;

  if (entry.status === "D") {
    return {
      path,
      status: entry.status,
      isUntracked: false,
      isBinary: false,
      added: 0,
      deleted: 0,
      patch: null,
    };
  }

  const numstat = runGit(
    ["diff", "--no-ext-diff", "--no-textconv", "-M", "--numstat", "HEAD", "--", path],
    projectRoot
  );
  if (numstat.code === 0 && numstat.stdout) {
    const first = numstat.stdout.split("\n")[0];
    if (first && !first.includes("Bin")) {
      const parsed = parseNumstatLine(first);
      added = parsed.added;
      deleted = parsed.deleted;
    }
  }

  if (!isBinary) {
    const diff = runGit(
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "-M",
        "--unified=0",
        "--no-color",
        "HEAD",
        "--",
        path,
      ],
      projectRoot
    );
    if (diff.code === 0 && diff.stdout) {
      if (diff.stdout.includes("Binary files differ")) {
        return {
          path,
          status: entry.status,
          isUntracked: false,
          isBinary: true,
          added,
          deleted,
          patch: null,
        };
      }
      patch = truncatePatch(diff.stdout);
    }
  }

  return {
    path,
    status: entry.status,
    isUntracked: false,
    isBinary,
    added,
    deleted,
    patch,
  };
}

function enrichUntrackedFile(projectRoot: string, entry: IGitStatusEntry): IGitDeltaFile {
  const path = entry.path;
  const fullPath = join(projectRoot, path);
  const isBinary = isLikelyBinaryGitPath(path);
  let patch: string | null = null;

  if (existsSync(fullPath)) {
    try {
      const stat = statSync(fullPath);
      if (stat.isFile() && !isBinary) {
        const content = readFileSync(fullPath, "utf-8");
        patch = truncatePatch(content);
      }
    } catch {
      // skip unreadable
    }
  }

  return {
    path,
    status: "??",
    isUntracked: true,
    isBinary,
    added: 0,
    deleted: 0,
    patch,
  };
}

export type IBuildGitDeltaOptions = {
  isExcluded?: (path: string) => boolean;
};

export function buildGitDelta(
  projectRoot: string,
  snapshot: IGitSnapshot,
  options?: IBuildGitDeltaOptions
): IGitDeltaFile[] {
  const isExcluded = options?.isExcluded ?? (() => false);
  const result: IGitDeltaFile[] = [];
  for (const entry of snapshot.entries) {
    if (isExcluded(entry.path)) continue;
    if (entry.status === "??" || entry.status === "!!") {
      result.push(enrichUntrackedFile(projectRoot, entry));
    } else {
      result.push(enrichTrackedFile(projectRoot, entry));
    }
  }
  return result;
}

export function hasScopeStructureChanges(entries: readonly IGitStatusEntry[]): boolean {
  return entries.some((e) => {
    const normalizedPath = e.path.toLowerCase();
    if (normalizedPath.startsWith(".steward/")) return false;
    if (normalizedPath === ".gitignore") return true;
    return e.status === "A" || e.status === "D";
  });
}

function runGitPathCommand(args: string[], projectRoot: string): string[] {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: buildSanitizedGitProcessEnv(),
  });
  if (result.status !== 0) {
    throw new AppError("Git path inventory command failed", ERR_GIT_DELTA, {
      projectRoot,
      command: `git ${args.join(" ")}`,
      code: result.status,
      stderr: (result.stderr ?? "").trim().slice(0, 1_000),
    });
  }
  return (result.stdout ?? "").split("\0").filter((value) => value.length > 0);
}

export function listGitProjectFiles(projectRoot: string): string[] {
  return [
    ...new Set(runGitPathCommand(["ls-files", "-co", "--exclude-standard", "-z"], projectRoot)),
  ].sort((left, right) => left.localeCompare(right));
}

export function listChangedPathsBetweenGitHeads(args: {
  projectRoot: string;
  fromHeadSha: string | null;
  toHeadSha: string | null;
}): string[] {
  if (args.toHeadSha === null || args.fromHeadSha === args.toHeadSha) return [];
  if (args.fromHeadSha === null) {
    return runGitPathCommand(
      ["ls-tree", "-r", "--name-only", "-z", args.toHeadSha],
      args.projectRoot
    ).sort((left, right) => left.localeCompare(right));
  }
  const tokens = runGitPathCommand(
    ["diff", "--name-status", "-z", "-M", args.fromHeadSha, args.toHeadSha, "--"],
    args.projectRoot
  );
  const paths = new Set<string>();
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index];
    index += 1;
    if (status === undefined) break;
    const firstPath = tokens[index];
    index += 1;
    if (firstPath === undefined) break;
    paths.add(firstPath);
    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = tokens[index];
      index += 1;
      if (secondPath !== undefined) paths.add(secondPath);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}
