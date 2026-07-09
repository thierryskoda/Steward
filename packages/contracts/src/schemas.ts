import { z } from "zod";
import { ITEM_STATUS_VALUES, STATUS, type IItemStatus } from "./workflow-status.js";

const SHORT_LABEL_WORD_PATTERN = /[A-Za-z0-9][A-Za-z0-9'/-]*/g;

/** Exported for soft validation (log and continue) when title/option labels are not 3-5 words. */
export function hasWordCountBetween(value: string, minWords: number, maxWords: number): boolean {
  const words = value.trim().match(SHORT_LABEL_WORD_PATTERN);
  const wordCount = words?.length ?? 0;
  return wordCount >= minWords && wordCount <= maxWords;
}

const SHORT_LABEL_MAX_WORDS = 5;

/**
 * Deterministic reformulation so a label satisfies 3-5 words.
 * If word count > 5, returns first 5 words; otherwise returns trimmed string (unchanged).
 * Used inside createShortLabelSchema so every parse/validate benefits.
 */
export function truncateToShortLabel(value: string): string {
  const trimmed = value.trim();
  const words = trimmed.match(SHORT_LABEL_WORD_PATTERN) ?? [];
  if (words.length > SHORT_LABEL_MAX_WORDS) {
    return words.slice(0, SHORT_LABEL_MAX_WORDS).join(" ");
  }
  return trimmed;
}

export function createShortLabelSchema(message: string): z.ZodType<string> {
  return z
    .string()
    .trim()
    .transform(truncateToShortLabel)
    .refine((value: string): boolean => hasWordCountBetween(value, 3, 5), { message });
}

/** Exported for startup migrator and strict validation of title/option labels. */
export const FindingShortLabelSchema = createShortLabelSchema("Must be 3-5 words.");

/** Shared success payload for approve/reject mutations. */
export const OkResponseSchema = z.object({
  ok: z.literal(true),
});

export type IOkResponse = z.infer<typeof OkResponseSchema>;

/** Request body for reject endpoints. Use parseRejectBody for parsing. */
export const RejectBodySchema = z.object({
  rejectReason: z.string().optional(),
});

/** Request body for approve finding endpoint. */
export const ApproveFindingBodySchema = z.object({
  selectedOptionId: z.enum(["A", "B", "C"]).optional(),
});

export type IRejectBody = z.infer<typeof RejectBodySchema>;

/** Route param :id validation. */
export const IdParamSchema = z.object({
  id: z.string().min(1),
});

export type IIdParam = z.infer<typeof IdParamSchema>;

/** Parse reject body; throws on invalid. Returns trimmed reason or empty string. */
export function parseRejectBody(body: unknown): string {
  const data = RejectBodySchema.parse(body ?? {});
  return typeof data.rejectReason === "string" ? data.rejectReason.trim() : "";
}

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  uptimeMs: z.number(),
});

export type IHealthResponse = z.infer<typeof HealthResponseSchema>;

export const RuntimeStateSchema = z.enum([
  "stopped",
  "starting",
  "needs-config",
  "reconciling",
  "running",
  "error",
]);
export type IRuntimeState = z.infer<typeof RuntimeStateSchema>;

export const RuntimePhaseSchema = z.enum([
  "opening-db",
  "migrating-db",
  "loading-config",
  "building-repo-scope",
  "starting-services",
  "reconciling-config",
  "ready",
]);
export type IRuntimePhase = z.infer<typeof RuntimePhaseSchema>;

export const RuntimeStatusResponseSchema = z.object({
  pid: z.number(),
  state: RuntimeStateSchema,
  startedAt: z.number(),
  lastHeartbeatAt: z.number(),
  lastError: z.string().nullable(),
  phase: RuntimePhaseSchema.optional(),
  phaseStartedAt: z.number().optional(),
});

export type IRuntimeStatusResponse = z.infer<typeof RuntimeStatusResponseSchema>;

export const ShutdownRuntimeResponseSchema = z.object({
  ok: z.literal(true),
});

