#!/usr/bin/env -S npx tsx
/**
 * Codex CLI contract check: validates the executable and proves the exact new-run and resume
 * command shapes are accepted without making a model request. Provider-backed proof lives in
 * codex-documentation-refresh-probe.ts.
 */
import "./load-env.js";
import { spawnSync } from "child_process";
import { AppError } from "../src/core/app-error.js";
import { ERR_AGENT_CLI_CONTRACT } from "../src/core/error-codes.js";
import {
  buildCodexCliArgs,
  getValidatedCodexCliCommand,
} from "../src/core/llm/codex-cli-process-runner.js";
import { DEFAULT_LLM_MODEL } from "../src/core/llm/llm-defaults.js";

function assertHelpCommand(args: { command: string; commandArgs: string[]; label: string }): void {
  const result = spawnSync(args.command, args.commandArgs, {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  if (result.status === 0) return;
  throw new AppError(
    "Installed Codex CLI rejected Steward's command contract.",
    ERR_AGENT_CLI_CONTRACT,
    {
      command: args.command,
      args: args.commandArgs,
      label: args.label,
      status: result.status,
      reason: result.error?.message ?? result.stderr.trim(),
      nextAction:
        "Set CTO_CODEX_CLI_PATH to a compatible Codex executable and rerun pnpm agent:contract.",
    }
  );
}

function buildHelpArgs(args: { resumeSessionId: string | undefined }): string[] {
  const { spawnArgs } = buildCodexCliArgs({
    prompt: "contract-probe",
    model: DEFAULT_LLM_MODEL,
    workspace: process.cwd(),
    executionMode: "ask",
    resumeSessionId: args.resumeSessionId,
    outputSchemaPath: undefined,
    securityMode: "standard",
  });
  return [...spawnArgs.slice(0, -1), "--help"];
}

function main(): void {
  const command = getValidatedCodexCliCommand("standard");
  assertHelpCommand({
    command,
    commandArgs: buildHelpArgs({ resumeSessionId: undefined }),
    label: "new read-only exec",
  });
  assertHelpCommand({
    command,
    commandArgs: buildHelpArgs({ resumeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53" }),
    label: "read-only exec resume",
  });
  console.log(`codex-cli-contract: pass (${command})`);
}

try {
  main();
} catch (error) {
  console.error("codex-cli-contract: failed", error);
  process.exitCode = 1;
}
