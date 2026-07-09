import { randomUUID } from "crypto";
import { z } from "zod";
import {
  ACTIVITY_SLUG,
  ActivityEventSchema,
  FindingDecisionSchema,
  FindingProblemSchema,
  ImplementationResultSchema,
  ItemStatusSchema,
  STATUS,
  UndoResultSchema,
  type IActivitySlug,
  type IImplementationResult,
  type IItemStatus,
  type IUndoResult,
} from "@steward/contracts/schemas";
import { appendActivity } from "../../core/activity-helpers.js";
import type { IActivityEvent, ILifecycleTimestamps } from "../../core/lifecycle-types.js";
import { LifecycleTimestampsZodSchema } from "../../core/lifecycle-types.js";
import type { ILastImplementationTranscript } from "../../core/llm/mutation-result.types.js";
import { transcriptEntrySchema } from "../../core/llm/agent-transcript-capture.schemas.js";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";

export type ICategoriesStoreDeps = {
  isAllowedItemTransition: (from: string, to: string) => boolean;
};

let categoriesStoreDeps: ICategoriesStoreDeps | null = null;

export function setCategoriesStoreDeps(deps: ICategoriesStoreDeps): void {
  categoriesStoreDeps = deps;
}

export type IOptionId = "A" | "B" | "C";
export type IFindingProblem = z.infer<typeof FindingProblemSchema>;
export type IFindingDecision = z.infer<typeof FindingDecisionSchema>;
export type ICategoryOption = IFindingDecision["options"][number];

const CATEGORY_FILE_SCHEMA_VERSION = 1;

const lastImplementationTranscriptSchema = z.object({
  chatId: z.string(),
  path: z.string(),
  entries: z.array(transcriptEntrySchema),
  capturedAt: z.number(),
});

export type ICategoryItem = {
  schemaVersion: typeof CATEGORY_FILE_SCHEMA_VERSION;
  id: string;
  categoryId: string;
  status: IItemStatus;
  createdAt: number;
  updatedAt: number;
  implementationAttempts: number;
  lastAttemptAt: number;
  lastFailureReason: string;
  rejectedReason?: string;
  lastImplementationTranscript?: ILastImplementationTranscript;
  lastImplementationResult?: IImplementationResult;
  hasBeenReverted?: boolean;
  lastUndoResult?: IUndoResult;
  workflowChatId: string;
  reason?: string;
  dedupeKey?: string;
  contextFingerprint?: string;
  lifecycle?: ILifecycleTimestamps;
  activities?: IActivityEvent[];
  problem?: IFindingProblem;
  decision?: IFindingDecision;
  title?: string;
  locations?: string[];
  fixPlan?: string;
};

export type ICategoryItemPersisted = Omit<ICategoryItem, "status">;

export const CategoryFileSchema = z
  .object({
    schemaVersion: z.literal(CATEGORY_FILE_SCHEMA_VERSION),
    id: z.string().min(1),
    categoryId: z.string().min(1),
    createdAt: z.number(),
    updatedAt: z.number(),
    implementationAttempts: z.number().int().nonnegative(),
    lastAttemptAt: z.number(),
    lastFailureReason: z.string(),
    rejectedReason: z.string().optional(),
    lastImplementationTranscript: lastImplementationTranscriptSchema.optional(),
    lastImplementationResult: ImplementationResultSchema.optional(),
    hasBeenReverted: z.boolean().optional(),
    lastUndoResult: UndoResultSchema.optional(),
    workflowChatId: z.string().min(1),
    reason: z.string().optional(),
    dedupeKey: z.string().optional(),
    contextFingerprint: z.string().optional(),
    lifecycle: LifecycleTimestampsZodSchema.optional(),
    activities: z.array(ActivityEventSchema).optional(),
    problem: FindingProblemSchema.optional(),
    decision: FindingDecisionSchema.optional(),
    title: z.string().optional(),
    locations: z.array(z.string()).optional(),
    fixPlan: z.string().optional(),
  })
  .strict();

