export type IMutationOutcome =
  "succeeded" | "failed" | "timeout" | "idle_timeout" | "spawn_error" | "killed" | "cancelled";

export type IEvaluatedFailureReason =
  "tool-rejected" | "spawn-error" | "timeout" | "no-write" | "unclear" | "evaluator-error";

import type { ITranscriptEntry } from "./agent-transcript-capture.js";

export type ITranscriptCapture = {
  chatId: string;
  path: string;
  entries: ITranscriptEntry[];
};

export type ILastImplementationTranscript = ITranscriptCapture & {
  capturedAt: number;
};

import type { ILLMProviderMeta } from "./llm-provider.types.js";

export type IMutationResult = {
  outcome: IMutationOutcome;
  summary: string;
  outputText: string;
  diagnosticText: string;
  providerMeta?: ILLMProviderMeta;
  runtimeMs?: number;
  code: number | null;
  reason: string;
  evaluatedStatus?: "success" | "failure";
  evaluatedFailureReason?: IEvaluatedFailureReason;
  evaluatedExplanation?: string;
  transcript?: ITranscriptCapture;
};
