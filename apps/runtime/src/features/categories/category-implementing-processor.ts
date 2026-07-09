/**
 * Runs the implement agent for one category item (workspace mutation), then updates status to implemented or failed with retry/transition logic.
 * Exists so approved items are processed by a single orchestration point. Use when a category item is claimed from approved; called from category workflow onClaimed.
 */
import { toAgentFailureReason } from "../../core/agent-failure-reason.js";
import { getRuntimeLogger } from "../../core/logger.js";
import { runWorkspaceMutationAgent } from "../../core/llm/run-workspace-mutation.agent.js";
import {
  appendFindingActivity,
  getFindingByCategoryAndId,
  patchFindingFromAgent,
  resolveImplementationPlan,
  failFindingFromAgent,
  transitionFindingStatus,
} from "./categories-store.js";
import {
  CATEGORY_IMPLEMENT_FAILED,
  CATEGORY_IMPLEMENT_MOVE_FAILED,
  CATEGORY_IMPLEMENT_RESULT_PARSE_FAILED,
  CATEGORY_IMPLEMENT_SKIPPED_INVALID,
  CATEGORY_IMPLEMENT_SKIPPED_STALE_CONTEXT_FAILED,
  CATEGORY_IMPLEMENT_SUCCEEDED,
  CATEGORY_IMPLEMENTED,
} from "./categories-log-events.js";
import { ImplementationResultSchema, STATUS } from "@steward/contracts/schemas";
import {
  extractImplementationResultJson,
  implementCategoryAgent,
  parseImplementationOutput,
} from "./implement-category.agent.js";
import { getItemLocations, getItemTitle, type ICategoryItem } from "./categories-store.js";
import { runStaleContextRevalidation } from "./stale-context-revalidation.js";
import { normalizeAgentReportedProjectPath } from "./agent-file-paths.js";

export type IProcessCategoryImplementingDeps = {
  cursorProjectDirFromRoot: (workspace: string) => string;
  implementingMaxRetries: number;
  getCurrentContextFingerprintForItem: (projectRoot: string, item: ICategoryItem) => string | null;
  buildRulesContextExcerpt: (projectRoot: string) => string;
  buildProjectContextExcerpt: (projectRoot: string) => Promise<string>;
  buildLocationsExcerpt: (projectRoot: string, locations: string[]) => string;
};

function normalizeImplementationResultFilePaths(args: {
  projectRoot: string;
  result: NonNullable<ReturnType<typeof parseImplementationOutput>>;
}): NonNullable<ReturnType<typeof parseImplementationOutput>> {
  return {
    ...args.result,
    fileChanges: args.result.fileChanges.map((change) => ({
      ...change,
      path: normalizeAgentReportedProjectPath({
        projectRoot: args.projectRoot,
        reportedPath: change.path,
        operation: "normalizeImplementationResultFilePath",
      }),
    })),
  };
}

