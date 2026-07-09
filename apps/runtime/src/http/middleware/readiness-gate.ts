/**
 * Rejects requests to feature routes until runtime state is "running".
 * Health and runtime status routes are always allowed. When state is "needs-config",
 * config GET and initialize are allowed so the UI can complete onboarding.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ROUTES } from "@steward/contracts/routes";
import { sendApiError } from "../api-response.js";

type IGetRuntimeStatus = () => {
  state: string;
  phase?: string;
};

const ALWAYS_ALLOWED_PATHS = new Set<string>([ROUTES.HEALTH.path, ROUTES.RUNTIME_STATUS.path]);

const NEEDS_CONFIG_ALLOWED_PATHS = new Set<string>([
  ROUTES.CONFIG_GET.path,
  ROUTES.CONFIG_INITIALIZE.path,
]);

const RECONCILING_ALLOWED_PATHS = new Set<string>([
  ROUTES.CONFIG_GET.path,
  ROUTES.CONFIG_UPDATE.path,
]);

export function createReadinessGate(getRuntimeStatus: IGetRuntimeStatus): RequestHandler {
  return function readinessGate(req: Request, res: Response, next: NextFunction): void {
    if (ALWAYS_ALLOWED_PATHS.has(req.path)) {
      next();
      return;
    }
    const status = getRuntimeStatus();
    if (status.state === "running") {
      next();
      return;
    }
    if (status.state === "needs-config" && NEEDS_CONFIG_ALLOWED_PATHS.has(req.path)) {
      next();
      return;
    }
    if (status.state === "reconciling" && RECONCILING_ALLOWED_PATHS.has(req.path)) {
      next();
      return;
    }
    const phase = status.phase ?? "startup";
    sendApiError(
      res,
      503,
      "SERVICE_UNAVAILABLE",
      `Runtime not ready (${phase}). Poll GET ${ROUTES.RUNTIME_STATUS.path} until state is running.`
    );
  };
}