const categoryItemPayloadSchema = CategoryFileSchema.extend({
  status: ItemStatusSchema,
});

type IFindingRow = {
  id: string;
  category_id: string;
  status: IItemStatus;
  payload_json: string;
  activities_json: string;
  lifecycle_json: string | null;
  workflow_chat_id: string;
  dedupe_key: string | null;
  context_fingerprint: string | null;
  selected_option_id: IOptionId | null;
  rejected_reason: string | null;
  failure_reason: string | null;
  claimed_at: number | null;
  agent_started_at: number | null;
  created_at: number;
  updated_at: number;
};

function emptyActivities(): IActivityEvent[] {
  return [];
}

function parseFindingRow(row: IFindingRow): ICategoryItem {
  const payload = parseJsonFromDb({
    raw: row.payload_json,
    schema: categoryItemPayloadSchema,
    context: { table: "findings", id: row.id },
  });
  const activities = parseJsonFromDb({
    raw: row.activities_json,
    schema: z.array(ActivityEventSchema),
    context: { table: "findings", id: row.id, column: "activities_json" },
  });
  const lifecycle =
    row.lifecycle_json === null
      ? undefined
      : parseJsonFromDb({
          raw: row.lifecycle_json,
          schema: LifecycleTimestampsZodSchema,
          context: { table: "findings", id: row.id, column: "lifecycle_json" },
        });
  return {
    ...payload,
    status: row.status,
    activities,
    ...(lifecycle !== undefined ? { lifecycle } : {}),
    ...(row.selected_option_id && payload.decision
      ? {
          decision: {
            ...payload.decision,
            selectedOptionId: row.selected_option_id,
          },
        }
      : {}),
    ...(row.rejected_reason ? { rejectedReason: row.rejected_reason } : {}),
    ...(row.failure_reason ? { lastFailureReason: row.failure_reason } : {}),
    updatedAt: row.updated_at,
  };
}

function rowForItem(item: ICategoryItem): {
  payloadJson: string;
  activitiesJson: string;
  lifecycleJson: string | null;
} {
  return {
    payloadJson: stringifyJsonForDb(item),
    activitiesJson: stringifyJsonForDb(item.activities ?? emptyActivities()),
    lifecycleJson: item.lifecycle ? stringifyJsonForDb(item.lifecycle) : null,
  };
}

function insertOrReplaceFinding(item: ICategoryItem): void {
  const row = rowForItem(item);
  getRuntimeDb()
    .prepare(
      `INSERT INTO findings (
        id, category_id, status, payload_json, activities_json, lifecycle_json,
        workflow_chat_id, dedupe_key, context_fingerprint, selected_option_id,
        rejected_reason, failure_reason, claimed_at, agent_started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category_id = excluded.category_id,
        status = excluded.status,
        payload_json = excluded.payload_json,
        activities_json = excluded.activities_json,
        lifecycle_json = excluded.lifecycle_json,
        workflow_chat_id = excluded.workflow_chat_id,
        dedupe_key = excluded.dedupe_key,
        context_fingerprint = excluded.context_fingerprint,
        selected_option_id = excluded.selected_option_id,
        rejected_reason = excluded.rejected_reason,
        failure_reason = excluded.failure_reason,
        claimed_at = excluded.claimed_at,
        agent_started_at = excluded.agent_started_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`
    )
    .run(
      item.id,
      item.categoryId,
      item.status,
      row.payloadJson,
      row.activitiesJson,
      row.lifecycleJson,
      item.workflowChatId,
      item.dedupeKey ?? null,
      item.contextFingerprint ?? null,
      item.decision?.selectedOptionId ?? null,
      item.rejectedReason ?? null,
      item.lastFailureReason || null,
      item.status === STATUS.CLAIMED ? Date.now() : null,
      item.status === STATUS.AGENT_RUNNING ? Date.now() : null,
      item.createdAt,
      item.updatedAt
    );
}

