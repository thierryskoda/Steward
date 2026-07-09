/**
 * Eval judge for humanize-category output. Compares actual vs expected and returns pass/fail
 * with score and reason. Used by the eval script to decide if generated output is good enough
 * (~95% equivalence in meaning and terminology).
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
import { HumanizeEvalFixtureExpectedSchema } from "./humanize-eval.schemas.js";

const INPUT_SCHEMA = z.object({
  categoryId: z.string(),
  title: z.string(),
  expected: HumanizeEvalFixtureExpectedSchema,
  actual: HumanizeEvalFixtureExpectedSchema,
});

const OUTPUT_SCHEMA = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100),
  reason: z.string().optional(),
});

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  return `You are evaluating whether a "humanized" finding output is good enough compared to a reference.

### Context
Category: ${input.categoryId}
Title: ${input.title}

### Reference (expected) output
${JSON.stringify(input.expected, null, 2)}

### Actual output to evaluate
${JSON.stringify(input.actual, null, 2)}

### Rubric
- **Pass** (true) only if actual is **at least 95% equivalent** in meaning, intent, and structure to expected.
- Actual must use **official product/feature names** (e.g. "Continual learning" not "memory" or other synonyms).
- Preserve clarity and structure: summary, current behavior, why it matters, evidence, decision question, and option tradeoffs must all be decision-readable.
- **Score**: 0-100. 100 = semantically identical and correct terminology. Lower if meaning drifts, wrong terms, or structure is off.
- **Reason**: Short explanation when failing; optional when passing.

Reply with JSON: {"pass": boolean, "score": number, "reason": "optional string"}.`;
}

export const humanizeEvalJudgeAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "humanize-eval-judge",
  description: "Evaluates humanize-category actual output vs expected; returns pass, score, reason",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: '{"pass":boolean,"score":number 0-100,"reason":"optional string"}',
};
