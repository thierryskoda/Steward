/**
 * In-flight guard for category implementing: runs the given callback only if the (categoryId, itemId) pair is not already in progress; always releases the lock in finally.
 * Exists to prevent duplicate implement runs when the same item is claimed multiple times. Use when claiming a approved item; called from category-workflow-descriptors onClaimed.
 */
import { CATEGORY_IMPLEMENT_SKIPPED_IN_FLIGHT } from "./categories-log-events.js";
import { getRuntimeLogger } from "../../core/logger.js";

const inFlightKeys = new Set<string>();

type IRunOnceIfNotInFlightArgs = {
  categoryId: string;
  itemId: string;
  run: () => Promise<void>;
};

/**
 * Runs the callback only if the item is not already in flight.
 * Prevents duplicate agent-running when the same item is claimed multiple times.
 * Always releases the in-flight lock in finally.
 */
export async function runOnceIfNotInFlight(args: IRunOnceIfNotInFlightArgs): Promise<void> {
  const { categoryId, itemId, run } = args;
  const key = `${categoryId}:${itemId}`;
  if (inFlightKeys.has(key)) {
    getRuntimeLogger().info({
      event: CATEGORY_IMPLEMENT_SKIPPED_IN_FLIGHT,
      categoryId,
      itemId,
    });
    return;
  }
  inFlightKeys.add(key);
  try {
    await run();
  } finally {
    inFlightKeys.delete(key);
  }
}
