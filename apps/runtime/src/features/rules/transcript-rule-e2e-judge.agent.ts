/**
 * LLM judge for the transcript-to-rule E2E. It verifies that a user-stated code
 * standard was captured as a rule and applied without overgeneralizing.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const INPUT_SCHEMA = z
  .object({
    scenarioId: z.string().min(1),
    transcriptMessage: z.string().min(1),
    proposalTitle: z.string().min(1),
    proposalRuleText: z.string().min(1),
    appliedRuleFileContent: z.string().min(1),
  })
  .strict();

const OUTPUT_SCHEMA = z
  .object({
    is_correct: z.boolean(),
    reason: z.string(),
    evidence: z.array(z.string().min(1)).min(1).max(6),
    warnings: z.array(z.string().min(1)).max(6).optional(),
  })
  .strict();

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  return `You are a read-only LLM judge for a backend E2E test.

Evaluate whether a chat transcript message was captured and applied as a durable code-standard rule.

### Scenario
ID: ${input.scenarioId}

### Transcript message
${input.transcriptMessage}

### Captured rule proposal
Title: ${input.proposalTitle}
Rule text:
${input.proposalRuleText}

### Applied rule file content
${input.appliedRuleFileContent}

### Pass criteria
- The proposal captures the actual code standard from the transcript: backend external JSON from webhooks/API requests must be validated with Zod before fields are read.
- The proposal does not turn this into unrelated process, workflow, memory, or agent-behavior guidance.
- The applied rule file contains the captured standard in durable project-rule form.
- The applied rule is concise and reusable across backend request/webhook parsing code.

### Fail conditions
Fail if the rule omits Zod/schema validation, omits the JSON.parse/direct-cast risk, targets only one file or one incident, or adds unrelated workflow/meta-agent rules.

Return only JSON matching:
{"is_correct":boolean,"reason":"string","evidence":["string"],"warnings":["string"]}

Reason contract:
- If is_correct is true, reason must be exactly "".
- If is_correct is false, reason must explain the failure.`;
}

export const transcriptRuleE2eJudgeAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "transcript-rule-e2e-judge",
  description: "Evaluates transcript-learned rule capture and application quality",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription:
    '{"is_correct":boolean,"reason":"string","evidence":["string"],"warnings":["string"]}. reason is empty string when passing.',
};
