import { z } from "zod";
import {
  ApprovalModeSchema,
  FeatureFlagsSchema,
  type IConfigResponse,
  type IInitializeConfigBody,
  type IUpdateConfigBody,
} from "@steward/contracts/schemas";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";

export const CONFIG_SCHEMA_VERSION = 2;

export const PROJECT_CONFIG_DEFAULT_FEATURES = {
  genericFindingEnabled: true,
  rulesWorkflowEnabled: false,
  continualLearningEnabled: false,
  optionHintsEnabled: false,
} as const satisfies IConfigResponse["features"];

export const ProjectConfigSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    ruleSources: z.array(z.string()),
    approvalMode: ApprovalModeSchema,
    projectContext: z.array(z.string()),
    features: FeatureFlagsSchema,
  })
  .strict();

export type IProjectConfig = z.infer<typeof ProjectConfigSchema>;

type IProjectConfigRow = {
  schema_version: number;
  payload_json: string;
};

function parseConfigRow(row: IProjectConfigRow): IProjectConfig {
  return parseJsonFromDb({
    raw: row.payload_json,
    schema: ProjectConfigSchema,
    context: { table: "project_config", id: "active", schemaVersion: row.schema_version },
  });
}

export function readProjectConfig(): IProjectConfig | null {
  const row = getRuntimeDb()
    .prepare("SELECT schema_version, payload_json FROM project_config WHERE id = 'active'")
    .get() as IProjectConfigRow | undefined;
  return row ? parseConfigRow(row) : null;
}

export function writeProjectConfig(config: IProjectConfig): IProjectConfig {
  const parsed = ProjectConfigSchema.parse(config);
  getRuntimeDb()
    .prepare(
      `INSERT INTO project_config (id, schema_version, payload_json, updated_at)
       VALUES ('active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    )
    .run(parsed.schemaVersion, stringifyJsonForDb(parsed), Date.now());
  return parsed;
}

export function initializeProjectConfig(input: IInitializeConfigBody): IProjectConfig {
  return writeProjectConfig({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ruleSources: input.ruleSources,
    approvalMode: input.approvalMode,
    projectContext: input.projectContext,
    features: input.features ?? PROJECT_CONFIG_DEFAULT_FEATURES,
  });
}

export function updateProjectConfig(patch: IUpdateConfigBody): IProjectConfig {
  const existing = readProjectConfig();
  if (!existing) {
    throw new Error("Project config is missing. Initialize the project before updating config.");
  }
  return writeProjectConfig({
    ...existing,
    ...patch,
    features: patch.features ?? existing.features,
  });
}

export function getProjectFeatureFlags(): IProjectConfig["features"] {
  return readProjectConfig()?.features ?? PROJECT_CONFIG_DEFAULT_FEATURES;
}