function readRows(whereSql: string, params: unknown[]): ICategoryItem[] {
  const rows = getRuntimeDb()
    .prepare(
      `SELECT id, category_id, status, payload_json, activities_json, lifecycle_json,
        workflow_chat_id, dedupe_key, context_fingerprint, selected_option_id,
        rejected_reason, failure_reason, claimed_at, agent_started_at, created_at, updated_at
       FROM findings ${whereSql}
       ORDER BY created_at ASC`
    )
    .all(...params) as IFindingRow[];
  return rows.map(parseFindingRow);
}

export function resolveImplementationPlan(item: ICategoryItem): string {
  const selectedId = item.decision?.selectedOptionId;
  const option =
    selectedId !== undefined
      ? item.decision?.options.find((candidate) => candidate.id === selectedId)
      : item.decision?.options[0];
  return option?.technicalPlan ?? item.fixPlan ?? "";
}

export function getItemTitle(item: ICategoryItemPersisted): string {
  return item.problem?.title ?? item.title ?? "Untitled finding";
}

export function getItemLocations(item: ICategoryItemPersisted): string[] {
  return item.problem?.locations ?? item.locations ?? [];
}

export function listFindingsByStatusForCategory(
  projectRoot: string,
  categoryId: string,
  status: IItemStatus
): ICategoryItem[] {
  void projectRoot;
  return readRows("WHERE category_id = ? AND status = ?", [categoryId, status]);
}

export function listReviewFindingsForCategory(
  projectRoot: string,
  categoryId: string
): ICategoryItem[] {
  return listFindingsByStatusForCategory(projectRoot, categoryId, STATUS.NEEDS_REVIEW);
}

export function listApprovedFindingsForCategory(
  projectRoot: string,
  categoryId: string
): ICategoryItem[] {
  return listFindingsByStatusForCategory(projectRoot, categoryId, STATUS.APPROVED);
}

export function listLearningFromRejectionFindingsForCategory(
  projectRoot: string,
  categoryId: string
): ICategoryItem[] {
  return listFindingsByStatusForCategory(projectRoot, categoryId, STATUS.LEARNING_FROM_REJECTION);
}

export function listClaimedFindingsForCategory(
  projectRoot: string,
  categoryId: string
): ICategoryItem[] {
  return listFindingsByStatusForCategory(projectRoot, categoryId, STATUS.CLAIMED);
}

export function listAgentRunningFindingsForCategory(
  projectRoot: string,
  categoryId: string
): ICategoryItem[] {
  return listFindingsByStatusForCategory(projectRoot, categoryId, STATUS.AGENT_RUNNING);
}

export function listAllFindingsForCategory(
  projectRoot: string,
  categoryId: string
): ICategoryItem[] {
  void projectRoot;
  return readRows("WHERE category_id = ?", [categoryId]);
}

export function getFindingByCategoryAndId(
  projectRoot: string,
  categoryId: string,
  id: string
): { item: ICategoryItem } | null {
  void projectRoot;
  const rows = readRows("WHERE category_id = ? AND id = ?", [categoryId, id]);
  const item = rows[0];
  return item ? { item } : null;
}

export function getFindingByIdAcrossCategories(
  projectRoot: string,
  categoryIds: string[],
  id: string
): { categoryId: string; item: ICategoryItem } | null {
  for (const categoryId of categoryIds) {
    const found = getFindingByCategoryAndId(projectRoot, categoryId, id);
    if (found) return { categoryId, item: found.item };
  }
  return null;
}

function transitionSlug(from: IItemStatus, to: IItemStatus): IActivitySlug | null {
  if (from === STATUS.NEEDS_REVIEW && to === STATUS.APPROVED) {
    return ACTIVITY_SLUG.WORKFLOW_ITEM_APPROVED_BY_USER;
  }
  if (to === STATUS.LEARNING_FROM_REJECTION || to === STATUS.REJECTED) {
    return ACTIVITY_SLUG.WORKFLOW_ITEM_REJECTED_BY_USER;
  }
  if (to === STATUS.CLAIMED) return ACTIVITY_SLUG.WORKFLOW_ITEM_CLAIMED_FOR_AGENT_RUN;
  if (to === STATUS.AGENT_RUNNING) return ACTIVITY_SLUG.CATEGORY_IMPLEMENT_AGENT_STARTED;
  if (to === STATUS.IMPLEMENTED) return ACTIVITY_SLUG.CATEGORY_IMPLEMENT_AGENT_FINISHED;
  if (to === STATUS.FAILED) return ACTIVITY_SLUG.CATEGORY_IMPLEMENT_AGENT_FAILED;
  return null;
}

