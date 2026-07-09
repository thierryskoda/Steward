import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ROUTES } from "@steward/contracts/routes";
import { getRuntimeLogger } from "../../core/logger.js";
import { HTTP_REQUEST_COMPLETED } from "../../core/runtime-log-events.js";

export function requestLogMiddleware(): RequestHandler {
  const log = getRuntimeLogger();
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const status = res.statusCode;
      if (req.path === ROUTES.RUNTIME_STATUS.path && status < 400) return;
      const classification = status >= 500 ? "server_error" : status >= 400 ? "client_error" : "ok";
      log.info({
        event: HTTP_REQUEST_COMPLETED,
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status,
        durationMs,
        classification,
      });
    });
    next();
  };
}
