/**
 * Extracts category/rule entries from arbitrary source docs. Used when ruleSources
 * change to regenerate the DB-backed rules snapshot. Output is one category per logical
 * rule (often one per file; AGENTS.md or multi-section docs can be one or more).
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const categoryEntrySchema = z.object({
  categoryId: z.string().min(1),
  rulePath: z.string(),
  ruleContent: z.string(),
});

const OUTPUT_SCHEMA = z.object({
  categories: z.array(categoryEntrySchema),
});

export type IExtractRulesCategoriesOutput = z.infer<typeof OUTPUT_SCHEMA>;

const INPUT_SCHEMA = z.object({
  sourceEntries: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    })
  ),
});

const INSTRUCTIONS = `You are given documentation files that may contain both coding rules and non-rule context. Your task is to extract only actionable rule categories that help improve code quality.

Inclusion criteria (must satisfy all):
- The section is normative and actionable (e.g. must/never/prefer/avoid style constraints).
- The guidance directly affects implementation, refactoring, testing, review, or architecture decisions.
- The section is specific enough to enforce in code review.

Exclusion criteria:
- Meta/orientation sections (purpose, scope, guide introduction).
- Repository inventories or descriptive maps (module lists, layout overviews).
- Operational dashboards/checklists (release gates, success signals, drift-risk tracking).
- Process or product context that does not constrain coding behavior directly.
- Placeholder/memory sections with no concrete coding constraints.

Extraction rules:
- First, evaluate each section and decide include vs exclude using the criteria above.
- Output one entry in "categories" for each included logical rule block only.
- categoryId: short slug (lowercase, hyphens; e.g. "dead-code", "type-safety-integrity"). Derive from heading when obvious; otherwise invent a concise slug.
- rulePath: the source file path this rule came from (exactly as given in the source doc header).
- ruleContent: exact full text for that included rule block (no summarization or truncation).
- Preserve original wording and structure in ruleContent.

Examples:
- Include: "Type Safety & Data Contracts", "Error Handling & Observability", "Testing".
- Exclude: "Scope Of This Guide", "Runtime layout and workflow baseline", "Product Success Signals (Minimal)".`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const sections = input.sourceEntries.map((e) => `### ${e.path}\n\`\`\`\n${e.content}\n\`\`\``);
  return `## Source documentation\n\n${sections.join("\n\n")}\n\n---\n\n${INSTRUCTIONS}`;
}

const OUTPUT_CONTRACT_DESCRIPTION = `Single JSON object: {"categories":[{"categoryId":"string","rulePath":"string","ruleContent":"string"},...]}. No other keys. categoryId is a slug; rulePath is source file path; ruleContent is full rule text.`;

export const extractRulesCategoriesAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "extract-rules-categories",
  description: "Extracts category/rule entries from configured source docs for snapshot cache",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: OUTPUT_CONTRACT_DESCRIPTION,
};
