/**
 * Runtime startup contract: exits with code 1 when project root is not provided.
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { spawn } from "child_process";
import { join } from "path";
import { existsSync } from "fs";

const RUNTIME_MAIN = join(process.cwd(), "dist", "src", "main.js");

describe("runtime startup contract", () => {
  it("exits with code 1 when project root is not provided", async () => {
    if (!existsSync(RUNTIME_MAIN)) {
      console.warn("skip: runtime not built (run pnpm --filter @steward/runtime build)");
      return;
    }
    const env = { ...process.env };
    delete env.CTO_TARGET_PROJECT_ROOT;
    const child = spawn("node", [RUNTIME_MAIN, "--runtime"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on("exit", (c) => resolve(c));
    });
    assert.strictEqual(code, 1, "expected exit code 1 when project root missing");
  });
});
