/**
 * Spawns `codex exec --json`, wires stdio, applies hard and idle timeouts, and returns
 * raw execution output. Queue orchestration and JSONL parsing live in run-agent-cli-process.
 */
import { spawn as nodeSpawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { isAbsolute, join, relative } from "path";
import {
  CHATGPT_BUNDLED_CODEX_PATH,
  selectCodexCliCommand,
} from "@steward/contracts/runtime-defaults";
import { AppError } from "../app-error.js";
import { loadEnv } from "../env.js";
import { ERR_AGENT_CLI_CONTRACT } from "../error-codes.js";
import {
  AGENT_FAILED_SPAWN,
  AGENT_TERMINATED,
  AGENT_TIMEOUT_HARD,
  AGENT_TIMEOUT_IDLE,
} from "../runtime-log-events.js";
import { getRuntimeLogger, logError, type ILogErrorExtra } from "../logger.js";
import type {
  IAgentCliResult,
  IAgentProcessConfig,
  IRawAgentCliRunReason,
  IRawAgentCliRunResult,
} from "./agent-cli-result.types.js";
import type {
  IAgentExecutionMode,
  IAgentRunnerRequestContext,
} from "./agent-cli-process-runner.js";
import type { IJsonSchema } from "./json-schema.types.js";
import type { IReadOnlyMcpServer } from "./llm-provider.types.js";
import { buildCodexStructuredOutputSchema } from "./codex-structured-output.js";

const CODEX_CLI_PROBE_TIMEOUT_MS = 10_000;
const validatedCodexCliCommands = new Set<string>();
const PROJECT_REVIEW_PERMISSION_PROFILE = "steward-project-review";

export type ICodexStructuredSecurityMode = "standard" | "project-isolated";

const PROJECT_REVIEW_FILESYSTEM_PERMISSION = '{":root"="deny"}';

const PROJECT_ISOLATED_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "TERM",
  "COLORTERM",
  "CODEX_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT_ID",
  "OPENAI_API_VERSION",
  "CODEX_API_KEY",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

type ICodexCliProbeResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  errorMessage: string | undefined;
};

