/**
 * In-memory state per transcript path for idle gating.
 * lastSize/lastSeenAtMs updated on each poll; run when stable for idleMs.
 */
export type IContinualLearningIdleState = {
  lastSize: number;
  lastSeenAtMs: number;
  inFlight: boolean;
};
