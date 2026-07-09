/**
 * Generates 3–5 concrete search questions from a rule and project context for a codebase scan. Used at the start of category detection to guide the scan; invoked when preparing the detect step for a category.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const INPUT_SCHEMA = z.object({
  categoryId: z.string(),
  ruleContent: z.string(),
  projectContext: z.string(),
});

const OUTPUT_SCHEMA = z.object({
  questions: z.array(z.string().min(1)).min(3).max(5),
});

const INSTRUCTIONS_HEAD = `You are preparing a codebase scan. Your job is to generate 3–5 concrete search questions that a software engineer would need to answer to find violations of the rule below.

`;

const INSTRUCTIONS_TAIL = `

Generate exactly 3–5 questions. Each question must:
- Be answerable by inspecting the codebase (no speculation about future features).
- Target structural or systemic issues the rule cares about (e.g. coupling, duplication, naming, error handling).
- Use concrete language (files, modules, boundaries) when project context provides it.`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const projectContextBlock = input.projectContext.trim()
    ? `Project context (use to ground questions in real paths and patterns):
---
${input.projectContext}
---

`
    : "";

  return `${INSTRUCTIONS_HEAD}${projectContextBlock}Rule for category "${input.categoryId}":
---
${input.ruleContent}
---${INSTRUCTIONS_TAIL}`;
}

export const generateDetectionQuestionsAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "generate-detection-questions",
  description: "Generates 3–5 search questions for a category rule to guide finding detection",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"questions":["string","string",...]}. Array of 3-5 strings; each a concrete search question.`,
};
