import { loadEnv } from "./env.js";
import { logError } from "./logger.js";

export type IDebugLog = (
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
  runId?: string
) => void;

export function createDebugLog(): IDebugLog {
  const env = loadEnv();
  const endpoint = env.CTO_DEBUG_ENDPOINT;
  const session = env.CTO_DEBUG_SESSION;
  if (!endpoint || !session) return () => {};

  return (hypothesisId, location, message, data, runId = "pre-fix") => {
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": session,
      },
      body: JSON.stringify({
        sessionId: session,
        runId,
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch((e) => {
      logError(e, {
        event: "Debug endpoint request failed",
        component: "debug",
        operation: "debugLogFetch",
      });
    });
  };
}
