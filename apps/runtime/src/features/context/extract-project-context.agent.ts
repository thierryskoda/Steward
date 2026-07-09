/**
 * Extracts a single project-context text from documentation files listed in config projectContext.
 * Used to populate the DB-backed project-context snapshot for prompt injection.
 */
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const OUTPUT_SCHEMA = z.object({
  projectContextText: z.string(),
});

export type IExtractProjectContextOutput = z.infer<typeof OUTPUT_SCHEMA>;

const INPUT_SCHEMA = z.object({
  sourceEntries: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    })
  ),
});

const INSTRUCTIONS = `You are given documentation files (README, guides, architecture docs) from a project. Your task is to produce a single consolidated "project context" text that will be used to ground codebase scans and coding decisions.

Include:
- Project purpose and main tech stack.
- Directory/module layout and where key code lives.
- Conventions (testing, naming, error handling) that affect implementation.
- File paths and module names that appear in the docs (so downstream tasks can reference them).

Exclude:
- Generic advice that does not describe this specific repo.
- Changelogs, release notes, or purely historical content unless they state current constraints.

Format:
- One coherent block of markdown (headings, lists, code paths as needed).
- Preserve concrete paths and names from the source docs.
- Output a single JSON object: {"projectContextText": "..."} with the full text as one string (escape newlines as \\n if needed, or use a single multi-line string).`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const sections = input.sourceEntries.map((e) => `### ${e.path}\n\`\`\`\n${e.content}\n\`\`\``);
  return `## Source documentation\n\n${sections.join("\n\n")}\n\n---\n\n${INSTRUCTIONS}`;
}

const OUTPUT_CONTRACT_DESCRIPTION = `Single JSON object: {"projectContextText":"string"}. projectContextText is the full consolidated project context in markdown.`;

export const extractProjectContextAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "extract-project-context",
  description: "Extracts consolidated project context from configured docs for snapshot cache",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
  outputContractDescription: OUTPUT_CONTRACT_DESCRIPTION,
};
