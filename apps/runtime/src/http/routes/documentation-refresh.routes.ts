import {
  DocumentationRefreshStatusResponseSchema,
  type IDocumentationRefreshStatus,
} from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = ["DOCUMENTATION_REFRESH_STATUS"];

type IDocumentationRefreshStatusRun = {
  status: IDocumentationRefreshStatus;
  findingId: string | null;
};

export type IDocumentationRefreshRouteDeps = {
  getLatestRun: () => IDocumentationRefreshStatusRun | null;
  getLastCheckedAt: () => number | null;
};

export function documentationRefreshRoutes(deps: IDocumentationRefreshRouteDeps): Router {
  const router = Router();
  router[ROUTES.DOCUMENTATION_REFRESH_STATUS.method](
    ROUTES.DOCUMENTATION_REFRESH_STATUS.path,
    requireAuth(),
    (req: Request, res: Response): void => {
      void req;
      res.set("Cache-Control", "no-store");
      const latest = deps.getLatestRun();
      const response =
        latest === null
          ? DocumentationRefreshStatusResponseSchema.parse({
              status: "never-checked",
              lastCheckedAt: null,
              findingId: null,
            })
          : DocumentationRefreshStatusResponseSchema.parse({
              status: latest.status,
              lastCheckedAt: deps.getLastCheckedAt(),
              findingId: latest.findingId,
            });
      res.status(200).json(response);
    }
  );
  return router;
}
