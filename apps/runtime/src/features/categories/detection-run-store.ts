/**
 * In-memory store of last detection run per category. Used to pick "least recently run"
 * when deciding which category to run in a proactive tick.
 */

type IEntry = { lastRunAt: number; lastFindingsCount: number };

const store = new Map<string, IEntry>();

export function recordDetectionRun(categoryId: string, findingsCount: number): void {
  store.set(categoryId, {
    lastRunAt: Date.now(),
    lastFindingsCount: findingsCount,
  });
}

/**
 * Returns the category id with the smallest lastRunAt (never-run treated as 0).
 * Returns undefined only when categoryIds is empty.
 */
export function getCategoryWithOldestRun(categoryIds: string[]): string | undefined {
  if (categoryIds.length === 0) return undefined;
  let oldestId: string = categoryIds[0]!;
  let oldestAt: number = store.get(oldestId)?.lastRunAt ?? 0;
  for (let i = 1; i < categoryIds.length; i++) {
    const id = categoryIds[i]!;
    const at = store.get(id)?.lastRunAt ?? 0;
    if (at < oldestAt) {
      oldestAt = at;
      oldestId = id;
    }
  }
  return oldestId;
}
