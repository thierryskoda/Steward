/**
 * Pino logger for the runtime. initRuntimeLogger() sets the file; getRuntimeLogger() returns it.
 * Before init, returns a silent logger. Convention: log.info({ event: EVENT, ...bindings }).
 * Use logError() for errors so one flat structured line is emitted with code + context + cause chain.
 */
import { createWriteStream, mkdirSync } from "fs";
import { join } from "path";
import pino, { type Logger } from "pino";
import { normalizeErrorForLog } from "./error-log-context.js";
import { RUNTIME_LOG_FILE } from "./log-paths.js";

let rootLogger: Logger = pino({ level: "silent" });

export type { Logger };

export function initRuntimeLogger(logsDir: string): Logger {
  mkdirSync(logsDir, { recursive: true });
  const logPath = join(logsDir, RUNTIME_LOG_FILE);
  const fileStream = createWriteStream(logPath, { flags: "a" });
  rootLogger = pino(
    {
      level: "info",
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      serializers: {
        err: pino.stdSerializers.err,
      },
    },
    fileStream
  );
  return rootLogger;
}

export function getRuntimeLogger(): Logger {
  return rootLogger;
}

export type ILogErrorExtra = {
  event: string;
  component?: string;
  operation?: string;
  phase?: string;
  projectRoot?: string;
  requestId?: string;
  [key: string]: unknown;
};

/**
 * Log an error as one structured line: code, message, context, causeChain. Use at boundaries and fatal catch.
 */
export function logError(err: unknown, extra: ILogErrorExtra): void {
  const normalized = normalizeErrorForLog(err);
  getRuntimeLogger().error({
    ...extra,
    code: normalized.code,
    message: normalized.message,
    ...normalized.context,
    causeChain: normalized.causeChain,
  });
}