export type IShutdownRuntimeResponse = z.infer<typeof ShutdownRuntimeResponseSchema>;

/** Project-scoped feature toggles stored in project_config. */
export const FeatureFlagsSchema = z
  .object({
    genericFindingEnabled: z.boolean(),
    rulesWorkflowEnabled: z.boolean(),
    continualLearningEnabled: z.boolean(),
    optionHintsEnabled: z.boolean(),
  })
  .strict();
export type IFeatureFlags = z.infer<typeof FeatureFlagsSchema>;

/** Canonical approval mode: always_approve = user approves every finding (2 options); trust_ai = AI may return 1 or 2, single-option auto-approve. */
export const ApprovalModeSchema = z.enum(["always_approve", "trust_ai"]);
export type IApprovalMode = z.infer<typeof ApprovalModeSchema>;

/** Product default when approvalMode is omitted. */
export const DEFAULT_APPROVAL_MODE: IApprovalMode = "trust_ai";
/** Constant for branching; use with DEFAULT_APPROVAL_MODE so literals are not duplicated. */
export const APPROVAL_MODE_ALWAYS_APPROVE: IApprovalMode = "always_approve";

/** GET /v1/config response: full repo-scope config. */
export const ConfigResponseSchema = z
  .object({
    schemaVersion: z.number(),
    ruleSources: z.array(z.string()),
    approvalMode: ApprovalModeSchema,
    projectContext: z.array(z.string()),
    features: FeatureFlagsSchema,
  })
  .strict();
export type IConfigResponse = z.infer<typeof ConfigResponseSchema>;

/** PATCH /v1/config request body: partial update; at least one field required. */
export const UpdateConfigBodySchema = z
  .object({
    features: FeatureFlagsSchema.optional(),
    ruleSources: z.array(z.string()).optional(),
    approvalMode: ApprovalModeSchema.optional(),
    projectContext: z.array(z.string()).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field is required.",
  });
export type IUpdateConfigBody = z.infer<typeof UpdateConfigBodySchema>;

/** POST /v1/config/initialize request body: full repo config for bootstrap. Features optional; server defaults apply. */
export const InitializeConfigBodySchema = z
  .object({
    ruleSources: z.array(z.string()),
    approvalMode: ApprovalModeSchema,
    projectContext: z.array(z.string()),
    features: FeatureFlagsSchema.optional(),
  })
  .strict();
export type IInitializeConfigBody = z.infer<typeof InitializeConfigBodySchema>;

/** POST /v1/config/initialize response: full config after write and activation. */
export type IInitializeConfigResponse = z.infer<typeof ConfigResponseSchema>;

/** Project runtime registry: one entry per running project runtime. */
export const RegistryEntryEndpointSchema = z.object({
  host: z.string(),
  port: z.number(),
});
export type IRegistryEntryEndpoint = z.infer<typeof RegistryEntryEndpointSchema>;

export const RegistryEntrySchema = z.object({
  projectKey: z.string(),
  projectRoot: z.string(),
  pid: z.number(),
  endpoint: RegistryEntryEndpointSchema,
  state: z.enum(["running", "starting"]).optional(),
  lastSeenAt: z.number(),
});
export type IRegistryEntry = z.infer<typeof RegistryEntrySchema>;

export const RegistryFileSchema = z.object({
  entries: z.record(z.string(), RegistryEntrySchema),
});
export type IRegistryFile = z.infer<typeof RegistryFileSchema>;

/** Agent CLI providers accepted by persisted preferences and runtime env. */
export const AgentCliProviderSchema = z.enum([
  "cursor_cli",
  "codex_cli",
  "claude_code_cli",
  "antigravity_cli",
]);
export type IAgentCliProvider = z.infer<typeof AgentCliProviderSchema>;
export const DEFAULT_AGENT_CLI_PROVIDER: IAgentCliProvider = "cursor_cli";
export const SELECTABLE_AGENT_CLI_PROVIDERS = [
  "cursor_cli",
  "codex_cli",
  "claude_code_cli",
] as const satisfies readonly IAgentCliProvider[];

