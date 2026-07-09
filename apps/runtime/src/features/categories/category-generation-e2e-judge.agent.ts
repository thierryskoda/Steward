/**
 * LLM judge for the category-generation E2E. It evaluates the persisted finding card
 * produced by the real detect -> options -> humanize flow.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
import { FindingDecisionSchema, FindingProblemSchema } from "@steward/contracts/schemas";

const INPUT_SCHEMA = z
  .object({
    scenarioId: z.string().min(1),
    categoryId: z.string().min(1),
    ruleContent: z.string().min(1),
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

Evaluate whether the generated finding card is good enough for a product owner to approve.

### Scenario
ID: ${input.scenarioId}
Category: ${input.categoryId}

### Category rule
${input.ruleContent}

### Project evidence
${input.projectEvidence}

### Generated finding problem
${JSON.stringify(input.problem, null, 2)}

### Generated decision
${JSON.stringify(input.decision, null, 2)}

### Pass criteria
- The generated problem names the actual issue: external JSON/input is trusted or parsed without schema validation.
- The card is decision-readable: it explains current behavior, why it matters, concrete evidence, and the decision being asked.
- The evidence bullets are grounded in the project evidence and do not invent unrelated facts.
- There are exactly two options, and both are valid implementation directions for this issue.
- Each option explains what changes, when to choose it, and the tradeoff.
- The copy is concise and understandable without reading code, while preserving important technical nouns such as schema validation when they identify the decision.

### Fail conditions
Fail if the card reports the wrong problem, invents unsupported behavior, omits the approval decision, produces vague options, or hides the core JSON/schema validation issue behind generic wording.

Return only JSON matching:
{"is_correct":boolean,"reason":"string","evidence":["string"],"warnings":["string"]}

Reason contract:
- If is_correct is true, reason must be exactly "".
- If is_correct is false, reason must explain the failure.`;
}

export const categoryGenerationE2eJudgeAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "category-generation-e2e-judge",
  description: "Evaluates generated category finding cards for E2E semantic quality",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription:
    '{"is_correct":boolean,"reason":"string","evidence":["string"],"warnings":["string"]}. reason is empty string when passing.',
};
