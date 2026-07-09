#!/usr/bin/env -S npx tsx
/**
 * Single agent CLI probe: main scenarios (workspace, plan, resume, tool-use) + sandbox/format matrix.
 * Sandbox phase uses a temp workspace and writes report artifacts to scripts/logs/agent-cli-sandbox-reports.
 */
import "../load-env.js";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { z } from "zod";
import { assertJsonEnvelopeContract } from "../../src/core/llm/agent-cli-contract-assert.js";
import { loadEnv } from "../../src/core/env.js";
import { getProjectRootFromStartupInput } from "../../src/core/startup-input.js";

type IScenario = {
  id: string;
  description: string;
  commandArgs?: string[];
  prepare?: () => Promise<{
    commandArgs: string[];
    notes?: string[];
    prepFailed?: boolean;
  }>;
  timeoutMs?: number;
};

type IFileMeta = {
  path: string;
  mtimeMs: number;
  size: number;
};

type IRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  runtimeMs: number;
  stdout: string;
  stderr: string;
};

type ITranscriptStats = {
  totalMessages: number;
  assistantMessages: number;
  lastAssistantText: string;
};

type ISandboxScenario = {
  id: string;
  sandbox?: "enabled" | "disabled";
  outputFormat?: "text" | "json" | "stream-json";
  trustForce?: boolean;
  timeoutMs: number;
};

type ISandboxResult = {
  id: string;
  code: number | null;
  timedOut: boolean;
  runtimeMs: number;
  stdoutLen: number;
  stderrLen: number;
  stdoutPreview: string;
  stderrPreview: string;
};

const SANDBOX_PROMPT = "Reply with exactly one word: OK";
const SANDBOX_TIMEOUT_MS = 45_000;

/** Sandbox scenario IDs that may exit 1 in some environments (e.g. text-only without trust/force). */
const SANDBOX_ALLOW_NONZERO_IDS = new Set<string>([
  "sandbox-enabled-text",
  "sandbox-disabled-text",
]);

const DEFAULT_MODEL = "auto";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CURSOR_PROJECTS_ROOT = join(homedir(), ".cursor", "projects");
const env = loadEnv();
const WORKSPACE = getProjectRootFromStartupInput(env);
const CURSOR_PROJECTS_ROOT = resolve(env.CTO_CURSOR_PROJECTS_ROOT ?? DEFAULT_CURSOR_PROJECTS_ROOT);
const COMMON_PROMPT = [
  "Probe run from steward.",
  "Reply with a short one-line message only.",
  "No markdown.",
].join(" ");

/** Approximate length of generate-detection-questions prompts (~10k). Used to reproduce runtime CLI failures. */
const LONG_PROMPT_TARGET_CHARS = 10_000;
function buildLongPrompt(): string {
  const ruleBlock = `
Rule for category "dead-code":
---
Remove unreachable, unused, or stale code paths quickly; remove unused exports, symbols, and orphan modules.
Do not preserve legacy branches when no caller uses them; remove compatibility branches retained after migrations.
Remove obsolete exports, files, scripts, and queue item shapes.
---
`.trim();
  const projectContextBlock = `
Project context (use to ground questions in real paths and patterns):
---
apps/runtime/src and packages/ are the main source roots.
AGENTS.md describes workflow and invariants.
---
`.trim();
  const prefix = `You are preparing a codebase scan. Your job is to generate 3–5 concrete search questions that a software engineer would need to answer to find violations of the rule below.

${projectContextBlock}

${ruleBlock}

Generate exactly 3–5 questions. Each question must:
- Be answerable by inspecting the codebase (no speculation about future features).
- Target structural or systemic issues the rule cares about (e.g. coupling, duplication, naming, error handling).
- Use concrete language (files, modules, boundaries) when project context provides it.

Output ONLY a JSON object. No markdown, no code blocks, no preamble.
Example: {"questions":["Where does core import from features?","Are there barrel index files re-exporting feature modules?"]}`;
  const padding =
    " Add more context so the prompt is long enough to match runtime prompts. ".repeat(
      Math.ceil((LONG_PROMPT_TARGET_CHARS - prefix.length) / 60)
    );
  return prefix + padding;
}