function compactProbeOutput(value: string): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 500)}...`;
}

function throwCodexCliContractError(args: {
  command: string;
  reason: "version_check_failed" | "help_check_failed" | "unsupported_command_surface";
  version: ICodexCliProbeResult;
  rootHelp: ICodexCliProbeResult;
  execHelp: ICodexCliProbeResult;
  missingCapabilities: string[];
}): never {
  const diagnostic = [
    args.version.errorMessage,
    args.version.stderr,
    args.rootHelp.errorMessage,
    args.rootHelp.stderr,
    args.execHelp.errorMessage,
    args.execHelp.stderr,
  ]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" | ");
  throw new AppError(
    "Codex CLI is unavailable or incompatible with Steward's non-interactive contract.",
    ERR_AGENT_CLI_CONTRACT,
    {
      command: args.command,
      reason: args.reason,
      versionStatus: args.version.status,
      rootHelpStatus: args.rootHelp.status,
      execHelpStatus: args.execHelp.status,
      version: compactProbeOutput(args.version.stdout),
      diagnostic: compactProbeOutput(diagnostic),
      missingCapabilities: args.missingCapabilities,
      nextAction:
        "Install or update Codex, or set CTO_CODEX_CLI_PATH to a compatible executable; then run pnpm agent:contract.",
    }
  );
}

export function assertCodexCliCompatibility(args: {
  command: string;
  securityMode: ICodexStructuredSecurityMode;
  version: ICodexCliProbeResult;
  rootHelp: ICodexCliProbeResult;
  execHelp: ICodexCliProbeResult;
}): void {
  if (args.version.status !== 0) {
    throwCodexCliContractError({
      ...args,
      reason: "version_check_failed",
      missingCapabilities: [],
    });
  }
  if (args.rootHelp.status !== 0 || args.execHelp.status !== 0) {
    throwCodexCliContractError({
      ...args,
      reason: "help_check_failed",
      missingCapabilities: [],
    });
  }

  const missingCapabilities: string[] = [];
  if (!args.rootHelp.stdout.includes("--ask-for-approval")) {
    missingCapabilities.push("--ask-for-approval");
  }
  if (!args.execHelp.stdout.includes("--json")) missingCapabilities.push("--json");
  if (args.securityMode === "standard") {
    if (!args.rootHelp.stdout.includes("--sandbox")) missingCapabilities.unshift("--sandbox");
    if (!args.execHelp.stdout.includes("resume")) missingCapabilities.push("exec resume");
  } else {
    if (!args.rootHelp.stdout.includes("--config")) missingCapabilities.unshift("--config");
    if (!args.rootHelp.stdout.includes("--disable")) missingCapabilities.push("--disable");
    if (!args.rootHelp.stdout.includes("--strict-config")) {
      missingCapabilities.push("--strict-config");
    }
    if (!args.execHelp.stdout.includes("--ephemeral")) missingCapabilities.push("--ephemeral");
    if (!args.execHelp.stdout.includes("--ignore-user-config")) {
      missingCapabilities.push("--ignore-user-config");
    }
    if (!args.execHelp.stdout.includes("--ignore-rules")) {
      missingCapabilities.push("--ignore-rules");
    }
    if (!args.execHelp.stdout.includes("--skip-git-repo-check")) {
      missingCapabilities.push("--skip-git-repo-check");
    }
  }
  if (!args.execHelp.stdout.includes("--output-schema")) {
    missingCapabilities.push("--output-schema");
  }
  if (missingCapabilities.length > 0) {
    throwCodexCliContractError({
      ...args,
      reason: "unsupported_command_surface",
      missingCapabilities,
    });
  }
}

function probeCodexCli(command: string, commandArgs: string[]): ICodexCliProbeResult {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    shell: false,
    timeout: CODEX_CLI_PROBE_TIMEOUT_MS,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    errorMessage: result.error?.message,
  };
}

export function getValidatedCodexCliCommand(securityMode: ICodexStructuredSecurityMode): string {
  const configuredPath = loadEnv().CTO_CODEX_CLI_PATH;
  const command = selectCodexCliCommand({
    configuredPath,
    platform: process.platform,
    bundledCodexExists: existsSync(CHATGPT_BUNDLED_CODEX_PATH),
  });
  const validationKey = `${securityMode}:${command}`;
  if (validatedCodexCliCommands.has(validationKey)) return command;

  assertCodexCliCompatibility({
    command,
    securityMode,
    version: probeCodexCli(command, ["--version"]),
    rootHelp: probeCodexCli(command, ["--help"]),
    execHelp: probeCodexCli(command, ["exec", "--help"]),
  });
  validatedCodexCliCommands.add(validationKey);
  return command;
}

export type IBuildCodexCliArgsInput = {
  prompt: string;
  model: string;
  workspace: string;
  executionMode: IAgentExecutionMode;
  resumeSessionId: string | undefined;
  outputSchemaPath: string | undefined;
  securityMode: ICodexStructuredSecurityMode;
  readOnlyMcpServer?: IReadOnlyMcpServer;
};

function buildReadOnlyMcpServerArgs(server: IReadOnlyMcpServer | undefined): string[] {
  if (server === undefined) return [];
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(server.name)) {
    throw new AppError("Read-only MCP server name is invalid.", ERR_AGENT_CLI_CONTRACT, {
      reason: "invalid_read_only_mcp_server_name",
    });
  }
  if (!isAbsolute(server.command) || !isAbsolute(server.cwd)) {
    throw new AppError("Read-only MCP server paths must be absolute.", ERR_AGENT_CLI_CONTRACT, {
      reason: "invalid_read_only_mcp_server_path",
    });
  }
  const configPath = server.args[1];
  if (
    server.command !== process.execPath ||
    server.args.length !== 2 ||
    server.args.some((value) => value.length === 0 || value.includes("\0") || !isAbsolute(value)) ||
    configPath === undefined ||
    relative(server.cwd, configPath).startsWith("..") ||
    isAbsolute(relative(server.cwd, configPath)) ||
    server.enabledTools.length === 0 ||
    new Set(server.enabledTools).size !== server.enabledTools.length ||
    server.enabledTools.some((value) => !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value))
  ) {
    throw new AppError("Read-only MCP server allowlist is invalid.", ERR_AGENT_CLI_CONTRACT, {
      reason: "invalid_read_only_mcp_server_allowlist",
    });
  }
  const prefix = `mcp_servers.${server.name}`;
  return [
    "-c",
    `${prefix}.command=${JSON.stringify(server.command)}`,
    "-c",
    `${prefix}.args=${JSON.stringify(server.args)}`,
    "-c",
    `${prefix}.cwd=${JSON.stringify(server.cwd)}`,
    "-c",
    `${prefix}.enabled_tools=${JSON.stringify(server.enabledTools)}`,
    "-c",
    `${prefix}.default_tools_approval_mode="approve"`,
    "-c",
    `${prefix}.startup_timeout_sec=30`,
    "-c",
    `${prefix}.tool_timeout_sec=15`,
    "-c",
    `${prefix}.required=true`,
  ];
}

function buildProjectIsolatedSecurityArgs(
  readOnlyMcpServer: IReadOnlyMcpServer | undefined
): string[] {
  return [
    "--strict-config",
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    `default_permissions="${PROJECT_REVIEW_PERMISSION_PROFILE}"`,
    "-c",
    `permissions.${PROJECT_REVIEW_PERMISSION_PROFILE}.filesystem=${PROJECT_REVIEW_FILESYSTEM_PERMISSION}`,
    "-c",
    `permissions.${PROJECT_REVIEW_PERMISSION_PROFILE}.network.enabled=false`,
    "-c",
    'shell_environment_policy.inherit="core"',
    "-c",
    'shell_environment_policy.exclude=["CODEX_HOME","OPENAI_API_KEY","CODEX_API_KEY","CODEX_ACCESS_TOKEN"]',
    "-c",
    "allow_login_shell=false",
    "-c",
    "tools.web_search=false",
    "--disable",
    "memories",
    "--disable",
    "plugins",
    "--disable",
    "apps",
    "--disable",
    "multi_agent",
    "--disable",
    "hooks",
    "--disable",
    "shell_snapshot",
    "--disable",
    "shell_tool",
    "--disable",
    "unified_exec",
    "--disable",
    "exec_permission_approvals",
    "--disable",
    "request_permissions_tool",
    "--disable",
    "collaboration_modes",
    "--disable",
    "skill_search",
    "--disable",
    "skill_mcp_dependency_install",
    "--disable",
    "plugin_sharing",
    "--disable",
    "remote_plugin",
    "--disable",
    "goals",
    "--disable",
    "workspace_dependencies",
    "--disable",
    "tool_suggest",
    "--disable",
    "browser_use",
    "--disable",
    "browser_use_external",
    "--disable",
    "browser_use_full_cdp_access",
    "--disable",
    "computer_use",
    "--disable",
    "image_generation",
    "--disable",
    "in_app_browser",
    "--disable",
    "chronicle",
    "-c",
    "skills.include_instructions=false",
    "-c",
    "include_apps_instructions=false",
    "-c",
    "include_collaboration_mode_instructions=false",
    ...buildReadOnlyMcpServerArgs(readOnlyMcpServer),
  ];
}

export function buildProjectIsolatedCodexSpawnEnv(args: {
  sourceEnv: NodeJS.ProcessEnv;
  agentTmpDir: string | undefined;
  isolatedCodexHome: string;
}): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = {};
  for (const key of PROJECT_ISOLATED_ENV_KEYS) {
    const value = args.sourceEnv[key];
    if (value !== undefined) spawnEnv[key] = value;
  }
  for (const [key, value] of Object.entries(args.sourceEnv)) {
    if (key.startsWith("LC_") && value !== undefined) spawnEnv[key] = value;
  }
  const agentTmpDir = args.agentTmpDir ?? args.sourceEnv.CTO_AGENT_TMP_DIR;
  if (agentTmpDir !== undefined) {
    spawnEnv.CTO_AGENT_TMP_DIR = agentTmpDir;
    spawnEnv.TMPDIR = agentTmpDir;
    spawnEnv.TMP = agentTmpDir;
    spawnEnv.TEMP = agentTmpDir;
  }
  spawnEnv.CODEX_HOME = args.isolatedCodexHome;
  return spawnEnv;
}

export function buildCodexCliArgs(input: IBuildCodexCliArgsInput): {
  spawnArgs: string[];
  logArgs: string[];
} {
  const {
    prompt,
    model,
    workspace,
    executionMode,
    resumeSessionId,
    outputSchemaPath,
    securityMode,
    readOnlyMcpServer,
  } = input;
  if (securityMode === "standard" && readOnlyMcpServer !== undefined) {
    throw new AppError(
      "Read-only MCP server is limited to project-isolated structured review.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "read_only_mcp_standard_mode_not_allowed" }
    );
  }
  if (securityMode === "project-isolated" && resumeSessionId !== undefined) {
    throw new AppError(
      "Project-isolated Codex review cannot resume a persisted session.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "project_isolated_resume_not_allowed" }
    );
  }
  if (securityMode === "project-isolated" && executionMode !== "ask") {
    throw new AppError(
      "Project-isolated Codex review must use read-only ask execution.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "project_isolated_mutation_not_allowed" }
    );
  }
  if (
    securityMode === "project-isolated" &&
    readOnlyMcpServer !== undefined &&
    readOnlyMcpServer.cwd !== workspace
  ) {
    throw new AppError(
      "Project-isolated MCP server must use the review workspace.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "read_only_mcp_workspace_mismatch" }
    );
  }
  const sandbox = executionMode === "ask" ? "read-only" : "workspace-write";
  const modelArgs = model === "auto" ? [] : ["--model", model];
  const securityArgs =
    securityMode === "standard"
      ? ["--sandbox", sandbox]
      : buildProjectIsolatedSecurityArgs(readOnlyMcpServer);
  const isolatedExecArgs =
    securityMode === "project-isolated"
      ? ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"]
      : [];
  const baseArgs = [
    "--cd",
    workspace,
    ...modelArgs,
    ...securityArgs,
    "--ask-for-approval",
    "never",
    "exec",
    ...isolatedExecArgs,
    "--json",
    ...(outputSchemaPath === undefined ? [] : ["--output-schema", outputSchemaPath]),
  ];
  const promptArgs = resumeSessionId !== undefined ? ["resume", resumeSessionId, prompt] : [prompt];
  const logPromptArgs =
    resumeSessionId !== undefined ? ["resume", resumeSessionId, "<redacted>"] : ["<redacted>"];
  return {
    spawnArgs: [...baseArgs, ...promptArgs],
    logArgs: [...baseArgs, ...logPromptArgs],
  };
}

function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

type ISpawnFailurePayload = {
  requestId: string | undefined;
  agentId: string | undefined;
  categoryId: string | undefined;
  itemId: string | undefined;
  workspace: string;
  model: string;
  cmd: string;
  args: string[];
};

type IExecutionRefs = {
  resolved: boolean;
  hardTimeoutId: ReturnType<typeof setTimeout> | null;
  idleWatchdogId: ReturnType<typeof setTimeout> | null;
  killGraceId: ReturnType<typeof setTimeout> | null;
};

type IExecutionCtx = {
  proc: ChildProcess;
  resolve: (r: IRawAgentCliRunResult | IAgentCliResult) => void;
  refs: IExecutionRefs;
  streams: { rawStdout: string; rawStderr: string };
  startTime: number;
  lastActivityAt: number;
  forceReason: IRawAgentCliRunReason | null;
  requestId: string | undefined;
  requestContext: IAgentRunnerRequestContext | undefined;
  workspace: string;
  model: string;
  timeoutMs: number;
  watchdogIdleMs: number;
  killGraceMs: number;
  getAbortResult: () => IAgentCliResult;
};

function resolveCtx(ctx: IExecutionCtx, result: IRawAgentCliRunResult | IAgentCliResult): void {
  if (ctx.refs.resolved) return;
  ctx.refs.resolved = true;
  if (ctx.refs.hardTimeoutId) clearTimeout(ctx.refs.hardTimeoutId);
  if (ctx.refs.idleWatchdogId) clearTimeout(ctx.refs.idleWatchdogId);
  if (ctx.refs.killGraceId) clearTimeout(ctx.refs.killGraceId);
  ctx.proc.removeAllListeners();
  ctx.resolve(result);
}

function refreshIdleWatchdog(ctx: IExecutionCtx): void {
  ctx.lastActivityAt = Date.now();
  if (ctx.refs.idleWatchdogId) clearTimeout(ctx.refs.idleWatchdogId);
  ctx.refs.idleWatchdogId = setTimeout(() => onIdleTimeout(ctx), ctx.watchdogIdleMs);
}

function onIdleTimeout(ctx: IExecutionCtx): void {
  if (ctx.refs.resolved) return;
  ctx.forceReason = "idle_timeout";
  const log = getRuntimeLogger();
  const runtimeMs = Date.now() - ctx.startTime;
  const idleMs = Date.now() - ctx.lastActivityAt;
  log.info({
    event: AGENT_TIMEOUT_IDLE,
    requestId: ctx.requestId,
    agentId: ctx.requestContext?.agentId,
    categoryId: ctx.requestContext?.categoryId,
    itemId: ctx.requestContext?.itemId,
    pid: ctx.proc.pid,
    runtimeMs,
    idleMs,
    reason: "idle_timeout",
    timeoutMs: ctx.timeoutMs,
    watchdogIdleMs: ctx.watchdogIdleMs,
    killGraceMs: ctx.killGraceMs,
    stdoutPreview: truncate(ctx.streams.rawStdout),
    stderrPreview: truncate(ctx.streams.rawStderr),
  });
  ctx.proc.kill("SIGTERM");
  ctx.refs.killGraceId = setTimeout(() => {
    if (!ctx.refs.resolved) {
      ctx.proc.kill("SIGKILL");
      resolveCtx(ctx, {
        rawStdout: ctx.streams.rawStdout,
        rawStderr: ctx.streams.rawStderr,
        code: null,
        signal: null,
        reason: "idle_timeout",
        runtimeMs,
        idleMs,
      });
    }
  }, ctx.killGraceMs);
}

function onHardTimeout(ctx: IExecutionCtx): void {
  if (ctx.refs.resolved) return;
  ctx.forceReason = "timeout";
  const log = getRuntimeLogger();
  const runtimeMs = Date.now() - ctx.startTime;
  log.info({
    event: AGENT_TIMEOUT_HARD,
    requestId: ctx.requestId,
    agentId: ctx.requestContext?.agentId,
    categoryId: ctx.requestContext?.categoryId,
    itemId: ctx.requestContext?.itemId,
    pid: ctx.proc.pid,
    runtimeMs,
    reason: "timeout",
    timeoutMs: ctx.timeoutMs,
    watchdogIdleMs: ctx.watchdogIdleMs,
    killGraceMs: ctx.killGraceMs,
    stdoutPreview: truncate(ctx.streams.rawStdout),
    stderrPreview: truncate(ctx.streams.rawStderr),
  });
  ctx.proc.kill("SIGTERM");
  ctx.refs.killGraceId = setTimeout(() => {
    if (!ctx.refs.resolved) {
      ctx.proc.kill("SIGKILL");
      resolveCtx(ctx, {
        rawStdout: ctx.streams.rawStdout,
        rawStderr: ctx.streams.rawStderr,
        code: null,
        signal: null,
        reason: "timeout",
        runtimeMs,
      });
    }
  }, ctx.killGraceMs);
}

function onClose(code: number | null, signal: NodeJS.Signals | null, ctx: IExecutionCtx): void {
  if (ctx.refs.resolved) return;
  const runtimeMs = Date.now() - ctx.startTime;
  const reason: IRawAgentCliRunReason = ctx.forceReason ?? (signal ? "killed" : "exit");

  if (reason === "killed" || ctx.forceReason) {
    const log = getRuntimeLogger();
    log.info({
      event: AGENT_TERMINATED,
      requestId: ctx.requestId,
      agentId: ctx.requestContext?.agentId,
      categoryId: ctx.requestContext?.categoryId,
      itemId: ctx.requestContext?.itemId,
      pid: ctx.proc.pid,
      code,
      signal,
      reason,
      runtimeMs,
      timeoutMs: ctx.timeoutMs,
      watchdogIdleMs: ctx.watchdogIdleMs,
      killGraceMs: ctx.killGraceMs,
      stdoutPreview: truncate(ctx.streams.rawStdout),
      stderrPreview: truncate(ctx.streams.rawStderr),
    });
  }

  resolveCtx(ctx, {
    rawStdout: ctx.streams.rawStdout,
    rawStderr: ctx.streams.rawStderr,
    code,
    signal,
    reason,
    runtimeMs,
  });
}

export type IExecuteCodexCliProcessInput = {
  prompt: string;
  model: string;
  workspace: string;
  config: IAgentProcessConfig;
  resumeSessionId: string | undefined;
  executionMode: IAgentExecutionMode;
  outputJsonSchema: IJsonSchema | undefined;
  securityMode: ICodexStructuredSecurityMode;
  readOnlyMcpServer?: IReadOnlyMcpServer;
  agentTmpDir?: string;
  isolatedCodexHome?: string;
  requestId?: string;
  requestContext?: IAgentRunnerRequestContext;
  onAbortReady: (abort: () => void) => void;
  getAbortResult: () => IAgentCliResult;
};

function writeCodexOutputSchema(args: {
  outputJsonSchema: IJsonSchema | undefined;
  agentTmpDir: string | undefined;
}): string | undefined {
  if (args.outputJsonSchema === undefined) return undefined;
  if (args.agentTmpDir === undefined) {
    throw new AppError(
      "Codex structured output requires a run-scoped temporary directory.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "missing_agent_tmp_dir" }
    );
  }
  const schemaPath = join(args.agentTmpDir, "output.schema.json");
  try {
    const codexSchema = buildCodexStructuredOutputSchema(args.outputJsonSchema);
    writeFileSync(schemaPath, `${JSON.stringify(codexSchema, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new AppError(
      "Codex structured output schema could not be written.",
      ERR_AGENT_CLI_CONTRACT,
      { schemaPath },
      { cause: error }
    );
  }
  return schemaPath;
}

