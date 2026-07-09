import type { Request, Response, NextFunction } from "express";

const CORS_ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const DEFAULT_ORIGIN = "http://localhost:1420";

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  void req;
  const origin = res.req.headers.origin;
  const allow =
    typeof origin === "string" && CORS_ALLOWED_ORIGIN.test(origin) ? origin : DEFAULT_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  next();
}
