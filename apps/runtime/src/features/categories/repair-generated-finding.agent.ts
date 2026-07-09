/**
 * Repairs a generated finding that passed the broad idea check but failed the quality gate.
 * Used once by generate-category before the candidate is judged again or dropped.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
import { FindingDecisionSchema, FindingProblemSchema } from "@steward/contracts/schemas";

const INPUT_SCHEMA = z
  .object({
    categoryId: z.string().min(1),
    ruleContent: z.string(),
    projectContext: z.string(),
    rulesContext: z.string(),
    problem: FindingProblemSchema,
    decision: FindingDecisionSchema,
    judgeReasons: z.array(z.string().min(1)).min(1).max(6),
  })
  .strict();

const OUTPUT_SCHEMA = z
  .object({
    problem: FindingProblemSchema,
    decision: FindingDecisionSchema,
  })
  .strict();

export type IRepairGeneratedFindingInput = z.infer<typeof INPUT_SCHEMA>;
export type IRepairGeneratedFindingOutput = z.infer<typeof OUTPUT_SCHEMA>;

function buildPrompt(input: IRepairGeneratedFindingInput): string {
  return `You are repairing a generated code-quality finding before it is shown to a user.

Do not choose a new issue. Keep the same underlying problem unless the judge reason proves the wording or option shape is wrong.

### Category
${input.categoryId}

### Category rule
${input.ruleContent || "none"}

### Project context
${input.projectContext || "none"}

### Rules context
${input.rulesContext || "none"}

### Judge reasons to fix
${input.judgeReasons.map((reason) => `- ${reason}`).join("\n")}

### Current problem
${JSON.stringify(input.problem, null, 2)}

### Current decision/options
${JSON.stringify(input.decision, null, 2)}

### Repair rules
- Preserve the same finding scope; do not invent a different issue.
- Tighten the title, technical finding, human evidence, or option plans only where needed.
- Keep file paths only in technical fields. User-facing fields should stay decision-readable.
- Options must be implementable and scoped to this finding. If two options remain, they must differ in strategy or tradeoff.
- Respect the category rule and rules context over the original wording.

Return only JSON:
{"problem":{...FindingProblem},"decision":{...FindingDecision}}.`;
}

export const repairGeneratedFindingAgent: IAgentSpec<
  IRepairGeneratedFindingInput,
  IRepairGeneratedFindingOutput
> = {
  id: "repair-generated-finding",
  description: "Repairs a generated finding after quality-gate feedback",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription:
    '{"problem":FindingProblem,"decision":FindingDecision}. Preserve the same issue; repair wording, evidence, and options only.',
};
