import { AppError } from "../app-error.js";
import { ERR_AGENT_CLI_CONTRACT } from "../error-codes.js";
import type { IJsonSchema } from "./json-schema.types.js";
import { CodexStructuredOutputEnvelopeSchema } from "./codex-structured-output.schemas.js";

/** Moves every provider-neutral schema under an object root accepted by Structured Outputs. */
export function buildCodexStructuredOutputSchema(outputJsonSchema: IJsonSchema): IJsonSchema {
  const resultSchema = { ...outputJsonSchema };
  delete resultSchema.$schema;
  return {
    type: "object",
    properties: { result: resultSchema },
    required: ["result"],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  };
}

/** Removes the Codex-only schema envelope before canonical agent validation. */
export function unwrapCodexStructuredOutput(outputText: string): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(outputText);
  } catch (error) {
    throw new AppError(
      "Codex structured output was not valid JSON.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "invalid_structured_output_json" },
      { cause: error }
    );
  }
  const parsed = CodexStructuredOutputEnvelopeSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AppError(
      "Codex structured output did not match its transport envelope.",
      ERR_AGENT_CLI_CONTRACT,
      {
        reason: "invalid_structured_output_envelope",
        issues: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      }
    );
  }
  const unwrapped = JSON.stringify(parsed.data.result);
  if (unwrapped === undefined) {
    throw new AppError(
      "Codex structured output envelope did not contain a JSON value.",
      ERR_AGENT_CLI_CONTRACT,
      { reason: "missing_structured_output_result" }
    );
  }
  return unwrapped;
}
