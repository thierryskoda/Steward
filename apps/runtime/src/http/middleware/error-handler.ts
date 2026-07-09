import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { formatZodIssuesForContext } from "../../core/error-log-context.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import {
  HTTP_HANDLER_INVALID_BODY,
  HTTP_HANDLER_UNCAUGHT_ERROR,
  HTTP_HANDLER_VALIDATION_ERROR,
} from "../../core/runtime-log-events.js";
import { sendApiError } from "../api-response.js";

export function errorHandlerMiddleware(): ErrorRequestHandler {
  const log = getRuntimeLogger();
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const method = req.method;
    const path = req.path;
    const operation = `${method} ${path}`;
    if (err instanceof SyntaxError) {
      if (!res.headersSent && !res.writableEnded) {
        log.warn({
          event: HTTP_HANDLER_INVALID_BODY,
          code: "ERR_HTTP_INVALID_BODY",
          message: "Invalid JSON body",
          component: "http",
          operation,
          requestId: req.requestId,
        });
        sendApiError(res, 400, "INVALID_BODY", "Invalid JSON body");
      }
      return;
    }
    if (err instanceof ZodError) {
      if (!res.headersSent && !res.writableEnded) {
        const issues = formatZodIssuesForContext(err.issues);
        const details = issues.join("; ") || "Invalid request body";
        log.warn({
          event: HTTP_HANDLER_VALIDATION_ERROR,
          code: "ERR_HTTP_VALIDATION",
          message: details,
          component: "http",
          operation,
          requestId: req.requestId,
          issues,
        });
        sendApiError(res, 400, "VALIDATION_ERROR", details);
      }
      return;
    }
    logError(err, {
      event: HTTP_HANDLER_UNCAUGHT_ERROR,
      component: "http",
      operation,
      requestId: req.requestId,
    });
    if (!res.headersSent && !res.writableEnded) {
      sendApiError(res, 500, "INTERNAL_ERROR", "Unexpected runtime server error");
    }
  };
}
