/**
 * LLM judge for the rejection-feedback E2E. It verifies that option hints learned
 * from a rejected finding shape the next generated decision options.
 */
import { z } from "zod";
import { FindingDecisionSchema, FindingProblemSchema } from "@steward/contracts/schemas";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const INPUT_SCHEMA = z
  .object({
    scenarioId: z.string().min(1),
    rejectedReason: z.string().min(1),
    learnedInstruction: z.string().min(1),
    projectEvidence: z.string().min(1),
    problem: FindingProblemSchema,
    decision: FindingDecisionSchema,
  })
  .strict();

const OUTPUT_SCHEMA = z
  .object({
    is_correct: z.boolean(),
    reason: z.string(),
    evidence: z.array(z.string().min(1)).min(1).max(6),
    warnings: z.array(z.string().min(1)).max(6).optional(),
  })
  .strict();

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  return `You are a read-only LLM judge for a backend E2E test.

Evaluate whether the generated decision options reflect feedback learned from a prior rejected finding.

### Scenario
ID: ${input.scenarioId}

### Prior rejected reason
${input.rejectedReason}

### Learned instruction inserted into option generation
${input.learnedInstruction}

### Project evidence
${input.projectEvidence}

### Generated problem
${JSON.stringify(input.problem, null, 2)}

### Generated decision
${JSON.stringify(input.decision, null, 2)}

### Pass criteria
- The generated problem still identifies the actual issue: webhook/external JSON is parsed or trusted without schema validation.
- The generated options do not repeat the rejected pattern of suggesting wrapper modules or moving the fix away from the JSON.parse/request boundary.
- At least one option clearly implements validation inline or directly at the boundary where the external JSON is parsed.
- The options are useful and distinct enough for approval, but the learned feedback has visibly shaped their direction.

### Fail conditions
Fail if the options suggest wrapper modules, generic abstraction layers, moving validation away from the parsing boundary, or ignore the learned instruction.

Return only JSON matching:
{"is_correct":boolean,"reason":"string","evidence":["string"],"warnings":["string"]}

Reason contract:
- If is_correct is true, reason must be exactly "".
- If is_correct is false, reason must explain the failure.`;
}

export const rejectionFeedbackE2eJudgeAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "rejection-feedback-e2e-judge",
  description: "Evaluates whether rejected-finding feedback shapes future generated options",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription:
    '{"is_correct":boolean,"reason":"string","evidence":["string"],"warnings":["string"]}. reason is empty string when passing.',
};
