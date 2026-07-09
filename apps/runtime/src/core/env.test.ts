import { describe, it } from "vitest";
import assert from "node:assert";
import { getAppliedEnvDefaults, parseEnv } from "./env.js";

const MINIMAL_ENV: Record<string, string> = {};

describe("parseEnv: boolean env vars are parsed from strings to real booleans with per-flag defaults", () => {
  it("when var is omitted, flag gets its schema default (e.g. default-true stays true, default-false stays false)", () => {
    const env = parseEnv({ ...MINIMAL_ENV });
    assert.strictEqual(env.CTO_REGENERATE_CONFIG_ON_GIT_POLL, true);
    assert.strictEqual(env.CTO_AGENT_IO_LOG_ENABLED, false);
  });

  it("when var is set to 'true' or 'false', result is that boolean and parsing is case-insensitive", () => {
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_AGENT_IO_LOG_ENABLED: "true" }).CTO_AGENT_IO_LOG_ENABLED,
      true
    );
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_AGENT_IO_LOG_ENABLED: "FALSE" }).CTO_AGENT_IO_LOG_ENABLED,
      false
    );
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_AGENT_IO_LOG_ENABLED: "True" }).CTO_AGENT_IO_LOG_ENABLED,
      true
    );
  });

  it("when var is set to something other than true/false (e.g. 0, 1, yes, no, empty), parseEnv throws with Invalid boolean env value", () => {
    for (const invalid of ["0", "1", "yes", "no", ""]) {
      assert.throws(
        () => parseEnv({ ...MINIMAL_ENV, CTO_AGENT_IO_LOG_ENABLED: invalid }),
        /Invalid boolean env value/
      );
    }
  });
});

describe("parseEnv: optional CTO_TARGET_PROJECT_ROOT is trimmed when set", () => {
  it("leading and trailing whitespace is trimmed when set", () => {
    const env = parseEnv({ CTO_TARGET_PROJECT_ROOT: "  /tmp/foo  " });
    assert.strictEqual(env.CTO_TARGET_PROJECT_ROOT, "/tmp/foo");
  });

  it("when the var is missing or empty, result is undefined (launcher provides project root at runtime spawn)", () => {
    assert.strictEqual(parseEnv({}).CTO_TARGET_PROJECT_ROOT, undefined);
    assert.strictEqual(
      parseEnv({ CTO_TARGET_PROJECT_ROOT: "" }).CTO_TARGET_PROJECT_ROOT,
      undefined
    );
  });
});

describe("parseEnv: optional path-with-default vars use a default when unset and the provided path when set", () => {
  it("when var is unset, result is the default path (e.g. ends with .cursor/projects)", () => {
    const env = parseEnv({ ...MINIMAL_ENV });
    assert.ok(env.CTO_CURSOR_PROJECTS_ROOT.endsWith(".cursor/projects"));
  });

  it("when var is set to a path, result is that path (no default)", () => {
    const env = parseEnv({
      ...MINIMAL_ENV,
      CTO_CURSOR_PROJECTS_ROOT: "/custom/cursor/projects",
    });
    assert.strictEqual(env.CTO_CURSOR_PROJECTS_ROOT, "/custom/cursor/projects");
  });
});

describe("parseEnv: optional string env vars are undefined when omitted and trimmed when set", () => {
  it("when var is omitted, result is undefined so callers can treat absence and empty consistently", () => {
    const env = parseEnv({ ...MINIMAL_ENV });
    assert.strictEqual(env.CTO_LOGS_ROOT, undefined);
    assert.strictEqual(env.CTO_DEBUG_ENDPOINT, undefined);
  });

  it("when var is set, leading and trailing whitespace is trimmed so we never store padded strings", () => {
    const env = parseEnv({
      ...MINIMAL_ENV,
      CTO_LOGS_ROOT: "  /tmp/cto-logs  ",
      CTO_DEBUG_ENDPOINT: "  http://127.0.0.1:7710/ingest/session  ",
    });
    assert.strictEqual(env.CTO_LOGS_ROOT, "/tmp/cto-logs");
    assert.strictEqual(env.CTO_DEBUG_ENDPOINT, "http://127.0.0.1:7710/ingest/session");
  });
});

describe("parseEnv: CTO_LLM_PROVIDER is strict provider union with default cursor_cli", () => {
  it("when omitted or empty, defaults to cursor_cli", () => {
    assert.strictEqual(parseEnv({ ...MINIMAL_ENV }).CTO_LLM_PROVIDER, "cursor_cli");
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "" }).CTO_LLM_PROVIDER,
      "cursor_cli"
    );
  });

  it("when set to a supported provider (case-insensitive), parses to that value", () => {
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "cursor_cli" }).CTO_LLM_PROVIDER,
      "cursor_cli"
    );
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "codex_cli" }).CTO_LLM_PROVIDER,
      "codex_cli"
    );
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "claude_code_cli" }).CTO_LLM_PROVIDER,
      "claude_code_cli"
    );
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "antigravity_cli" }).CTO_LLM_PROVIDER,
      "antigravity_cli"
    );
    assert.strictEqual(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "  CODEX_CLI  " }).CTO_LLM_PROVIDER,
      "codex_cli"
    );
  });

  it("when set to invalid value, parseEnv throws with Invalid CTO_LLM_PROVIDER", () => {
    assert.throws(
      () => parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "openai" }),
      /Invalid CTO_LLM_PROVIDER/
    );
    assert.throws(
      () => parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "cursor" }),
      /Invalid CTO_LLM_PROVIDER/
    );
    assert.throws(
      () => parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "unsupported_provider" }),
      /Invalid CTO_LLM_PROVIDER/
    );
  });
});

describe("getAppliedEnvDefaults: reports which env keys were filled from defaults (for observability)", () => {
  it("when a defaultable key is not present in env, it appears in the returned list so we know we applied a default", () => {
    const defaults = getAppliedEnvDefaults({ CTO_TARGET_PROJECT_ROOT: "/tmp/test-project" });
    const keys = new Set(defaults.map((e) => e.key));
    assert.ok(keys.has("CURSOR_POLL_INTERVAL_MS"));
    assert.ok(keys.has("CTO_REGENERATE_CONFIG_ON_GIT_POLL"));
  });

  it("when a defaultable key is explicitly set in env, it does not appear in the list so we do not report it as defaulted", () => {
    const defaults = getAppliedEnvDefaults({
      CTO_TARGET_PROJECT_ROOT: "/tmp/test-project",
      CURSOR_POLL_INTERVAL_MS: "5000",
      CTO_REGENERATE_CONFIG_ON_GIT_POLL: "false",
    });
    const keys = new Set(defaults.map((e) => e.key));
    assert.ok(!keys.has("CURSOR_POLL_INTERVAL_MS"));
    assert.ok(!keys.has("CTO_REGENERATE_CONFIG_ON_GIT_POLL"));
  });

  it("when a key is 'defaulted when empty' (e.g. CTO_CURSOR_PROJECTS_ROOT) and value is only whitespace, it appears in the list as defaulted", () => {
    const defaults = getAppliedEnvDefaults({
      CTO_TARGET_PROJECT_ROOT: "/tmp/test-project",
      CTO_CURSOR_PROJECTS_ROOT: "   ",
    });
    assert.ok(defaults.some((e) => e.key === "CTO_CURSOR_PROJECTS_ROOT"));
  });
});
