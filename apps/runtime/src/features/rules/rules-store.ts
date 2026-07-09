import { randomUUID } from "crypto";
import { z } from "zod";
import {
  ACTIVITY_SLUG,
  ActivityEventSchema,
  ItemStatusSchema,
  STATUS,
  type IActivitySlug,
  type IItemStatus,
} from "@steward/contracts/schemas";
import { appendActivity } from "../../core/activity-helpers.js";
import type { IActivityEvent, ILifecycleTimestamps } from "../../core/lifecycle-types.js";
import { LifecycleTimestampsZodSchema } from "../../core/lifecycle-types.js";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";
import { loadSnapshot } from "../categories/rules-snapshot.js";

const RULE_PROPOSAL_SCHEMA_VERSION = 1;

export type IRulesStoreDeps = {
  isAllowedRuleTransition: (from: string, to: string) => boolean;
};

let rulesStoreDeps: IRulesStoreDeps | null = null;

export function setRulesStoreDeps(deps: IRulesStoreDeps): void {
  rulesStoreDeps = deps;
}

export type IRuleStatus = IItemStatus;

export type IRuleProposal = {
  schemaVersion: typeof RULE_PROPOSAL_SCHEMA_VERSION;
  id: string;
  title: string;
  ruleText: string;
  rationale: string;
  sourceMessageId: string;
  sourceChatId?: string;
  status: IRuleStatus;
  createdAt: number;
  updatedAt: number;
  retryCount?: number;
  activities?: IActivityEvent[];
  lifecycle?: ILifecycleTimestamps;
};

