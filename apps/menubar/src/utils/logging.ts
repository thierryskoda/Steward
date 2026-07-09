type ILogLevel = "error" | "warn" | "info" | "debug";
type ITracePhase = "start" | "success" | "fail";

type ILogger = {
  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
  trace(args: {
    event: string;
    phase: ITracePhase;
    metadata?: Record<string, unknown>;
    error?: unknown;
  }): void;
};

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

function formatErrorForLog(e: unknown): string | undefined {
  if (e == null) return undefined;
  if (e instanceof Error) return e.message || safeStringify(e);
  if (typeof e === "object") {
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

export function createLogger(component: string): ILogger {
  return {
    error(message: string, error?: unknown, metadata?: Record<string, unknown>) {
      const errStr = formatErrorForLog(error);
      void logToFile({
        level: "error",
        component,
        message,
        error: errStr,
        metadata,
      });
    },
    warn(message: string, metadata?: Record<string, unknown>) {
      void logToFile({ level: "warn", component, message, metadata });
    },
    info(message: string, metadata?: Record<string, unknown>) {
      void logToFile({ level: "info", component, message, metadata });
    },
    debug(message: string, metadata?: Record<string, unknown>) {
      void logToFile({ level: "debug", component, message, metadata });
    },
    trace(args: {
      event: string;
      phase: ITracePhase;
      metadata?: Record<string, unknown>;
      error?: unknown;
    }) {
      const traceMetadata = {
        event: args.event,
        phase: args.phase,
        ...(args.metadata ?? {}),
      };
      const errStr = formatErrorForLog(args.error);
      const level: ILogLevel = args.phase === "fail" ? "error" : "info";
      void logToFile({
        level,
        component,
        message: `trace ${args.event} ${args.phase}`,
        error: errStr,
        metadata: traceMetadata,
      });
    },
  };
}

async function logToFile(args: {
  level: ILogLevel;
  component: string;
  message: string;
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const bridge = window.ctoBridge;
  if (!bridge) return;
  try {
    await bridge.writeUiLog({
      level: args.level,
      component: args.component,
      message: args.message,
      error: args.error ?? null,
      metadata: args.metadata ?? null,
    });
  } catch {
    // best-effort; avoid breaking app on log failure
  }
}
