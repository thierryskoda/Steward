/**
 * Runs the undo agent for one implemented finding (same workflow chat), then updates item with hasBeenReverted and lastUndoResult.
 * Invoked by the findings undo HTTP route.
 */
import {
  ACTIVITY_SLUG,
  STATUS,
  UndoResultSchema,
  type IUndoResult,
} from "@steward/contracts/schemas";
import { getRuntimeLogger } from "../../core/logger.js";
import { runWorkspaceMutationAgent } from "../../core/llm/run-workspace-mutation.agent.js";
import {
  appendFindingActivity,
  getFindingByCategoryAndId,
  getItemTitle,
  resolveImplementationPlan,
  updateFindingUndoResult,
} from "./categories-store.js";
import {
  CATEGORY_UNDO_FAILED,
  CATEGORY_UNDO_RESULT_PARSE_FAILED,
  CATEGORY_UNDO_SUCCEEDED,
} from "./categories-log-events.js";
import { undoCategoryAgent, extractUndoResultJson } from "./undo-category.agent.js";
import { normalizeAgentReportedProjectPath } from "./agent-file-paths.js";

export type IProcessUndoCategoryDeps = {
  cursorProjectDirFromRoot: (workspace: string) => string;
};

function normalizeUndoResultFilePaths(args: {
  projectRoot: string;
  result: IUndoResult;
}): IUndoResult {
  return {
    ...args.result,
    revertedFiles: args.result.revertedFiles.map((reportedPath) =>
      normalizeAgentReportedProjectPath({
        projectRoot: args.projectRoot,
        reportedPath,
        operation: "normalizeUndoResultRevertedFilePath",
      })
    ),
    skippedFiles: args.result.skippedFiles.map((reportedPath) =>
      normalizeAgentReportedProjectPath({
        projectRoot: args.projectRoot,
        reportedPath,
        operation: "normalizeUndoResultSkippedFilePath",
      })
    ),
  };
}

export async function processUndoCategory(args: {
  projectRoot: string;
  categoryId: string;
  itemId: string;
  deps: IProcessUndoCategoryDeps;
}): Promise<{ ok: boolean }> {
  const { projectRoot, categoryId, itemId, deps } = args;
  const log = getRuntimeLogger();

  const found = getFindingByCategoryAndId(projectRoot, categoryId, itemId);
  if (!found) {
    log.info({ event: "undo_item_not_found", categoryId, itemId });
    return { ok: false };
  }
  const item = found.item;
  if (item.status !== STATUS.IMPLEMENTED) {
    log.info({ event: "undo_invalid_status", categoryId, itemId, status: item.status });
    return { ok: false };
  }
  if (item.hasBeenReverted === true) {
    log.info({ event: "undo_already_reverted", categoryId, itemId });
    return { ok: false };
  }

  const allowedPaths = item.lastImplementationResult?.fileChanges?.map((f) => f.path) ?? [];
  const technicalPlanFallback = resolveImplementationPlan(item);

  appendFindingActivity(
    projectRoot,
    categoryId,
    itemId,
    ACTIVITY_SLUG.WORKFLOW_ITEM_UNDO_REQUESTED
  );

  const result = await runWorkspaceMutationAgent({
    agent: undoCategoryAgent,
    input: {
      title: getItemTitle(item),
      allowedPaths,
      technicalPlanFallback,
    },
    workspace: projectRoot,
    resumeChatId: item.workflowChatId,
    requestContext: { categoryId, itemId },
    deps: { cursorProjectDirFromRoot: deps.cursorProjectDirFromRoot },
    lifecycleCallbacks: {
      onStarted: () => {
        appendFindingActivity(
          projectRoot,
          categoryId,
          itemId,
          ACTIVITY_SLUG.CATEGORY_UNDO_AGENT_STARTED
        );
      },
      onFinished: () => {
        appendFindingActivity(
          projectRoot,
          categoryId,
          itemId,
          ACTIVITY_SLUG.CATEGORY_UNDO_AGENT_FINISHED
        );
      },
    },
  });

  if (result.outcome !== "succeeded") {
    appendFindingActivity(
      projectRoot,
      categoryId,
      itemId,
      ACTIVITY_SLUG.CATEGORY_UNDO_AGENT_FAILED,
      {
        reason: result.summary,
      }
    );
    log.info({
      event: CATEGORY_UNDO_FAILED,
      categoryId,
      itemId,
      outcome: result.outcome,
      summary: result.summary,
    });
    return { ok: false };
  }

  const raw = result.outputText;
  const toParse = extractUndoResultJson(raw);
  let lastUndoResult: IUndoResult | undefined;
  if (toParse) {
    try {
      const parsed = UndoResultSchema.safeParse(JSON.parse(toParse));
      if (parsed.success) lastUndoResult = parsed.data;
    } catch {
      /* ignore */
    }
  }
  if (lastUndoResult === undefined) {
    log.info({
      event: CATEGORY_UNDO_RESULT_PARSE_FAILED,
      categoryId,
      itemId,
      stdoutExcerpt: raw.trim().slice(0, 500),
    });
  }

  const ok = updateFindingUndoResult({
    projectRoot,
    categoryId,
    id: itemId,
    result:
      lastUndoResult !== undefined
        ? normalizeUndoResultFilePaths({ projectRoot, result: lastUndoResult })
        : {
            summary: result.summary,
            revertedFiles: [],
            skippedFiles: [],
            reasons: [],
          },
    reverted: true,
  });
  if (!ok) {
    log.info({ event: CATEGORY_UNDO_FAILED, categoryId, itemId, reason: "update_failed" });
    return { ok: false };
  }

  log.info({
    event: CATEGORY_UNDO_SUCCEEDED,
    categoryId,
    itemId,
    summary: lastUndoResult?.summary ?? result.summary,
  });
  return { ok: true };
}
