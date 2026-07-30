import assert from "node:assert";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it } from "vitest";
import { collectGitSnapshot, collectRequiredGitSnapshot } from "./git-snapshot.js";

function runGit(projectRoot: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
}

function commitAll(projectRoot: string, message: string): void {
  runGit(projectRoot, ["add", "-A"]);
  runGit(projectRoot, ["commit", "-m", message]);
}

describe("collectGitSnapshot", () => {
  let projectRoot: string;

  beforeEach((): void => {
    projectRoot = mkdtempSync(join(tmpdir(), "steward-git-snapshot-"));
    runGit(projectRoot, ["init"]);
    runGit(projectRoot, ["config", "user.email", "snapshot@example.com"]);
    runGit(projectRoot, ["config", "user.name", "Snapshot Test"]);
    writeFileSync(
      join(projectRoot, ".gitignore"),
      [".steward/", "ignored-secret.txt", "node_modules/", "dist/"].join("\n") + "\n"
    );
    writeFileSync(join(projectRoot, "tracked.txt"), "initial\n");
    commitAll(projectRoot, "initial");
  });

  afterEach((): void => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("changes the fingerprint whenever the contents of the same modified path change", () => {
    writeFileSync(join(projectRoot, "tracked.txt"), "first edit\n");
    const first = collectGitSnapshot(projectRoot);

    writeFileSync(join(projectRoot, "tracked.txt"), "second edit\n");
    const second = collectGitSnapshot(projectRoot);

    assert.notStrictEqual(second.hash, first.hash);
    assert.notStrictEqual(
      second.entries[0]?.contentFingerprint,
      first.entries[0]?.contentFingerprint
    );
  });

  it("changes the fingerprint whenever the contents of the same untracked path change", () => {
    writeFileSync(join(projectRoot, "notes.md"), "first draft\n");
    const first = collectGitSnapshot(projectRoot);

    writeFileSync(join(projectRoot, "notes.md"), "second draft\n");
    const second = collectGitSnapshot(projectRoot);

    assert.notStrictEqual(second.hash, first.hash);
    assert.notStrictEqual(
      second.entries[0]?.contentFingerprint,
      first.entries[0]?.contentFingerprint
    );
  });

  it("preserves unusual Git paths so their content changes supersede a review", () => {
    const path = 'odd\nname\t".txt';
    writeFileSync(join(projectRoot, path), "first edit\n");
    const first = collectRequiredGitSnapshot(projectRoot);

    writeFileSync(join(projectRoot, path), "second edit\n");
    const second = collectRequiredGitSnapshot(projectRoot);

    assert.strictEqual(first.entries[0]?.path, path);
    assert.notStrictEqual(second.hash, first.hash);
    assert.notStrictEqual(
      second.entries[0]?.contentFingerprint,
      first.entries[0]?.contentFingerprint
    );
  });

  it("keeps deletions, renames, and HEAD changes observable", () => {
    unlinkSync(join(projectRoot, "tracked.txt"));
    const deleted = collectGitSnapshot(projectRoot);
    assert.strictEqual(
      deleted.entries.some((entry) => entry.status === "D"),
      true
    );

    writeFileSync(join(projectRoot, "tracked.txt"), "initial\n");
    runGit(projectRoot, ["mv", "tracked.txt", "renamed.txt"]);
    const renamed = collectGitSnapshot(projectRoot);
    assert.strictEqual(
      renamed.entries.some((entry) => entry.status === "R" && entry.renameFrom === "tracked.txt"),
      true
    );

    const headBeforeCommit = renamed.headSha;
    commitAll(projectRoot, "rename tracked file");
    const committed = collectGitSnapshot(projectRoot);
    assert.notStrictEqual(committed.headSha, headBeforeCommit);
    assert.notStrictEqual(committed.hash, renamed.hash);
  });

  it("does not observe ignored files or dereference untracked symlinks", () => {
    mkdirSync(join(projectRoot, ".steward"), { recursive: true });
    mkdirSync(join(projectRoot, "node_modules"), { recursive: true });
    writeFileSync(join(projectRoot, ".steward", "state.db"), "private state");
    writeFileSync(join(projectRoot, "node_modules", "package.js"), "generated dependency");
    writeFileSync(join(projectRoot, "ignored-secret.txt"), "secret one");
    const ignoredFirst = collectGitSnapshot(projectRoot);

    writeFileSync(join(projectRoot, ".steward", "state.db"), "private state changed");
    writeFileSync(join(projectRoot, "node_modules", "package.js"), "dependency changed");
    writeFileSync(join(projectRoot, "ignored-secret.txt"), "secret two");
    const ignoredSecond = collectGitSnapshot(projectRoot);
    assert.strictEqual(ignoredSecond.hash, ignoredFirst.hash);
    assert.deepStrictEqual(ignoredSecond.entries, []);

    const externalSecret = join(projectRoot, "..", `${projectRoot.split("/").pop()}-secret.txt`);
    writeFileSync(externalSecret, "outside one");
    symlinkSync(externalSecret, join(projectRoot, "linked-secret.txt"));
    const linkedFirst = collectGitSnapshot(projectRoot);
    writeFileSync(externalSecret, "outside two");
    const linkedSecond = collectGitSnapshot(projectRoot);
    assert.strictEqual(linkedSecond.hash, linkedFirst.hash);
    rmSync(externalSecret, { force: true });
  });

  it("does not observe Steward runtime files when the target repository does not ignore them", () => {
    writeFileSync(
      join(projectRoot, ".gitignore"),
      ["ignored-secret.txt", "node_modules/", "dist/"].join("\n") + "\n"
    );
    mkdirSync(join(projectRoot, ".steward", "tmp", "runs", "request-1"), {
      recursive: true,
    });
    const schemaPath = join(
      projectRoot,
      ".steward",
      "tmp",
      "runs",
      "request-1",
      "output.schema.json"
    );
    writeFileSync(schemaPath, '{"version":1}\n');
    const first = collectGitSnapshot(projectRoot);

    writeFileSync(schemaPath, '{"version":2}\n');
    mkdirSync(join(projectRoot, ".StEwArD", "tmp", "runs", "request-2"), {
      recursive: true,
    });
    writeFileSync(
      join(projectRoot, ".StEwArD", "tmp", "runs", "request-2", "private.txt"),
      "mixed-case private state"
    );
    const second = collectGitSnapshot(projectRoot);

    assert.strictEqual(second.hash, first.hash);
    assert.strictEqual(
      second.entries.some((entry) => entry.path.startsWith(".steward/")),
      false
    );
    assert.strictEqual(
      second.entries.some((entry) => entry.path.toLowerCase().startsWith(".steward/")),
      false
    );
  });

  it("fails closed when required Git status evidence cannot be captured", () => {
    const nonGitRoot = mkdtempSync(join(tmpdir(), "steward-required-git-snapshot-"));
    try {
      assert.throws(
        () => collectRequiredGitSnapshot(nonGitRoot),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "ERR_GIT_DELTA" &&
          /root does not match/.test(error.message)
      );
    } finally {
      rmSync(nonGitRoot, { recursive: true, force: true });
    }
  });

  it("disables a repository-configured filesystem monitor command", () => {
    const markerPath = join(projectRoot, "fsmonitor-marker.txt");
    const hookPath = join(projectRoot, "fsmonitor-hook.sh");
    writeFileSync(hookPath, `#!/bin/sh\n: > "${markerPath}"\nexit 0\n`);
    chmodSync(hookPath, 0o700);
    runGit(projectRoot, ["config", "core.fsmonitor", hookPath]);

    runGit(projectRoot, ["status", "--porcelain=v1"]);
    assert.strictEqual(existsSync(markerPath), true, "negative control should execute the hook");
    unlinkSync(markerPath);

    collectRequiredGitSnapshot(projectRoot);

    assert.strictEqual(existsSync(markerPath), false);
  });

  it("rejects a repository whose local config redirects the selected worktree", () => {
    const outsideWorktree = mkdtempSync(join(tmpdir(), "steward-outside-worktree-"));
    try {
      runGit(projectRoot, ["config", "core.worktree", outsideWorktree]);

      assert.throws(
        () => collectRequiredGitSnapshot(projectRoot),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "ERR_GIT_DELTA" &&
          /root does not match/.test(error.message)
      );
    } finally {
      rmSync(outsideWorktree, { recursive: true, force: true });
    }
  });
});
