import "dotenv/config";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
import { AppError } from "./app-error.js";
import { ERR_ENV_INVALID } from "./error-codes.js";
const DEFAULT_CURSOR_PROJECTS = join(homedir(), ".cursor", "projects");
const DEFAULT_CURSOR_POLL_INTERVAL_MS = 5000;
const DEFAULT_AGENT_TIMEOUT_MS = 900000;
const DEFAULT_AGENT_WATCHDOG_IDLE_MS = 600000; // 10 min
const DEFAULT_AGENT_KILL_GRACE_MS = 10000;
const DEFAULT_AGENT_MAX_CONCURRENCY = 3;
const DEFAULT_AGENT_IO_LOG_ENABLED = false;
const DEFAULT_REGENERATE_CONFIG_ON_GIT_POLL = true;
const DEFAULT_IMPLEMENTING_STALE_MS = 20 * 60 * 1000;
const DEFAULT_AGENT_MAX_QUEUE_AGE_MS = 10 * 60 * 1000;
const DEFAULT_AGENT_QUEUE_WARN_WAIT_MS = 30_000;
const DEFAULT_CONTINUAL_LEARNING_IDLE_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_GIT_POLL_QUIET_WINDOW_MS = 60_000; // 60s before starting new findings

/** No required env keys; project root comes from launcher via startup-input. */
export const REQUIRED_ENV_KEYS: readonly string[] = [];

const DEFAULT_LLM_PROVIDER = "cursor_cli" as const;
export type ILLMProviderId = "cursor_cli" | "codex_cli" | "claude_code_cli" | "antigravity_cli";
const LLM_PROVIDER_VALUES: ILLMProviderId[] = [
  "cursor_cli",
  "codex_cli",
  "claude_code_cli",
  "antigravity_cli",
];

type IDefaultableEnvKey =
  | "CTO_CURSOR_PROJECTS_ROOT"
  | "CURSOR_POLL_INTERVAL_MS"
  | "AGENT_TIMEOUT_MS"
  | "AGENT_WATCHDOG_IDLE_MS"
  | "AGENT_KILL_GRACE_MS"
  | "CTO_AGENT_MAX_CONCURRENCY"
  | "CTO_AGENT_IO_LOG_ENABLED"
  | "CTO_REGENERATE_CONFIG_ON_GIT_POLL"
  | "CTO_HTTP_PORT"
  | "CTO_IMPLEMENTING_STALE_MS"
  | "CTO_AGENT_MAX_QUEUE_AGE_MS"
  | "CTO_AGENT_QUEUE_WARN_WAIT_MS"
  | "CTO_CONTINUAL_LEARNING_IDLE_MS"
  | "CTO_GIT_POLL_QUIET_WINDOW_MS";

type IDefaultableEnvValue = string | number | boolean;

const DEFAULTABLE_ENV_KEYS: readonly IDefaultableEnvKey[] = [
  "CTO_CURSOR_PROJECTS_ROOT",
  "CURSOR_POLL_INTERVAL_MS",
  "AGENT_TIMEOUT_MS",
  "AGENT_WATCHDOG_IDLE_MS",
  "AGENT_KILL_GRACE_MS",
  "CTO_AGENT_MAX_CONCURRENCY",
  "CTO_AGENT_IO_LOG_ENABLED",
  "CTO_REGENERATE_CONFIG_ON_GIT_POLL",
  "CTO_HTTP_PORT",
  "CTO_IMPLEMENTING_STALE_MS",
  "CTO_AGENT_MAX_QUEUE_AGE_MS",
  "CTO_AGENT_QUEUE_WARN_WAIT_MS",
  "CTO_CONTINUAL_LEARNING_IDLE_MS",
  "CTO_GIT_POLL_QUIET_WINDOW_MS",
];

const DEFAULT_ENV_VALUES: Readonly<Record<IDefaultableEnvKey, IDefaultableEnvValue>> = {
  CTO_CURSOR_PROJECTS_ROOT: DEFAULT_CURSOR_PROJECTS,
  CURSOR_POLL_INTERVAL_MS: DEFAULT_CURSOR_POLL_INTERVAL_MS,
  AGENT_TIMEOUT_MS: DEFAULT_AGENT_TIMEOUT_MS,
  AGENT_WATCHDOG_IDLE_MS: DEFAULT_AGENT_WATCHDOG_IDLE_MS,
  AGENT_KILL_GRACE_MS: DEFAULT_AGENT_KILL_GRACE_MS,
  CTO_AGENT_MAX_CONCURRENCY: DEFAULT_AGENT_MAX_CONCURRENCY,
  CTO_AGENT_IO_LOG_ENABLED: DEFAULT_AGENT_IO_LOG_ENABLED,
  CTO_REGENERATE_CONFIG_ON_GIT_POLL: DEFAULT_REGENERATE_CONFIG_ON_GIT_POLL,
  CTO_HTTP_PORT: 0,
  CTO_IMPLEMENTING_STALE_MS: DEFAULT_IMPLEMENTING_STALE_MS,
  CTO_AGENT_MAX_QUEUE_AGE_MS: DEFAULT_AGENT_MAX_QUEUE_AGE_MS,
  CTO_AGENT_QUEUE_WARN_WAIT_MS: DEFAULT_AGENT_QUEUE_WARN_WAIT_MS,
  CTO_CONTINUAL_LEARNING_IDLE_MS: DEFAULT_CONTINUAL_LEARNING_IDLE_MS,
  CTO_GIT_POLL_QUIET_WINDOW_MS: DEFAULT_GIT_POLL_QUIET_WINDOW_MS,
};

