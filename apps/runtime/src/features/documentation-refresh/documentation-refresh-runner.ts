import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";
import { DOCUMENTATION_REFRESH_CATEGORY_ID, STATUS } from "@steward/contracts/schemas";
import { AppError, isAppError } from "../../core/app-error.js";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { ERR_DOCUMENTATION_REFRESH_STATE } from "../../core/error-codes.js";
import { listChangedPathsBetweenGitHeads, listGitProjectFiles } from "../../core/git/git-delta.js";
import { isGeneratedOrDependencyGitPath } from "../../core/git/git-content-policy.js";
import type { IProjectChangeBatch } from "../../core/git/git-poll-tick.js";
import { collectGitSnapshot, fingerprintGitProjectPath } from "../../core/git/git-snapshot.js";
import type { ILLMProvider } from "../../core/llm/llm-provider.types.js";
import { runSchemaConstrainedAgentWithProvider } from "../../core/llm/run-structured.agent.js";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import type {
  ICategoryItem,
  IFindingDecision,
  IFindingProblem,
} from "../categories/categories-store.js";
import { documentationRefreshAgent } from "./documentation-refresh.agent.js";
import {
  acquireDocumentationRefreshLease,
  releaseDocumentationRefreshLease,
} from "./documentation-refresh-lease.js";
import {
  DOCUMENTATION_REFRESH_LEASE_BUSY,
  DOCUMENTATION_REFRESH_RUN_COMPLETED,
  DOCUMENTATION_REFRESH_RUN_FAILED,
  DOCUMENTATION_REFRESH_RUN_QUEUED,
  DOCUMENTATION_REFRESH_RUN_RETRYING,
  DOCUMENTATION_REFRESH_RUN_STARTED,
  DOCUMENTATION_REFRESH_RUN_SUPERSEDED,
} from "./documentation-refresh-log-events.js";
import {
  DocumentationRefreshAgentOutputSchema,
  type IDocumentationRefreshAgentInput,
  type IDocumentationRefreshAgentOutput,
  type IDocumentationRefreshEvidence,
  type IDocumentationRefreshReport,
  type IDocumentationRefreshRun,
  type IDocumentationRefreshRunKind,
} from "./documentation-refresh.schemas.js";
import {
  blockDocumentationRefreshRun,
  claimDocumentationRefreshRun,
  completeDocumentationRefreshRun,
  createDocumentationRefreshRun,
  failDocumentationRefreshRun,
  findDocumentationRefreshRunByInput,
  listDocumentationRefreshRuns,
  requeueDocumentationRefreshRun,
  supersedeDocumentationRefreshRun,
} from "./documentation-refresh-store.js";

const DOCUMENTATION_BATCH_LIMIT = 25;
const CHANGED_PATH_LIMIT = 100;
const GLOBAL_LEASE_TTL_MS = 10 * 60 * 1_000;
const DOCUMENTATION_REFRESH_WALL_TIME_MS = 9 * 60 * 1_000 + 45 * 1_000;
const TERMINAL_STATUSES = new Set<IDocumentationRefreshRun["status"]>([
  "clean",
  "needs-review",
  "blocked",
  "failed",
  "superseded",
]);
const CHECKPOINT_STATUSES = new Set<IDocumentationRefreshRun["status"]>([
  "clean",
  "needs-review",
  "blocked",
]);
const TRANSIENT_AGENT_REASONS = new Set([
  "timeout",
  "idle_timeout",
  "spawn_error",
  "killed",
  "shutdown_cancelled",
]);
const DOCUMENTATION_EXTENSIONS = [".md", ".mdx", ".markdown"] as const;

type IDocumentationFindingStore = {
  listOpenFindings(projectRoot: string): ICategoryItem[];
  createFinding(args: {
    categoryId: string;
    reason?: string;
    problem?: IFindingProblem;
    decision?: IFindingDecision;
    dedupeKey?: string;
    contextFingerprint?: string;
    status?: ICategoryItem["status"];
  }): ICategoryItem;
  saveFinding(projectRoot: string, item: ICategoryItem): void;
  patchFinding(args: {
    projectRoot: string;
    categoryId: string;
    id: string;
    patch: Partial<ICategoryItem>;
  }): boolean;
  deleteFinding(projectRoot: string, id: string): boolean;
};

