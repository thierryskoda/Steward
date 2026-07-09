/**
 * Single app error contract: message, machine code, flat context, native cause.
 * Use at IO/schema/runtime boundaries; central logger serializes for one structured log line.
 */
export class AppError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context: Record<string, unknown> = {},
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.context = context;
    if (typeof Object.create !== "undefined" && Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