const DEFAULTED_WHEN_EMPTY_KEYS: ReadonlySet<IDefaultableEnvKey> = new Set([
  "CTO_CURSOR_PROJECTS_ROOT",
]);

function strictBooleanEnv(
  defaultValue: boolean
): z.ZodType<boolean, z.ZodTypeDef, string | undefined> {
  return z
    .string()
    .optional()
    .transform((s) => {
      if (s === undefined || s === null) return defaultValue;
      const lower = s.trim().toLowerCase();
      if (lower === "true") return true;
      if (lower === "false") return false;
      throw new AppError(`Invalid boolean env value. Use "true" or "false".`, ERR_ENV_INVALID, {
        key: "boolean env",
        value: s,
      });
    });
}

function optionalStringEnv(): z.ZodType<string | undefined, z.ZodTypeDef, string | undefined> {
  return z
    .string()
    .optional()
    .transform((s) => {
      if (s === undefined || s === null) return undefined;
      const normalized = s.trim();
      if (!normalized) return undefined;
      return normalized;
    });
}

const envSchema = z.object({
  /** Set by launcher when spawning runtime; do not rely on .env for project selection. */
  CTO_TARGET_PROJECT_ROOT: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  CTO_CURSOR_PROJECTS_ROOT: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : DEFAULT_CURSOR_PROJECTS)),
  CURSOR_POLL_INTERVAL_MS: z.coerce.number().default(DEFAULT_CURSOR_POLL_INTERVAL_MS),
  AGENT_TIMEOUT_MS: z.coerce.number().min(1000).default(DEFAULT_AGENT_TIMEOUT_MS),
  AGENT_WATCHDOG_IDLE_MS: z.coerce.number().min(5000).default(DEFAULT_AGENT_WATCHDOG_IDLE_MS),
  AGENT_KILL_GRACE_MS: z.coerce.number().min(1000).default(DEFAULT_AGENT_KILL_GRACE_MS),
  CTO_AGENT_MAX_CONCURRENCY: z.coerce.number().min(1).default(DEFAULT_AGENT_MAX_CONCURRENCY),
  /** 0 = dynamic port (OS-assigned); otherwise fixed port. Default 0 for multi-project. */
  CTO_HTTP_PORT: z.coerce.number().min(0).max(65535).default(0),
  CTO_IMPLEMENTING_STALE_MS: z.coerce.number().min(60_000).default(DEFAULT_IMPLEMENTING_STALE_MS),
  CTO_AGENT_MAX_QUEUE_AGE_MS: z.coerce.number().min(10_000).default(DEFAULT_AGENT_MAX_QUEUE_AGE_MS),
  CTO_AGENT_QUEUE_WARN_WAIT_MS: z.coerce
    .number()
    .min(1000)
    .default(DEFAULT_AGENT_QUEUE_WARN_WAIT_MS),
  CTO_LLM_PROVIDER: z
    .string()
    .optional()
    .transform((s): ILLMProviderId => {
      const v = (s?.trim() ?? "").toLowerCase() || DEFAULT_LLM_PROVIDER;
      if (LLM_PROVIDER_VALUES.includes(v as ILLMProviderId)) return v as ILLMProviderId;
      throw new AppError(
        `Invalid CTO_LLM_PROVIDER. Use one of: ${LLM_PROVIDER_VALUES.join(", ")}.`,
        ERR_ENV_INVALID,
        { key: "CTO_LLM_PROVIDER", value: s, allowed: LLM_PROVIDER_VALUES }
      );
    }),
  CTO_DEBUG_ENDPOINT: optionalStringEnv(),
  CTO_DEBUG_SESSION: optionalStringEnv(),
  CTO_LOGS_ROOT: optionalStringEnv(),
  CTO_AGENT_IO_LOG_ENABLED: strictBooleanEnv(DEFAULT_AGENT_IO_LOG_ENABLED),
  CTO_REGENERATE_CONFIG_ON_GIT_POLL: strictBooleanEnv(DEFAULT_REGENERATE_CONFIG_ON_GIT_POLL),
  CTO_CONTINUAL_LEARNING_IDLE_MS: z.coerce
    .number()
    .min(60_000)
    .default(DEFAULT_CONTINUAL_LEARNING_IDLE_MS),
  CTO_GIT_POLL_QUIET_WINDOW_MS: z.coerce
    .number()
    .min(1000)
    .default(DEFAULT_GIT_POLL_QUIET_WINDOW_MS),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function parseEnv(env: Record<string, string | undefined>): Env {
  return envSchema.parse(env);
}

type IEnvDefaultApplied = {
  key: IDefaultableEnvKey;
  defaultValue: IDefaultableEnvValue;
};

export function getAppliedEnvDefaults(
  env: Record<string, string | undefined>
): IEnvDefaultApplied[] {
  const applied: IEnvDefaultApplied[] = [];
  for (const key of DEFAULTABLE_ENV_KEYS) {
    const raw = env[key];
    const hasOwn = Object.prototype.hasOwnProperty.call(env, key);
    const missing = !hasOwn || raw === undefined;
    const empty =
      raw !== undefined && DEFAULTED_WHEN_EMPTY_KEYS.has(key) && raw.trim().length === 0;
    if (missing || empty) {
      applied.push({
        key,
        defaultValue: DEFAULT_ENV_VALUES[key],
      });
    }
  }
  return applied;
}

export function loadEnv(): Env {
  if (_env) return _env;
  _env = parseEnv(process.env);
  return _env;
}