/** App preferences: known projects and selected project. Stored in app-data. */
export const AppPreferencesSchema = z.object({
  knownProjectRoots: z.array(z.string()),
  selectedProjectRoot: z.string().nullable(),
  cliProviderByProjectRoot: z.record(z.string(), AgentCliProviderSchema).default({}),
});
export type IAppPreferences = z.infer<typeof AppPreferencesSchema>;

/** Scanning status controls passive discovery/intake, not workflow execution. */
export const ScanningStatusSchema = z.enum(["active", "paused"]);
export type IScanningStatus = z.infer<typeof ScanningStatusSchema>;

export const ScanningStatusResponseSchema = z.object({
  status: ScanningStatusSchema,
});
export type IScanningStatusResponse = z.infer<typeof ScanningStatusResponseSchema>;

/** Canonical activity slugs for workflow lifecycle. SSOT for runtime and consumers. */
const _ACTIVITY_SLUGS = [
  "workflow_item_detected",
  "workflow_item_approved_by_user",
  "workflow_item_rejected_by_user",
  "workflow_item_claimed_for_agent_run",
  "category_implement_agent_started",
  "category_implement_agent_finished",
  "category_implement_agent_failed",
  "docs_update_implement_agent_started",
  "docs_update_implement_agent_finished",
  "docs_update_implement_agent_failed",
  "workflow_item_moved_to_terminal_state",
  "workflow_item_reclaimed_on_startup",
  "workflow_item_recovered_from_stale_state",
  "workflow_item_undo_requested",
  "category_undo_agent_started",
  "category_undo_agent_finished",
  "category_undo_agent_failed",
  "workflow_item_reverted",
  "workflow_item_undo_partially_reverted",
] as const;

export type IActivitySlug = (typeof _ACTIVITY_SLUGS)[number];

/** Named activity slug constants (SSOT); use these instead of string literals. Derived from _ACTIVITY_SLUGS. */
export const ACTIVITY_SLUG = {
  WORKFLOW_ITEM_DETECTED: _ACTIVITY_SLUGS[0],
  WORKFLOW_ITEM_APPROVED_BY_USER: _ACTIVITY_SLUGS[1],
  WORKFLOW_ITEM_REJECTED_BY_USER: _ACTIVITY_SLUGS[2],
  WORKFLOW_ITEM_CLAIMED_FOR_AGENT_RUN: _ACTIVITY_SLUGS[3],
  CATEGORY_IMPLEMENT_AGENT_STARTED: _ACTIVITY_SLUGS[4],
  CATEGORY_IMPLEMENT_AGENT_FINISHED: _ACTIVITY_SLUGS[5],
  CATEGORY_IMPLEMENT_AGENT_FAILED: _ACTIVITY_SLUGS[6],
  DOCS_UPDATE_IMPLEMENT_AGENT_STARTED: _ACTIVITY_SLUGS[7],
  DOCS_UPDATE_IMPLEMENT_AGENT_FINISHED: _ACTIVITY_SLUGS[8],
  DOCS_UPDATE_IMPLEMENT_AGENT_FAILED: _ACTIVITY_SLUGS[9],
  WORKFLOW_ITEM_MOVED_TO_TERMINAL_STATE: _ACTIVITY_SLUGS[10],
  WORKFLOW_ITEM_RECLAIMED_ON_STARTUP: _ACTIVITY_SLUGS[11],
  WORKFLOW_ITEM_RECOVERED_FROM_STALE_STATE: _ACTIVITY_SLUGS[12],
  WORKFLOW_ITEM_UNDO_REQUESTED: _ACTIVITY_SLUGS[13],
  CATEGORY_UNDO_AGENT_STARTED: _ACTIVITY_SLUGS[14],
  CATEGORY_UNDO_AGENT_FINISHED: _ACTIVITY_SLUGS[15],
  CATEGORY_UNDO_AGENT_FAILED: _ACTIVITY_SLUGS[16],
  WORKFLOW_ITEM_REVERTED: _ACTIVITY_SLUGS[17],
  WORKFLOW_ITEM_UNDO_PARTIALLY_REVERTED: _ACTIVITY_SLUGS[18],
} as const satisfies Record<string, IActivitySlug>;

