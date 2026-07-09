#!/usr/bin/env -S npx tsx
/**
 * Minimal agent CLI contract check: runs only the scenarios the runtime relies on
 * (runtime-style --mode ask + json, create-chat + resume + json). Asserts stdout
 * matches the runtime's envelope schema. Use in CI/verify; can take 2–5 minutes.
 */
import "./load-env.js";
import { spawn } from "child_process";
import { assertJsonEnvelopeContract } from "../src/core/llm/agent-cli-contract-assert.js";
import { loadEnv } from "../src/core/env.js";
import { getProjectRootFromStartupInput } from "../src/core/startup-input.js";

const DEFAULT_MODEL = "auto";
const CONTRACT_TIMEOUT_MS = 90_000;
const COMMON_PROMPT =
  "Probe run from steward. Reply with a short one-line message only. No markdown.";

const env = loadEnv();
const WORKSPACE = getProjectRootFromStartupInput(env);

type IRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  runtimeMs: number;
  stdout: string;
  stderr: string;
};

function runAgent(args: { commandArgs: string[]; timeoutMs: number }): Promise<IRunResult> {
  const start = Date.now();
  return new Promise((resolvePromise) => {
    const proc = spawn("agent", args.commandArgs, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!finished) proc.kill("SIGKILL");
      }, 3000);
    }, args.timeoutMs);
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      resolvePromise({
        code: null,
        signal: null,
        timedOut,
        runtimeMs: Date.now() - start,
        stdout,
        stderr: `${stderr}\nSPAWN_ERROR: ${error.message}`.trim(),
      });
    });
    proc.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      resolvePromise({
        code,
        signal,
        timedOut,
        runtimeMs: Date.now() - start,
        stdout,
        stderr,
      });
    });
  });
}

async function main(): Promise<void> {
  console.log("agent-cli-contract: workspace=", WORKSPACE);
  let failed = false;

  const scenario1Id = "runtime-style-ask-json";
  console.log(`--- ${scenario1Id} ---`);
  const result1 = await runAgent({
    commandArgs: [
      "-p",
      COMMON_PROMPT,
      "--model",
      DEFAULT_MODEL,
      "--output-format",
      "json",
      "--workspace",
      WORKSPACE,
      "--mode",
      "ask",
    ],
    timeoutMs: CONTRACT_TIMEOUT_MS,
  });
  try {
    assertJsonEnvelopeContract(
      scenario1Id,
      {
        code: result1.code,
        timedOut: result1.timedOut,
        stdout: result1.stdout,
        stderr: result1.stderr,
      },
      true
    );
    console.log(`${scenario1Id}: pass (code=${result1.code}, runtimeMs=${result1.runtimeMs})`);
  } catch (err) {
    console.error(`${scenario1Id}:`, err);
    failed = true;
  }

  const scenario2Id = "deterministic-create-chat-resume-json";
  console.log(`--- ${scenario2Id} ---`);
  const createChat = await runAgent({
    commandArgs: ["create-chat"],
    timeoutMs: CONTRACT_TIMEOUT_MS,
  });
  const createOutput = `${createChat.stdout}\n${createChat.stderr}`.trim();
  const chatIdMatch = createOutput.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
  const chatId = chatIdMatch?.[0] ?? "";
  if (!chatId) {
    console.error(
      `${scenario2Id}: create-chat did not return chat id (code=${createChat.code}, timedOut=${createChat.timedOut})`
    );
    failed = true;
  } else {
    const result2 = await runAgent({
      commandArgs: [
        "-p",
        COMMON_PROMPT,
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--resume",
        chatId,
        "--output-format",
        "json",
      ],
      timeoutMs: CONTRACT_TIMEOUT_MS,
    });
    try {
      assertJsonEnvelopeContract(
        scenario2Id,
        {
          code: result2.code,
          timedOut: result2.timedOut,
          stdout: result2.stdout,
          stderr: result2.stderr,
        },
        true
      );
      console.log(`${scenario2Id}: pass (code=${result2.code}, runtimeMs=${result2.runtimeMs})`);
    } catch (err) {
      console.error(`${scenario2Id}:`, err);
      failed = true;
    }
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("agent-cli-contract failed:", err);
  process.exit(1);
});
