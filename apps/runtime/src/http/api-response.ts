import type { Response } from "express";
import { ApiErrorSchema } from "@steward/contracts/error";

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: string
): void {
  const payload =
    details !== undefined ? { error: { code, message, details } } : { error: { code, message } };
  res.status(status).json(ApiErrorSchema.parse(payload));
}
