#!/usr/bin/env -S npx tsx
/**
 * Runs a single agent CLI invocation that mimics the runtime's generate-detection-questions
 * (long prompt + create-chat + resume + --mode ask --output-format json). Use to reproduce
 * "Agent CLI returned empty JSON output" / code 1 with full stderr visible.
 */
import "../load-env.js";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { loadEnv } from "../../src/core/env.js";
import { getProjectRootFromStartupInput } from "../../src/core/startup-input.js";
import {
  getAgentRunTmpDir,
  ensureAgentRunTmpDir,
  removeAgentRunTmpDir,
} from "../../src/core/agent-tmp-dir.js";
import { prependQualityFirstInstruction } from "../../src/core/llm/quality-first-prompt.js";

const env = loadEnv();
const WORKSPACE = getProjectRootFromStartupInput(env);
const LONG_PROMPT_TARGET_CHARS = 10_000;

function buildLongPrompt(): string {
  const ruleBlock = `
Rule for category "dead-code":
---
Remove unreachable, unused, or stale code paths quickly; remove unused exports, symbols, and orphan modules.
Do not preserve legacy branches when no caller uses them; remove compatibility branches retained after migrations.
---
`.trim();
  const prefix = `You are preparing a codebase scan. Generate 3–5 concrete search questions for the rule below.

Project context: apps/runtime/src and packages/ are the main source roots.

${ruleBlock}

Output ONLY a JSON object. Example: {"questions":["Where does core import from features?"]}`;
  const padding = " (padding to match runtime prompt length) ".repeat(
    Math.ceil((LONG_PROMPT_TARGET_CHARS - prefix.length) / 40)
  );
  return prefix + padding;
}

function runAgent(
  commandArgs: string[],
  timeoutMs: number,
  spawnEnv?: Record<string, string>
): Promise<{ code: number | null; stdout: string; stderr: string; runtimeMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn("agent", commandArgs, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: WORKSPACE,
      env: spawnEnv ? { ...process.env, ...spawnEnv } : undefined,
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 3000);
    }, timeoutMs);
    proc.stdout?.on("data", (c) => (stdout += c.toString()));
    proc.stderr?.on("data", (c) => (stderr += c.toString()));
    proc.on("close", (code) => {
      clearTimeout(t);
      resolve({
        code: code ?? null,
        stdout,
        stderr,
        runtimeMs: Date.now() - start,
      });
    });
    proc.on("error", (err) => {
      clearTimeout(t);
      resolve({
        code: null,
        stdout,
        stderr: stderr + "\nSPAWN_ERROR: " + err.message,
        runtimeMs: Date.now() - start,
      });
    });
  });
}

async function main(): Promise<void> {
  const requestId = randomUUID();
  const agentTmpDir = getAgentRunTmpDir(WORKSPACE, requestId);
  ensureAgentRunTmpDir(WORKSPACE, requestId);
  const useRuntimeEnv = process.argv.includes("--runtime-env");
  const spawnEnv = useRuntimeEnv ? { CTO_AGENT_TMP_DIR: agentTmpDir } : undefined;
  if (useRuntimeEnv) console.log("Using runtime-like env (CTO_AGENT_TMP_DIR)");

  console.log("create-chat...");
  const createResult = await runAgent(["create-chat"], 15_000, spawnEnv);
  const chatIdMatch = (createResult.stdout + "\n" + createResult.stderr).match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
  const chatId = chatIdMatch?.[0] ?? "";
  if (!chatId) {
    console.error("create-chat failed:", createResult);
    removeAgentRunTmpDir(agentTmpDir);
    process.exit(1);
  }
  console.log("chatId:", chatId);
  console.log("CTO_AGENT_TMP_DIR:", agentTmpDir);

  const longPrompt = buildLongPrompt();
  const useQualityFirst = process.argv.includes("--quality-first");
  const shortPrompt = "Reply with exactly: OK";
  const basePrompt = process.argv.includes("--short-prompt") ? shortPrompt : longPrompt;
  const promptWithInstruction =
    useRuntimeEnv && useQualityFirst
      ? prependQualityFirstInstruction(basePrompt, agentTmpDir)
      : basePrompt;
  if (useRuntimeEnv && useQualityFirst)
    console.log("Prepending quality-first instruction (runtime-style prompt)");
  if (process.argv.includes("--short-prompt")) console.log("Using short prompt (length test)");
  const args = [
    "-p",
    promptWithInstruction,
    "--model",
    "auto",
    "--output-format",
    "json",
    "--workspace",
    WORKSPACE,
    "--mode",
    "ask",
    "--resume",
    chatId,
  ];
  console.log("Running agent with prompt length:", promptWithInstruction.length, "chars");
  const result = await runAgent(args, 120_000, spawnEnv);
  removeAgentRunTmpDir(agentTmpDir);

  console.log("code:", result.code);
  console.log("runtimeMs:", result.runtimeMs);
  console.log("stdout length:", result.stdout.length);
  console.log("stderr length:", result.stderr.length);
  if (result.stdout.length > 0) console.log("stdout preview:", result.stdout.slice(0, 500));
  if (result.stderr.length > 0) console.log("stderr full:", result.stderr);
  process.exit(result.code === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
