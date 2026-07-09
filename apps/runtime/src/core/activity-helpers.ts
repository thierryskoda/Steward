import type { IActivityEvent, IActivitySlug } from "@steward/contracts/schemas";

export function createActivityEvent(
  slug: IActivitySlug,
  meta?: Record<string, unknown>
): IActivityEvent {
  return { slug, at: Date.now(), ...(meta !== undefined ? { meta } : {}) };
}

export function appendActivity(
  current: IActivityEvent[] | undefined,
  slug: IActivitySlug,
  meta?: Record<string, unknown>
): IActivityEvent[] {
  const next = createActivityEvent(slug, meta);
  return [...(current ?? []), next];
}
