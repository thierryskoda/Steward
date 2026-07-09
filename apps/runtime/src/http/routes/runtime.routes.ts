import { Router, type Request, type Response } from "express";
import {
  RuntimeStatusResponseSchema,
  ShutdownRuntimeResponseSchema,
} from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { requireAuth } from "../middleware/auth.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = ["RUNTIME_STATUS", "RUNTIME_SHUTDOWN"];

type IRuntimeRouteDeps = {
  getRuntimeStatus: () => {
    pid: number;
    state: string;
    startedAt: number;
    lastHeartbeatAt: number;
    lastError: string | null;
  };
  onShutdownRequest: () => void;
};

export function runtimeRoutes(deps: IRuntimeRouteDeps): Router {
  const router = Router();
  const { getRuntimeStatus, onShutdownRequest } = deps;

  router[ROUTES.RUNTIME_STATUS.method](
    ROUTES.RUNTIME_STATUS.path,
    requireAuth(),
    (req: Request, res: Response) => {
      void req;
      const raw = getRuntimeStatus();
      const data = RuntimeStatusResponseSchema.parse(raw);
      res.status(200).json(data);
    }
  );

  router[ROUTES.RUNTIME_SHUTDOWN.method](
    ROUTES.RUNTIME_SHUTDOWN.path,
    requireAuth(),
    (req: Request, res: Response) => {
      void req;
      const data = ShutdownRuntimeResponseSchema.parse({ ok: true as const });
      res.status(200).json(data);
      setImmediate(() => onShutdownRequest());
    }
  );

  return router;
}
