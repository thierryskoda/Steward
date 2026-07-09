import { Router, type Request, type Response } from "express";
import { HealthResponseSchema } from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = ["HEALTH"];

export function healthRoutes(): Router {
  const router = Router();
  router[ROUTES.HEALTH.method](ROUTES.HEALTH.path, (_req: Request, res: Response) => {
    const uptimeMs = process.uptime() * 1000;
    const data = HealthResponseSchema.parse({
      ok: true,
      version: "1.0",
      uptimeMs,
    });
    res.status(200).json(data);
  });
  return router;
}