export async function processCategoryImplementing(args: {
  projectRoot: string;
  itemId: string;
  categoryId: string;
  deps: IProcessCategoryImplementingDeps;
}): Promise<void> {
  const { projectRoot, itemId, categoryId, deps } = args;
  const log = getRuntimeLogger();

  const item = getFindingByCategoryAndId(projectRoot, categoryId, itemId)?.item;
  if (!item) {
    log.info({ event: CATEGORY_IMPLEMENT_SKIPPED_INVALID, categoryId, itemId });
    return;
  }

  const technicalPlan = resolveImplementationPlan(item);
  const locations = getItemLocations(item);
  if (!locations.length || !technicalPlan.trim()) {
    log.info({ event: CATEGORY_IMPLEMENT_SKIPPED_INVALID, categoryId, itemId });
    return;
  }

  const currentFingerprint = deps.getCurrentContextFingerprintForItem(projectRoot, item);
  const itemFingerprint = item.contextFingerprint ?? "";
  const isStale =
    currentFingerprint !== null &&
    currentFingerprint.length > 0 &&
    itemFingerprint !== currentFingerprint;
  if (isStale) {
    const revalidationResult = await runStaleContextRevalidation({
      projectRoot,
      item,
      currentFingerprint,
      deps: {
        buildRulesContextExcerpt: deps.buildRulesContextExcerpt,
        buildProjectContextExcerpt: deps.buildProjectContextExcerpt,
        buildLocationsExcerpt: deps.buildLocationsExcerpt,
      },
    });
    if (revalidationResult.decision === "fail") {
      const reason = revalidationResult.reasonCode || "context_changed_invalidated_item";
      transitionFindingStatus(projectRoot, categoryId, item.id, STATUS.FAILED, {
        lastFailureReason: reason,
      });
      log.info({
        event: CATEGORY_IMPLEMENT_SKIPPED_STALE_CONTEXT_FAILED,
        categoryId,
        itemId: item.id,
        reasonCode: reason,
      });
      return;
    }
    if (revalidationResult.decision === "patch" && revalidationResult.patchedFields) {
      patchFindingFromAgent({
        projectRoot,
        categoryId,
        id: item.id,
        patch: {
          ...revalidationResult.patchedFields,
          contextFingerprint: currentFingerprint,
        },
      });
    } else {
      patchFindingFromAgent({
        projectRoot,
        categoryId,
        id: item.id,
        patch: {
          contextFingerprint: currentFingerprint,
        },
      });
    }
  }

  const itemToUse = isStale
    ? (getFindingByCategoryAndId(projectRoot, categoryId, item.id)?.item ?? item)
    : item;
  const technicalPlanToUse = resolveImplementationPlan(itemToUse);
  const locationsToUse = getItemLocations(itemToUse);
  if (!locationsToUse.length || !technicalPlanToUse.trim()) {
    log.info({ event: CATEGORY_IMPLEMENT_SKIPPED_INVALID, categoryId, itemId });
    return;
  }

  const startedAt = Date.now();
  const attemptNumber = (itemToUse.implementationAttempts ?? 0) + 1;

  let result;
  try {
    result = await runWorkspaceMutationAgent({
      agent: implementCategoryAgent,
      input: {
        title: getItemTitle(itemToUse),
        locations: getItemLocations(itemToUse),
        technicalPlan: technicalPlanToUse,
      },
      workspace: projectRoot,
      resumeChatId: itemToUse.workflowChatId,
      requestContext: { categoryId, itemId: itemToUse.id },
      deps: { cursorProjectDirFromRoot: deps.cursorProjectDirFromRoot },
      lifecycleCallbacks: {
        onQueued: () => {
          /* File remains in claimed/ until onStarted. */
        },
        onStarted: () => {
          appendFindingActivity(
            projectRoot,
            categoryId,
            itemToUse.id,
            "category_implement_agent_started"
          );
          transitionFindingStatus(
            projectRoot,
            categoryId,
            itemToUse.id,
            STATUS.AGENT_RUNNING,
            undefined
          );
        },
        onFinished: () => {
          appendFindingActivity(
            projectRoot,
            categoryId,
            itemToUse.id,
            "category_implement_agent_finished"
          );
        },
      },
    });
  } catch (error) {
    const isShutdown =
      error instanceof Error &&
      (error.message.includes("Agent queue is shutting down") ||
        error.message.includes("cancelled during shutdown"));
    if (isShutdown) {
      log.info({
        event: "Category implement agent aborted due to queue shutdown",
        categoryId,
        itemId: itemToUse.id,
      });
      transitionFindingStatus(projectRoot, categoryId, itemToUse.id, STATUS.APPROVED);
      return;
    }
    const lastFailureReason = error instanceof Error ? error.message : String(error);
    failFindingFromAgent({
      projectRoot,
      categoryId: itemToUse.categoryId,
      id: itemToUse.id,
      lastFailureReason,
      maxRetries: deps.implementingMaxRetries,
    });
    throw error;
  }

  const transcript =
    result.transcript !== undefined ? { ...result.transcript, capturedAt: Date.now() } : undefined;

  if (result.outcome === "cancelled") {
    log.info({
      event: "Category implement agent cancelled due to activity stop",
      categoryId,
      itemId: itemToUse.id,
      durationMs: Date.now() - startedAt,
    });
    transitionFindingStatus(projectRoot, categoryId, itemToUse.id, STATUS.APPROVED);
    return;
  }

  if (result.outcome !== "succeeded") {
    const lastFailureReason = toAgentFailureReason(result.outcome, result.evaluatedFailureReason);
    appendFindingActivity(
      projectRoot,
      categoryId,
      itemToUse.id,
      "category_implement_agent_failed",
      {
        reason: lastFailureReason,
      }
    );
    log.info({
      event: CATEGORY_IMPLEMENT_FAILED,
      categoryId,
      itemId: itemToUse.id,
      outcome: result.outcome,
      reason: result.reason,
      summary: result.summary,
      attemptNumber,
      durationMs: Date.now() - startedAt,
    });
    failFindingFromAgent({
      projectRoot,
      categoryId: itemToUse.categoryId,
      id: itemToUse.id,
      lastFailureReason,
      maxRetries: deps.implementingMaxRetries,
      lastImplementationTranscript: transcript,
    });
    return;
  }

  log.info({
    event: CATEGORY_IMPLEMENT_SUCCEEDED,
    categoryId,
    itemId: itemToUse.id,
    summary: result.summary,
    attemptNumber,
    durationMs: Date.now() - startedAt,
  });

  let lastImplementationResult = parseImplementationOutput(result.outputText) ?? undefined;
  if (lastImplementationResult === undefined && transcript?.entries?.length) {
    const lastAssistant = [...transcript.entries].filter((e) => e.role === "assistant").pop();
    const textPart = lastAssistant?.message?.content?.find(
      (p): p is { type: "text"; text: string } => p.type === "text"
    );
    const raw = textPart?.text;
    if (raw) {
      const toParse = extractImplementationResultJson(raw);
      if (toParse) {
        try {
          const parsed = ImplementationResultSchema.safeParse(JSON.parse(toParse));
          if (parsed.success) lastImplementationResult = parsed.data;
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (lastImplementationResult === undefined) {
    log.info({
      event: CATEGORY_IMPLEMENT_RESULT_PARSE_FAILED,
      categoryId,
      itemId: itemToUse.id,
      outputExcerpt: result.outputText.trim().slice(0, 500),
    });
  }
  if (lastImplementationResult !== undefined) {
    lastImplementationResult = normalizeImplementationResultFilePaths({
      projectRoot,
      result: lastImplementationResult,
    });
  }
  const ok = transitionFindingStatus(
    projectRoot,
    itemToUse.categoryId,
    itemToUse.id,
    STATUS.IMPLEMENTED,
    {
      lastImplementationTranscript: transcript,
      lastImplementationResult,
    }
  );
  if (!ok) {
    log.info({
      event: CATEGORY_IMPLEMENT_MOVE_FAILED,
      categoryId,
      itemId: itemToUse.id,
      attemptNumber,
      durationMs: Date.now() - startedAt,
    });
    return;
  }
  log.info({
    event: CATEGORY_IMPLEMENTED,
    categoryId,
    itemId: itemToUse.id,
    attemptNumber,
    durationMs: Date.now() - startedAt,
  });
}
