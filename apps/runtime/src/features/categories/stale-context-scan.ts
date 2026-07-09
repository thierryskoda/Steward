/**
 * Scans NEEDS_REVIEW and APPROVED category items for stale context (fingerprint mismatch),
 * runs the revalidation agent, and applies keep/patch/fail (patch or move to FAILED).
 * Invoked after rules/project-context snapshot refresh in git poll onTick.
 */
import { STATUS } from "@steward/contracts/schemas";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import {
  STALE_CONTEXT_SCAN_COMPLETED,
  STALE_CONTEXT_SCAN_DECISION,
  STALE_CONTEXT_SCAN_REVALIDATION_FAILED,
  STALE_CONTEXT_SCAN_STARTED,
} from "./categories-log-events.js";
import type { ICategoryItem } from "./categories-store.js";
import { patchFindingFromAgent, transitionFindingStatus } from "./categories-store.js";
import { runStaleContextRevalidation } from "./stale-context-revalidation.js";

const CONTEXT_CHANGED_INVALIDATED_ITEM = "context_changed_invalidated_item";
const MAX_STALE_ITEMS_PER_SCAN = 20;

export type IStaleContextScanDeps = {
  getCurrentContextFingerprintForItem: (projectRoot: string, item: ICategoryItem) => string | null;
  loadCategoryRegistry: () => Array<{ categoryId: string }>;
  listReviewFindingsForCategory: (projectRoot: string, categoryId: string) => ICategoryItem[];
  listApprovedFindingsForCategory: (projectRoot: string, categoryId: string) => ICategoryItem[];
  buildRulesContextExcerpt: (projectRoot: string) => string;
  buildProjectContextExcerpt: (projectRoot: string) => Promise<string>;
  buildLocationsExcerpt: (projectRoot: string, locations: string[]) => string;
};

function isStale(item: ICategoryItem, currentFingerprint: string): boolean {
  const itemFingerprint = item.contextFingerprint ?? "";
  return itemFingerprint !== currentFingerprint && currentFingerprint.length > 0;
}

/**
 * Runs stale-context scan: finds stale items, revalidates each, applies keep/patch/fail.
 */
export async function runStaleContextScan(
  projectRoot: string,
  deps: IStaleContextScanDeps
): Promise<void> {
  const log = getRuntimeLogger();
  const candidates: { categoryId: string; item: ICategoryItem }[] = [];
  const registry = deps.loadCategoryRegistry();
  for (const entry of registry) {
    const pending = deps.listReviewFindingsForCategory(projectRoot, entry.categoryId);
    const ready = deps.listApprovedFindingsForCategory(projectRoot, entry.categoryId);
    for (const item of [...pending, ...ready]) {
      const currentFingerprint = deps.getCurrentContextFingerprintForItem(projectRoot, item);
      if (currentFingerprint && isStale(item, currentFingerprint)) {
        candidates.push({ categoryId: entry.categoryId, item });
      }
    }
  }
  const toProcess = candidates.slice(0, MAX_STALE_ITEMS_PER_SCAN);
  if (toProcess.length === 0) {
    return;
  }
  log.info({
    event: STALE_CONTEXT_SCAN_STARTED,
    projectRoot,
    staleCount: candidates.length,
    agentRunningCount: toProcess.length,
    sampleIds: toProcess.slice(0, 5).map((c) => ({ categoryId: c.categoryId, itemId: c.item.id })),
  });
  let keepCount = 0;
  let patchCount = 0;
  let failCount = 0;
  const revalidationDeps = {
    buildRulesContextExcerpt: deps.buildRulesContextExcerpt,
    buildProjectContextExcerpt: deps.buildProjectContextExcerpt,
    buildLocationsExcerpt: deps.buildLocationsExcerpt,
  };
  for (const { categoryId, item } of toProcess) {
    const currentFingerprint = deps.getCurrentContextFingerprintForItem(projectRoot, item);
    if (!currentFingerprint) continue;
    try {
      const result = await runStaleContextRevalidation({
        projectRoot,
        item,
        currentFingerprint,
        deps: revalidationDeps,
      });
      log.info({
        event: STALE_CONTEXT_SCAN_DECISION,
        categoryId,
        itemId: item.id,
        decision: result.decision,
        reasonCode: result.reasonCode,
      });
      if (result.decision === "keep") {
        keepCount += 1;
        const ok = patchFindingFromAgent({
          projectRoot,
          categoryId,
          id: item.id,
          patch: {
            contextFingerprint: currentFingerprint,
          },
        });
        if (!ok) {
          log.info({
            event: STALE_CONTEXT_SCAN_REVALIDATION_FAILED,
            categoryId,
            itemId: item.id,
            phase: "patch_keep_fingerprint",
          });
        }
      } else if (result.decision === "patch" && result.patchedFields) {
        patchCount += 1;
        const patchedFields = {
          ...result.patchedFields,
          contextFingerprint: currentFingerprint,
        };
        const ok = patchFindingFromAgent({
          projectRoot,
          categoryId,
          id: item.id,
          patch: patchedFields,
        });
        if (!ok) {
          log.info({
            event: STALE_CONTEXT_SCAN_REVALIDATION_FAILED,
            categoryId,
            itemId: item.id,
            phase: "patch_fields",
          });
        }
      } else {
        failCount += 1;
        const reason =
          result.decision === "fail"
            ? result.reasonCode || CONTEXT_CHANGED_INVALIDATED_ITEM
            : CONTEXT_CHANGED_INVALIDATED_ITEM;
        const ok = transitionFindingStatus(projectRoot, categoryId, item.id, STATUS.FAILED, {
          lastFailureReason: reason,
        });
        if (!ok) {
          log.info({
            event: STALE_CONTEXT_SCAN_REVALIDATION_FAILED,
            categoryId,
            itemId: item.id,
            phase: "move_to_failed",
          });
        }
      }
    } catch (error) {
      logError(error, {
        event: STALE_CONTEXT_SCAN_REVALIDATION_FAILED,
        component: "categories",
        operation: "staleContextScan",
        categoryId,
        itemId: item.id,
      });
    }
  }
  log.info({
    event: STALE_CONTEXT_SCAN_COMPLETED,
    projectRoot,
    processed: toProcess.length,
    decisions: { keep: keepCount, patch: patchCount, fail: failCount },
  });
}
