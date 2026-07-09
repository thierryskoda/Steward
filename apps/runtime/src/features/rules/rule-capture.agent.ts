/**
 * Classifies a chat message as a code standard or not and extracts title/ruleText/rationale. Used to capture user-stated rules for project code standards; output is used for rule proposals that may be applied under the rules directory and reflected in rules-snapshot from ruleSources.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
const INPUT_SCHEMA = z.object({
  messageRole: z.string(),
  messageContent: z.string(),
  fullCanonicalRulesContent: z.string(),
  existingRulesSection: z.string(),
});

const OUTPUT_SCHEMA = z.object({
  relevant: z.boolean(),
  title: z.string().optional(),
  ruleText: z.string().optional(),
  rationale: z.string().optional(),
  reason: z.string().optional(),
});

const INSTRUCTIONS = `You are a code standards expert. Analyze this chat message.

SCOPE: Extract ONLY true code standards—style, typing, naming, architecture, testing, linting, file structure. REJECT: process/memory/ops/workflow/meta-agent rules, chat persistence policies, triage routing, LLM evaluation flows, filesystem layout for workflows, plan refresh instructions. If the message is about how the agent or system behaves (not how developers write code), output relevant=false with reason=not_code_standard.

GENERALITY GATE (strict): Propose rules only if they are reusable standards, not one-off fixes.
- ACCEPT only guidance that applies broadly across files/features.
- REJECT rules tied to a specific file path, module name, alias, symbol, migration, or single refactor detail (for example: "do not import from X file", "replace this exact barrel export", "rename this specific folder").
- REJECT advice that encodes a local incident into policy.
- If too narrow/situational, output relevant=false with reason=code_only.

VERY IMPORTANT: If this rule already exists or is substantially the same as any existing rule above, output relevant=false with reason=duplicate.

When relevant (code standard only and passes GENERALITY GATE), output a JSON object with:
- relevant: true
- title: short label (a few words)
- ruleText: the rule content in markdown, suitable for rule source files in ruleSources. Be concise.
- rationale: one short sentence why

When NOT relevant, output:
- relevant: false
- reason: one of: irrelevant, small_talk, question, acknowledgment, vague, code_only, parse_failed, not_code_standard, duplicate`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  return `Message:
[${input.messageRole}] ${input.messageContent.slice(0, 4000)}

Canonical rules from config ruleSources (do not suggest a rule that duplicates or restates any of this):
---
${input.fullCanonicalRulesContent}
---

${input.existingRulesSection}

${INSTRUCTIONS}`;
}

export const ruleCaptureAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "rule-capture",
  description: "Extracts code standards and rules from chat messages for Cursor rules",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"relevant":boolean,"title"?:string,"ruleText"?:string,"rationale"?:string,"reason"?:string}. When relevant=true include title, ruleText, rationale; when false include reason.`,
};