export const RuleProposalPersistedSchema = z
  .object({
    schemaVersion: z.literal(RULE_PROPOSAL_SCHEMA_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    ruleText: z.string().min(1),
    rationale: z.string().min(1),
    sourceMessageId: z.string().min(1),
    sourceChatId: z.string().optional(),
    status: ItemStatusSchema.refine((status) => status !== STATUS.LEARNING_FROM_REJECTION),
    createdAt: z.number(),
    updatedAt: z.number(),
    retryCount: z.number().optional(),
    activities: z.array(ActivityEventSchema).optional(),
    lifecycle: LifecycleTimestampsZodSchema.optional(),
  })
  .strict();

type IRuleRow = {
  id: string;
  status: IRuleStatus;
  payload_json: string;
  activities_json: string;
  lifecycle_json: string | null;
  source_message_id: string;
  source_chat_id: string | null;
  failure_reason: string | null;
  claimed_at: number | null;
  agent_started_at: number | null;
  created_at: number;
  updated_at: number;
};

function parseRuleRow(row: IRuleRow): IRuleProposal {
  const payload = parseJsonFromDb({
    raw: row.payload_json,
    schema: RuleProposalPersistedSchema,
    context: { table: "rules", id: row.id },
  });
  const activities = parseJsonFromDb({
    raw: row.activities_json,
    schema: z.array(ActivityEventSchema),
    context: { table: "rules", id: row.id, column: "activities_json" },
  });
  const lifecycle =
    row.lifecycle_json === null
      ? undefined
      : parseJsonFromDb({
          raw: row.lifecycle_json,
          schema: LifecycleTimestampsZodSchema,
          context: { table: "rules", id: row.id, column: "lifecycle_json" },
        });
  return {
    ...payload,
    status: row.status,
    activities,
    updatedAt: row.updated_at,
    ...(lifecycle !== undefined ? { lifecycle } : {}),
    ...(row.source_chat_id !== null ? { sourceChatId: row.source_chat_id } : {}),
  };
}

function writeRuleRow(rule: IRuleProposal): void {
  const activities = rule.activities ?? [];
  getRuntimeDb()
    .prepare(
      `INSERT INTO rules (
        id, status, payload_json, activities_json, lifecycle_json, source_message_id,
        source_chat_id, failure_reason, claimed_at, agent_started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        payload_json = excluded.payload_json,
        activities_json = excluded.activities_json,
        lifecycle_json = excluded.lifecycle_json,
        source_message_id = excluded.source_message_id,
        source_chat_id = excluded.source_chat_id,
        failure_reason = excluded.failure_reason,
        claimed_at = excluded.claimed_at,
        agent_started_at = excluded.agent_started_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`
    )
    .run(
      rule.id,
      rule.status,
      stringifyJsonForDb(rule),
      stringifyJsonForDb(activities),
      rule.lifecycle ? stringifyJsonForDb(rule.lifecycle) : null,
      rule.sourceMessageId,
      rule.sourceChatId ?? null,
      null,
      rule.status === STATUS.CLAIMED ? Date.now() : null,
      rule.status === STATUS.AGENT_RUNNING ? Date.now() : null,
      rule.createdAt,
      rule.updatedAt
    );
}

function readRules(whereSql: string, params: unknown[]): IRuleProposal[] {
  const rows = getRuntimeDb()
    .prepare(
      `SELECT id, status, payload_json, activities_json, lifecycle_json,
        source_message_id, source_chat_id, failure_reason, claimed_at,
        agent_started_at, created_at, updated_at
       FROM rules ${whereSql}
       ORDER BY created_at ASC`
    )
    .all(...params) as IRuleRow[];
  return rows.map(parseRuleRow);
}

export function listReviewRules(projectRoot: string): IRuleProposal[] {
  void projectRoot;
  return readRules("WHERE status = ?", [STATUS.NEEDS_REVIEW]);
}

export function listApprovedRules(projectRoot: string): IRuleProposal[] {
  void projectRoot;
  return readRules("WHERE status = ?", [STATUS.APPROVED]);
}

export function listAllRules(projectRoot: string): IRuleProposal[] {
  void projectRoot;
  return readRules("", []);
}

export function listClaimedRules(projectRoot: string): IRuleProposal[] {
  void projectRoot;
  return readRules("WHERE status = ?", [STATUS.CLAIMED]);
}

export function listAgentRunningRules(projectRoot: string): IRuleProposal[] {
  void projectRoot;
  return readRules("WHERE status = ?", [STATUS.AGENT_RUNNING]);
}

export type IRuleCorpusItem = {
  id: string;
  title?: string;
  ruleText: string;
  source: "snapshot" | "needs-review" | "in_flight";
};

export function normalizeRuleTextForDedupe(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function readAllRuleCorporaForDedupe(projectRoot: string): IRuleCorpusItem[] {
  const snapshot = loadSnapshot(projectRoot);
  const snapshotRules =
    snapshot?.categories.map((entry) => ({
      id: entry.categoryId,
      title: entry.categoryId,
      ruleText: entry.ruleContent,
      source: "snapshot" as const,
    })) ?? [];
  const dbRules = listAllRules(projectRoot).map((rule) => ({
    id: rule.id,
    title: rule.title,
    ruleText: rule.ruleText,
    source:
      rule.status === STATUS.NEEDS_REVIEW || rule.status === STATUS.APPROVED
        ? ("needs-review" as const)
        : ("in_flight" as const),
  }));
  return [...snapshotRules, ...dbRules];
}

export function isExactDuplicateInCorpus(ruleText: string, corpus: IRuleCorpusItem[]): boolean {
  const normalized = normalizeRuleTextForDedupe(ruleText);
  return corpus.some((item) => normalizeRuleTextForDedupe(item.ruleText) === normalized);
}

export function findRuleById(projectRoot: string, id: string): { rule: IRuleProposal } | null {
  void projectRoot;
  const rule = readRules("WHERE id = ?", [id])[0];
  return rule ? { rule } : null;
}

export function saveRuleProposal(projectRoot: string, rule: IRuleProposal): void {
  void projectRoot;
  writeRuleRow(rule);
}

function transitionSlug(from: IRuleStatus, to: IRuleStatus): IActivitySlug | null {
  if (from === STATUS.NEEDS_REVIEW && to === STATUS.APPROVED) {
    return ACTIVITY_SLUG.WORKFLOW_ITEM_APPROVED_BY_USER;
  }
  if (to === STATUS.REJECTED) return ACTIVITY_SLUG.WORKFLOW_ITEM_REJECTED_BY_USER;
  if (to === STATUS.CLAIMED) return ACTIVITY_SLUG.WORKFLOW_ITEM_CLAIMED_FOR_AGENT_RUN;
  if (to === STATUS.AGENT_RUNNING) return ACTIVITY_SLUG.DOCS_UPDATE_IMPLEMENT_AGENT_STARTED;
  if (to === STATUS.IMPLEMENTED) return ACTIVITY_SLUG.DOCS_UPDATE_IMPLEMENT_AGENT_FINISHED;
  if (to === STATUS.FAILED) return ACTIVITY_SLUG.DOCS_UPDATE_IMPLEMENT_AGENT_FAILED;
  return null;
}

export function transitionRuleStatus(
  projectRoot: string,
  id: string,
  targetStatus: IItemStatus
): boolean {
  const found = findRuleById(projectRoot, id);
  if (!found) return false;
  const rule = found.rule;
  if (rulesStoreDeps && !rulesStoreDeps.isAllowedRuleTransition(rule.status, targetStatus)) {
    return false;
  }
  const slug = transitionSlug(rule.status, targetStatus);
  writeRuleRow({
    ...rule,
    status: targetStatus,
    updatedAt: Date.now(),
    ...(slug ? { activities: appendActivity(rule.activities, slug) } : {}),
  });
  return true;
}

export function updateRuleInPlace(
  projectRoot: string,
  id: string,
  patch: Partial<IRuleProposal>
): boolean {
  const found = findRuleById(projectRoot, id);
  if (!found) return false;
  writeRuleRow({ ...found.rule, ...patch, updatedAt: Date.now() });
  return true;
}

export function recoverInterruptedRulesOnStartup(projectRoot: string): void {
  for (const rule of listClaimedRules(projectRoot)) {
    transitionRuleStatus(projectRoot, rule.id, STATUS.APPROVED);
  }
  for (const rule of listAgentRunningRules(projectRoot)) {
    transitionRuleStatus(projectRoot, rule.id, STATUS.FAILED);
  }
}

export function recoverInterruptedRules(args: {
  projectRoot: string;
  staleMs: number;
  implementingMaxRetries: number;
  now?: number;
}): void {
  const now = args.now ?? Date.now();
  for (const rule of [
    ...listClaimedRules(args.projectRoot),
    ...listAgentRunningRules(args.projectRoot),
  ]) {
    if (now - rule.updatedAt < args.staleMs) continue;
    const target = rule.status === STATUS.CLAIMED ? STATUS.APPROVED : STATUS.FAILED;
    transitionRuleStatus(args.projectRoot, rule.id, target);
  }
}

export function createRuleProposal(args: {
  title: string;
  ruleText: string;
  rationale: string;
  sourceMessageId: string;
  sourceChatId?: string;
}): IRuleProposal {
  const now = Date.now();
  return {
    schemaVersion: RULE_PROPOSAL_SCHEMA_VERSION,
    id: randomUUID(),
    title: args.title.trim(),
    ruleText: args.ruleText.trim(),
    rationale: args.rationale.trim(),
    sourceMessageId: args.sourceMessageId,
    ...(args.sourceChatId !== undefined ? { sourceChatId: args.sourceChatId } : {}),
    status: STATUS.NEEDS_REVIEW,
    createdAt: now,
    updatedAt: now,
    activities: appendActivity(undefined, ACTIVITY_SLUG.WORKFLOW_ITEM_DETECTED),
  };
}
