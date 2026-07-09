/**
 * Generates exclude names/patterns for runtime file scanning from repo layout and gitignore. Used to avoid file scanning noise; invoked when generating or regenerating repo-scope config.
 */
import { z } from "zod";
import { CHEAP_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import { extractJsonArray } from "../../core/llm/json-extract.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";

const INPUT_SCHEMA = z.object({
  projectRootName: z.string(),
  topLevelDirectories: z.array(z.string()),
  topLevelFiles: z.array(z.string()),
  gitignoreContent: z.string(),
});

const OUTPUT_SCHEMA = z.array(z.string());

const INSTRUCTIONS = `You generate repository exclude names for a local runtime config.

Output must be ONLY a JSON array of strings (exclude names/patterns).

Rules:
- Output ONLY JSON.
- Excludes must be safety-first and comprehensive for file scanning noise.
- Include generated/transient folders when present or implied (e.g. node_modules, dist, .next, build, out, coverage, .cache, target, .vite, logs).
- If top-level directories contain any of these, include them:
  .git, .steward, node_modules, dist, .next, build, out, coverage, ios, android, .expo, .turbo, .cache
- Use .gitignore as strong inspiration for additional noise excludes (e.g. *.log, *.tsbuildinfo, caches, artifacts).
- Also include tool/OS/runtime noise if relevant (e.g. .cursor, .qodo, .DS_Store, *.err).
- Prefer reusable names over absolute paths.
- Important semantics: plain names are matched by path segment everywhere in the repo.
- Keep output deduplicated and concise.`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const gitignoreBlock = input.gitignoreContent.trim()
    ? `.gitignore contents:
${input.gitignoreContent}

`
    : "";

  return `${INSTRUCTIONS}

Project: ${input.projectRootName}
Top-level directories: ${JSON.stringify(input.topLevelDirectories)}
Top-level files: ${JSON.stringify(input.topLevelFiles)}
${gitignoreBlock}`.trimEnd();
}

export const generateRepoExcludeAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  z.infer<typeof OUTPUT_SCHEMA>
> = {
  id: "generate-repo-exclude",
  description: "Generates repo exclude array",
  model: CHEAP_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonArray,
  outputContractDescription: `JSON array of strings: ["name",...]. Exclude names/patterns for runtime file scanning (e.g. node_modules, dist, .git).`,
};
