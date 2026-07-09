/**
 * Tests for agent CLI process runner: buildAgentCliArgs (ask vs force, resume, --trust, --print, --output-format).
 */
import { describe, it } from "vitest";
import assert from "node:assert";
import { DEFAULT_LLM_MODEL } from "./llm-defaults.js";
import { buildAgentCliArgs } from "./agent-cli-process-runner.js";

describe("buildAgentCliArgs", () => {
  it("includes --print, prompt, --trust, --model, --output-format json, --workspace", () => {
    const { spawnArgs, logArgs } = buildAgentCliArgs({
      prompt: "hello",
      model: DEFAULT_LLM_MODEL,
      workspace: "/tmp/ws",
      executionMode: "ask",
      resumeChatId: undefined,
    });
    assert.strictEqual(spawnArgs[0], "--print");
    assert.strictEqual(spawnArgs[1], "hello");
    assert.ok(spawnArgs.includes("--trust"));
    assert.ok(spawnArgs.includes("--model"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--model") + 1], DEFAULT_LLM_MODEL);
    assert.ok(spawnArgs.includes("--output-format"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--output-format") + 1], "json");
    assert.ok(spawnArgs.includes("--workspace"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--workspace") + 1], "/tmp/ws");
    assert.strictEqual(logArgs[0], "--print");
    assert.strictEqual(logArgs[1], "<redacted>");
    assert.ok(logArgs.includes("--trust"));
  });

  it("adds --mode ask when executionMode is ask", () => {
    const { spawnArgs } = buildAgentCliArgs({
      prompt: "p",
      model: DEFAULT_LLM_MODEL,
      workspace: "/w",
      executionMode: "ask",
      resumeChatId: undefined,
    });
    assert.ok(spawnArgs.includes("--mode"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--mode") + 1], "ask");
    assert.ok(!spawnArgs.includes("--force"));
  });

  it("adds --force and no --mode when executionMode is force", () => {
    const { spawnArgs } = buildAgentCliArgs({
      prompt: "p",
      model: DEFAULT_LLM_MODEL,
      workspace: "/w",
      executionMode: "force",
      resumeChatId: undefined,
    });
    assert.ok(spawnArgs.includes("--force"));
    assert.strictEqual(spawnArgs.indexOf("--mode"), -1);
  });

  it("adds --resume chatId when resumeChatId is set", () => {
    const { spawnArgs } = buildAgentCliArgs({
      prompt: "p",
      model: DEFAULT_LLM_MODEL,
      workspace: "/w",
      executionMode: "ask",
      resumeChatId: "chat-uuid-123",
    });
    assert.ok(spawnArgs.includes("--resume"));
    assert.strictEqual(spawnArgs[spawnArgs.indexOf("--resume") + 1], "chat-uuid-123");
  });

  it("omits --resume when resumeChatId is undefined", () => {
    const { spawnArgs } = buildAgentCliArgs({
      prompt: "p",
      model: DEFAULT_LLM_MODEL,
      workspace: "/w",
      executionMode: "ask",
      resumeChatId: undefined,
    });
    assert.strictEqual(spawnArgs.indexOf("--resume"), -1);
  });
});