export const ActivityEventSchema = z.object({
  slug: z.enum(_ACTIVITY_SLUGS),
  at: z.number(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type IActivityEvent = z.infer<typeof ActivityEventSchema>;

const LifecycleFieldsSchema = z.object({
  activities: z.array(ActivityEventSchema).optional(),
});

export const InboxRuleItemSchema = z.object({
  type: z.literal("rule"),
  id: z.string(),
  title: z.string(),
  ruleText: z.string(),
  rationale: z.string(),
  createdAt: z.number(),
});

export type IInboxRuleItem = z.infer<typeof InboxRuleItemSchema>;

/** Finding domain: problem description (technical + human). Human fields optional when humanize skipped (e.g. 1-option flow). */
export const FindingProblemSchema = z.object({
  title: FindingShortLabelSchema,
  locations: z.array(z.string().min(1)).min(1),
  technicalFinding: z.string().min(1),
  humanSummary: z.string().min(1).optional(),
  humanCurrentBehavior: z.string().min(1).optional(),
  humanWhyItMatters: z.string().min(1).optional(),
  humanEvidence: z.array(z.string().min(1).max(240)).min(1).max(3).optional(),
  humanDecisionQuestion: z.string().min(1).optional(),
});

export type IFindingProblem = z.infer<typeof FindingProblemSchema>;

/** Finding domain: one implementation option (dual-audience plans). */
const FindingOptionSchema = z.object({
  id: z.enum(["A", "B", "C"]),
  name: FindingShortLabelSchema,
  technicalPlan: z.string(),
  /** One-sentence explanation of why this option was oriented this way (constraints + rule intent). */
  ruleConsideration: z.string().min(1),
  humanSummary: z.string().optional(),
  humanChooseThisIf: z.string().optional(),
  humanTradeoff: z.string().optional(),
});

/** Strict finding option for inbox: human fields are mandatory. */
const InboxFindingOptionSchema = FindingOptionSchema.extend({
  humanSummary: z.string(),
  humanChooseThisIf: z.string(),
  humanTradeoff: z.string(),
});

const InboxFindingProblemSchema = FindingProblemSchema.extend({
  humanSummary: z.string(),
  humanCurrentBehavior: z.string(),
  humanWhyItMatters: z.string(),
  humanEvidence: z.array(z.string().min(1).max(240)).min(1).max(3),
  humanDecisionQuestion: z.string(),
});

/** Finding domain: user choice and options (1–2 options). */
export const FindingDecisionSchema = z.object({
  options: z.array(FindingOptionSchema).min(1).max(2),
  selectedOptionId: z.enum(["A", "B", "C"]).optional(),
});

export type IFindingDecision = z.infer<typeof FindingDecisionSchema>;

export const InboxFindingItemSchema = z.object({
  type: z.literal("finding"),
  categoryId: z.string(),
  id: z.string(),
  problem: InboxFindingProblemSchema,
  decision: z.object({
    options: z.array(InboxFindingOptionSchema).min(2),
    selectedOptionId: z.enum(["A", "B", "C"]).optional(),
  }),
  createdAt: z.number(),
});

export type IInboxFindingItem = z.infer<typeof InboxFindingItemSchema>;

export const InboxItemSchema = z.discriminatedUnion("type", [
  InboxRuleItemSchema,
  InboxFindingItemSchema,
]);

export type IInboxItem = z.infer<typeof InboxItemSchema>;

export const InboxFindingsResponseSchema = z.object({
  items: z.array(InboxFindingItemSchema),
});

export type IInboxFindingsResponse = z.infer<typeof InboxFindingsResponseSchema>;

export const InboxRulesResponseSchema = z.object({
  items: z.array(InboxRuleItemSchema),
});

export type IInboxRulesResponse = z.infer<typeof InboxRulesResponseSchema>;

export const ItemStatusSchema = z.enum(ITEM_STATUS_VALUES);
const ITEM_STATUS = ItemStatusSchema;

export type { IItemStatus };
export { ITEM_STATUS_VALUES, STATUS };

/** One file change in implement-agent result. */
export const ImplementationResultFileChangeSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(400)
    .transform((s) => s.trim()),
  bulletPoints: z
    .array(
      z
        .string()
        .min(1)
        .max(200)
        .transform((s) => s.trim())
    )
    .min(1)
    .max(20),
});

/** Implement-agent JSON output: summary, fileChanges, checks. */
export const ImplementationResultSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(500)
    .transform((s) => s.trim()),
  fileChanges: z.array(ImplementationResultFileChangeSchema).max(50),
  checks: z
    .array(
      z
        .string()
        .min(1)
        .max(200)
        .transform((s) => s.trim())
    )
    .max(20),
});