export function executeCodexCliProcess(
  input: IExecuteCodexCliProcessInput
): Promise<IRawAgentCliRunResult | IAgentCliResult> {
  const {
    prompt,
    model,
    workspace,
    config,
    resumeSessionId,
    executionMode,
    outputJsonSchema,
    securityMode,
    readOnlyMcpServer,
    agentTmpDir,
    isolatedCodexHome,
    requestId,
    requestContext,
    onAbortReady,
    getAbortResult,
  } = input;
  const { timeoutMs, watchdogIdleMs, killGraceMs } = config;
  const codexCliCommand = getValidatedCodexCliCommand(securityMode);
  if (securityMode === "project-isolated" && isolatedCodexHome === undefined) {
    throw new AppError(
      "Project-isolated Codex review requires an isolated Codex home.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "missing_isolated_codex_home" }
    );
  }
  if (securityMode === "project-isolated" && agentTmpDir === undefined) {
    throw new AppError(
      "Project-isolated Codex review requires a run-scoped temporary directory.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "missing_project_isolated_agent_tmp_dir" }
    );
  }
  const outputSchemaPath = writeCodexOutputSchema({ outputJsonSchema, agentTmpDir });
  const { spawnArgs, logArgs } = buildCodexCliArgs({
    prompt,
    model,
    workspace,
    executionMode,
    resumeSessionId,
    outputSchemaPath,
    securityMode,
    readOnlyMcpServer,
  });
  const spawnPayload: ISpawnFailurePayload = {
    requestId,
    agentId: requestContext?.agentId,
    categoryId: requestContext?.categoryId,
    itemId: requestContext?.itemId,
    workspace,
    model,
    cmd: codexCliCommand,
    args: logArgs,
  };

  return new Promise((resolve) => {
    const startTime = Date.now();
    const refs: IExecutionRefs = {
      resolved: false,
      hardTimeoutId: null,
      idleWatchdogId: null,
      killGraceId: null,
    };
    const streams = { rawStdout: "", rawStderr: "" };
    let proc: ChildProcess;

    try {
      const spawnEnv =
        securityMode === "project-isolated"
          ? buildProjectIsolatedCodexSpawnEnv({
              sourceEnv: process.env,
              agentTmpDir,
              isolatedCodexHome: isolatedCodexHome ?? "",
            })
          : agentTmpDir
            ? { ...process.env, CTO_AGENT_TMP_DIR: agentTmpDir }
            : undefined;
      proc = nodeSpawn(codexCliCommand, spawnArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        cwd: workspace,
        env: spawnEnv,
      });
    } catch (error) {
      const extra: ILogErrorExtra = {
        event: AGENT_FAILED_SPAWN,
        component: "core",
        operation: "spawn",
        ...spawnPayload,
      };
      if (isErrnoException(error)) {
        extra.code = error.code;
        extra.errno = error.errno;
        extra.syscall = error.syscall;
        extra.path = error.path;
      }
      logError(error, extra);
      resolve({
        rawStdout: "",
        rawStderr: "",
        code: null,
        signal: null,
        reason: "spawn_error",
      });
      return;
    }

    const ctx: IExecutionCtx = {
      proc,
      resolve,
      refs,
      streams,
      startTime,
      lastActivityAt: startTime,
      forceReason: null,
      requestId,
      requestContext,
      workspace,
      model,
      timeoutMs,
      watchdogIdleMs,
      killGraceMs,
      getAbortResult,
    };

    onAbortReady(() => {
      if (ctx.refs.resolved) return;
      try {
        proc.kill("SIGTERM");
      } catch {
        // Process may already be dead.
      }
      resolveCtx(ctx, getAbortResult());
    });

    refs.hardTimeoutId = setTimeout(() => onHardTimeout(ctx), timeoutMs);
    refs.idleWatchdogId = setTimeout(() => onIdleTimeout(ctx), watchdogIdleMs);

    proc.stdout?.on("data", (d) => {
      streams.rawStdout += d.toString();
      refreshIdleWatchdog(ctx);
    });
    proc.stderr?.on("data", (d) => {
      streams.rawStderr += d.toString();
      refreshIdleWatchdog(ctx);
    });

    proc.on("error", (err) => {
      if (refs.resolved) return;
      const extra: ILogErrorExtra = {
        event: AGENT_FAILED_SPAWN,
        component: "core",
        operation: "spawn",
        ...spawnPayload,
      };
      if (isErrnoException(err)) {
        extra.code = err.code;
        extra.errno = err.errno;
        extra.syscall = err.syscall;
        extra.path = err.path;
      }
      logError(err, extra);
      resolveCtx(ctx, {
        rawStdout: streams.rawStdout,
        rawStderr: streams.rawStderr,
        code: null,
        signal: null,
        reason: "spawn_error",
      });
    });

    proc.on("close", (code, signal) => onClose(code, signal, ctx));
  });
}
