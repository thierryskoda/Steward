import { STATUS } from "@steward/contracts/schemas";
import { getProjectRoot } from "../../core/project-root.js";
import { getRuntimeLogger } from "../../core/logger.js";
import { getActionableCategories } from "./category-registry.js";
import { listApprovedFindingsForCategory, transitionFindingStatus } from "./categories-store.js";
import {
  processCategoryImplementing,
  type IProcessCategoryImplementingDeps,
} from "./category-implementing-processor.js";
import { runOnceIfNotInFlight } from "./category-execution-coordinator.js";
import {
  CATEGORY_IMPLEMENTING_FILE_EVENT_RECEIVED,
  CATEGORY_IMPLEMENTING_WATCHER_STARTED,
} from "./categories-log-events.js";

const POLL_INTERVAL_MS = 10_000;

async function runFindingImplementationWorker(args: {
  projectRoot: string;
  deps: IProcessCategoryImplementingDeps;
  isGenericFindingEnabled: boolean;
}): Promise<void> {
  if (!args.isGenericFindingEnabled) return;
  for (const category of getActionableCategories()) {
    const approved = listApprovedFindingsForCategory(args.projectRoot, category.categoryId)[0];
    if (!approved) continue;
    const claimed = transitionFindingStatus(
      args.projectRoot,
      category.categoryId,
      approved.id,
      STATUS.CLAIMED
    );
    if (!claimed) continue;
    getRuntimeLogger().info({
      event: CATEGORY_IMPLEMENTING_FILE_EVENT_RECEIVED,
      categoryId: category.categoryId,
      itemId: approved.id,
    });
    await runOnceIfNotInFlight({
      categoryId: category.categoryId,
      itemId: approved.id,
      run: () =>
        processCategoryImplementing({
          projectRoot: args.projectRoot,
          categoryId: category.categoryId,
          itemId: approved.id,
          deps: args.deps,
        }),
    });
    return;
  }
}

export function startFindingImplementationWorker(args: {
  deps: IProcessCategoryImplementingDeps;
  isGenericFindingEnabled: boolean;
}): ReturnType<typeof setInterval> {
  getRuntimeLogger().info({ event: CATEGORY_IMPLEMENTING_WATCHER_STARTED });
  return setInterval(() => {
    void runFindingImplementationWorker({
      projectRoot: getProjectRoot(),
      deps: args.deps,
      isGenericFindingEnabled: args.isGenericFindingEnabled,
    });
  }, POLL_INTERVAL_MS);
}