/** Scenario ids that expect a single JSON envelope on stdout. Contract assertions apply. */
const JSON_ENVELOPE_SCENARIO_IDS = new Set([
  "runtime-style-ask-json",
  "runtime-style-ask-json-resume",
  "deterministic-create-chat-resume-json",
  "plan-p-output-json-trust-force",
]);
/** Runtime-style scenarios: allow empty stdout (resilience path). */
const RUNTIME_STYLE_ALLOW_EMPTY_STDOUT_IDS = new Set([
  "runtime-style-ask-json",
  "runtime-style-ask-json-resume",
]);

const TranscriptLineSchema = z
  .object({
    role: z.string(),
    message: z
      .object({
        content: z
          .array(
            z
              .object({
                type: z.string(),
                text: z.string().optional(),
              })
              .passthrough()
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

function cursorProjectDirFromRoot(projectRoot: string): string {
  const abs = resolve(projectRoot);
  return abs.replace(/^\/+/, "").replace(/\//g, "-");
}

function collectTranscriptFiles(transcriptsDir: string): IFileMeta[] {
  if (!existsSync(transcriptsDir)) return [];

  const out: IFileMeta[] = [];
  for (const entry of readdirSync(transcriptsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const fullPath = join(transcriptsDir, entry.name);
      const st = statSync(fullPath);
      out.push({ path: fullPath, mtimeMs: st.mtimeMs, size: st.size });
      continue;
    }
    if (!entry.isDirectory()) continue;
    const nested = join(transcriptsDir, entry.name, `${entry.name}.jsonl`);
    if (!existsSync(nested)) continue;
    const st = statSync(nested);
    out.push({ path: nested, mtimeMs: st.mtimeMs, size: st.size });
  }
  return out;
}

function toMap(files: IFileMeta[]): Map<string, IFileMeta> {
  return new Map(files.map((f) => [f.path, f]));
}

function textFromLine(line: string): { role: string; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  try {
    const parsed = TranscriptLineSchema.parse(raw);
    const content = parsed.message?.content ?? [];
    const text = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) return null;
    return { role: parsed.role, text };
  } catch {
    return null;
  }
}

function previewTranscript(path: string): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = lines
    .map(textFromLine)
    .filter((v): v is { role: string; text: string } => v !== null);
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const out: string[] = [];
  if (first) out.push(`first: [${first.role}] ${first.text.slice(0, 180)}`);
  if (last && last !== first) out.push(`last: [${last.role}] ${last.text.slice(0, 180)}`);
  out.push(`messages: ${parsed.length}`);
  return out;
}

function transcriptStats(path: string): ITranscriptStats {
  if (!existsSync(path)) {
    return { totalMessages: 0, assistantMessages: 0, lastAssistantText: "" };
  }
  const parsed = readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(textFromLine)
    .filter((v): v is { role: string; text: string } => v !== null);
  const assistantOnly = parsed.filter((item) => item.role === "assistant");
  return {
    totalMessages: parsed.length,
    assistantMessages: assistantOnly.length,
    lastAssistantText:
      assistantOnly.length > 0 ? assistantOnly[assistantOnly.length - 1]!.text.slice(0, 200) : "",
  };
}

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

async function prepareDeterministicResumeScenario(): Promise<{
  commandArgs: string[];
  notes: string[];
  prepFailed?: boolean;
}> {
  const createChat = await runAgent({
    commandArgs: ["create-chat"],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });

  const createOutput = `${createChat.stdout}\n${createChat.stderr}`.trim();
  const chatIdMatch = createOutput.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
  const chatId = chatIdMatch?.[0] ?? "";
  if (!chatId) {
    return {
      commandArgs: ["-p", COMMON_PROMPT, "--model", DEFAULT_MODEL, "--output-format", "json"],
      notes: [
        `create-chat failed to return chat id (code=${createChat.code}, timedOut=${createChat.timedOut})`,
        `create-chat stdout preview: ${JSON.stringify(createChat.stdout.slice(0, 200) || "(empty)")}`,
        `create-chat stderr preview: ${JSON.stringify(createChat.stderr.slice(0, 200) || "(empty)")}`,
      ],
      prepFailed: true,
    };
  }

  return {
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
    notes: [`create-chat chatId: ${chatId}`],
  };
}

async function prepareRuntimeStyleResumeScenario(): Promise<{
  commandArgs: string[];
  notes: string[];
  prepFailed?: boolean;
}> {
  const createChat = await runAgent({
    commandArgs: ["create-chat"],
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  const createOutput = `${createChat.stdout}\n${createChat.stderr}`.trim();
  const chatIdMatch = createOutput.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
  const chatId = chatIdMatch?.[0] ?? "";
  if (!chatId) {
    return {
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
      notes: [
        `create-chat failed to return chat id (code=${createChat.code}, timedOut=${createChat.timedOut})`,
        `create-chat stdout preview: ${JSON.stringify(createChat.stdout.slice(0, 200) || "(empty)")}`,
        `create-chat stderr preview: ${JSON.stringify(createChat.stderr.slice(0, 200) || "(empty)")}`,
      ],
      prepFailed: true,
    };
  }
  return {
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
      "--resume",
      chatId,
    ],
    notes: [`create-chat chatId: ${chatId}`],
  };
}

function buildScenarios(): IScenario[] {
  return [
    {
      id: "positional-basic",
      description: "agent <prompt> --model --workspace",
      commandArgs: [COMMON_PROMPT, "--model", DEFAULT_MODEL, "--workspace", WORKSPACE],
    },
    {
      id: "positional-output-text",
      description: "agent <prompt> --model --workspace --output-format text",
      commandArgs: [
        COMMON_PROMPT,
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
      ],
    },
    {
      id: "positional-write-delete",
      description:
        "agent <prompt> --model --workspace --output-format text (write/read/delete file, often blocked without trust/force)",
      commandArgs: [
        "Use shell commands to create the directory .steward/tmp/runs/agent-cli-probe and then create .steward/tmp/runs/agent-cli-probe/agent-cli-probe-positional.tmp with text OK, read it, then delete it. Return one-line summary only.",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
      ],
      timeoutMs: 120_000,
    },
    {
      id: "positional-write-delete-trust-force",
      description:
        "agent <prompt> --model --workspace --output-format text --trust --force (write/read/delete file)",
      commandArgs: [
        "Use shell commands to create the directory .steward/tmp/runs/agent-cli-probe and then create .steward/tmp/runs/agent-cli-probe/agent-cli-probe-positional.tmp with text OK, read it, then delete it. Return one-line summary only.",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
        "--trust",
        "--force",
      ],
      timeoutMs: 120_000,
    },
    {
      id: "flag-p-output-text",
      description: "agent -p <prompt> --model --workspace --output-format text",
      commandArgs: [
        "-p",
        COMMON_PROMPT,
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
      ],
    },
    {
      id: "runtime-style-ask-json",
      description:
        "agent -p <prompt> --model auto --output-format json --workspace <path> --mode ask (runtime codepath)",
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
      timeoutMs: 90_000,
    },
    {
      id: "runtime-style-ask-json-resume",
      description:
        "agent create-chat then -p <prompt> --mode ask --output-format json --resume <chatId> (runtime resume path)",
      prepare: prepareRuntimeStyleResumeScenario,
      timeoutMs: 90_000,
    },
    {
      id: "runtime-style-long-prompt-ask-json-resume",
      description:
        "agent create-chat then -p <long prompt> --mode ask --output-format json --resume (reproduces generate-detection-questions CLI failure)",
      prepare: async (): Promise<{
        commandArgs: string[];
        notes?: string[];
        prepFailed?: boolean;
      }> => {
        const createChat = await runAgent({
          commandArgs: ["create-chat"],
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        const createOutput = `${createChat.stdout}\n${createChat.stderr}`.trim();
        const chatIdMatch = createOutput.match(
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
        );
        const chatId = chatIdMatch?.[0] ?? "";
        if (!chatId) {
          return {
            commandArgs: [
              "-p",
              buildLongPrompt(),
              "--model",
              DEFAULT_MODEL,
              "--output-format",
              "json",
              "--workspace",
              WORKSPACE,
              "--mode",
              "ask",
            ],
            notes: [
              `create-chat failed (code=${createChat.code}) stdout: ${JSON.stringify(createChat.stdout.slice(0, 200))} stderr: ${JSON.stringify(createChat.stderr.slice(0, 200))}`,
            ],
            prepFailed: true,
          };
        }
        const longPrompt = buildLongPrompt();
        return {
          commandArgs: [
            "-p",
            longPrompt,
            "--model",
            DEFAULT_MODEL,
            "--output-format",
            "json",
            "--workspace",
            WORKSPACE,
            "--mode",
            "ask",
            "--resume",
            chatId,
          ],
          notes: [`create-chat chatId: ${chatId}`, `prompt length: ${longPrompt.length} chars`],
        };
      },
      timeoutMs: 120_000,
    },
    {
      id: "plan-p-output-text-trust-force",
      description:
        "agent -p <prompt> --plan --output-format text --trust --force (plan formatting probe)",
      commandArgs: [
        "-p",
        "Create a short 3-step plan to rename variable foo to bar in a TypeScript file. Return concise plan only.",
        "--plan",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
        "--trust",
        "--force",
      ],
      timeoutMs: 120_000,
    },
    {
      id: "plan-p-output-json-trust-force",
      description:
        "agent -p <prompt> --plan --output-format json --trust --force (plan formatting probe)",
      commandArgs: [
        "-p",
        "Create a short 3-step plan to rename variable foo to bar in a TypeScript file. Return concise plan only.",
        "--plan",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "json",
        "--trust",
        "--force",
      ],
      timeoutMs: 120_000,
    },
    {
      id: "plan-p-output-stream-json-trust-force",
      description:
        "agent -p <prompt> --plan --output-format stream-json --trust --force (plan formatting probe)",
      commandArgs: [
        "-p",
        "Create a short 3-step plan to rename variable foo to bar in a TypeScript file. Return concise plan only.",
        "--plan",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--trust",
        "--force",
      ],
      timeoutMs: 120_000,
    },
    {
      id: "deterministic-create-chat-resume-json",
      description:
        "agent create-chat -> agent -p <prompt> --resume <chatId> --workspace --output-format json",
      prepare: prepareDeterministicResumeScenario,
    },
    {
      id: "tool-shell-pwd",
      description: "agent -p tool-use prompt to run pwd",
      commandArgs: [
        "-p",
        "Run exactly one shell command: pwd. Then return one line with that path.",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
      ],
      timeoutMs: 120_000,
    },
    {
      id: "tool-shell-write-delete",
      description: "agent -p tool-use prompt to write/read/delete temp file",
      commandArgs: [
        "-p",
        "Use shell commands to create the directory .steward/tmp/runs/agent-cli-probe and then create .steward/tmp/runs/agent-cli-probe/agent-cli-probe.tmp with text OK, read it, then delete it. Return one-line summary only.",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
      ],
      timeoutMs: 120_000,
    },
    {
      id: "tool-shell-pwd-trust-force",
      description: "agent -p tool-use prompt to run pwd with --trust --force",
      commandArgs: [
        "-p",
        "Run exactly one shell command: pwd. Then return one line with that path.",
        "--model",
        DEFAULT_MODEL,
        "--workspace",
        WORKSPACE,
        "--output-format",
        "text",
        "--trust",
        "--force",
      ],
      timeoutMs: 120_000,
    },
  ];
}

function buildSandboxScenarios(): ISandboxScenario[] {
  const base: Pick<ISandboxScenario, "timeoutMs"> = { timeoutMs: SANDBOX_TIMEOUT_MS };
  const scenarios: ISandboxScenario[] = [];
  for (const format of ["text", "json", "stream-json"] as const) {
    scenarios.push({
      ...base,
      id: `sandbox-enabled-${format}`,
      sandbox: "enabled",
      outputFormat: format,
    });
    scenarios.push({
      ...base,
      id: `sandbox-disabled-${format}`,
      sandbox: "disabled",
      outputFormat: format,
    });
    scenarios.push({
      ...base,
      id: `sandbox-enabled-${format}-trust-force`,
      sandbox: "enabled",
      outputFormat: format,
      trustForce: true,
    });
    scenarios.push({
      ...base,
      id: `sandbox-disabled-${format}-trust-force`,
      sandbox: "disabled",
      outputFormat: format,
      trustForce: true,
    });
  }
  return scenarios;
}

function sandboxScenarioToCommandArgs(workspace: string, scenario: ISandboxScenario): string[] {
  const cmdArgs: string[] = ["--print", "--output-format", scenario.outputFormat ?? "text"];
  if (scenario.sandbox) {
    cmdArgs.push("--sandbox", scenario.sandbox);
  }
  cmdArgs.push("--workspace", workspace);
  if (scenario.trustForce) {
    cmdArgs.push("--trust", "--force");
  }
  cmdArgs.push(SANDBOX_PROMPT);
  return cmdArgs;
}

function runResultToSandboxResult(scenario: ISandboxScenario, result: IRunResult): ISandboxResult {
  return {
    id: scenario.id,
    code: result.code,
    timedOut: result.timedOut,
    runtimeMs: result.runtimeMs,
    stdoutLen: result.stdout.length,
    stderrLen: result.stderr.length,
    stdoutPreview: result.stdout.slice(0, 200).replace(/\n/g, " "),
    stderrPreview: result.stderr.slice(0, 200).replace(/\n/g, " "),
  };
}

async function runSandboxPhase(workspace: string): Promise<ISandboxResult[]> {
  const scenarios = buildSandboxScenarios();
  const results: ISandboxResult[] = [];

  for (const scenario of scenarios) {
    const commandArgs = sandboxScenarioToCommandArgs(workspace, scenario);
    const result = await runAgent({
      commandArgs,
      timeoutMs: scenario.timeoutMs,
    });
    let code = result.code;
    if (scenario.outputFormat === "json") {
      try {
        assertJsonEnvelopeContract(
          scenario.id,
          {
            code: result.code,
            timedOut: result.timedOut,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          false
        );
      } catch {
        code = 1;
      }
    }
    results.push(runResultToSandboxResult(scenario, { ...result, code }));
    await new Promise((r) => setTimeout(r, 500));
  }

  return results;
}

function writeSandboxReports(args: { results: ISandboxResult[]; workspaceUsed: string }): {
  jsonPath: string;
  mdPath: string;
} {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const reportDir = join(scriptDir, "logs", "agent-cli-sandbox-reports");
  mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(reportDir, `sandbox-probe-${ts}.json`);
  const mdPath = join(reportDir, `sandbox-probe-${ts}.md`);

  const report = {
    timestamp: new Date().toISOString(),
    workspaceUsed: args.workspaceUsed,
    scenarios: args.results,
    summary: {
      total: args.results.length,
      passed: args.results.filter((r) => r.code === 0 && !r.timedOut).length,
      failed: args.results.filter((r) => r.code !== 0 || r.timedOut).length,
    },
  };

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  const mdLines: string[] = [
    "# Agent CLI Sandbox Probe Report",
    "",
    `Generated: ${report.timestamp}`,
    "",
    "## Summary",
    "",
    `- Total: ${report.summary.total}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    "",
    "## Results",
    "",
    "| ID | Code | TimedOut | RuntimeMs | StdoutLen |",
    "|----|------|----------|----------|-----------|",
  ];
  for (const r of args.results) {
    mdLines.push(
      `| ${r.id} | ${r.code ?? "null"} | ${r.timedOut} | ${r.runtimeMs} | ${r.stdoutLen} |`
    );
  }
  mdLines.push("");
  mdLines.push("## Stdout/Stderr Previews");
  mdLines.push("");
  for (const r of args.results) {
    mdLines.push(`### ${r.id}`);
    mdLines.push(`- stdout: \`${r.stdoutPreview}\``);
    mdLines.push(`- stderr: \`${r.stderrPreview}\``);
    mdLines.push("");
  }
  writeFileSync(mdPath, mdLines.join("\n"), "utf-8");
  return { jsonPath, mdPath };
}

async function main(): Promise<void> {
  const scenarios = buildScenarios();
  const projectDir = cursorProjectDirFromRoot(WORKSPACE);
  const transcriptsDir = join(CURSOR_PROJECTS_ROOT, projectDir, "agent-transcripts");

  console.log("=== agent-cli-probe batch start ===");
  console.log("workspace:", WORKSPACE);
  console.log("model:", DEFAULT_MODEL);
  console.log("cursorProjectsRoot:", CURSOR_PROJECTS_ROOT);
  console.log("transcriptsDir:", transcriptsDir);
  console.log("scenarioCount:", scenarios.length);
  console.log();

  const summaries: Array<{
    id: string;
    code: number | null;
    timedOut: boolean;
    runtimeMs: number;
    transcriptCount: number;
  }> = [];

  for (const scenario of scenarios) {
    const before = collectTranscriptFiles(transcriptsDir);
    const beforeMap = toMap(before);
    const startedAt = Date.now();
    const timeoutMs = scenario.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    console.log(`--- scenario: ${scenario.id} ---`);
    console.log("description:", scenario.description);
    console.log("timeoutMs:", timeoutMs);
    const prepared = scenario.prepare
      ? await scenario.prepare()
      : { commandArgs: scenario.commandArgs ?? [] };
    if (prepared.notes && prepared.notes.length > 0) {
      for (const note of prepared.notes) {
        console.log("prep:", note);
      }
    }
    console.log("command:", JSON.stringify(["agent", ...prepared.commandArgs]));

    const result = await runAgent({
      commandArgs: prepared.commandArgs,
      timeoutMs,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 800));

    const after = collectTranscriptFiles(transcriptsDir);
    const createdOrTouched = after
      .filter((file) => {
        const prev = beforeMap.get(file.path);
        if (!prev) return true;
        return file.mtimeMs > prev.mtimeMs || file.size !== prev.size;
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    const createdSinceStart = after
      .filter((file) => !beforeMap.has(file.path) && file.mtimeMs >= startedAt - 1_000)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    const reportFiles = createdSinceStart.length > 0 ? createdSinceStart : createdOrTouched;

    console.log(
      "result:",
      JSON.stringify({
        code: result.code,
        signal: result.signal,
        timedOut: result.timedOut,
        runtimeMs: result.runtimeMs,
        stdoutChars: result.stdout.length,
        stderrChars: result.stderr.length,
      })
    );
    console.log("stdoutPreview:", JSON.stringify(result.stdout.slice(0, 400) || "(empty)"));
    console.log("stderrPreview:", JSON.stringify(result.stderr.slice(0, 400) || "(empty)"));
    console.log("transcriptsDetected:", reportFiles.length);
    let totalAssistantMessages = 0;
    let transcriptsWithAssistantText = 0;
    for (const file of reportFiles) {
      const relPath = file.path.startsWith(CURSOR_PROJECTS_ROOT)
        ? file.path.slice(CURSOR_PROJECTS_ROOT.length + 1)
        : file.path;
      console.log(`  - ${relPath}`);
      const preview = previewTranscript(file.path);
      for (const line of preview) {
        console.log(`    ${line}`);
      }
      const stats = transcriptStats(file.path);
      totalAssistantMessages += stats.assistantMessages;
      if (stats.lastAssistantText.trim().length > 0) {
        transcriptsWithAssistantText += 1;
      }
      if (stats.assistantMessages > 0) {
        console.log(`    assistantMessages: ${stats.assistantMessages}`);
        console.log(
          `    assistantLastPreview: ${JSON.stringify(stats.lastAssistantText || "(empty)")}`
        );
      }
    }
    if (result.stdout.trim().length === 0 && totalAssistantMessages > 0) {
      console.log(
        "warning: transcript has assistant output but CLI stdout is empty (possible stdout/print mismatch)"
      );
    }
    if (result.timedOut && transcriptsWithAssistantText > 0) {
      console.log(
        "warning: process timed out despite assistant transcript reply (possible agent process exit issue)"
      );
    }
    let contractFailed = false;
    if (JSON_ENVELOPE_SCENARIO_IDS.has(scenario.id) && !prepared.prepFailed) {
      try {
        assertJsonEnvelopeContract(
          scenario.id,
          {
            code: result.code,
            timedOut: result.timedOut,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          RUNTIME_STYLE_ALLOW_EMPTY_STDOUT_IDS.has(scenario.id)
        );
      } catch (err) {
        console.error("contract assertion failed:", err);
        contractFailed = true;
      }
    }
    console.log();

    summaries.push({
      id: scenario.id,
      code: contractFailed || prepared.prepFailed ? 1 : (result.code ?? 1),
      timedOut: prepared.prepFailed ? false : result.timedOut,
      runtimeMs: result.runtimeMs,
      transcriptCount: reportFiles.length,
    });
  }

  console.log("=== batch summary ===");
  for (const summary of summaries) {
    console.log(
      `${summary.id}: code=${summary.code} timedOut=${summary.timedOut} runtimeMs=${summary.runtimeMs} transcripts=${summary.transcriptCount}`
    );
  }

  const mainPhaseFailed = summaries.some((s) => s.code !== 0 || s.timedOut);

  console.log("\n=== agent-cli:sandbox-probe phase ===");
  const sandboxWorkspace = mkdtempSync(join(tmpdir(), "cto-agent-sandbox-probe-"));
  mkdirSync(join(sandboxWorkspace, ".steward"), { recursive: true });
  writeFileSync(join(sandboxWorkspace, "README.md"), "# Sandbox probe temp workspace\n", "utf-8");
  const sandboxCleanup = (): void => {
    rmSync(sandboxWorkspace, { recursive: true, force: true });
  };
  process.on("SIGINT", sandboxCleanup);
  process.on("SIGTERM", sandboxCleanup);

  const sandboxResults = await runSandboxPhase(sandboxWorkspace);
  for (const r of sandboxResults) {
    console.log(
      `${r.id}: code=${r.code} timedOut=${r.timedOut} runtimeMs=${r.runtimeMs} stdoutLen=${r.stdoutLen}`
    );
  }
  sandboxCleanup();

  const { jsonPath, mdPath } = writeSandboxReports({
    results: sandboxResults,
    workspaceUsed: sandboxWorkspace,
  });
  console.log("sandbox report json:", jsonPath);
  console.log("sandbox report md:", mdPath);

  const sandboxPhaseFailed = sandboxResults.some(
    (r) => (r.code !== 0 || r.timedOut) && !SANDBOX_ALLOW_NONZERO_IDS.has(r.id)
  );
  const hasFailure = mainPhaseFailed || sandboxPhaseFailed;
  process.exit(hasFailure ? 1 : 0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("agent-cli-probe failed:", message);
  process.exit(1);
});