export function transitionFindingStatus(
  projectRoot: string,
  categoryId: string,
  id: string,
  status: IItemStatus,
  opts?: {
    selectedOptionId?: IOptionId;
    rejectedReason?: string;
    lastFailureReason?: string;
    lastImplementationTranscript?: ILastImplementationTranscript;
    lastImplementationResult?: IImplementationResult;
  }
): boolean {
  const found = getFindingByCategoryAndId(projectRoot, categoryId, id);
  if (!found) return false;
  const item = found.item;
  if (categoriesStoreDeps && !categoriesStoreDeps.isAllowedItemTransition(item.status, status)) {
    return false;
  }
  const now = Date.now();
  const slug = transitionSlug(item.status, status);
  const activities = slug ? appendActivity(item.activities, slug) : item.activities;
  const decision =
    opts?.selectedOptionId && item.decision
      ? { ...item.decision, selectedOptionId: opts.selectedOptionId }
      : item.decision;
  insertOrReplaceFinding({
    ...item,
    status,
    updatedAt: now,
    ...(decision ? { decision } : {}),
    ...(activities ? { activities } : {}),
    ...(opts?.rejectedReason !== undefined ? { rejectedReason: opts.rejectedReason } : {}),
    ...(opts?.lastFailureReason !== undefined ? { lastFailureReason: opts.lastFailureReason } : {}),
    ...(opts?.lastImplementationTranscript !== undefined
      ? { lastImplementationTranscript: opts.lastImplementationTranscript }
      : {}),
    ...(opts?.lastImplementationResult !== undefined
      ? { lastImplementationResult: opts.lastImplementationResult }
      : {}),
  });
  return true;
}

export function failFindingFromAgent(args: {
  projectRoot: string;
  categoryId: string;
  id: string;
  lastFailureReason: string;
  maxRetries: number;
  lastImplementationTranscript?: ILastImplementationTranscript;
}): boolean {
  void args.maxRetries;
  const found = getFindingByCategoryAndId(args.projectRoot, args.categoryId, args.id);
  if (!found) return false;
  insertOrReplaceFinding({
    ...found.item,
    status: STATUS.FAILED,
    updatedAt: Date.now(),
    lastFailureReason: args.lastFailureReason,
    ...(args.lastImplementationTranscript !== undefined
      ? { lastImplementationTranscript: args.lastImplementationTranscript }
      : {}),
    activities: appendActivity(
      found.item.activities,
      ACTIVITY_SLUG.CATEGORY_IMPLEMENT_AGENT_FAILED
    ),
  });
  return true;
}

export function createFinding(args: {
  categoryId: string;
  reason?: string;
  title?: string;
  locations?: string[];
  fixPlan?: string;
  workflowChatId?: string;
  problem?: IFindingProblem;
  decision?: IFindingDecision;
  dedupeKey?: string;
  contextFingerprint?: string;
  status?: IItemStatus;
}): ICategoryItem {
  const now = Date.now();
  return {
    schemaVersion: CATEGORY_FILE_SCHEMA_VERSION,
    id: randomUUID(),
    categoryId: args.categoryId,
    status: args.status ?? STATUS.NEEDS_REVIEW,
    createdAt: now,
    updatedAt: now,
    implementationAttempts: 0,
    lastAttemptAt: 0,
    lastFailureReason: "",
    workflowChatId: args.workflowChatId ?? randomUUID(),
    activities: appendActivity(undefined, ACTIVITY_SLUG.WORKFLOW_ITEM_DETECTED),
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.locations !== undefined ? { locations: args.locations } : {}),
    ...(args.fixPlan !== undefined ? { fixPlan: args.fixPlan } : {}),
    ...(args.problem !== undefined ? { problem: args.problem } : {}),
    ...(args.decision !== undefined ? { decision: args.decision } : {}),
    ...(args.dedupeKey !== undefined ? { dedupeKey: args.dedupeKey } : {}),
    ...(args.contextFingerprint !== undefined
      ? { contextFingerprint: args.contextFingerprint }
      : {}),
  };
}

