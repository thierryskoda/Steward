import fs from "fs";
import path from "path";
import { resolveLogsDir } from "./paths.js";

function safeStringify(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length <= 300 ? s : `${s.slice(0, 300)}...`;
    } catch {
      return "[non-serializable]";
    }
  }
  return String(v);
}

/** Extract actionable message from unknown error; avoids [object Object]. */
export function formatErrorForLog(e: unknown): string {
  if (e instanceof Error) return e.message || safeStringify(e);
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    const parts: string[] = [];
    if ("kind" in obj) parts.push(`kind=${safeStringify(obj.kind)}`);
    if ("code" in obj) parts.push(`code=${safeStringify(obj.code)}`);
    if ("message" in obj) parts.push(`message=${safeStringify(obj.message)}`);
    if (parts.length > 0) return parts.join(" ");
    return safeStringify(e);
  }
  return String(e);
}

const MENUBAR_UI_LOG = "menubar-ui.log";
const MENUBAR_HOST_LOG = "menubar-host.log";
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function rotateIfNeeded(logPath: string): void {
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  if (stat.size < MAX_LOG_BYTES) return;
  const rotated = `${logPath}.1`;
  const rotated2 = `${logPath}.2`;
  if (fs.existsSync(rotated)) {
    fs.renameSync(rotated, rotated2);
  }
  fs.renameSync(logPath, rotated);
}

function formatLogLine(
  message: string,
  error?: string,
  metadata?: Record<string, unknown>
): string {
  const parts: string[] = [message];
  if (error && error.length > 0) {
    parts.push(`error=${error}`);
  }
  if (metadata && Object.keys(metadata).length > 0) {
    parts.push(JSON.stringify(metadata));
  }
  return parts.join(" ");
}

function writeLogLine(
  logPath: string,
  level: string,
  component: string,
  message: string,
  error?: string,
  metadata?: Record<string, unknown>
): void {
  const dir = path.dirname(logPath);
  fs.mkdirSync(dir, { recursive: true });
  rotateIfNeeded(logPath);
  const ts = new Date().toISOString();
  const content = formatLogLine(message, error, metadata);
  const line = `[${ts}] [${level}] [${component}] ${content}\n`;
  fs.appendFileSync(logPath, line);
}

export function writeUiLog(args: {
  level: string;
  component: string;
  message: string;
  error?: string | null | unknown;
  metadata?: Record<string, unknown> | null;
}): void {
  const logsDir = resolveLogsDir();
  const logPath = path.join(logsDir, MENUBAR_UI_LOG);
  const errorStr =
    args.error == null
      ? undefined
      : typeof args.error === "string"
        ? args.error
        : formatErrorForLog(args.error);
  writeLogLine(
    logPath,
    args.level,
    args.component,
    args.message,
    errorStr ?? undefined,
    args.metadata ?? undefined
  );
}

export function writeHostLog(level: string, component: string, message: string): void {
  const logsDir = resolveLogsDir();
  const logPath = path.join(logsDir, MENUBAR_HOST_LOG);
  try {
    writeLogLine(logPath, level, component, message);
  } catch {
    // best-effort
  }
}

export function getLogsDir(): string {
  return resolveLogsDir();
}
