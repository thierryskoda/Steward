/**
 * Produces one highest-impact finding (or noFinding) for a rule from search questions and project context. Used in category detection to drive the codebase scan; invoked when a category is run to detect violations.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

/** Accept any non-empty title so parse never fails; callers log when not 3-5 words. */
const FindingTitleSchema = z.string().trim().min(1);

const SingleFindingSchema = z.object({
  findingKey: z.string().min(1),
  title: FindingTitleSchema,
  locations: z.array(z.string().min(1)).min(1),
  finding: z.string(),
});

const NoFindingSchema = z.object({ noFinding: z.literal(true) });

const OUTPUT_SCHEMA = z.union([SingleFindingSchema, NoFindingSchema]);

export type IDetectCategoryOutput = z.infer<typeof OUTPUT_SCHEMA>;

const INPUT_SCHEMA = z.object({
  categoryId: z.string(),
  ruleContent: z.string(),
  existingFindingsContext: z.string(),
  detectionQuestions: z.array(z.string().min(1)).min(3).max(5),
  excludedPatterns: z.array(z.string()),
});

const INSTRUCTIONS_HEAD = `You are a code quality reviewer.

You must use the following search questions to guide your scan. Answer them from the project context; your finding should reflect where the rule is violated in a way that addresses these questions.

Search questions (must inform your finding):`;

const INSTRUCTIONS_TAIL = `
Find the single highest-impact structural or systemic violation of the rule (from earlier in this chat), informed by the search questions. Focus on one pattern-level finding with the highest structural/systemic impact. Prefer issues that affect many files or overall project integrity over small local fixes. Include:
- findingKey: short slug (e.g. "parse-failure-swallowed")
- title: short label, exactly 3-5 words
- locations: exhaustive array of file paths (and optional symbols) where this exact issue pattern appears; list all supported locations from project context, ordered highest-impact first (no cap)
- finding: technical one-sentence description (for LLM/implementation context; include file paths, symbols, concrete details)

title quality rules:
- Exactly 3-5 words.
- Use concrete domain words, not generic placeholders.
- No punctuation-only tokens, markdown, or file paths.

Location coverage rules:
- Prefer multi-location findings when the pattern appears in multiple places; systemic/architectural issues often span many files.
- List every supported location from project context where the pattern appears; order by impact. Do not cap the number of locations.
- Single-location findings are allowed only when exhaustive scan finds exactly one supported location.
- Never invent file paths; only use paths that appear in project context.`;

function hasMeaningfulFindingsContext(value: string): boolean {
  const t = value.trim();
  return t.length > 0 && t !== "none" && t !== "empty";
}

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const excludeBlock =
    input.excludedPatterns.length > 0
      ? `
Do not search for or report findings in excluded paths. Excluded path segments/patterns (do not list these as locations): ${input.excludedPatterns.join(", ")}. Only report locations in repo paths that are not in this list.

`
      : "";

  const existingFindingsBlock = hasMeaningfulFindingsContext(input.existingFindingsContext)
    ? `Here are existing in-flight findings (pending/approved/claimed/agent-running). Avoid generating duplicates:
---
${input.existingFindingsContext}
---

`
    : "";

  return `${excludeBlock}${existingFindingsBlock}${INSTRUCTIONS_HEAD}
${input.detectionQuestions.map((q) => `- ${q}`).join("\n")}${INSTRUCTIONS_TAIL}`;
}

export const detectCategoryAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "detect-category",
  description: "Identifies rule violations for any category from rule content",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `Either {"noFinding": true} or {"findingKey":"string","title":"string","finding":"string","locations":["path/to/file.ts",...]}. findingKey slug; title 3-5 words; locations exhaustive; finding one-sentence technical.`,
};