type IDocumentationRefreshRunnerDeps = {
  projectRoot: string;
  projectKey: string;
  ownerId: string;
  llmProvider: ILLMProvider;
  findingStore: IDocumentationFindingStore;
  shouldContinue: () => boolean;
};

type IDocumentationRefreshRunner = {
  run(changeBatch: IProjectChangeBatch): Promise<IDocumentationRefreshRun | null>;
};

type IScopeBlocker = {
  reason: string;
  nextAction: string;
  locations: string[];
};

type IDocumentationRefreshScope = {
  input: IDocumentationRefreshAgentInput;
  baselineCursorAfterRun: string | null;
  blocker: IScopeBlocker | null;
  allowedProjectPaths: ReadonlySet<string>;
};

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isDocumentationPath(path: string): boolean {
  const lower = path.toLowerCase();
  return DOCUMENTATION_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isSafeProjectPath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path)) return false;
  const normalized = path.replaceAll("\\", "/");
  if (normalized.split("/").includes("..")) return false;
  if (isGeneratedOrDependencyGitPath(normalized)) return false;
  if (normalized.endsWith(".log") || normalized.split("/").includes("logs")) return false;
  return true;
}

function isSymlink(projectRoot: string, path: string): boolean {
  const fullPath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, fullPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return true;
  try {
    return lstatSync(fullPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function isPresentProjectPath(projectRoot: string, path: string): boolean {
  const fullPath = resolve(projectRoot, path);
  const relativePath = relative(projectRoot, fullPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return false;
  try {
    const stat = lstatSync(fullPath);
    return stat.isFile() || stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function contentHash(projectRoot: string, path: string): string {
  return fingerprintGitProjectPath(projectRoot, path) ?? hashJson({ path, state: "deleted" });
}

function latestCheckpointRun(
  runs: readonly IDocumentationRefreshRun[]
): IDocumentationRefreshRun | null {
  return (
    runs
      .filter((run) => CHECKPOINT_STATUSES.has(run.status))
      .sort(
        (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)
      )[0] ?? null
  );
}

function latestBaselineCursor(runs: readonly IDocumentationRefreshRun[]): string | null {
  return (
    runs
      .filter((run) => run.kind === "baseline" && CHECKPOINT_STATUSES.has(run.status))
      .map((run) => run.baselineCursor)
      .filter((cursor): cursor is string => cursor !== null)
      .sort((left, right) => right.localeCompare(left))[0] ?? null
  );
}

function previouslyReviewedHashes(runs: readonly IDocumentationRefreshRun[]): Set<string> {
  const reviewed = new Set<string>();
  for (const run of runs) {
    if (!CHECKPOINT_STATUSES.has(run.status)) continue;
    for (const entry of run.scopedContentHashes) reviewed.add(`${entry.path}\0${entry.hash}`);
  }
  return reviewed;
}

function buildInputFingerprint(args: {
  kind: IDocumentationRefreshRunKind;
  hashes: IDocumentationRefreshAgentInput["scopedContentHashes"];
}): string {
  return hashJson({ kind: args.kind, hashes: args.hashes });
}

function selectDocumentationPaths(args: {
  documentationInventory: readonly string[];
  changedPaths: readonly string[];
}): string[] {
  const currentDocumentation = new Set(args.documentationInventory);
  const changedDocumentation = args.changedPaths.filter(
    (path) => isDocumentationPath(path) && currentDocumentation.has(path)
  );
  const rootDocumentation = args.documentationInventory.filter((path) => !path.includes("/"));
  return [
    ...new Set([...changedDocumentation, ...rootDocumentation, ...args.documentationInventory]),
  ].slice(0, DOCUMENTATION_BATCH_LIMIT);
}

function buildBaselineScope(args: {
  projectRoot: string;
  projectFiles: readonly string[];
  documentationInventory: readonly string[];
  cursor: string | null;
  headSha: string | null;
}): IDocumentationRefreshScope | null {
  const documentationPaths = args.documentationInventory
    .filter((path) => args.cursor === null || path.localeCompare(args.cursor) > 0)
    .slice(0, DOCUMENTATION_BATCH_LIMIT);
  if (documentationPaths.length === 0) return null;
  const hashes = documentationPaths.map((path) => ({
    path,
    hash: contentHash(args.projectRoot, path),
  }));
  const unsafeSymlinks = documentationPaths.filter((path) => isSymlink(args.projectRoot, path));
  const inputFingerprint = buildInputFingerprint({ kind: "baseline", hashes });
  return {
    input: {
      kind: "baseline",
      inputFingerprint,
      headSha: args.headSha,
      baselineCursor: args.cursor,
      changedPaths: [],
      documentationPaths,
      scopedContentHashes: hashes,
    },
    baselineCursorAfterRun: documentationPaths.at(-1) ?? args.cursor,
    blocker:
      unsafeSymlinks.length === 0
        ? null
        : {
            reason: "Documentation symlinks cannot be inspected safely in the bounded worker.",
            nextAction: "Replace the symlink with a project-owned file or review it manually.",
            locations: unsafeSymlinks,
          },
    allowedProjectPaths: new Set(args.projectFiles),
  };
}

function buildIncrementalScope(args: {
  projectRoot: string;
  projectFiles: readonly string[];
  documentationInventory: readonly string[];
  rawChangedPaths: readonly string[];
  projectFingerprint: string;
  fromHeadSha: string | null;
  toHeadSha: string | null;
  reviewedHashes: ReadonlySet<string>;
}): IDocumentationRefreshScope | null {
  const committedPaths = listChangedPathsBetweenGitHeads({
    projectRoot: args.projectRoot,
    fromHeadSha: args.fromHeadSha,
    toHeadSha: args.toHeadSha,
  });
  const candidates = [...new Set([...args.rawChangedPaths, ...committedPaths])]
    .filter(isSafeProjectPath)
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) return null;

  const overBudget = candidates.length > CHANGED_PATH_LIMIT;
  const boundedCandidates = candidates.slice(0, CHANGED_PATH_LIMIT);
  const allHashes = boundedCandidates.map((path) => ({
    path,
    hash: contentHash(args.projectRoot, path),
  }));
  const exactRun = overBudget
    ? null
    : findDocumentationRefreshRunByInput({
        kind: "incremental",
        inputFingerprint: buildInputFingerprint({ kind: "incremental", hashes: allHashes }),
      });
  const hashes =
    exactRun === null && !overBudget
      ? allHashes.filter((entry) => !args.reviewedHashes.has(`${entry.path}\0${entry.hash}`))
      : allHashes;
  if (hashes.length === 0) return null;

  const changedPaths = hashes.map((entry) => entry.path);
  const unsafeSymlinks = changedPaths.filter((path) => isSymlink(args.projectRoot, path));
  const documentationPaths = selectDocumentationPaths({
    documentationInventory: args.documentationInventory,
    changedPaths,
  });
  const inputFingerprint = overBudget
    ? hashJson({
        kind: "incremental",
        reason: "changed_path_budget_exceeded",
        pathCount: candidates.length,
        projectFingerprint: args.projectFingerprint,
        hashes,
      })
    : buildInputFingerprint({ kind: "incremental", hashes });
  const blocker = overBudget
    ? {
        reason: `The stabilized change contains ${candidates.length} project paths, above the ${CHANGED_PATH_LIMIT}-path review budget.`,
        nextAction: "Split or reduce the change, then let the documentation review run again.",
        locations: changedPaths.slice(0, DOCUMENTATION_BATCH_LIMIT),
      }
    : unsafeSymlinks.length > 0
      ? {
          reason: "Changed symlinks cannot be inspected safely in the bounded worker.",
          nextAction: "Replace the symlink with a project-owned file or review it manually.",
          locations: unsafeSymlinks,
        }
      : documentationPaths.length === 0
        ? {
            reason: "The project has no inspectable documentation files for this code change.",
            nextAction: "Confirm whether the project intentionally has no durable documentation.",
            locations: changedPaths.slice(0, DOCUMENTATION_BATCH_LIMIT),
          }
        : null;
  return {
    input: {
      kind: "incremental",
      inputFingerprint,
      headSha: args.toHeadSha,
      baselineCursor: null,
      changedPaths,
      documentationPaths,
      scopedContentHashes: hashes,
    },
    baselineCursorAfterRun: null,
    blocker,
    allowedProjectPaths: new Set(args.projectFiles),
  };
}

function toPreflightReport(blocker: IScopeBlocker): IDocumentationRefreshReport {
  return {
    title: "Documentation Review Needs Input",
    humanSummary: blocker.reason,
    humanCurrentBehavior: "The read-only documentation review stopped before model execution.",
    humanWhyItMatters: "Publishing a partial freshness result could hide stale documentation.",
    humanEvidence: [blocker.reason.slice(0, 240)],
    humanDecisionQuestion: "How should this bounded documentation scope be resolved?",
    locations: blocker.locations,
    recommendation: {
      title: "Resolve Documentation Review Blocker",
      humanSummary: blocker.nextAction,
      technicalPlan: blocker.nextAction,
    },
  };
}

function toEvidence(output: IDocumentationRefreshAgentOutput): IDocumentationRefreshEvidence {
  return {
    checkedPaths: output.checkedDocumentPaths,
    summary: output.summary,
    verificationCommands: output.commandsRun.map((command) => command.command),
    uncertainties: output.uncertainties,
  };
}

function reportToFinding(report: IDocumentationRefreshReport): {
  problem: IFindingProblem;
  decision: IFindingDecision;
} {
  return {
    problem: {
      title: report.title,
      locations: report.locations,
      technicalFinding: report.humanCurrentBehavior,
      humanSummary: report.humanSummary,
      humanCurrentBehavior: report.humanCurrentBehavior,
      humanWhyItMatters: report.humanWhyItMatters,
      humanEvidence: report.humanEvidence,
      humanDecisionQuestion: report.humanDecisionQuestion,
    },
    decision: {
      options: [
        {
          id: "A",
          name: report.recommendation.title,
          technicalPlan: report.recommendation.technicalPlan,
          ruleConsideration:
            "Documentation refresh is advisory and requires a separately authorized edit.",
          humanSummary: report.recommendation.humanSummary,
          humanChooseThisIf: "Choose this after confirming the documented behavior should change.",
          humanTradeoff: "No repository file is changed by this report-only workflow.",
        },
      ],
    },
  };
}

function validateAgentOutput(args: {
  output: IDocumentationRefreshAgentOutput;
  input: IDocumentationRefreshAgentInput;
  projectRoot: string;
  allowedProjectPaths: ReadonlySet<string>;
}): IDocumentationRefreshAgentOutput {
  const output = DocumentationRefreshAgentOutputSchema.parse(args.output);
  const checked = new Set(output.checkedDocumentPaths);
  const missingDocuments = args.input.documentationPaths.filter((path) => !checked.has(path));
  const unsafeDocuments = output.checkedDocumentPaths.filter(
    (path) =>
      !args.allowedProjectPaths.has(path) ||
      !isDocumentationPath(path) ||
      !isPresentProjectPath(args.projectRoot, path)
  );
  const unsafeAuthorities = output.checkedAuthorityPaths.filter(
    (path) => !args.allowedProjectPaths.has(path) || !isPresentProjectPath(args.projectRoot, path)
  );
  if (missingDocuments.length > 0 || unsafeDocuments.length > 0 || unsafeAuthorities.length > 0) {
    throw new AppError(
      "Documentation refresh output did not prove the complete pinned scope",
      ERR_DOCUMENTATION_REFRESH_STATE,
      {
        reason: "invalid_agent_evidence",
        missingDocuments: missingDocuments.join(","),
        unsafeDocuments: unsafeDocuments.join(","),
        unsafeAuthorities: unsafeAuthorities.join(","),
      }
    );
  }
  return output;
}

function transientAgentFailure(error: unknown): boolean {
  if (!isAppError(error)) return false;
  const reason = error.context.reason;
  return typeof reason === "string" && TRANSIENT_AGENT_REASONS.has(reason);
}

function errorStopReason(error: unknown): string {
  if (isAppError(error)) {
    const reason = error.context.reason;
    return typeof reason === "string" ? reason : error.code;
  }
  return error instanceof Error ? error.message.slice(0, 1_000) : "unknown_failure";
}

function logBindings(args: {
  deps: Pick<IDocumentationRefreshRunnerDeps, "projectKey">;
  run: IDocumentationRefreshRun;
  durationMs?: number;
}): Record<string, unknown> {
  return {
    component: "documentation-refresh",
    projectKey: args.deps.projectKey,
    runId: args.run.id,
    kind: args.run.kind,
    inputFingerprint: args.run.inputFingerprint,
    attemptCount: args.run.attemptCount,
    ...(args.durationMs === undefined ? {} : { durationMs: args.durationMs }),
  };
}

function locationMatchesDocumentationPath(location: string, documentationPath: string): boolean {
  return location === documentationPath || location.startsWith(`${documentationPath}:`);
}

function findingTouchesDocumentationPaths(
  finding: ICategoryItem,
  documentationPaths: readonly string[]
): boolean {
  const locations = finding.problem?.locations ?? finding.locations ?? [];
  return documentationPaths.some((documentationPath) =>
    locations.some((location) => locationMatchesDocumentationPath(location, documentationPath))
  );
}

function documentationPathFromLocation(location: string): string | null {
  const path = location.replace(/:\d+(?:(?:-|:)\d+)?$/, "");
  return isDocumentationPath(path) ? path : null;
}

function findingDocumentationScopeIsCovered(
  finding: ICategoryItem,
  documentationPaths: readonly string[]
): boolean {
  const locations = finding.problem?.locations ?? finding.locations ?? [];
  const findingDocumentationPaths = [
    ...new Set(
      locations
        .map((location) => documentationPathFromLocation(location))
        .filter((path): path is string => path !== null)
    ),
  ];
  return (
    findingDocumentationPaths.length > 0 &&
    findingDocumentationPaths.every((findingPath) =>
      documentationPaths.some((documentationPath) => documentationPath === findingPath)
    )
  );
}

function reportedDocumentationPaths(args: {
  report: IDocumentationRefreshReport;
  documentationPaths: readonly string[];
}): string[] {
  return args.documentationPaths.filter((documentationPath) =>
    args.report.locations.some((location) =>
      locationMatchesDocumentationPath(location, documentationPath)
    )
  );
}

function upsertScopedFinding(args: {
  deps: IDocumentationRefreshRunnerDeps;
  report: IDocumentationRefreshReport;
  inputFingerprint: string;
  documentationPaths: readonly string[];
}): string {
  const shaped = reportToFinding(args.report);
  const openFindings = args.deps.findingStore.listOpenFindings(args.deps.projectRoot);
  const currentReportDocumentationPaths = reportedDocumentationPaths({
    report: args.report,
    documentationPaths: args.documentationPaths,
  });
  const matchingFindings = openFindings.filter(
    (finding) =>
      finding.contextFingerprint === args.inputFingerprint ||
      findingTouchesDocumentationPaths(finding, currentReportDocumentationPaths)
  );
  const current = matchingFindings[0];
  if (current === undefined) {
    const finding = args.deps.findingStore.createFinding({
      categoryId: DOCUMENTATION_REFRESH_CATEGORY_ID,
      status: STATUS.NEEDS_REVIEW,
      reason: "documentation_freshness_report",
      problem: shaped.problem,
      decision: shaped.decision,
      dedupeKey: `documentation-refresh:${args.inputFingerprint}`,
      contextFingerprint: args.inputFingerprint,
    });
    args.deps.findingStore.saveFinding(args.deps.projectRoot, finding);
    return finding.id;
  }
  const updated = args.deps.findingStore.patchFinding({
    projectRoot: args.deps.projectRoot,
    categoryId: DOCUMENTATION_REFRESH_CATEGORY_ID,
    id: current.id,
    patch: {
      status: STATUS.NEEDS_REVIEW,
      reason: "documentation_freshness_report",
      problem: shaped.problem,
      decision: shaped.decision,
      dedupeKey: `documentation-refresh:${args.inputFingerprint}`,
      contextFingerprint: args.inputFingerprint,
    },
  });
  if (!updated) {
    throw new AppError(
      "Current documentation finding could not be updated",
      ERR_DOCUMENTATION_REFRESH_STATE,
      { findingId: current.id, reason: "finding_update_failed" }
    );
  }
  for (const duplicate of matchingFindings.slice(1)) {
    args.deps.findingStore.deleteFinding(args.deps.projectRoot, duplicate.id);
  }
  return current.id;
}

function removeResolvedFindingsForDocumentationPaths(args: {
  deps: IDocumentationRefreshRunnerDeps;
  documentationPaths: readonly string[];
  preservedDocumentationPaths: readonly string[];
}): void {
  const matchingFindings = args.deps.findingStore
    .listOpenFindings(args.deps.projectRoot)
    .filter((finding) => findingDocumentationScopeIsCovered(finding, args.documentationPaths));
  for (const finding of matchingFindings) {
    if (findingTouchesDocumentationPaths(finding, args.preservedDocumentationPaths)) continue;
    args.deps.findingStore.deleteFinding(args.deps.projectRoot, finding.id);
  }
}

function publishOutput(args: {
  deps: IDocumentationRefreshRunnerDeps;
  run: IDocumentationRefreshRun;
  scope: IDocumentationRefreshScope;
  output: IDocumentationRefreshAgentOutput;
  now: number;
}): IDocumentationRefreshRun {
  return getRuntimeDb().transaction((): IDocumentationRefreshRun => {
    const evidence = toEvidence(args.output);
    if (args.output.status === "clean") {
      removeResolvedFindingsForDocumentationPaths({
        deps: args.deps,
        documentationPaths: args.scope.input.documentationPaths,
        preservedDocumentationPaths: [],
      });
      return completeDocumentationRefreshRun({
        id: args.run.id,
        status: "clean",
        evidence,
        findingId: null,
        baselineCursor: args.scope.baselineCursorAfterRun,
        stopReason: "bounded_review_clean",
        nextAction: "wait_for_project_change",
        now: args.now,
      });
    }
    removeResolvedFindingsForDocumentationPaths({
      deps: args.deps,
      documentationPaths: args.scope.input.documentationPaths,
      preservedDocumentationPaths: reportedDocumentationPaths({
        report: args.output.report,
        documentationPaths: args.scope.input.documentationPaths,
      }),
    });
    const findingId = upsertScopedFinding({
      deps: args.deps,
      report: args.output.report,
      inputFingerprint: args.run.inputFingerprint,
      documentationPaths: args.scope.input.documentationPaths,
    });
    if (args.output.status === "drift") {
      return completeDocumentationRefreshRun({
        id: args.run.id,
        status: "needs-review",
        evidence,
        findingId,
        baselineCursor: args.scope.baselineCursorAfterRun,
        stopReason: "documentation_drift_reported",
        nextAction: "human_review",
        now: args.now,
      });
    }
    return blockDocumentationRefreshRun({
      id: args.run.id,
      evidence,
      blocker: args.output.blocker,
      findingId,
      baselineCursor: args.scope.baselineCursorAfterRun,
      stopReason: "documentation_review_blocked",
      nextAction: args.output.nextAction,
      now: args.now,
    });
  })();
}

function publishPreflightBlocker(args: {
  deps: IDocumentationRefreshRunnerDeps;
  run: IDocumentationRefreshRun;
  scope: IDocumentationRefreshScope;
  blocker: IScopeBlocker;
  now: number;
}): IDocumentationRefreshRun {
  return getRuntimeDb().transaction((): IDocumentationRefreshRun => {
    const report = toPreflightReport(args.blocker);
    const findingId = upsertScopedFinding({
      deps: args.deps,
      report,
      inputFingerprint: args.run.inputFingerprint,
      documentationPaths: args.scope.input.documentationPaths,
    });
    return blockDocumentationRefreshRun({
      id: args.run.id,
      evidence: {
        checkedPaths: [],
        summary: args.blocker.reason,
        verificationCommands: [],
        uncertainties: [args.blocker.reason],
      },
      blocker: args.blocker.reason,
      findingId,
      baselineCursor: args.scope.baselineCursorAfterRun,
      stopReason: "preflight_scope_blocked",
      nextAction: args.blocker.nextAction,
      now: args.now,
    });
  })();
}

function buildScope(args: {
  deps: IDocumentationRefreshRunnerDeps;
  changeBatch: IProjectChangeBatch;
}): IDocumentationRefreshScope | null {
  const projectFiles = listGitProjectFiles(args.deps.projectRoot).filter(isSafeProjectPath);
  const documentationInventory = projectFiles
    .filter(isDocumentationPath)
    .filter((path) => isPresentProjectPath(args.deps.projectRoot, path))
    .sort((left, right) => left.localeCompare(right));
  const runs = listDocumentationRefreshRuns();
  const cursor = latestBaselineCursor(runs);
  const baseline = buildBaselineScope({
    projectRoot: args.deps.projectRoot,
    projectFiles,
    documentationInventory,
    cursor,
    headSha: args.changeBatch.snapshot.headSha,
  });
  if (baseline !== null) return baseline;
  const checkpoint = latestCheckpointRun(runs);
  return buildIncrementalScope({
    projectRoot: args.deps.projectRoot,
    projectFiles,
    documentationInventory,
    rawChangedPaths: args.changeBatch.changedPaths,
    projectFingerprint: args.changeBatch.fingerprint,
    fromHeadSha: checkpoint?.headSha ?? null,
    toHeadSha: args.changeBatch.snapshot.headSha,
    reviewedHashes: previouslyReviewedHashes(runs),
  });
}

async function runClaimedScope(args: {
  deps: IDocumentationRefreshRunnerDeps;
  scope: IDocumentationRefreshScope;
  run: IDocumentationRefreshRun;
  pinnedSnapshotHash: string;
  startedAt: number;
  deadlineAt: number;
}): Promise<IDocumentationRefreshRun> {
  let claimedRun = args.run;
  for (;;) {
    try {
      const output =
        args.scope.blocker === null
          ? validateAgentOutput({
              output: await runSchemaConstrainedAgentWithProvider({
                agent: documentationRefreshAgent,
                input: args.scope.input,
                workspace: args.deps.projectRoot,
                resumeChatId: undefined,
                llmProvider: args.deps.llmProvider,
                deadlineAt: args.deadlineAt,
              }),
              input: args.scope.input,
              projectRoot: args.deps.projectRoot,
              allowedProjectPaths: args.scope.allowedProjectPaths,
            })
          : null;
      const postSnapshot = collectGitSnapshot(args.deps.projectRoot);
      if (postSnapshot.hash !== args.pinnedSnapshotHash) {
        const superseded = supersedeDocumentationRefreshRun({
          id: claimedRun.id,
          stopReason: "project_changed_during_documentation_review",
          now: Date.now(),
        });
        getRuntimeLogger().info({
          event: DOCUMENTATION_REFRESH_RUN_SUPERSEDED,
          ...logBindings({
            deps: args.deps,
            run: superseded,
            durationMs: Date.now() - args.startedAt,
          }),
          reason: superseded.stopReason,
        });
        return superseded;
      }
      let completed: IDocumentationRefreshRun;
      if (args.scope.blocker !== null) {
        completed = publishPreflightBlocker({
          deps: args.deps,
          run: claimedRun,
          scope: args.scope,
          blocker: args.scope.blocker,
          now: Date.now(),
        });
      } else {
        if (output === null) {
          throw new AppError(
            "Documentation refresh completed without a validated output",
            ERR_DOCUMENTATION_REFRESH_STATE,
            { runId: claimedRun.id, reason: "missing_validated_output" }
          );
        }
        completed = publishOutput({
          deps: args.deps,
          run: claimedRun,
          scope: args.scope,
          output,
          now: Date.now(),
        });
      }
      getRuntimeLogger().info({
        event: DOCUMENTATION_REFRESH_RUN_COMPLETED,
        ...logBindings({
          deps: args.deps,
          run: completed,
          durationMs: Date.now() - args.startedAt,
        }),
        outcome: completed.status,
      });
      return completed;
    } catch (error) {
      if (transientAgentFailure(error) && claimedRun.attemptCount < 2) {
        const queued = requeueDocumentationRefreshRun({
          id: claimedRun.id,
          stopReason: errorStopReason(error),
          now: Date.now(),
        });
        getRuntimeLogger().warn({
          event: DOCUMENTATION_REFRESH_RUN_RETRYING,
          ...logBindings({ deps: args.deps, run: queued }),
          reason: queued.stopReason,
        });
        if (!args.deps.shouldContinue()) return queued;
        claimedRun = claimDocumentationRefreshRun({
          id: queued.id,
          now: Date.now(),
          leaseObservedAt: Date.now(),
        });
        continue;
      }
      const failed = failDocumentationRefreshRun({
        id: claimedRun.id,
        stopReason: errorStopReason(error),
        nextAction: "inspect_runtime_log_and_retry_after_a_new_change",
        now: Date.now(),
      });
      logError(error, {
        event: DOCUMENTATION_REFRESH_RUN_FAILED,
        ...logBindings({
          deps: args.deps,
          run: failed,
          durationMs: Date.now() - args.startedAt,
        }),
      });
      return failed;
    }
  }
}

export function createDocumentationRefreshRunner(
  deps: IDocumentationRefreshRunnerDeps
): IDocumentationRefreshRunner {
  return {
    run: async (changeBatch: IProjectChangeBatch): Promise<IDocumentationRefreshRun | null> => {
      if (!deps.shouldContinue()) return null;
      const scope = buildScope({ deps, changeBatch });
      if (scope === null) return null;
      const existing = findDocumentationRefreshRunByInput({
        kind: scope.input.kind,
        inputFingerprint: scope.input.inputFingerprint,
      });
      if (
        existing !== null &&
        (TERMINAL_STATUSES.has(existing.status) || existing.status === "running")
      ) {
        return existing;
      }
      const now = Date.now();
      const queued = createDocumentationRefreshRun({
        kind: scope.input.kind,
        inputFingerprint: scope.input.inputFingerprint,
        headSha: scope.input.headSha,
        scopedContentHashes: scope.input.scopedContentHashes,
        baselineCursor: scope.input.baselineCursor,
        now,
      });
      getRuntimeLogger().info({
        event: DOCUMENTATION_REFRESH_RUN_QUEUED,
        ...logBindings({ deps, run: queued }),
      });
      const leaseResult = acquireDocumentationRefreshLease({
        ownerId: deps.ownerId,
        projectKey: deps.projectKey,
        runId: queued.id,
        pid: process.pid,
        now,
        ttlMs: GLOBAL_LEASE_TTL_MS,
      });
      if (!leaseResult.acquired) {
        getRuntimeLogger().info({
          event: DOCUMENTATION_REFRESH_LEASE_BUSY,
          ...logBindings({ deps, run: queued }),
          holderProjectKey: leaseResult.holder.projectKey,
          holderRunId: leaseResult.holder.runId,
          holderExpiresAt: leaseResult.holder.expiresAt,
        });
        return queued;
      }
      const startedAt = Date.now();
      try {
        if (!deps.shouldContinue()) return queued;
        const currentSnapshot = collectGitSnapshot(deps.projectRoot);
        if (currentSnapshot.hash !== changeBatch.fingerprint) {
          const superseded = supersedeDocumentationRefreshRun({
            id: queued.id,
            stopReason: "project_changed_before_documentation_review",
            now: Date.now(),
          });
          getRuntimeLogger().info({
            event: DOCUMENTATION_REFRESH_RUN_SUPERSEDED,
            ...logBindings({ deps, run: superseded, durationMs: Date.now() - startedAt }),
            reason: superseded.stopReason,
          });
          return superseded;
        }
        const claimed = claimDocumentationRefreshRun({
          id: queued.id,
          now: Date.now(),
          leaseObservedAt: leaseResult.lease.acquiredAt,
        });
        getRuntimeLogger().info({
          event: DOCUMENTATION_REFRESH_RUN_STARTED,
          ...logBindings({ deps, run: claimed }),
        });
        return await runClaimedScope({
          deps,
          scope,
          run: claimed,
          pinnedSnapshotHash: changeBatch.fingerprint,
          startedAt,
          deadlineAt: startedAt + DOCUMENTATION_REFRESH_WALL_TIME_MS,
        });
      } finally {
        releaseDocumentationRefreshLease({ ownerId: deps.ownerId, runId: queued.id });
      }
    },
  };
}
