/**
 * Tests for LLM provider factory: env-based selection and singleton get/set.
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert";
import { loadEnv, parseEnv } from "../env.js";
import { AppError } from "../app-error.js";
import { ERR_LLM_PROVIDER } from "../error-codes.js";
import { createLlmProvider, setLlmProvider, getLlmProvider } from "./llm-provider-factory.js";

const MINIMAL_ENV = { CTO_TARGET_PROJECT_ROOT: "/tmp/test-project" };

vi.mock("../env.js", async () => {
  const actual = await vi.importActual<typeof import("../env.js")>("../env.js");
  return { ...actual, loadEnv: vi.fn() };
});

describe("createLlmProvider: returns provider for supported automated CLI providers", () => {
  it("when CTO_LLM_PROVIDER is cursor_cli, returns provider with runStructured, runMutation, createConversationId", () => {
    vi.mocked(loadEnv).mockReturnValue(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "cursor_cli" })
    );
    const provider = createLlmProvider();
    assert.strictEqual(typeof provider.runStructured, "function");
    assert.strictEqual(typeof provider.runMutation, "function");
    assert.strictEqual(typeof provider.createConversationId, "function");
  });

  it("when CTO_LLM_PROVIDER is codex_cli, returns provider with runStructured, runMutation, createConversationId", () => {
    vi.mocked(loadEnv).mockReturnValue(parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "codex_cli" }));
    const provider = createLlmProvider();
    assert.strictEqual(typeof provider.runStructured, "function");
    assert.strictEqual(typeof provider.runMutation, "function");
    assert.strictEqual(typeof provider.createConversationId, "function");
  });

  it("when CTO_LLM_PROVIDER is claude_code_cli, returns provider with runStructured, runMutation, createConversationId", () => {
    vi.mocked(loadEnv).mockReturnValue(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "claude_code_cli" })
    );
    const provider = createLlmProvider();
    assert.strictEqual(typeof provider.runStructured, "function");
    assert.strictEqual(typeof provider.runMutation, "function");
    assert.strictEqual(typeof provider.createConversationId, "function");
  });
});

describe("createLlmProvider: rejects providers without automated CLI support", () => {
  it("when CTO_LLM_PROVIDER is antigravity_cli, throws a clear unsupported-provider error", () => {
    vi.mocked(loadEnv).mockReturnValue(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "antigravity_cli" })
    );

    assert.throws(
      () => createLlmProvider(),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERR_LLM_PROVIDER &&
        error.context.provider === "antigravity_cli"
    );
  });
});

describe("setLlmProvider and getLlmProvider: singleton round-trip", () => {
  it("after setLlmProvider(provider), getLlmProvider() returns the same instance", () => {
    vi.mocked(loadEnv).mockReturnValue(
      parseEnv({ ...MINIMAL_ENV, CTO_LLM_PROVIDER: "cursor_cli" })
    );
    const provider = createLlmProvider();
    setLlmProvider(provider);
    const got = getLlmProvider();
    assert.strictEqual(got, provider);
  });
});
