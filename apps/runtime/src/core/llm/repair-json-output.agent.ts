/**
 * Repairs malformed LLM output into strict JSON given expected contract and parse error. Used when structured agents return invalid JSON; invoked by repair-json-output.ts (e.g. after runStructuredAgent parse failure).
 */
import { z } from "zod";
import { CHEAP_LLM_MODEL } from "./llm-defaults.js";
import { extractJsonObject } from "./json-extract.js";
import type { IAgentSpec } from "./agent-spec.types.js";

const INPUT_SCHEMA = z.object({
  expectedOutputContract: z.string().min(1),
  receivedOutput: z.string().min(1),
  parseError: z.string().optional(),
});

const OUTPUT_SCHEMA = z
  .object({
    repairedJson: z.string().min(2),
  })
  .strict();

const INSTRUCTIONS = `You repair LLM outputs into strict JSON.

Input:
- expectedOutputContract: describes the valid output shape.
- receivedOutput: the raw output that failed parsing.
- parseError: optional parsing error message.

Task:
- Using ONLY the text in receivedOutput and expectedOutputContract above, produce valid JSON that matches the contract.
- Do NOT run terminal commands, read files, or write files. Your entire response must be exactly one JSON object.
- Return only this shape (no other keys, no preamble, no code blocks, no explanation):
  {"repairedJson":"<VALID_JSON_TEXT>"}
- repairedJson must be a string whose contents are valid JSON (object or array). Escape quotes and backslashes inside the string. No markdown.`;

function buildPrompt(input: z.infer<typeof INPUT_SCHEMA>): string {
  const parseErrorBlock =
    input.parseError !== undefined && input.parseError.trim().length > 0
      ? `parseError:
${input.parseError}

`
      : "";

  return `${INSTRUCTIONS}

expectedOutputContract:
---
${input.expectedOutputContract}
---

${parseErrorBlock}receivedOutput:
---
${input.receivedOutput}
---`;
}

type IRepairJsonOutputInput = z.infer<typeof INPUT_SCHEMA>;
type IRepairJsonOutputOutput = z.infer<typeof OUTPUT_SCHEMA>;

export const repairJsonOutputAgent: IAgentSpec<IRepairJsonOutputInput, IRepairJsonOutputOutput> = {
  id: "repair-json-output",
  description: "Repairs malformed agent output into strict JSON text",
  model: CHEAP_LLM_MODEL,
  inputSchema: INPUT_SCHEMA,
  outputSchema: OUTPUT_SCHEMA,
  buildPrompt,
  extractOutput: extractJsonObject,
};
