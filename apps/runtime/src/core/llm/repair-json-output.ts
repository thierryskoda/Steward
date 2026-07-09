/**
 * Runs the repair-json-output agent via the LLM provider with a single retry budget. Used when structured agent output fails to parse; callers use this instead of invoking the agent spec directly so queue/timeouts are consistent.
 */
import { z } from "zod";
import { AppError } from "../app-error.js";
import { ERR_JSON_REPAIR } from "../error-codes.js";
import { getLlmProvider } from "./llm-provider-factory.js";
import { repairJsonOutputAgent } from "./repair-json-output.agent.js";

/** Validates that repaired string is parseable JSON; used instead of bare JSON.parse. */
const anyJsonSchema = z.unknown();

const REPAIR_RETRY_BUDGET = 1;

export async function repairJsonOutput(args: {
  expectedOutputContract: string;
  receivedOutput: string;
  parseError?: string;
  workspace: string;
  _repairDepth?: number;
}): Promise<string> {
  const depth = args._repairDepth ?? 0;
  if (depth > REPAIR_RETRY_BUDGET) {
    throw new AppError(`JSON repair depth exceeds budget; aborting`, ERR_JSON_REPAIR, {
      depth,
      budget: REPAIR_RETRY_BUDGET,
      workspace: args.workspace,
    });
  }
  if (args.receivedOutput.trim().length === 0) {
    throw new AppError("JSON repair skipped: received output is empty", ERR_JSON_REPAIR, {
      workspace: args.workspace,
    });
  }
  const input = repairJsonOutputAgent.inputSchema.parse({
    expectedOutputContract: args.expectedOutputContract,
    receivedOutput: args.receivedOutput,
    parseError: args.parseError,
  });
  const prompt = repairJsonOutputAgent.buildPrompt(input);
  const result = await getLlmProvider().runStructured({
    prompt,
    model: repairJsonOutputAgent.model,
    workspace: args.workspace,
    resumeConversationId: undefined,
  });
  if (!result.success) {
    const detail = result.diagnosticText || result.outputText || "repair agent failed";
    throw new AppError(
      `JSON repair agent failed (${result.reason}): ${detail}`,
      ERR_JSON_REPAIR,
      { reason: result.reason, workspace: args.workspace },
      { cause: result }
    );
  }
  const extracted = repairJsonOutputAgent.extractOutput
    ? repairJsonOutputAgent.extractOutput(result.outputText)
    : result.outputText;
  if (extracted === null) {
    throw new AppError("JSON repair agent produced no parseable output", ERR_JSON_REPAIR, {
      workspace: args.workspace,
    });
  }

  const rawParsed: unknown = JSON.parse(extracted);
  const parsed = repairJsonOutputAgent.outputSchema.parse(rawParsed);
  const repairedJson = parsed.repairedJson.trim();
  const looksLikePlaceholder =
    repairedJson.length < 10 ||
    repairedJson.startsWith("<") ||
    /^\s*(run |node |bash|To produce|```)/i.test(repairedJson);
  if (looksLikePlaceholder) {
    throw new AppError(
      "Repair agent returned placeholder or instructions instead of JSON",
      ERR_JSON_REPAIR,
      { workspace: args.workspace, preview: repairedJson.slice(0, 60) }
    );
  }
  try {
    const reparsed: unknown = JSON.parse(repairedJson);
    anyJsonSchema.parse(reparsed);
  } catch (e) {
    throw new AppError(
      "Repaired output is not valid JSON",
      ERR_JSON_REPAIR,
      { workspace: args.workspace },
      { cause: e }
    );
  }
  return repairedJson;
}
