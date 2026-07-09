import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import type { IGitStatusEntry, IGitSnapshot } from "./git-snapshot.js";

const MAX_PATCH_CHARS = 50000;
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);

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
  const proc = spawnSync("git", args, { cwd, encoding: "utf-8" });
  return {
    stdout: (proc.stdout ?? "").trim(),
    stderr: (proc.stderr ?? "").trim(),
    code: proc.status,
  };
}

function isLikelyBinary(path: string): boolean {
  const lower = path.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
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
  const isBinary = isLikelyBinary(path);
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

  const numstat = runGit(["diff", "-M", "--numstat", "HEAD", "--", path], projectRoot);
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
      ["diff", "-M", "--unified=0", "--no-color", "HEAD", "--", path],
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
  const isBinary = isLikelyBinary(path);
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

export function hasScopeStructureChanges(entries: IGitStatusEntry[]): boolean {
  return entries.some((e) => {
    if (e.path.startsWith(".steward/")) return false;
    if (e.path === ".gitignore") return true;
    return e.status === "A" || e.status === "D";
  });
}
