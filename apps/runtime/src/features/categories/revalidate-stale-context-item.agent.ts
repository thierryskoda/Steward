/**
 * Decides keep/patch/fail for a category item when rules or project-context snapshots have
 * changed since the item was created. Used so we do not implement findings that no longer
 * align with current rules or project context. Invoked by stale-context scan and pre-implement gate.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const INPUT_SCHEMA = z.object({
  categoryId: z.string(),
  itemJson: z.record(z.unknown()),
  /** Fingerprint when the item was created (or last revalidated). */
  contextFingerprintWhenCreated: z.string(),
  /** Current snapshot fingerprint; differs from above so context has changed. */
  currentContextFingerprint: z.string(),
  /** Current rules/guidance text so the agent can compare. */
  rulesContextExcerpt: z.string(),
  /** Current project context excerpt so the agent can compare. */
  projectContextExcerpt: z.string(),
  /** Optional: current code at item locations (when location files changed). */
  locationsCodeExcerpt: z.string().optional(),
});

const OUTPUT_SCHEMA = z.object({
  decision: z.enum(["keep", "patch", "fail"]),
  reasonCode: z.string().min(1),
  patchedFields: z.record(z.unknown()).optional(),
});

const INSTRUCTIONS = `You evaluate a Steward category item whose rules or project context have changed since it was created.

TASK: Decide whether the item is still valid under the CURRENT rules and project context.

- keep: The finding and chosen fix are still correct and aligned with the new rules/context. No changes needed.
- patch: The item is mostly valid but needs minor updates (e.g. title, locations, fixPlan, selectedOptionId). Provide patchedFields with only the fields to update. Allowed keys: title, locations, fixPlan, selectedOptionId.
- fail: The item is no longer valid (e.g. contradicts new rules, no longer applies under new context, or the proposed fix would violate current guidance). Use reasonCode: "context_changed_invalidated_item" or a short machine-readable reason.`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  let body = `Category: ${input.categoryId}

Context has changed (fingerprint when created: ${input.contextFingerprintWhenCreated}, current: ${input.currentContextFingerprint}).

Current rules/guidance (excerpt):
${input.rulesContextExcerpt.slice(0, 8000)}

Current project context (excerpt):
${input.projectContextExcerpt.slice(0, 4000)}
`;
  if (input.locationsCodeExcerpt && input.locationsCodeExcerpt.length > 0) {
    body += `

Current code at item locations (for comparison):
${input.locationsCodeExcerpt.slice(0, 6000)}
`;
  }
  body += `

Item to revalidate:
${JSON.stringify(input.itemJson, null, 2)}

${INSTRUCTIONS}`;
  return body;
}

export const revalidateStaleContextItemAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "revalidate-stale-context-item",
  description:
    "Decides whether a category item is still valid after rules or project-context snapshots changed",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: `{"decision":"keep"|"patch"|"fail","reasonCode":"string","patchedFields"?: object}. For patch, patchedFields may include title, locations, fixPlan, selectedOptionId.`,
};
