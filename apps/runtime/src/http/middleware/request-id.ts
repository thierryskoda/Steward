import type { Request, Response, NextFunction, RequestHandler } from "express";
import { randomUUID } from "crypto";

const X_REQUEST_ID = "x-request-id";
const MAX_REQUEST_ID_LENGTH = 128;

function parseIncomingRequestId(header: string | undefined): string | null {
  if (header == null || typeof header !== "string") return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= MAX_REQUEST_ID_LENGTH
    ? trimmed
    : trimmed.slice(0, MAX_REQUEST_ID_LENGTH);
}

/**
 * Assigns a requestId to each request for correlation in logs. Uses x-request-id if valid, else generates UUID.
 * Echoes final value in response header. Must run before request-log and error-handler.
 */
export function requestIdMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = parseIncomingRequestId(req.get(X_REQUEST_ID));
    req.requestId = incoming ?? randomUUID();
    res.setHeader(X_REQUEST_ID, req.requestId);
    next();
  };
}
