/**
 * Produces 3–12 implementation constraints from a finding and project rules. Used when building the implementation checklist for an option; invoked by generate-category after options are generated.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const INPUT_SCHEMA = z.object({
  title: z.string(),
  finding: z.string(),
  locations: z.array(z.string().min(1)).min(1),
  rulesContext: z.string(),
});

/** Accept any non-empty array so parse never fails; callers log when count not 3-12. */
const OUTPUT_SCHEMA = z.object({
  constraints: z.array(z.string().min(1)).min(1),
});

const INSTRUCTIONS = `Generate 3–12 actionable constraints. Each constraint must:
- Be specific to this finding and the codebase (refer to files/modules when project context allows).
- Be checkable (e.g. "Do not add barrel index files", "Use StrictOmit from @/core/general.types", "Ensure write is idempotent under retry").
- Derive from the rules above; do not invent new policy.`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const rulesBlock = input.rulesContext.trim()
    ? `Relevant rules (high level):
---
${input.rulesContext}
---

`
    : "";

  return `You are an architect preparing an implementation checklist. For the finding from this chat (title: ${input.title}), produce a short list of constraints the implementer must follow when proposing fixes.

${rulesBlock}${INSTRUCTIONS}`;
}

export const generateFixConstraintsAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "generate-fix-constraints",
  description: "Generates implementation constraints from a finding and project rules",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"constraints":["string",...]}. Array of 3-12 strings; each an actionable constraint.`,
};
