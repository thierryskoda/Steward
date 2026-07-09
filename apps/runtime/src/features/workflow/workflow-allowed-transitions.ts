import { STATUS, type IItemStatus } from "@steward/contracts/schemas";

function transitionKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** Full set of allowed item transitions (categories). Built from canonical STATUS. */
const ITEM_TRANSITION_PAIRS: readonly (readonly [string, string])[] = [
  [STATUS.NEEDS_REVIEW, STATUS.APPROVED],
  [STATUS.NEEDS_REVIEW, STATUS.REJECTED],
  [STATUS.NEEDS_REVIEW, STATUS.LEARNING_FROM_REJECTION],
  [STATUS.LEARNING_FROM_REJECTION, STATUS.REJECTED],
  [STATUS.APPROVED, STATUS.CLAIMED],
  [STATUS.APPROVED, STATUS.REJECTED],
  [STATUS.APPROVED, STATUS.LEARNING_FROM_REJECTION],
  [STATUS.CLAIMED, STATUS.AGENT_RUNNING],
  [STATUS.CLAIMED, STATUS.APPROVED],
  [STATUS.AGENT_RUNNING, STATUS.IMPLEMENTED],
  [STATUS.AGENT_RUNNING, STATUS.FAILED],
  [STATUS.AGENT_RUNNING, STATUS.APPROVED],
];
export const ALLOWED_ITEM_TRANSITIONS = new Set<string>(
  ITEM_TRANSITION_PAIRS.map(([from, to]) => transitionKey(from, to))
);

/** Rules workflow transitions (subset; no learning-from-rejection). */
const RULES_TRANSITION_PAIRS: readonly (readonly [string, string])[] = [
  [STATUS.NEEDS_REVIEW, STATUS.APPROVED],
  [STATUS.NEEDS_REVIEW, STATUS.REJECTED],
  [STATUS.APPROVED, STATUS.CLAIMED],
  [STATUS.APPROVED, STATUS.REJECTED],
  [STATUS.CLAIMED, STATUS.AGENT_RUNNING],
  [STATUS.CLAIMED, STATUS.APPROVED],
  [STATUS.AGENT_RUNNING, STATUS.IMPLEMENTED],
  [STATUS.AGENT_RUNNING, STATUS.FAILED],
  [STATUS.AGENT_RUNNING, STATUS.APPROVED],
];
export const RULES_ALLOWED_TRANSITIONS = new Set<string>(
  RULES_TRANSITION_PAIRS.map(([from, to]) => transitionKey(from, to))
);

export function isAllowedItemTransition(fromSubdir: IItemStatus, toSubdir: IItemStatus): boolean {
  return ALLOWED_ITEM_TRANSITIONS.has(`${fromSubdir}->${toSubdir}`);
}

export function isAllowedRuleTransition(fromStatus: string, targetStatus: IItemStatus): boolean {
  return RULES_ALLOWED_TRANSITIONS.has(`${fromStatus}->${targetStatus}`);
}
