import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { mkdirSync } from "fs";
import { join } from "path";
import { generateExclude } from "./generate-repo-scope-config.js";
import { createTempRootHelper } from "../../core/test-helpers.js";

const { createTempProjectRoot, cleanup } = createTempRootHelper("generate-exclude");
afterEach(cleanup);

describe("generateExclude", () => {
  it("returns unique normalized exclude list from runner", async () => {
    const projectRoot = createTempProjectRoot();
    mkdirSync(join(projectRoot, "docs"), { recursive: true });

    const result = await generateExclude({
      projectRoot,
      deps: {
        runExcludeAgentFn: async (): Promise<string[]> => ["logs", " logs ", "node_modules"],
      },
    });

    assert.deepStrictEqual(result.exclude, ["logs", "node_modules"]);
  });

  it("throws when required excludes are missing for present directories", async () => {
    const projectRoot = createTempProjectRoot();
    mkdirSync(join(projectRoot, "node_modules"), { recursive: true });

    await assert.rejects(
      () =>
        generateExclude({
          projectRoot,
          deps: {
            runExcludeAgentFn: async (): Promise<string[]> => ["logs"],
          },
        }),
      /Generated exclude missing required entries.*node_modules/i
    );
  });

  it("runner receives summary-derived input", async () => {
    const projectRoot = createTempProjectRoot();
    mkdirSync(join(projectRoot, "docs"), { recursive: true });

    let seenInput: unknown = null;
    await generateExclude({
      projectRoot,
      deps: {
        runExcludeAgentFn: async (input): Promise<string[]> => {
          seenInput = input;
          return ["logs", "node_modules"];
        },
      },
    });

    assert.ok(seenInput);
    const input = seenInput as Record<string, unknown>;
    assert.ok(Array.isArray(input.topLevelDirectories));
    assert.ok(Array.isArray(input.topLevelFiles));
    assert.strictEqual(typeof input.projectRootName, "string");
  });
});