export type IImplementationResult = z.infer<typeof ImplementationResultSchema>;

/** Undo-agent JSON output: summary, revertedFiles, skippedFiles, reasons. */
export const UndoResultSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(500)
    .transform((s) => s.trim()),
  revertedFiles: z
    .array(
      z
        .string()
        .min(1)
        .max(400)
        .transform((s) => s.trim())
    )
    .max(50),
  skippedFiles: z
    .array(
      z
        .string()
        .min(1)
        .max(400)
        .transform((s) => s.trim())
    )
    .max(50),
  reasons: z
    .array(
      z
        .string()
        .min(1)
        .max(300)
        .transform((s) => s.trim())
    )
    .max(20),
});

export type IUndoResult = z.infer<typeof UndoResultSchema>;

/** Finding domain item (full status + lifecycle). No fixPlan; plan resolved from decision.selectedOptionId + decision.options. */
export const FindingItemSchema = z
  .object({
    type: z.literal("finding"),
    categoryId: z.string(),
    id: z.string(),
    status: ITEM_STATUS,
    problem: FindingProblemSchema,
    decision: FindingDecisionSchema,
    createdAt: z.number(),
    updatedAt: z.number().optional(),
    lastImplementationResult: ImplementationResultSchema.optional(),
    hasBeenReverted: z.boolean().optional(),
    lastUndoResult: UndoResultSchema.optional(),
  })
  .merge(LifecycleFieldsSchema.partial());

export type IFindingItem = z.infer<typeof FindingItemSchema>;

const CtoRuleItemSchema = z
  .object({
    type: z.literal("rule"),
    id: z.string(),
    status: ITEM_STATUS,
    title: z.string(),
    ruleText: z.string(),
    rationale: z.string(),
    createdAt: z.number(),
    updatedAt: z.number().optional(),
  })
  .merge(LifecycleFieldsSchema.partial());

export const CtoItemSchema = z.discriminatedUnion("type", [CtoRuleItemSchema, FindingItemSchema]);

export type ICtoItem = z.infer<typeof CtoItemSchema>;

export const CtoItemsResponseSchema = z.object({
  items: z.array(CtoItemSchema),
});

export type ICtoItemsResponse = z.infer<typeof CtoItemsResponseSchema>;

/** One category entry in rules snapshot (GET /v1/rules/snapshot). */
export const RulesSnapshotCategoryEntrySchema = z.object({
  categoryId: z.string().min(1),
  rulePath: z.string(),
  ruleContent: z.string(),
});

export type IRulesSnapshotCategoryEntry = z.infer<typeof RulesSnapshotCategoryEntrySchema>;

export const RulesSnapshotResponseSchema = z.object({
  categories: z.array(RulesSnapshotCategoryEntrySchema),
});

export type IRulesSnapshotResponse = z.infer<typeof RulesSnapshotResponseSchema>;
