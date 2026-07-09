/**
 * Turns a technical finding and options into a decision-readable approval card. Used in the
 * plan stage before the option picker is shown to the user.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
import { createSchemaPropertyGetter } from "../../core/llm/zod-to-prompt.js";

const EvidenceItemSchema = z.string().min(1);

const OptionHumanSchema = z.object({
  id: z.enum(["A", "B"]),
  humanSummary: z.string().min(1),
  humanChooseThisIf: z.string().min(1),
  humanTradeoff: z.string().min(1),
});

const INPUT_SCHEMA = z.object({
  categoryId: z.string(),
  title: z.string(),
  finding: z.string(),
  locations: z.array(z.string()).min(1),
  options: z
    .array(
      z.object({
        id: z.enum(["A", "B"]),
        name: z.string(),
        technicalPlan: z.string(),
        ruleConsideration: z.string().optional(),
      })
    )
    .min(2),
});

const OUTPUT_SCHEMA = z.object({
  humanSummary: z.string().min(1),
  humanCurrentBehavior: z.string().min(1),
  humanWhyItMatters: z.string().min(1),
  humanEvidence: z.array(EvidenceItemSchema).min(1).max(3),
  humanDecisionQuestion: z.string().min(1),
  options: z.array(OptionHumanSchema).min(1),
});

export type IHumanizeCategoryOutput = z.infer<typeof OUTPUT_SCHEMA>;

const outputField = createSchemaPropertyGetter(OUTPUT_SCHEMA);
const optionField = createSchemaPropertyGetter(OptionHumanSchema);

const INSTRUCTIONS = `Write an approval decision card, not a workflow story.

The reader must understand:
1. What happens today.
2. Why that is a problem.
3. What decision they are being asked to make.
4. How each option changes behavior.
5. What each option gives up.

Style:
- Be concise and direct. Use short paragraphs, not fragments.
- Use plain language, but keep product nouns from the input when they identify the actual decision.
- If a product noun matters, define it briefly instead of replacing it. Examples: workflow recipe, profile guidance, trusted setup, runtime, schema, tool.
- Do not force the issue into step-by-step "you" flows unless the finding is literally about a user workflow.
- Do not hide the exact thing being changed.
- Avoid vague architecture filler: orchestration, systemic, coupling, abstraction, lifecycle, dependency graph, surface area.
- No file paths in user-facing fields. Use file paths only to infer evidence.

Output fields:
- ${outputField("humanSummary")}: 1-2 sentences. State the problem and practical impact.
- ${outputField("humanCurrentBehavior")}: 1 sentence. Say what the product/code currently allows or does.
- ${outputField("humanWhyItMatters")}: 1 sentence. Say why ignoring this is risky or confusing.
- ${outputField("humanEvidence")}: 1-3 bullets, each 4-14 words. Mention concrete product behavior, tests, or sources without paths.
- ${outputField("humanDecisionQuestion")}: 1 direct question that names the decision.

Option fields:
- ${optionField("humanSummary")}: 1-2 sentences. Say what changes if this option is approved.
- ${optionField("humanChooseThisIf")}: One sentence starting with "Choose this if". Name the preference or product direction this option serves.
- ${optionField("humanTradeoff")}: One sentence. State what the user gains and what they accept.`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  return `You are a product-focused technical writer.

Your job is to translate a technical finding and implementation options into a concise approval card for a product owner.

### Context
Category: ${input.categoryId}
Technical Title: ${input.title}
Technical Finding: ${input.finding}
Locations: ${input.locations.join(", ")}

Technical Options:
${JSON.stringify(input.options, null, 2)}

### Output Quality Rules

${INSTRUCTIONS}`;
}

export const humanizeCategoryAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "humanize-category",
  description: "Translates technical findings and options into approval decision cards",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"humanSummary":"string","humanCurrentBehavior":"string","humanWhyItMatters":"string","humanEvidence":["string",...1-3],"humanDecisionQuestion":"string","options":[{"id":"A"|"B","humanSummary":"string","humanChooseThisIf":"string","humanTradeoff":"string"},...]}. Option IDs must match input.`,
};
