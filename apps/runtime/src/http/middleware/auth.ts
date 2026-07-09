import type { Request, Response, NextFunction, RequestHandler } from "express";
import { validateAuthToken } from "../auth-token.js";
import { sendApiError } from "../api-response.js";

export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!validateAuthToken(req.headers.authorization)) {
      sendApiError(res, 401, "UNAUTHORIZED", "Missing or invalid Authorization header");
      return;
    }
    next();
  };
}
