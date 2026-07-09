/**
 * Chooses target file and append/create action for a rule proposal. Used after a rule is approved; invoked by rule-apply-worker. Worker writes to the project rules directory (.cursor/rules/*.mdc). Canonical rules are read from DB-backed snapshots generated from configured ruleSources.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const CURSOR_RULE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]*\.mdc$/;

const APPLY_INPUT_SCHEMA = z
  .object({
    ruleTitle: z.string(),
    ruleContentPreview: z.string(),
    existingFilesList: z.string(),
  })
  .strict();

const APPLY_OUTPUT_SCHEMA = z
  .object({
    targetFile: z
      .string()
      .transform((s) => s.trim().replace(/\.md$/, ".mdc"))
      .refine(
        (s) => CURSOR_RULE_FILENAME_PATTERN.test(s),
        "targetFile must be a kebab-case .mdc filename with no path segments"
      ),
    action: z.enum(["append", "create"]),
  })
  .strict();

const INSTRUCTIONS = `You are a code standards expert. Given this rule proposal, decide where to add it in the project rules directory (worker writes to .cursor/rules/*.mdc).

Output a JSON object with:
- targetFile: string (filename only, e.g. "typescript.mdc" or "user-preferences.mdc"). Use existing file if the rule fits that topic; otherwise create a new filename (e.g. "testing.mdc", "architecture.mdc"). Always use .mdc extension.
- action: "append" | "create"

Do not decide whether the rule should apply. This proposal was already approved; your only job is to choose the safest target filename and write action.`;

function buildApplyPrompt(input: z.infer<typeof APPLY_INPUT_SCHEMA>): string {
  return `${INSTRUCTIONS}

Rule title: ${input.ruleTitle}
Rule content (first 500 chars): ${input.ruleContentPreview.slice(0, 500)}

Existing rule files:
${input.existingFilesList}`;
}

export const ruleApplyTargetAgent: IAgentSpec<
  z.infer<typeof APPLY_INPUT_SCHEMA>,
  z.infer<typeof APPLY_OUTPUT_SCHEMA>
> = {
  id: "rule-apply-target",
  description: "Decides target file and whether to apply a rule proposal",
  model: DEFAULT_LLM_MODEL,
  inputSchema: APPLY_INPUT_SCHEMA,
  outputSchema: APPLY_OUTPUT_SCHEMA,
  buildPrompt: buildApplyPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"targetFile":"kebab-case-filename.mdc","action":"append"|"create"}. targetFile must be filename only, no path segments.`,
};
