/**
 * Challenges a fully generated finding before persistence. Used by generate-category as a
 * production quality gate so weak findings are repaired or dropped before review/approval.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
import { FindingDecisionSchema, FindingProblemSchema } from "@steward/contracts/schemas";

const LocationEvidenceSchema = z
  .object({
    location: z.string().min(1),
    excerpt: z.string().min(1),
  })
  .strict();

const INPUT_SCHEMA = z
  .object({
    categoryId: z.string().min(1),
    ruleContent: z.string(),
    projectContext: z.string(),
    rulesContext: z.string(),
    problem: FindingProblemSchema,
    decision: FindingDecisionSchema,
    locationEvidence: z.array(LocationEvidenceSchema).max(8),
  })
  .strict();

const OUTPUT_SCHEMA = z
  .object({
    decision: z.enum(["accept", "repair", "drop"]),
    reasons: z.array(z.string().min(1)).max(6),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision !== "accept" && value.reasons.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "repair/drop decisions require at least one reason.",
        path: ["reasons"],
      });
    }
  });

export type IJudgeGeneratedFindingInput = z.infer<typeof INPUT_SCHEMA>;
export type IJudgeGeneratedFindingOutput = z.infer<typeof OUTPUT_SCHEMA>;

function buildPrompt(input: IJudgeGeneratedFindingInput): string {
  const evidenceBlock =
    input.locationEvidence.length === 0
      ? "No file excerpts were available; judge only from the supplied context and generated card."
      : input.locationEvidence
          .map(
            (item) => `Location: ${item.location}
Excerpt:
\`\`\`
${item.excerpt}
\`\`\``
          )
          .join("\n\n");

  return `You are a strict read-only quality gate for generated code-quality findings.

Decide whether this finding is good enough to persist for human review or automatic approval.

### Category
${input.categoryId}

### Category rule
${input.ruleContent || "none"}

### Project context
${input.projectContext || "none"}

### Rules context
${input.rulesContext || "none"}

### Generated problem
${JSON.stringify(input.problem, null, 2)}

### Generated decision/options
${JSON.stringify(input.decision, null, 2)}

### Location evidence
${evidenceBlock}

### Decision rules
- accept: The finding is supported by evidence, matches the category rule, is high enough impact to show, and all options are valid.
- repair: The finding is basically valid but needs tighter title, clearer evidence, better wording, or option cleanup.
- drop: The finding is unsupported, duplicate-like, too trivial/local for the category, conflicts with project rules, invents facts, or options are not implementable.

Challenge the generated card directly:
- Is the problem actually present in the listed locations?
- Are the locations relevant and not invented?
- Is the issue meaningful for the rule, not just generic polish?
- Are the options scoped to the finding and materially different when there are two?
- Does the user-facing card explain current behavior, why it matters, evidence, and the decision?

Return only JSON:
{"decision":"accept"|"repair"|"drop","reasons":["short reason", "..."]}.

If decision is accept, reasons may be empty.`;
}

export const judgeGeneratedFindingAgent: IAgentSpec<
  IJudgeGeneratedFindingInput,
  IJudgeGeneratedFindingOutput
> = {
  id: "judge-generated-finding",
  description: "Quality-gates generated findings before persistence",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription:
    '{"decision":"accept"|"repair"|"drop","reasons":["string",...]}. repair/drop require reasons; accept may use an empty reasons array.',
};
