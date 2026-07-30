import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { collectGitSnapshot } from "../../core/git/git-snapshot.js";
import {
  assertNextCommitmentReviewProjectRootSupported,
  createNextCommitmentReviewWorkspace,
} from "./next-commitment-review-workspace.js";

const tempDirs: string[] = [];
const fixtureRoot = join(process.cwd(), ".steward", "tmp", "runs", "review-workspace-tests");

function createFixture(): { projectRoot: string; runRoot: string } {
  mkdirSync(fixtureRoot, { recursive: true });
  const projectRoot = mkdtempSync(join(fixtureRoot, "steward-review-source-"));
  const runRoot = join(projectRoot, ".steward", "tmp", "runs", "fixture");
  tempDirs.push(projectRoot);
  mkdirSync(join(projectRoot, "src"));
  writeFileSync(join(projectRoot, ".gitignore"), ".steward/\nignored.txt\n", "utf8");
  writeFileSync(join(projectRoot, "README.md"), "# Complete project\n", "utf8");
  writeFileSync(join(projectRoot, "src", "index.ts"), "export const done = true;\n", "utf8");
  writeFileSync(join(projectRoot, ".env.production"), "SECRET=tracked-but-sensitive\n", "utf8");
  writeFileSync(join(projectRoot, "ignored.txt"), "ignored secret\n", "utf8");
  writeFileSync(join(projectRoot, "outside.txt"), "outside target\n", "utf8");
  symlinkSync(join(projectRoot, "outside.txt"), join(projectRoot, "linked.txt"));
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "steward@example.test"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "Steward Test"], { cwd: projectRoot });
  execFileSync(
    "git",
    [
      "add",
      ".gitignore",
      "README.md",
      "src/index.ts",
      ".env.production",
      "outside.txt",
      "linked.txt",
    ],
    { cwd: projectRoot }
  );
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: projectRoot });
  writeFileSync(join(projectRoot, "README.md"), "# Complete project\nCurrent evidence.\n", "utf8");
  writeFileSync(join(projectRoot, "NOTES.md"), "No active work remains.\n", "utf8");
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(join(runRoot, "other-agent-secret.txt"), "must stay out\n", "utf8");
  return { projectRoot, runRoot };
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("createNextCommitmentReviewWorkspace", () => {
  it("rejects projects under a globally readable operating-system temporary root", () => {
    const temporaryProject = mkdtempSync(join(tmpdir(), "steward-review-unsafe-temp-project-"));
    tempDirs.push(temporaryProject);

    expect(() => assertNextCommitmentReviewProjectRootSupported(temporaryProject)).toThrowError(
      expect.objectContaining({ code: "ERR_NEXT_COMMITMENT_REVIEW_SNAPSHOT" })
    );
  });

  it("rejects a Steward runtime directory redirected into an operating-system temp root", () => {
    mkdirSync(fixtureRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(fixtureRoot, "steward-review-symlink-project-"));
    const redirectedRuntime = mkdtempSync(join(tmpdir(), "steward-review-redirected-runtime-"));
    tempDirs.push(projectRoot, redirectedRuntime);
    symlinkSync(redirectedRuntime, join(projectRoot, ".steward"), "dir");

    expect(() => assertNextCommitmentReviewProjectRootSupported(projectRoot)).toThrowError(
      expect.objectContaining({ code: "ERR_NEXT_COMMITMENT_REVIEW_SNAPSHOT" })
    );
  });

  it("copies only bounded Git-visible regular text files and records host-produced Git state", () => {
    const { projectRoot, runRoot } = createFixture();
    const snapshot = collectGitSnapshot(projectRoot);

    const review = createNextCommitmentReviewWorkspace({
      projectRoot,
      runRoot,
      projectSnapshot: snapshot,
    });

    expect(readFileSync(join(review.workspacePath, "README.md"), "utf8")).toContain(
      "Current evidence"
    );
    expect(readFileSync(join(review.workspacePath, "NOTES.md"), "utf8")).toContain(
      "No active work"
    );
    expect(existsSync(join(review.workspacePath, ".git"))).toBe(true);
    expect(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: review.workspacePath,
        encoding: "utf8",
      }).trim()
    ).toBe(realpathSync(review.workspacePath));
    expect(existsSync(join(review.workspacePath, ".steward"))).toBe(false);
    expect(existsSync(join(review.workspacePath, "ignored.txt"))).toBe(false);
    expect(existsSync(join(review.workspacePath, ".env.production"))).toBe(false);
    expect(existsSync(join(review.workspacePath, "linked.txt"))).toBe(false);
    expect(existsSync(join(review.workspacePath, "other-agent-secret.txt"))).toBe(false);
    expect(review.excludedCounts["sensitive-or-local"]).toBe(1);
    expect(review.excludedCounts.symlink).toBe(1);

    const gitState = JSON.parse(readFileSync(review.gitStatePath, "utf8")) as {
      changedPaths: Array<{ path: string; status: string }>;
    };
    expect(gitState.changedPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "README.md", status: "M" }),
        expect.objectContaining({ path: "NOTES.md", status: "??" }),
      ])
    );
  });
});
