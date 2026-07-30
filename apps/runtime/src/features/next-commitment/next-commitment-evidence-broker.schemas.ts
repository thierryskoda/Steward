import { z } from "zod";
import { NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT } from "./next-commitment-limits.js";

const SafeRelativePathSchema = z.string().min(1).max(4_096);

export const NextCommitmentEvidenceBrokerConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectPaths: z.array(SafeRelativePathSchema).max(20_000),
    gitStateFile: z.literal("git-state.json"),
    taskManifestFile: z.literal("recent-codex-tasks.json"),
    auditFile: z.literal("evidence-audit.jsonl"),
  })
  .strict();

export const NextCommitmentTaskManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectRoot: z.string().min(1).max(4_096),
    capturedAt: z.number().int().nonnegative(),
    selection: z
      .object({
        lookbackDays: z.number().int().positive(),
        maxTasks: z.number().int().positive(),
        manifestTaskCount: z.number().int().nonnegative(),
        eligibleTaskCount: z.number().int().nonnegative(),
        truncated: z.boolean(),
        scanTruncated: z.boolean(),
      })
      .strict(),
    tasks: z
      .array(
        z
          .object({
            id: z.string().min(1).max(256),
            title: z.string().min(1).max(2_000),
            updatedAt: z.number().int().nonnegative(),
            transcriptBytes: z.number().int().nonnegative(),
            snapshotFile: SafeRelativePathSchema,
            snapshotBytes: z.number().int().nonnegative(),
            sourceTruncated: z.boolean(),
          })
          .strict()
      )
      .max(NEXT_COMMITMENT_RECENT_TASK_MANIFEST_LIMIT),
  })
  .strict();

export const NextCommitmentEvidenceAuditEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project-file"), path: SafeRelativePathSchema }).strict(),
  z.object({ kind: z.literal("project-state") }).strict(),
  z.object({ kind: z.literal("task-manifest") }).strict(),
  z.object({ kind: z.literal("codex-task"), taskId: z.string().min(1).max(256) }).strict(),
]);

const JsonRpcIdSchema = z.union([z.string(), z.number().finite(), z.null()]);

export const McpRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: JsonRpcIdSchema.optional(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export const McpInitializeParamsSchema = z
  .object({ protocolVersion: z.string().min(1) })
  .passthrough();

export const McpToolCallParamsSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.unknown()).optional(),
    _meta: z.unknown().optional(),
  })
  .strict();

export const ListProjectFilesArgsSchema = z
  .object({
    prefix: z.string().max(4_096).optional(),
    query: z.string().min(1).max(200).optional(),
    cursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export const ReadProjectFileArgsSchema = z
  .object({
    path: SafeRelativePathSchema,
    startLine: z.number().int().min(1).optional(),
    maxLines: z.number().int().min(1).max(400).optional(),
  })
  .strict();

export const SearchProjectFilesArgsSchema = z
  .object({
    query: z.string().min(2).max(200),
    prefix: z.string().max(4_096).optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const ReadRecentTaskArgsSchema = z
  .object({
    taskId: z.string().min(1).max(256),
    startLine: z.number().int().min(1).optional(),
    maxLines: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type INextCommitmentEvidenceBrokerConfig = z.infer<
  typeof NextCommitmentEvidenceBrokerConfigSchema
>;
export type INextCommitmentTaskManifest = z.infer<typeof NextCommitmentTaskManifestSchema>;
export type INextCommitmentEvidenceAuditEntry = z.infer<
  typeof NextCommitmentEvidenceAuditEntrySchema
>;
