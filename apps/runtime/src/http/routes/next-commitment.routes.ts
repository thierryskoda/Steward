import {
  NextCommitmentRunResponseSchema,
  NextCommitmentStatusResponseSchema,
  type INextCommitmentRunResponse,
} from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { Router, type Request, type Response } from "express";
import type { INextCommitmentRun } from "../../features/next-commitment/next-commitment.schemas.js";
import { requireAuth } from "../middleware/auth.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = [
  "NEXT_COMMITMENT_STATUS",
  "NEXT_COMMITMENT_RUNS",
];

export type INextCommitmentRouteDeps = {
  getLatestRun: () => INextCommitmentRun | null;
  startRun: () => INextCommitmentRun;
};

function toResponse(run: INextCommitmentRun): INextCommitmentRunResponse {
  return NextCommitmentRunResponseSchema.parse({
    status: run.status,
    runId: run.id,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    result: run.result,
    stopReason: run.stopReason,
  });
}

export function nextCommitmentRoutes(deps: INextCommitmentRouteDeps): Router {
  const router = Router();
  router[ROUTES.NEXT_COMMITMENT_STATUS.method](
    ROUTES.NEXT_COMMITMENT_STATUS.path,
    requireAuth(),
    (_req: Request, res: Response): void => {
      res.set("Cache-Control", "no-store");
      const latest = deps.getLatestRun();
      const response =
        latest === null
          ? NextCommitmentStatusResponseSchema.parse({ status: "never-run" })
          : NextCommitmentStatusResponseSchema.parse(toResponse(latest));
      res.status(200).json(response);
    }
  );
  router[ROUTES.NEXT_COMMITMENT_RUNS.method](
    ROUTES.NEXT_COMMITMENT_RUNS.path,
    requireAuth(),
    (_req: Request, res: Response): void => {
      res.set("Cache-Control", "no-store");
      res.status(202).json(toResponse(deps.startRun()));
    }
  );
  return router;
}
