/**
 * Canonical workflow/item status values. SSOT for runtime and consumers.
 * Do not duplicate status unions elsewhere.
 */

export const ITEM_STATUS_VALUES = [
  "needs-review",
  "learning-from-rejection",
  "approved",
  "claimed",
  "agent-running",
  "implemented",
  "failed",
  "rejected",
] as const;

export type IItemStatus = (typeof ITEM_STATUS_VALUES)[number];

/** Named status constants (SSOT); use these instead of string literals. */
export const STATUS = {
  NEEDS_REVIEW: ITEM_STATUS_VALUES[0],
  LEARNING_FROM_REJECTION: ITEM_STATUS_VALUES[1],
  APPROVED: ITEM_STATUS_VALUES[2],
  CLAIMED: ITEM_STATUS_VALUES[3],
  AGENT_RUNNING: ITEM_STATUS_VALUES[4],
  IMPLEMENTED: ITEM_STATUS_VALUES[5],
  FAILED: ITEM_STATUS_VALUES[6],
  REJECTED: ITEM_STATUS_VALUES[7],
} as const satisfies Record<string, IItemStatus>;
