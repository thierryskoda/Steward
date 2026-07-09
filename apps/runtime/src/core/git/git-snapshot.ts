import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { getRuntimeLogger } from "../logger.js";
import { GIT_SNAPSHOT_STATUS_FAILED } from "../runtime-log-events.js";

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
  path: string;
  status: IGitStatusCode;
  renameFrom?: string;
};

export type IGitSnapshot = {
  headSha: string | null;
  entries: IGitStatusEntry[];
  hash: string;
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

function getHeadSha(cwd: string): string | null {
  const r = runGit(["rev-parse", "--verify", "HEAD"], cwd);
  if (r.code !== 0 || !r.stdout) return null;
  return r.stdout;
}

function parsePorcelainLine(line: string): IGitStatusEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const xy = trimmed.slice(0, 2);
  const rest = trimmed.slice(2).trim();
  if (rest.includes(" -> ")) {
    const idx = rest.indexOf(" -> ");
    const fromPath = rest.slice(0, idx).trim();
    const toPath = rest.slice(idx + 4).trim();
    if (toPath) {
      const statusStr = xy[0] === "R" || xy[0] === "C" ? (xy[0] === "R" ? "R" : "C") : "M";
      return {
        path: toPath,
        status: toGitStatusCode(statusStr),
        renameFrom: fromPath || undefined,
      };
    }
  }
  const path = rest;
  if (!path) return null;
  const statusStr = xy === "??" ? "??" : xy === "!!" ? "!!" : (xy[0] ?? "M");
  return { path, status: toGitStatusCode(statusStr) };
}

function buildHash(headSha: string | null, entries: IGitStatusEntry[]): string {
  const payload = JSON.stringify({
    headSha,
    entries: entries.map((e) => [e.path, e.status, e.renameFrom]).sort(),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

export function collectGitSnapshot(projectRoot: string): IGitSnapshot {
  const headSha = getHeadSha(projectRoot);
  const r = runGit(["status", "--porcelain=v1", "-uall"], projectRoot);
  if (r.code !== 0) {
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
  const lines = r.stdout.split("\n").filter(Boolean);
  const entries: IGitStatusEntry[] = [];
  for (const line of lines) {
    const entry = parsePorcelainLine(line);
    if (!entry) continue;
    entries.push(entry);
  }
  const hash = buildHash(headSha, entries);
  return { headSha, entries, hash };
}
