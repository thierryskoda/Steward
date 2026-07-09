import { Router, type Request, type Response } from "express";
import { ScanningStatusResponseSchema, type IScanningStatus } from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { requireAuth } from "../middleware/auth.js";
import { sendApiError } from "../api-response.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = [
  "SCANNING_STATUS",
  "SCANNING_RESUME",
  "SCANNING_PAUSE",
];

export type IScanningRouteDeps = {
  getScanningStatus: () => IScanningStatus;
  resumeScanning: () => Promise<void>;
  pauseScanning: () => Promise<void>;
};

export function scanningRoutes(deps: IScanningRouteDeps): Router {
  const router = Router();
  const { getScanningStatus, resumeScanning, pauseScanning } = deps;

  router[ROUTES.SCANNING_STATUS.method](
    ROUTES.SCANNING_STATUS.path,
    requireAuth(),
    (req: Request, res: Response) => {
      void req;
      const status = getScanningStatus();
      const response = ScanningStatusResponseSchema.parse({ status });
      res.status(200).json(response);
    }
  );

  router[ROUTES.SCANNING_RESUME.method](
    ROUTES.SCANNING_RESUME.path,
    requireAuth(),
    async (req: Request, res: Response) => {
      void req;
      try {
        await resumeScanning();
        const status = getScanningStatus();
        const response = ScanningStatusResponseSchema.parse({ status });
        res.status(200).json(response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendApiError(res, 500, "INTERNAL_ERROR", msg);
      }
    }
  );

  router[ROUTES.SCANNING_PAUSE.method](
    ROUTES.SCANNING_PAUSE.path,
    requireAuth(),
    async (req: Request, res: Response) => {
      void req;
      try {
        await pauseScanning();
        const status = getScanningStatus();
        const response = ScanningStatusResponseSchema.parse({ status });
        res.status(200).json(response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendApiError(res, 500, "INTERNAL_ERROR", msg);
      }
    }
  );

  return router;
}
