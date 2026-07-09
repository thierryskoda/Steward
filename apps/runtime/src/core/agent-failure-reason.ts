import type { IMutationOutcome, IEvaluatedFailureReason } from "./llm/mutation-result.types.js";

const OUTCOME_SLUG_MAP: Record<IMutationOutcome, string> = {
  succeeded: "agent-exit-nonzero",
  failed: "agent-exit-nonzero",
  timeout: "agent-timeout",
  idle_timeout: "agent-idle-timeout",
  spawn_error: "agent-spawn-error",
  killed: "agent-killed",
  cancelled: "agent-cancelled",
};

const EVALUATED_REASON_SLUG_MAP: Record<IEvaluatedFailureReason, string> = {
  "tool-rejected": "agent-tool-rejected",
  "spawn-error": "agent-spawn-error",
  timeout: "agent-timeout",
  "no-write": "agent-no-write",
  unclear: "agent-unclear",
  "evaluator-error": "agent-evaluator-error",
};

export function toAgentFailureReason(
  outcome: IMutationOutcome,
  evaluatedFailureReason?: IEvaluatedFailureReason
): string {
  if (outcome === "failed" && evaluatedFailureReason) {
    return EVALUATED_REASON_SLUG_MAP[evaluatedFailureReason] ?? "agent-unclear";
  }
  return OUTCOME_SLUG_MAP[outcome] ?? "agent-unknown";
}
