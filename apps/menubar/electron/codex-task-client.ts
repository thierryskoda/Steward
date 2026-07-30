/**
 * Owns bounded local Codex app-server processes for real Desktop-visible tasks.
 * Each submission uses a fresh permission profile with no filesystem access, creates
 * a persisted project-associated thread, names it, and submits exactly one initial turn.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { z } from "zod";
import { CodexTaskSubmissionSchema, type ICodexTaskSubmission } from "@steward/contracts/schemas";
import {
  CodexAppServerEmptyResultSchema,
  CodexAppServerConfigReadResultSchema,
  CodexAppServerGetAuthStatusResultSchema,
  CodexAppServerErrorResponseSchema,
  CodexAppServerErrorParamsSchema,
  CodexAppServerInitializeResultSchema,
  CodexAppServerMcpStatusListResultSchema,
  CodexAppServerMessageSchema,
  CodexAppServerThreadReadResultSchema,
  CodexAppServerThreadSearchResultSchema,
  CodexAppServerThreadStartResultSchema,
  CodexAppServerTurnCompletedParamsSchema,
  CodexAppServerTurnStartResultSchema,
  CodexAppServerUserMessageItemSchema,
  CodexAppServerFinalAgentMessageItemSchema,
  CodexMcpServerInventorySchema,
} from "./codex-task-client.schemas.js";
import { formatErrorForLog, writeHostLog } from "./logs-service.js";

const CLIENT_NAME = "steward";
const CLIENT_TITLE = "Steward";
const PERMISSION_PROFILE_PREFIX = "steward-review";
const CHATGPT_API_BASE_URL = "https://chatgpt.com/backend-api/";
const CLOSE_GRACE_MS = 10_000;
const FORCE_KILL_GRACE_MS = 1_000;
const MAX_PROTOCOL_LINE_LENGTH = 25_000_000;
const RECONCILIATION_PAGE_SIZE = 25;
const MAX_CONFIGURED_MCP_SERVERS = 100;
const MAX_RECONCILIATION_THREADS = 100;
const DISABLED_FEATURES = [
  "apps",
  "plugins",
  "memories",
  "multi_agent",
  "hooks",
  "shell_snapshot",
  "exec_permission_approvals",
  "request_permissions_tool",
  "collaboration_modes",
  "skill_search",
  "skill_mcp_dependency_install",
  "plugin_sharing",
  "remote_plugin",
  "connectors",
  "enable_mcp_apps",
  "auth_elicitation",
  "tool_call_mcp_elicitation",
  "standalone_web_search",
  "web_search_cached",
  "web_search_request",
  "goals",
  "workspace_dependencies",
  "tool_suggest",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "image_generation",
  "in_app_browser",
  "chronicle",
  "shell_tool",
  "unified_exec",
] as const;

type IPendingRequest = {
  method: string;
  acceptResult: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ITurnCompletion = z.infer<typeof CodexAppServerTurnCompletedParamsSchema>;
type IThreadSearchResult = z.infer<typeof CodexAppServerThreadSearchResultSchema>;

type ITrackedTurn = {
  threadId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type IClientProcess = {
  process: ChildProcessWithoutNullStreams;
  reader: Interface;
  pending: Map<number, IPendingRequest>;
  trackedTurns: Map<string, ITrackedTurn>;
  completedTurns: Map<string, ITurnCompletion>;
  activeTurnPromises: Set<Promise<void>>;
  stderr: string;
  closing: boolean;
  detached: boolean;
  shutdownPromise: Promise<void> | null;
};

export type ICodexTaskRequest = {
  submissionId: string;
  cwd: string;
  title: string;
  prompt: string;
};

export type ICodexTaskClient = {
  submitTask: (request: ICodexTaskRequest) => Promise<ICodexTaskSubmission>;
  close: () => Promise<void>;
};

type ICodexMcpServerInventoryItem = z.infer<typeof CodexMcpServerInventorySchema>[number];

function buildMcpServerDisableOverride(inventory: readonly ICodexMcpServerInventoryItem[]): string {
  const entries = inventory.map((server) => {
    const safeTransport =
      server.transport.type === "stdio" ? 'command="/usr/bin/false"' : 'url="http://127.0.0.1:9"';
    return `${JSON.stringify(server.name)}={${safeTransport},enabled=false}`;
  });
  return `mcp_servers={${entries.join(",")}}`;
}

export function buildCodexTaskAppServerArgs(
  mcpInventory: readonly ICodexMcpServerInventoryItem[],
  projectRoot: string,
  permissionProfileId: string,
  logDir: string
): string[] {
  const filesystemPermissions = '{":root"="deny"}';
  const args = [
    "app-server",
    "--strict-config",
    "--stdio",
    "-c",
    "tools.web_search=false",
    "-c",
    'web_search="disabled"',
    "-c",
    "notify=[]",
    "-c",
    `projects={${JSON.stringify(projectRoot)}={trust_level="untrusted"}}`,
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    "project_doc_fallback_filenames=[]",
    "-c",
    "analytics.enabled=false",
    "-c",
    "feedback.enabled=false",
    "-c",
    "check_for_update_on_startup=false",
    "-c",
    `log_dir=${JSON.stringify(logDir)}`,
    "-c",
    'otel.exporter="none"',
    "-c",
    'otel.metrics_exporter="none"',
    "-c",
    'otel.trace_exporter="none"',
    "-c",
    "otel.log_user_prompt=false",
    "-c",
    'shell_environment_policy.inherit="core"',
    "-c",
    'shell_environment_policy.exclude=["CODEX_HOME","OPENAI_API_KEY","CODEX_API_KEY","CODEX_ACCESS_TOKEN","HTTP_PROXY","HTTPS_PROXY","NO_PROXY","ALL_PROXY"]',
    "-c",
    "allow_login_shell=false",
    "-c",
    "include_apps_instructions=false",
    "-c",
    "include_collaboration_mode_instructions=false",
    "-c",
    "skills.include_instructions=false",
    "-c",
    "agents.max_concurrent_threads_per_session=1",
    "-c",
    "agents.max_depth=0",
    "-c",
    `default_permissions=${JSON.stringify(permissionProfileId)}`,
    "-c",
    `permissions.${permissionProfileId}.filesystem=${filesystemPermissions}`,
    "-c",
    `permissions.${permissionProfileId}.network.enabled=false`,
    "-c",
    "orchestrator.mcp.enabled=false",
    "-c",
    "orchestrator.skills.enabled=false",
    "-c",
    "apps._default.enabled=false",
    "-c",
    buildMcpServerDisableOverride(mcpInventory),
  ];
  for (const feature of DISABLED_FEATURES) args.push("--disable", feature);
  return args;
}

function comparablePath(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "message"}: ${issue.message}`)
    .join("; ");
}

function validateTaskRequest(request: ICodexTaskRequest): void {
  if (!isAbsolute(request.cwd) || request.cwd.includes("\0")) {
    throw new Error("Creating a Codex task requires a safe absolute project path.");
  }
  if (request.title.trim().length === 0 || request.title.length > 120) {
    throw new Error("Creating a Codex task requires a title between 1 and 120 characters.");
  }
  if (request.prompt.trim().length === 0) {
    throw new Error("Creating a Codex task requires a non-empty prompt.");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      request.submissionId
    )
  ) {
    throw new Error("Creating a Codex task requires a valid submission ID.");
  }
}

const CODEX_PROCESS_ENV_KEYS = [
  "HOME",
  "PATH",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
] as const;

export function buildCodexTaskProcessEnv(codexHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CODEX_HOME: codexHome };
  for (const key of CODEX_PROCESS_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function extractMcpInventory(
  result: z.infer<typeof CodexAppServerConfigReadResultSchema>
): ICodexMcpServerInventoryItem[] {
  const inventory = Object.entries(result.config.mcp_servers ?? {}).map(([name, config]) => {
    if (config.command != null && config.url == null) {
      return { name, enabled: config.enabled ?? true, transport: { type: "stdio" as const } };
    }
    if (config.url != null && config.command == null) {
      return {
        name,
        enabled: config.enabled ?? true,
        transport: { type: "streamable_http" as const },
      };
    }
    throw new Error(`Codex MCP server ${JSON.stringify(name)} has an unsafe transport shape.`);
  });
  const parsed = CodexMcpServerInventorySchema.safeParse(inventory);
  if (!parsed.success) {
    throw new Error(`Codex MCP inventory is incompatible: ${formatSchemaIssues(parsed.error)}`);
  }
  if (parsed.data.length > MAX_CONFIGURED_MCP_SERVERS) {
    throw new Error("Codex MCP inventory contains too many servers to isolate safely.");
  }
  return [...parsed.data].sort((left, right) => left.name.localeCompare(right.name));
}

function validateSafeHostConfig(
  result: z.infer<typeof CodexAppServerConfigReadResultSchema>,
  expectedLogDir: string,
  expectedProjectRoot: string
): void {
  const config = result.config;
  const unsafeHostPath = [
    config.experimental_compact_prompt_file,
    config.experimental_instructions_file,
    config.experimental_thread_config_endpoint,
    config.model_catalog_json,
    config.model_instructions_file,
    config.developer_instructions,
    config.instructions,
    config.user_instructions,
  ].some((value) => value != null);
  const otel = config.otel;
  const safeOtel =
    otel != null &&
    otel.exporter === "none" &&
    otel.metrics_exporter === "none" &&
    otel.trace_exporter === "none" &&
    otel.log_user_prompt === false;
  const hasSelectedProjectUntrusted = Object.entries(config.projects ?? {}).some(
    ([projectRoot, projectConfig]) =>
      isAbsolute(projectRoot) &&
      comparablePath(projectRoot) === comparablePath(expectedProjectRoot) &&
      projectConfig.trust_level === "untrusted"
  );
  const selectedProjectTrustOrigin = result.origins[`projects.${expectedProjectRoot}.trust_level`];
  const projectDocBytesOrigin = result.origins.project_doc_max_bytes;
  const projectDocFallbackOrigin = result.origins.project_doc_fallback_filenames;
  const shellToolOrigin = result.origins["features.shell_tool"];
  const unifiedExecOrigin = result.origins["features.unified_exec"];
  const hasEnabledProjectLayer =
    result.layers?.some(
      (layer) => layer.name.type === "project" && typeof layer.disabledReason !== "string"
    ) ?? false;
  if (
    config.model_provider != null ||
    Object.keys(config.model_providers ?? {}).length !== 0 ||
    config.openai_base_url != null ||
    (config.chatgpt_base_url != null && config.chatgpt_base_url !== CHATGPT_API_BASE_URL) ||
    (config.forced_login_method != null && config.forced_login_method !== "chatgpt") ||
    config.forced_chatgpt_workspace_id != null ||
    config.notify == null ||
    config.notify.length !== 0 ||
    config.analytics?.enabled !== false ||
    config.feedback?.enabled !== false ||
    config.check_for_update_on_startup !== false ||
    config.log_dir == null ||
    comparablePath(config.log_dir) !== comparablePath(expectedLogDir) ||
    !safeOtel ||
    unsafeHostPath ||
    !hasSelectedProjectUntrusted ||
    selectedProjectTrustOrigin?.name.type !== "sessionFlags" ||
    config.project_doc_max_bytes !== 0 ||
    config.project_doc_fallback_filenames == null ||
    config.project_doc_fallback_filenames.length !== 0 ||
    projectDocBytesOrigin?.name.type !== "sessionFlags" ||
    (projectDocFallbackOrigin != null && projectDocFallbackOrigin.name.type !== "sessionFlags") ||
    config.features?.shell_tool !== false ||
    config.features.unified_exec !== false ||
    shellToolOrigin?.name.type !== "sessionFlags" ||
    unifiedExecOrigin?.name.type !== "sessionFlags" ||
    result.layers == null ||
    hasEnabledProjectLayer
  ) {
    throw new Error(
      "Codex task isolation failed because project configuration can still execute or transmit outside the selected project."
    );
  }
}

export function createCodexTaskClient(args: {
  codexCliCommand: string;
  codexHome: string;
  clientVersion: string;
  requestTimeoutMs: number;
  turnTimeoutMs: number;
}): ICodexTaskClient {
  if (args.codexCliCommand.trim().length === 0) {
    throw new Error("Codex task client requires a CLI command.");
  }
  if (!isAbsolute(args.codexHome)) {
    throw new Error("Codex task client requires an absolute shared Codex home.");
  }
  if (args.clientVersion.trim().length === 0) {
    throw new Error("Codex task client requires a client version.");
  }
  if (!Number.isFinite(args.requestTimeoutMs) || args.requestTimeoutMs <= 0) {
    throw new Error("Codex task client requires a positive request timeout.");
  }
  if (!Number.isFinite(args.turnTimeoutMs) || args.turnTimeoutMs <= 0) {
    throw new Error("Codex task client requires a positive turn timeout.");
  }
  const codexLogDir = resolve(args.codexHome, "log");
  let active: IClientProcess | null = null;
  let nextRequestId = 1;
  let permanentlyClosed = false;
  const processes = new Set<IClientProcess>();
  const submissions = new Map<string, Promise<ICodexTaskSubmission>>();
  let submissionQueue: Promise<void> = Promise.resolve();

  function rejectPending(state: IClientProcess, error: Error): void {
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    state.pending.clear();
  }

  function rejectTrackedTurns(state: IClientProcess, error: Error): void {
    for (const tracked of state.trackedTurns.values()) {
      clearTimeout(tracked.timeout);
      tracked.reject(error);
    }
    state.trackedTurns.clear();
    state.completedTurns.clear();
  }

  function detachState(state: IClientProcess, error: Error): void {
    if (state.detached) return;
    state.detached = true;
    rejectPending(state, error);
    rejectTrackedTurns(state, error);
    state.reader.close();
    if (!state.process.killed) {
      state.process.kill("SIGTERM");
      const forceKill = setTimeout(() => state.process.kill("SIGKILL"), FORCE_KILL_GRACE_MS);
      state.process.once("close", () => clearTimeout(forceKill));
    }
    processes.delete(state);
    if (active === state) active = null;
  }

  function settleTrackedTurn(state: IClientProcess, completion: ITurnCompletion): void {
    const tracked = state.trackedTurns.get(completion.turn.id);
    if (tracked === undefined) {
      state.completedTurns.set(completion.turn.id, completion);
      if (state.completedTurns.size > 100) {
        const oldestTurnId = state.completedTurns.keys().next().value;
        if (typeof oldestTurnId === "string") state.completedTurns.delete(oldestTurnId);
      }
      return;
    }
    state.trackedTurns.delete(completion.turn.id);
    clearTimeout(tracked.timeout);
    if (tracked.threadId !== completion.threadId) {
      tracked.reject(new Error("Codex completed a task under the wrong thread."));
      return;
    }
    if (completion.turn.status === "completed" && completion.turn.error == null) {
      tracked.resolve();
      return;
    }
    const detail = completion.turn.error?.message;
    tracked.reject(
      new Error(
        detail === undefined
          ? `Codex review ${completion.turn.status}.`
          : `Codex review ${completion.turn.status}: ${detail}`
      )
    );
  }

  function handleNotification(
    state: IClientProcess,
    message: { method: string; params?: unknown }
  ): void {
    if (message.method === "turn/completed") {
      const parsed = CodexAppServerTurnCompletedParamsSchema.safeParse(message.params);
      if (!parsed.success) {
        writeHostLog(
          "error",
          "codex_task",
          `invalid_turn_completed issues=${formatErrorForLog(formatSchemaIssues(parsed.error))}`
        );
        return;
      }
      writeHostLog(
        parsed.data.turn.status === "completed" ? "info" : "error",
        "codex_task",
        `turn_completed threadId=${parsed.data.threadId} turnId=${parsed.data.turn.id} status=${parsed.data.turn.status}`
      );
      settleTrackedTurn(state, parsed.data);
      return;
    }
    if (message.method === "error") {
      const parsed = CodexAppServerErrorParamsSchema.safeParse(message.params);
      if (!parsed.success) return;
      writeHostLog(
        "error",
        "codex_task",
        `turn_error threadId=${parsed.data.threadId} turnId=${parsed.data.turnId} willRetry=${parsed.data.willRetry} message=${formatErrorForLog(parsed.data.error.message)}`
      );
    }
  }

  function handleLine(state: IClientProcess, line: string): void {
    if (line.length > MAX_PROTOCOL_LINE_LENGTH) {
      detachState(
        state,
        new Error(`Codex app-server returned an oversized protocol message (${line.length} bytes).`)
      );
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      detachState(
        state,
        new Error(`Codex app-server returned invalid JSON: ${formatErrorForLog(error)}`, {
          cause: error,
        })
      );
      return;
    }
    const parsed = CodexAppServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      detachState(
        state,
        new Error(
          `Codex app-server returned an invalid message: ${formatSchemaIssues(parsed.error)}`
        )
      );
      return;
    }
    const message = parsed.data;
    if ("method" in message) {
      if ("id" in message) {
        state.process.stdin.write(
          `${JSON.stringify({
            id: message.id,
            error: {
              code: -32601,
              message: "Steward does not allow interactive app-server requests.",
            },
          })}\n`
        );
        writeHostLog("error", "codex_task", `unsupported_server_request method=${message.method}`);
        return;
      }
      handleNotification(state, message);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = state.pending.get(message.id);
    if (pending === undefined) return;
    state.pending.delete(message.id);
    clearTimeout(pending.timeout);
    const errorResponse = CodexAppServerErrorResponseSchema.safeParse(message);
    if (errorResponse.success) {
      pending.reject(
        new Error(`Codex ${pending.method} failed: ${errorResponse.data.error.message}`)
      );
      return;
    }
    if (!("result" in message)) {
      detachState(state, new Error(`Codex ${pending.method} returned no result.`));
      return;
    }
    pending.acceptResult(message.result);
  }

  function request<T>(
    state: IClientProcess,
    method: string,
    params: unknown,
    resultSchema: z.ZodType<T>
  ): Promise<T> {
    const id = nextRequestId++;
    return new Promise<T>((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        state.pending.delete(id);
        const error = new Error(`Codex ${method} timed out before the task was accepted.`);
        rejectRequest(error);
        detachState(state, error);
      }, args.requestTimeoutMs);
      state.pending.set(id, {
        method,
        timeout,
        reject: rejectRequest,
        acceptResult: (result) => {
          const parsed = resultSchema.safeParse(result);
          if (!parsed.success) {
            const error = new Error(
              `Codex ${method} returned an incompatible result: ${formatSchemaIssues(parsed.error)}`
            );
            rejectRequest(error);
            detachState(state, error);
            return;
          }
          resolveRequest(parsed.data);
        },
      });
      state.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  function notify(state: IClientProcess, method: string): void {
    state.process.stdin.write(`${JSON.stringify({ method })}\n`);
  }

  function waitForTurnCompletion(
    state: IClientProcess,
    argsForTurn: { threadId: string; turnId: string }
  ): Promise<void> {
    const cached = state.completedTurns.get(argsForTurn.turnId);
    if (cached !== undefined) {
      state.completedTurns.delete(argsForTurn.turnId);
      return new Promise<void>((resolveTurn, rejectTurn) => {
        const timeout = setTimeout(() => undefined, 0);
        const tracked: ITrackedTurn = {
          threadId: argsForTurn.threadId,
          resolve: resolveTurn,
          reject: rejectTurn,
          timeout,
        };
        clearTimeout(timeout);
        state.trackedTurns.set(argsForTurn.turnId, tracked);
        settleTrackedTurn(state, cached);
      });
    }
    const completion = new Promise<void>((resolveTurn, rejectTurn) => {
      const timeout = setTimeout(() => {
        state.trackedTurns.delete(argsForTurn.turnId);
        rejectTurn(new Error("Codex review timed out before producing a final answer."));
        detachState(state, new Error("Codex review exceeded its bounded turn timeout."));
      }, args.turnTimeoutMs);
      state.trackedTurns.set(argsForTurn.turnId, {
        threadId: argsForTurn.threadId,
        resolve: resolveTurn,
        reject: rejectTurn,
        timeout,
      });
    });
    state.activeTurnPromises.add(completion);
    void completion
      .finally(() => state.activeTurnPromises.delete(completion))
      .catch(() => undefined);
    return completion;
  }

  function spawnClientProcess(appServerArgs: string[], projectRoot: string): IClientProcess {
    const child = spawn(args.codexCliCommand, appServerArgs, {
      cwd: existsSync(projectRoot) ? projectRoot : process.cwd(),
      env: buildCodexTaskProcessEnv(args.codexHome),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const state: IClientProcess = {
      process: child,
      reader: createInterface({ input: child.stdout }),
      pending: new Map(),
      trackedTurns: new Map(),
      completedTurns: new Map(),
      activeTurnPromises: new Set(),
      stderr: "",
      closing: false,
      detached: false,
      shutdownPromise: null,
    };
    processes.add(state);
    state.reader.on("line", (line) => handleLine(state, line));
    child.stderr.on("data", (chunk: Buffer) => {
      state.stderr = `${state.stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.once("error", (error) => {
      detachState(state, new Error("Codex app-server could not start.", { cause: error }));
    });
    child.once("close", (code, signal) => {
      if (state.closing) return;
      const diagnostic = state.stderr.trim().replaceAll(/\s+/g, " ").slice(-500);
      detachState(
        state,
        new Error(
          `Codex app-server exited unexpectedly (code=${String(code)} signal=${String(signal)})${diagnostic.length > 0 ? `: ${diagnostic}` : ""}`
        )
      );
    });
    return state;
  }

  async function initializeClient(state: IClientProcess): Promise<void> {
    let initialized: z.infer<typeof CodexAppServerInitializeResultSchema>;
    try {
      initialized = await request(
        state,
        "initialize",
        {
          clientInfo: { name: CLIENT_NAME, title: CLIENT_TITLE, version: args.clientVersion },
          capabilities: { experimentalApi: true },
        },
        CodexAppServerInitializeResultSchema
      );
    } catch (error) {
      const clientError =
        error instanceof Error ? error : new Error("Codex app-server initialization failed.");
      detachState(state, clientError);
      throw clientError;
    }
    if (comparablePath(initialized.codexHome) !== comparablePath(args.codexHome)) {
      const error = new Error("Codex app-server did not use the shared Desktop task history.");
      detachState(state, error);
      throw error;
    }
    notify(state, "initialized");
  }

  function shutdownState(state: IClientProcess, drainTurns: boolean): Promise<void> {
    if (state.shutdownPromise !== null) return state.shutdownPromise;
    state.closing = true;
    state.shutdownPromise = (async (): Promise<void> => {
      if (drainTurns && state.activeTurnPromises.size > 0) {
        await Promise.race([
          Promise.allSettled([...state.activeTurnPromises]),
          new Promise<void>((resolveDrain) => setTimeout(resolveDrain, CLOSE_GRACE_MS)),
        ]);
      }
      rejectPending(state, new Error("Codex task client is shutting down."));
      rejectTrackedTurns(state, new Error("Codex task client shut down before review completion."));
      state.reader.close();
      if (state.process.exitCode !== null || state.process.signalCode !== null) return;
      state.process.stdin.end();
      await new Promise<void>((resolveClose) => {
        let forceKill: ReturnType<typeof setTimeout> | null = null;
        const terminate = setTimeout(() => {
          state.process.kill("SIGTERM");
          forceKill = setTimeout(() => {
            state.process.kill("SIGKILL");
            resolveClose();
          }, FORCE_KILL_GRACE_MS);
        }, CLOSE_GRACE_MS);
        state.process.once("close", () => {
          clearTimeout(terminate);
          if (forceKill !== null) clearTimeout(forceKill);
          resolveClose();
        });
      });
    })().finally(() => {
      processes.delete(state);
      if (active === state) active = null;
    });
    return state.shutdownPromise;
  }

  async function readProjectMcpInventory(
    canonicalProjectRoot: string,
    permissionProfileId: string
  ): Promise<ICodexMcpServerInventoryItem[]> {
    const state = spawnClientProcess(
      buildCodexTaskAppServerArgs([], canonicalProjectRoot, permissionProfileId, codexLogDir),
      canonicalProjectRoot
    );
    try {
      await initializeClient(state);
      const config = await request(
        state,
        "config/read",
        { cwd: canonicalProjectRoot, includeLayers: false },
        CodexAppServerConfigReadResultSchema
      );
      return extractMcpInventory(config);
    } finally {
      await shutdownState(state, false);
    }
  }

  async function startClient(
    canonicalProjectRoot: string,
    permissionProfileId: string
  ): Promise<IClientProcess> {
    if (permanentlyClosed) throw new Error("Codex task client is closed.");
    const mcpInventory = await readProjectMcpInventory(canonicalProjectRoot, permissionProfileId);
    if (permanentlyClosed) throw new Error("Codex task client is closed.");
    const state = spawnClientProcess(
      buildCodexTaskAppServerArgs(
        mcpInventory,
        canonicalProjectRoot,
        permissionProfileId,
        codexLogDir
      ),
      canonicalProjectRoot
    );
    active = state;
    await initializeClient(state);
    const isolatedConfig = await request(
      state,
      "config/read",
      { cwd: canonicalProjectRoot, includeLayers: true },
      CodexAppServerConfigReadResultSchema
    );
    validateSafeHostConfig(isolatedConfig, codexLogDir, canonicalProjectRoot);
    const authStatus = await request(
      state,
      "getAuthStatus",
      { includeToken: false, refreshToken: false },
      CodexAppServerGetAuthStatusResultSchema
    );
    if (
      authStatus.authMethod !== "chatgpt" ||
      authStatus.authToken !== null ||
      authStatus.requiresOpenaiAuth !== true
    ) {
      const error = new Error(
        "Codex task isolation requires the signed-in Desktop ChatGPT account."
      );
      detachState(state, error);
      throw error;
    }
    const isolatedInventory = extractMcpInventory(isolatedConfig);
    if (
      isolatedInventory.length !== mcpInventory.length ||
      isolatedInventory.some(
        (server, index) =>
          server.name !== mcpInventory[index]?.name ||
          server.transport.type !== mcpInventory[index]?.transport.type ||
          server.enabled
      )
    ) {
      const error = new Error(
        "Codex task isolation failed because project MCP configuration changed or remained enabled."
      );
      detachState(state, error);
      throw error;
    }
    const mcpStatus = await request(
      state,
      "mcpServerStatus/list",
      {
        cursor: null,
        limit: MAX_CONFIGURED_MCP_SERVERS,
        detail: "toolsAndAuthOnly",
        threadId: null,
      },
      CodexAppServerMcpStatusListResultSchema
    );
    const exposesMcpCapability = mcpStatus.data.some(
      (server) =>
        Object.keys(server.tools).length > 0 ||
        server.resources.length > 0 ||
        server.resourceTemplates.length > 0
    );
    if (exposesMcpCapability || mcpStatus.nextCursor != null) {
      const error = new Error(
        "Codex task isolation failed because an external MCP server is still available."
      );
      detachState(state, error);
      throw error;
    }
    return state;
  }

  async function findExistingTask(
    state: IClientProcess,
    requestArgs: ICodexTaskRequest
  ): Promise<ICodexTaskSubmission | null> {
    const canonicalProjectRoot = comparablePath(requestArgs.cwd);
    let foundRunning = false;
    for (const archived of [false, true]) {
      let cursor: string | null = null;
      let inspected = 0;
      let pages = 0;
      const seenCursors = new Set<string>();
      do {
        const listed: IThreadSearchResult = await request(
          state,
          "thread/search",
          {
            cursor,
            limit: Math.min(RECONCILIATION_PAGE_SIZE, MAX_RECONCILIATION_THREADS - inspected),
            sortKey: "updated_at",
            sortDirection: "desc",
            sourceKinds: ["vscode"],
            archived,
            searchTerm: requestArgs.submissionId,
          },
          CodexAppServerThreadSearchResultSchema
        );
        pages += 1;
        inspected += listed.data.length;
        for (const searchResult of listed.data) {
          const candidate = searchResult.thread;
          if (
            candidate.source !== "vscode" ||
            candidate.ephemeral ||
            comparablePath(candidate.cwd) !== canonicalProjectRoot
          ) {
            continue;
          }
          const read = await request(
            state,
            "thread/read",
            { threadId: candidate.id, includeTurns: true },
            CodexAppServerThreadReadResultSchema
          );
          for (const turn of read.thread.turns) {
            const hasSubmission = turn.items.some((item) => {
              const userMessage = CodexAppServerUserMessageItemSchema.safeParse(item);
              return userMessage.success && userMessage.data.clientId === requestArgs.submissionId;
            });
            if (!hasSubmission) continue;
            const hasFinalAnswer = turn.items.some((item) => {
              const agentMessage = CodexAppServerFinalAgentMessageItemSchema.safeParse(item);
              return agentMessage.success && agentMessage.data.text.trim().length > 0;
            });
            if (turn.status === "completed" && hasFinalAnswer) {
              writeHostLog(
                "info",
                "codex_task",
                `reconciled_submission submissionId=${requestArgs.submissionId} threadId=${candidate.id}`
              );
              return CodexTaskSubmissionSchema.parse({
                status: "submitted",
                threadId: candidate.id,
                title: requestArgs.title,
              });
            }
            if (turn.status === "inProgress") foundRunning = true;
          }
        }
        cursor = listed.nextCursor ?? null;
        if (cursor !== null) {
          if (
            inspected >= MAX_RECONCILIATION_THREADS ||
            pages >= MAX_RECONCILIATION_THREADS / RECONCILIATION_PAGE_SIZE ||
            seenCursors.has(cursor)
          ) {
            throw new Error(
              "Codex task history is too large or inconsistent to deduplicate safely."
            );
          }
          seenCursors.add(cursor);
        }
      } while (cursor !== null);
    }
    if (foundRunning) {
      throw new Error(
        "This Codex review already exists and is still running. Open it from the Codex sidebar."
      );
    }
    return null;
  }

  async function submitTaskOnce(requestArgs: ICodexTaskRequest): Promise<ICodexTaskSubmission> {
    validateTaskRequest(requestArgs);
    const canonicalProjectRoot = comparablePath(requestArgs.cwd);
    const permissionProfileId = `${PERMISSION_PROFILE_PREFIX}-${randomUUID()}`;
    const state = await startClient(canonicalProjectRoot, permissionProfileId);
    let createdThreadId: string | null = null;
    let turnAccepted = false;
    try {
      const existing = await findExistingTask(state, requestArgs);
      if (existing !== null) return existing;
      const threadResult = await request(
        state,
        "thread/start",
        {
          cwd: canonicalProjectRoot,
          approvalPolicy: "never",
          permissions: permissionProfileId,
          runtimeWorkspaceRoots: [canonicalProjectRoot],
          environments: [],
          dynamicTools: [],
          ephemeral: false,
        },
        CodexAppServerThreadStartResultSchema
      );
      createdThreadId = threadResult.thread.id;
      if (threadResult.thread.source !== "vscode") {
        throw new Error(
          `Codex created a non-Desktop task source (${JSON.stringify(threadResult.thread.source)}). Update Codex before trying again.`
        );
      }
      if (threadResult.thread.ephemeral) {
        throw new Error("Codex created an ephemeral task that cannot appear in Desktop history.");
      }
      if (comparablePath(threadResult.thread.cwd) !== canonicalProjectRoot) {
        throw new Error("Codex created the task in a different project than the selected project.");
      }
      if (threadResult.activePermissionProfile.id !== permissionProfileId) {
        throw new Error("Codex did not apply Steward's isolated permission profile.");
      }
      if (
        threadResult.runtimeWorkspaceRoots.length !== 1 ||
        comparablePath(threadResult.runtimeWorkspaceRoots[0] ?? "") !== canonicalProjectRoot
      ) {
        throw new Error(
          `Codex did not isolate the task to the selected project root (expected=${JSON.stringify(canonicalProjectRoot)} actual=${JSON.stringify(threadResult.runtimeWorkspaceRoots)}).`
        );
      }
      await request(
        state,
        "thread/name/set",
        { threadId: createdThreadId, name: requestArgs.title },
        CodexAppServerEmptyResultSchema
      );
      const turnResult = await request(
        state,
        "turn/start",
        {
          threadId: createdThreadId,
          clientUserMessageId: requestArgs.submissionId,
          input: [
            {
              type: "text",
              text: `Steward submission ID: ${requestArgs.submissionId}\n\n${requestArgs.prompt}`,
              text_elements: [],
            },
          ],
          cwd: canonicalProjectRoot,
          approvalPolicy: "never",
          permissions: permissionProfileId,
          runtimeWorkspaceRoots: [canonicalProjectRoot],
          environments: [],
        },
        CodexAppServerTurnStartResultSchema
      );
      turnAccepted = true;
      await waitForTurnCompletion(state, {
        threadId: createdThreadId,
        turnId: turnResult.turn.id,
      });
      const completedThread = await request(
        state,
        "thread/read",
        { threadId: createdThreadId, includeTurns: true },
        CodexAppServerThreadReadResultSchema
      );
      const completedTurn = completedThread.thread.turns.find(
        (turn) => turn.id === turnResult.turn.id
      );
      const hasFinalAnswer =
        completedTurn?.status === "completed" &&
        completedTurn.items.some((item) => {
          const agentMessage = CodexAppServerFinalAgentMessageItemSchema.safeParse(item);
          return agentMessage.success && agentMessage.data.text.trim().length > 0;
        });
      if (!hasFinalAnswer) {
        throw new Error("Codex review completed without producing a final answer.");
      }
      return CodexTaskSubmissionSchema.parse({
        status: "submitted",
        threadId: createdThreadId,
        title: requestArgs.title,
      });
    } catch (error) {
      if (createdThreadId !== null && !turnAccepted && active === state) {
        try {
          await request(
            state,
            "thread/delete",
            { threadId: createdThreadId },
            CodexAppServerEmptyResultSchema
          );
        } catch (cleanupError) {
          writeHostLog(
            "error",
            "codex_task",
            `orphan_cleanup_failed threadId=${createdThreadId} error=${formatErrorForLog(cleanupError)}`
          );
        }
      }
      throw error;
    } finally {
      await shutdownState(state, false);
    }
  }

  function submitTask(requestArgs: ICodexTaskRequest): Promise<ICodexTaskSubmission> {
    const existing = submissions.get(requestArgs.submissionId);
    if (existing !== undefined) return existing;
    const submission = submissionQueue
      .then(() => submitTaskOnce(requestArgs))
      .catch((error: unknown) => {
        submissions.delete(requestArgs.submissionId);
        throw error;
      });
    submissionQueue = submission.then(
      () => undefined,
      () => undefined
    );
    submissions.set(requestArgs.submissionId, submission);
    return submission;
  }

  async function close(): Promise<void> {
    permanentlyClosed = true;
    await Promise.all([...processes].map((state) => shutdownState(state, true)));
  }

  return { submitTask, close };
}
