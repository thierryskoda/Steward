import type { RuntimeClientError } from "../runtime-client.js";
import { isRuntimeClientError } from "../runtime-client.js";

function toRuntimeClientError(error: unknown): RuntimeClientError | null {
  if (isRuntimeClientError(error)) return error;
  if (error instanceof Error) {
    return {
      kind: "offline",
      message: error.message.trim() || "Unexpected renderer error.",
    };
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return { kind: "offline", message: error.trim() };
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string" && value.trim().length > 0) {
      return { kind: "offline", message: value.trim() };
    }
  }
  return null;
}

export function getRuntimeErrorMessage(error: unknown): string {
  const err = toRuntimeClientError(error);
  if (!err) return "Unexpected error. Open logs for details.";

  switch (err.kind) {
    case "offline":
      return (
        err.message ||
        "Project runtime unreachable. Start from tray or run `pnpm reset-runtime` then `pnpm dev`."
      );
    case "timeout":
      return "Request timed out. Try again.";
    case "unauthorized":
      return "Invalid token. Restart project runtime.";
    case "api":
      return err.message;
    case "parse":
      return err.message
        ? `Invalid response from runtime. ${err.message}`
        : "Invalid response from runtime.";
    default:
      return "Unexpected error. Open logs for details.";
  }
}
