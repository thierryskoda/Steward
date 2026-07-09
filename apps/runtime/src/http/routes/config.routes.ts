/**
 * GET /v1/config: return full repo-scope config (404 if missing).
 * PATCH /v1/config: update DB-backed config and run lifecycle reconciliation.
 * POST /v1/config/initialize: write full config, start activation, and return immediately.
 */
import { Router, type Request, type Response } from "express";
import {
  ConfigResponseSchema,
  InitializeConfigBodySchema,
  UpdateConfigBodySchema,
} from "@steward/contracts/schemas";
import { ROUTES } from "@steward/contracts/routes";
import { requireAuth } from "../middleware/auth.js";
import { sendApiError } from "../api-response.js";
import { HTTP_HANDLER_UNCAUGHT_ERROR } from "../../core/runtime-log-events.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { getProjectRoot } from "../../core/project-root.js";

export const MOUNTED_ROUTE_KEYS: (keyof typeof ROUTES)[] = [
  "CONFIG_GET",
  "CONFIG_UPDATE",
  "CONFIG_INITIALIZE",
];

/** Config shape for this route; supplied via deps from lifecycle. */
export type IConfigRouteConfig = {
  schemaVersion: number;
  ruleSources: string[];
  approvalMode: string;
  projectContext: string[];
  features: Record<string, unknown>;
};

export type IConfigRouteDeps = {
  getRuntimeStatus: () => { state: string };
  runActivation: (config: IConfigRouteConfig) => Promise<void>;
  readConfig: (projectRoot: string) => IConfigRouteConfig | null;
  writeConfig: (projectRoot: string, config: IConfigRouteConfig) => void;
  configSchemaVersion: number;
  featureFlagsDefaults: Record<string, unknown>;
};

export function configRoutes(deps: IConfigRouteDeps): Router {
  const router = Router();
  const {
    getRuntimeStatus,
    runActivation,
    readConfig,
    writeConfig,
    configSchemaVersion,
    featureFlagsDefaults,
  } = deps;

  router[ROUTES.CONFIG_GET.method](
    ROUTES.CONFIG_GET.path,
    requireAuth(),
    async (req: Request, res: Response) => {
      void req;
      const config = readConfig(getProjectRoot());
      if (config === null) {
        sendApiError(res, 404, "CONFIG_MISSING", "Project config not found.");
        return;
      }
      const data = ConfigResponseSchema.parse(config);
      res.status(200).json(data);
    }
  );

  router[ROUTES.CONFIG_UPDATE.method](
    ROUTES.CONFIG_UPDATE.path,
    requireAuth(),
    async (req: Request, res: Response) => {
      const config = readConfig(getProjectRoot());
      if (config === null) {
        sendApiError(res, 404, "CONFIG_MISSING", "Project config not found.");
        return;
      }
      const parseResult = UpdateConfigBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const details = parseResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        sendApiError(res, 400, "VALIDATION_ERROR", `Invalid request body. ${details}`);
        return;
      }
      const patch = parseResult.data;
      const updated: IConfigRouteConfig = {
        ...config,
        ...(patch.features !== undefined ? { features: patch.features } : {}),
        ...(patch.ruleSources !== undefined ? { ruleSources: patch.ruleSources } : {}),
        ...(patch.approvalMode !== undefined ? { approvalMode: patch.approvalMode } : {}),
        ...(patch.projectContext !== undefined ? { projectContext: patch.projectContext } : {}),
      };
      const diffSummary: Record<string, unknown> = {};
      if (patch.features !== undefined) {
        diffSummary.features = { before: config.features, after: updated.features };
      }
      if (patch.ruleSources !== undefined) {
        diffSummary.ruleSources = { before: config.ruleSources, after: updated.ruleSources };
      }
      if (patch.approvalMode !== undefined) {
        diffSummary.approvalMode = { before: config.approvalMode, after: updated.approvalMode };
      }
      if (patch.projectContext !== undefined) {
        diffSummary.projectContext = {
          before: config.projectContext,
          after: updated.projectContext,
        };
      }
      getRuntimeLogger().info({
        event: "CONFIG_PATCH_APPLIED",
        requestId: req.requestId,
        changedKeys: Object.keys(patch),
        diffSummary,
      });
      try {
        writeConfig(getProjectRoot(), updated);
      } catch (err) {
        logError(err, {
          event: HTTP_HANDLER_UNCAUGHT_ERROR,
          component: "http",
          operation: `${ROUTES.CONFIG_UPDATE.method} ${ROUTES.CONFIG_UPDATE.path}`,
          requestId: req.requestId,
        });
        sendApiError(
          res,
          500,
          "CONFIG_WRITE_FAILED",
          err instanceof Error ? err.message : "Failed to write config."
        );
        return;
      }
      try {
        await runActivation(updated);
      } catch (err) {
        logError(err, {
          event: HTTP_HANDLER_UNCAUGHT_ERROR,
          component: "http",
          operation: `${ROUTES.CONFIG_UPDATE.method} ${ROUTES.CONFIG_UPDATE.path} runActivation`,
          requestId: req.requestId,
        });
        const message = err instanceof Error ? err.message : String(err);
        sendApiError(res, 500, "RECONCILE_FAILED", message);
        return;
      }
      const data = ConfigResponseSchema.parse(updated);
      res.status(200).json(data);
    }
  );

  router[ROUTES.CONFIG_INITIALIZE.method](
    ROUTES.CONFIG_INITIALIZE.path,
    requireAuth(),
    async (req: Request, res: Response) => {
      if (getRuntimeStatus().state !== "needs-config") {
        sendApiError(
          res,
          409,
          "ALREADY_INITIALIZED",
          "Runtime already initialized. Config can only be set once when state is needs-config."
        );
        return;
      }
      const parseResult = InitializeConfigBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const details = parseResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        sendApiError(res, 400, "VALIDATION_ERROR", `Invalid request body. ${details}`);
        return;
      }
      const { ruleSources, approvalMode, projectContext, features } = parseResult.data;
      const fullConfig: IConfigRouteConfig = {
        schemaVersion: configSchemaVersion,
        ruleSources,
        approvalMode,
        projectContext,
        features: features ?? featureFlagsDefaults,
      };
      try {
        writeConfig(getProjectRoot(), fullConfig);
      } catch (err) {
        logError(err, {
          event: HTTP_HANDLER_UNCAUGHT_ERROR,
          component: "http",
          operation: `${ROUTES.CONFIG_INITIALIZE.method} ${ROUTES.CONFIG_INITIALIZE.path}`,
          requestId: req.requestId,
        });
        sendApiError(
          res,
          500,
          "CONFIG_WRITE_FAILED",
          err instanceof Error ? err.message : "Failed to write config."
        );
        return;
      }
      const activation = runActivation(fullConfig);
      void activation.catch((err: unknown) => {
        logError(err, {
          event: HTTP_HANDLER_UNCAUGHT_ERROR,
          component: "http",
          operation: `${ROUTES.CONFIG_INITIALIZE.method} ${ROUTES.CONFIG_INITIALIZE.path} runActivation`,
          requestId: req.requestId,
        });
      });
      const data = ConfigResponseSchema.parse(fullConfig);
      res.status(200).json(data);
    }
  );

  return router;
}
