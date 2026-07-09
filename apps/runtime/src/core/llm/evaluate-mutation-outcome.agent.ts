/**
 * Classifies mutation execution as success or failure from CLI exit/output. Used after a workspace-mutation run to decide retry vs fail; invoked by run-workspace-mutation.agent orchestration.
 */
import { z } from "zod";
import { CHEAP_LLM_MODEL } from "./llm-defaults.js";
import { extractJsonObject } from "./json-extract.js";
import type { IAgentSpec } from "./agent-spec.types.js";
const INPUT_SCHEMA = z.object({
  taskIntent: z.string(),
  code: z.number().nullable(),
  reason: z.string(),
  outputExcerpt: z.string(),
  diagnosticExcerpt: z.string(),
});

const FAILURE_REASON = ["tool-rejected", "spawn-error", "timeout", "no-write", "unclear"] as const;

const OUTPUT_SCHEMA = z.object({
  status: z.enum(["success", "failure"]),
  failureReason: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return "unclear";
      const valid = FAILURE_REASON as readonly string[];
      if (valid.includes(v)) return v as (typeof FAILURE_REASON)[number];
      return "unclear";
    }),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
});

export type IEvaluateMutationOutcomeOutput = z.infer<typeof OUTPUT_SCHEMA>;

const INSTRUCTIONS = `Classify:
- status: "success" if the task was completed (files changed as intended, or explicit no-op when appropriate). "failure" if tools were blocked, no files were modified when they should have been, spawn/timeout errors, or unclear outcome.
- failureReason: only when status is "failure". Use: "tool-rejected" when output says ApplyPatch/Shell rejected or tools blocked; "spawn-error" when process failed to start; "timeout" when idle/hard timeout; "no-write" when agent reports no files modified but task required edits; "unclear" otherwise.
- explanation: one short sentence.
- confidence: 0-1.`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  return `You classify whether a mutation task succeeded or failed based on its execution output.

Task intent (what the agent was asked to do):
---
${input.taskIntent.slice(0, 500)}
---

Execution result:
- exit code: ${String(input.code)}
- termination reason: ${input.reason}
- output (excerpt): ${input.outputExcerpt.slice(0, 800)}
- diagnostic (excerpt): ${input.diagnosticExcerpt.slice(0, 400)}

${INSTRUCTIONS}`;
}

export const evaluateMutationOutcomeAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "evaluate-mutation-outcome",
  description: "Classifies mutation execution success or failure from output",
  model: CHEAP_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"status":"success"|"failure","failureReason"?:string,"explanation":"string","confidence":number}. failureReason one of: tool-rejected, spawn-error, timeout, no-write, unclear. confidence 0-1.`,
};
