/**
 * Undo agent: reverts the prior implementation for one finding in the same workflow chat.
 * Strict path allowlist; never touch files outside it. Used when user triggers undo on an implemented item.
 */
import { UndoResultSchema, type IUndoResult } from "@steward/contracts/schemas";
import { z } from "zod";
import { DEFAULT_LLM_MODEL } from "../../core/llm/llm-defaults.js";
import type { IAgentSpec } from "../../core/llm/agent-spec.types.js";
import { extractJsonObject } from "../../core/llm/json-extract.js";

const INPUT_SCHEMA = z.object({
  title: z.string(),
  /** Paths the implement step reported; only these may be modified. Empty when using technicalPlanFallback. */
  allowedPaths: z.array(z.string().min(1).max(400)).max(50),
  /** Selected option plan text; used when allowedPaths is empty so the model knows what was implemented. */
  technicalPlanFallback: z.string(),
});

const OUTPUT_JSON_SHAPE = `{
  "summary": "one short sentence",
  "revertedFiles": ["path/to/file1.ts", "path/to/file2.ts"],
  "skippedFiles": ["path/to/skipped.ts"],
  "reasons": ["reason per skipped file or global"]
}`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const pathsSection =
    input.allowedPaths.length > 0
      ? `You may ONLY modify these files (paths relative to repo root). Do not create, edit, or delete any other file.\nAllowed paths:\n${input.allowedPaths.map((p) => `  - ${p}`).join("\n")}`
      : `No file list was recorded for this implementation. Use the "What was implemented" section below to infer which files you changed in the previous turn; revert only those. Do not guess unrelated files.`;

  return `You are reverting the implementation for this finding. Use the context from this same chat.

Item title: ${input.title}

Revert rules (mandatory):
- ${pathsSection}
- If a file's content no longer matches what you changed (e.g. refactored by another change), skip it and add it to skippedFiles with a reason.
- Do not revert edits that were made by other agents or users; only undo the work from your prior implementation in this chat.
- Restore files to their pre-implementation state where possible (revert edits, delete added files, restore deleted files).

What was implemented (for context when allowed paths are unknown):
${input.technicalPlanFallback}

When done, output a single JSON object only (no markdown, no code fence, no preamble). Shape:
${OUTPUT_JSON_SHAPE}
- summary: one short sentence describing what was reverted or skipped.
- revertedFiles: paths you successfully reverted (relative to repo root).
- skippedFiles: paths you did not revert (e.g. content changed, not found).
- reasons: one reason per skipped file or a single global reason.`;
}

/** Strips optional markdown code fence for parsing. */
export function extractUndoResultJson(raw: string): string | null {
  return extractJsonObject(raw);
}

export const undoCategoryAgent: IAgentSpec<z.infer<typeof INPUT_SCHEMA>, IUndoResult> = {
  id: "undo-category",
  description: "Reverts the prior implementation for one finding using same chat; path-scoped.",
  model: DEFAULT_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: UndoResultSchema,
  buildPrompt,
  extractOutput: extractUndoResultJson,
};