export function saveFinding(projectRoot: string, item: ICategoryItem): void {
  void projectRoot;
  insertOrReplaceFinding(item);
}

export function patchFindingFromAgent(args: {
  projectRoot: string;
  categoryId: string;
  id: string;
  patch: Partial<ICategoryItem>;
}): boolean;
export function patchFindingFromAgent(args: {
  projectRoot: string;
  categoryId: string;
  id: string;
  patch: Partial<ICategoryItem>;
}): boolean {
  const found = getFindingByCategoryAndId(args.projectRoot, args.categoryId, args.id);
  if (!found) return false;
  insertOrReplaceFinding({ ...found.item, ...args.patch, updatedAt: Date.now() });
  return true;
}

export function patchFindingLifecycle(args: {
  projectRoot: string;
  categoryId: string;
  id: string;
  patch: ILifecycleTimestamps;
}): boolean {
  return patchFindingFromAgent({
    projectRoot: args.projectRoot,
    categoryId: args.categoryId,
    id: args.id,
    patch: { lifecycle: args.patch },
  });
}

export function appendFindingActivity(
  projectRoot: string,
  categoryId: string,
  id: string,
  slug: IActivitySlug,
  meta?: Record<string, unknown>
): boolean {
  const found = getFindingByCategoryAndId(projectRoot, categoryId, id);
  if (!found) return false;
  insertOrReplaceFinding({
    ...found.item,
    activities: appendActivity(found.item.activities, slug, meta),
    updatedAt: Date.now(),
  });
  return true;
}

export function updateFindingUndoResult(args: {
  projectRoot: string;
  categoryId: string;
  id: string;
  result: IUndoResult;
  reverted: boolean;
}): boolean {
  const found = getFindingByCategoryAndId(args.projectRoot, args.categoryId, args.id);
  if (!found) return false;
  insertOrReplaceFinding({
    ...found.item,
    hasBeenReverted: args.reverted,
    lastUndoResult: args.result,
    updatedAt: Date.now(),
    activities: appendActivity(
      found.item.activities,
      args.reverted
        ? ACTIVITY_SLUG.WORKFLOW_ITEM_REVERTED
        : ACTIVITY_SLUG.WORKFLOW_ITEM_UNDO_PARTIALLY_REVERTED
    ),
  });
  return true;
}

export function recoverInterruptedFindingsForCategory(args: {
  projectRoot: string;
  categoryId: string;
  staleMs: number;
  now?: number;
}): void {
  const now = args.now ?? Date.now();
  for (const item of [
    ...listClaimedFindingsForCategory(args.projectRoot, args.categoryId),
    ...listAgentRunningFindingsForCategory(args.projectRoot, args.categoryId),
  ]) {
    if (now - item.updatedAt < args.staleMs) continue;
    const target = item.status === STATUS.CLAIMED ? STATUS.APPROVED : STATUS.FAILED;
    transitionFindingStatus(args.projectRoot, args.categoryId, item.id, target);
  }
}

export function recoverInterruptedFindingsOnStartup(args: { categoryId: string }): void {
  for (const item of listClaimedFindingsForCategory("", args.categoryId)) {
    transitionFindingStatus("", args.categoryId, item.id, STATUS.APPROVED);
  }
  for (const item of listAgentRunningFindingsForCategory("", args.categoryId)) {
    transitionFindingStatus("", args.categoryId, item.id, STATUS.FAILED);
  }
}
