/**
 * Updates the project context file (from configured projectContext) Learned Project Context section from a transcript. Used by continual-learning to add high-signal project facts not inferable from code; invoked after a transcript is available and no human approval is required for this section.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const INPUT_SCHEMA = z.object({
  transcriptContent: z.string(),
  targetFilePath: z.string(),
  targetFileContent: z.string(),
});

const OUTPUT_SCHEMA = z.string();

const MAX_BULLETS_PER_SECTION = 12;
const SECTION = "## Learned Project Context";

function buildInstructionsHead(targetFilePath: string): string {
  return `You are updating the project's context file from a single chat transcript. You may edit only one section in that file; all other content must remain unchanged.

Target file (edit only this file in the workspace): ${targetFilePath}

Allowed section (you may add or update bullets only here):
- ${SECTION}

Scope: Project context only. Do not add code standards, style rules, typing/convention rules, or architecture rules—those are for the rule-capture flow. Add only high-level facts about the project that are hard for an LLM to know from the codebase alone.

Bar for inclusion:
- Include only facts that are high-signal, durable, and not inferable by just reading the code (e.g. decisions the team made, why something is the way it is, product boundaries that are not obvious from code structure).
- Do not add things that are easy to infer (e.g. a full architecture description that could be derived from code structure).
- Never include: one-off tasks, temporary incidents, file-local quirks, secrets/credentials, branch names, commit hashes, transient errors, or anything that belongs in coding rules.

Rules:
- Edit only the file ${targetFilePath} in the workspace. Change only the section above. Do not modify any other section or line.
- Add or update plain bullet points only. No evidence tags, confidence scores, or metadata.
- Keep the section to at most ${MAX_BULLETS_PER_SECTION} bullets. Deduplicate semantically similar bullets.
- If the transcript contains nothing that meets the bar above, do not edit the file at all. Reply with exactly: No high-signal memory updates.

Current content of ${targetFilePath}:
---
`;
}

const INSTRUCTIONS_TAIL = `
---

Transcript content to evaluate:
---
`;

const INSTRUCTIONS_FOOT = `
---

If you make edits: output a short plain-text summary of what you added or updated in the Learned Project Context section. If you made no edit: output exactly "No high-signal memory updates."`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  return `${buildInstructionsHead(input.targetFilePath)}${input.targetFileContent}${INSTRUCTIONS_TAIL}${input.transcriptContent}${INSTRUCTIONS_FOOT}`;
}

export const learnAgentsMemoryAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "learn-agents-memory",
  description:
    "Extracts learned project context from transcript and updates the projectContext target file Learned Project Context section only",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: (raw) => raw?.trim() ?? null,
  outputContractDescription:
    "Plain text: short summary of what was added or updated in the Learned Project Context section, or exactly 'No high-signal memory updates.'",
};
