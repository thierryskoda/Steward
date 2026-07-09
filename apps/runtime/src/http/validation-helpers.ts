import type { z } from "zod";
import {
  HTTP_RESPONSE_COLLECTION_SANITIZED,
  HTTP_RESPONSE_ITEM_DROPPED,
} from "../core/runtime-log-events.js";
import { formatZodIssuesForContext } from "../core/error-log-context.js";
import { getRuntimeLogger } from "../core/logger.js";

export type IRouteIdParams = {
  id: string;
};

export type ISanitizeCollectionArgs<T> = {
  route: string;
  requestId: string | undefined;
  rawItems: unknown[];
  itemSchema: z.ZodType<T>;
  getItemId?: (raw: unknown) => string | undefined;
};

/**
 * Per-item safeParse; collect valid items, log each dropped item and a summary.
 * Returns only schema-valid items. Never throws for item-level validation failures.
 */
export function sanitizeCollection<T>(args: ISanitizeCollectionArgs<T>): T[] {
  const { route, requestId, rawItems, itemSchema, getItemId } = args;
  const log = getRuntimeLogger();
  const valid: T[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const result = itemSchema.safeParse(raw);
    if (result.success) {
      valid.push(result.data);
    } else {
      const itemId = getItemId?.(raw);
      const issues = formatZodIssuesForContext(result.error.issues);
      log.warn({
        event: HTTP_RESPONSE_ITEM_DROPPED,
        route,
        requestId,
        index: i,
        itemId: itemId ?? null,
        issues,
      });
    }
  }
  const dropped = rawItems.length - valid.length;
  if (dropped > 0) {
    log.warn({
      event: HTTP_RESPONSE_COLLECTION_SANITIZED,
      route,
      requestId,
      total: rawItems.length,
      valid: valid.length,
      dropped,
    });
  }
  return valid;
}
