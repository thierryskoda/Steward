import { reportRuntimeStatusError } from "../runtime-client.js";
import { getRuntimeErrorMessage } from "../ui/errors.js";

export const LOAD_TIMEOUT_MS = 20_000;

export function withLoadTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject({ kind: "timeout" as const, message: "Request timed out" }), ms);
  });
  return Promise.race([p, timeout]);
}

export function reportRuntimeError(error: unknown): void {
  reportRuntimeStatusError(getRuntimeErrorMessage(error));
}
