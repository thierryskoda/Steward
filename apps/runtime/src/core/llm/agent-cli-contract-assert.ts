import { AppError } from "../app-error.js";
import { ERR_AGENT_CLI_CONTRACT } from "../error-codes.js";
import { agentCliEnvelopeSchema } from "./agent-cli-envelope.js";

export type IAgentCliRunResult = {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

/**
 * Asserts that a JSON-envelope scenario run produced a valid envelope (or
 * allowed empty stdout when allowEmptyStdout). Throws with a clear message on
 * failure.
 */
export function assertJsonEnvelopeContract(
  scenarioId: string,
  result: IAgentCliRunResult,
  allowEmptyStdout: boolean
): void {
  if (result.code !== 0 || result.timedOut) {
    throw new AppError(
      `[${scenarioId}] Expected code 0 and not timed out`,
      ERR_AGENT_CLI_CONTRACT,
      { scenarioId, code: result.code, timedOut: result.timedOut }
    );
  }
  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) {
    if (!allowEmptyStdout) {
      throw new AppError(
        `[${scenarioId}] Expected non-empty stdout for JSON envelope scenario`,
        ERR_AGENT_CLI_CONTRACT,
        { scenarioId }
      );
    }
    return;
  }
  const firstLine = trimmed.split("\n")[0]?.trim() ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AppError(
      `[${scenarioId}] stdout is not valid JSON: ${msg}`,
      ERR_AGENT_CLI_CONTRACT,
      { scenarioId, stdoutPreview: firstLine.slice(0, 200) },
      { cause: e }
    );
  }
  const envelope = agentCliEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new AppError(
      `[${scenarioId}] stdout does not match agent CLI envelope schema: ${envelope.error.message}`,
      ERR_AGENT_CLI_CONTRACT,
      { scenarioId, stdoutPreview: firstLine.slice(0, 200), schemaError: envelope.error.message },
      { cause: envelope.error }
    );
  }
  if (typeof envelope.data.result !== "string") {
    throw new AppError(`[${scenarioId}] envelope.result must be a string`, ERR_AGENT_CLI_CONTRACT, {
      scenarioId,
    });
  }
}
