/**
 * Builds the implement-step prompt (title, locations, selected plan) for claimed code-quality fixes. Used when the user has approved an option and the runtime runs the implement phase; invoked by category-implementing-processor.
 */
import { ImplementationResultSchema, type IImplementationResult } from "@steward/contracts/schemas";
import { z } from "zod";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
import { CATEGORY_IMPLEMENT_RESULT_PARSE_FAILED } from "./categories-log-events.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";

const INPUT_SCHEMA = z.object({
  title: z.string(),
  locations: z.array(z.string()).min(1),
  technicalPlan: z.string(),
});

const INSTRUCTIONS_PREFIX = `You are implementing a claimed code-quality fix. Use the context from this same chat. Do not re-explore; apply the fix directly.

Item to implement:
- title:`;

const INSTRUCTIONS_SUFFIX = `

Perform the fix directly in the repository at all listed locations with minimal, safe edits.
Run relevant tests or checks after changes.

When done, output a single JSON object only (no markdown, no code fence, no preamble). Shape:
{
  "summary": "one short sentence",
  "fileChanges": [{"path": "path/to/file.ts", "bulletPoints": ["short change 1", "short change 2"]}],
  "checks": ["Ran runtime tests", "Lint passed"]
}
- summary: one short sentence describing what was done.
- fileChanges: every file you created, modified, or deleted; path relative to repo root; bulletPoints: 1–5 very short bullets per file.
- checks: list of tests or checks you ran (e.g. "Ran workspace X test").`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const locationsText = input.locations.map((location) => `  - ${location}`).join("\n");
  return `${INSTRUCTIONS_PREFIX} ${input.title}
- locations (apply fix at all of these when safe):
${locationsText}

Here is the option plan that was selected:
${input.technicalPlan}${INSTRUCTIONS_SUFFIX}`;
}

/** Extracts JSON from stdout or transcript text; strips optional markdown code fence so parse can succeed. */
export function extractImplementationResultJson(raw: string): string | null {
  return extractJsonObject(raw);
}

/** Parses agent stdout into implementation result; returns null on parse failure. */
export function parseImplementationOutput(raw: string): IImplementationResult | null {
  const log = getRuntimeLogger();
  const toParse = extractImplementationResultJson(raw);
  if (!toParse) {
    log.info({
      event: "implementation_result_extract_failed",
      rawLength: raw.length,
      rawExcerpt: raw.trim().slice(0, 200),
    });
    return null;
  }
  try {
    const parsed = ImplementationResultSchema.safeParse(JSON.parse(toParse));
    if (parsed.success) return parsed.data;
    log.info({
      event: "implementation_result_schema_validation_failed",
      rawLength: raw.length,
      errors: parsed.error.flatten(),
    });
    return null;
  } catch (e) {
    logError(e, {
      event: CATEGORY_IMPLEMENT_RESULT_PARSE_FAILED,
      component: "categories",
      operation: "implementCategoryParseResult",
      rawLength: raw.length,
      toParseExcerpt: toParse.slice(0, 300),
    });
    return null;
  }
}

export const implementCategoryAgent: IAgentSpec<
  z.infer<typeof INPUT_SCHEMA>,
  IImplementationResult
> = {
  id: "implement-category",
  description: "Implements a claimed category item reusing same chat context",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: ImplementationResultSchema,
  buildPrompt,
  extractOutput: extractImplementationResultJson,
};
