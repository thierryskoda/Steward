import assert from "node:assert";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import type { IAgentSpec } from "./agent-spec.types.js";
import type { ILLMProvider, ILLMRunResult, ILLMStructuredRunArgs } from "./llm-provider.types.js";
import { setLlmProvider } from "./llm-provider-factory.js";
import {
  runSchemaConstrainedAgentWithProvider,
  runStructuredAgentWithProvider,
} from "./run-structured.agent.js";

const outputSchema = z.object({ source: z.string() }).strict();

const agent: IAgentSpec<Record<string, never>, z.infer<typeof outputSchema>> = {
  id: "explicit-provider-routing-test",
  description: "Proves workflow-specific provider routing",
  model: "test-model",
  inputSchema: z.object({}).strict(),
  outputSchema,
  buildPrompt: (): string => "Return the provider source as JSON.",
  extractOutput: (raw) => raw,
};

function successfulResult(source: string): ILLMRunResult {
  return {
    outputText: JSON.stringify({ source }),
    diagnosticText: "",
    reason: "exit",
    success: true,
  };
}

function createProvider(source: string): ILLMProvider {
  return {
    runStructured: async (): Promise<ILLMRunResult> => successfulResult(source),
    runMutation: async (): Promise<ILLMRunResult> => successfulResult(source),
    createConversationId: async (): Promise<string> => `${source}-conversation`,
  };
}

function createSequentialProvider(
  results: ILLMRunResult[],
  observedDeadlines: Array<number | undefined> = [],
  observedIsolatedCodexHomes: Array<string | undefined> = []
): ILLMProvider {
  let nextResultIndex = 0;
  return {
    runStructured: async (args: ILLMStructuredRunArgs): Promise<ILLMRunResult> => {
      observedDeadlines.push(args.deadlineAt);
      observedIsolatedCodexHomes.push(args.isolatedCodexHome);
      const result = results[nextResultIndex];
      if (result === undefined) {
        throw new Error(`No provider result configured at index ${nextResultIndex}`);
      }
      nextResultIndex += 1;
      return result;
    },
    runMutation: async (): Promise<ILLMRunResult> => successfulResult("unused"),
    createConversationId: async (): Promise<string> => "workflow-specific-conversation",
  };
}

describe("runStructuredAgentWithProvider", () => {
  let workspace: string | undefined;

  afterEach((): void => {
    if (workspace !== undefined) {
      rmSync(workspace, { recursive: true, force: true });
      workspace = undefined;
    }
  });

  it("uses the supplied provider and preserves run-scoped temporary-directory cleanup", async () => {
    workspace = mkdtempSync(join(tmpdir(), "steward-structured-provider-"));
    setLlmProvider(createProvider("application-default"));
    let receivedOutputJsonSchema: unknown;
    const workflowProvider = createProvider("workflow-specific");
    workflowProvider.runStructured = async (
      args: ILLMStructuredRunArgs
    ): Promise<ILLMRunResult> => {
      receivedOutputJsonSchema = Reflect.get(args, "outputJsonSchema");
      return successfulResult("workflow-specific");
    };

    const output = await runSchemaConstrainedAgentWithProvider({
      agent,
      input: {},
      workspace,
      resumeChatId: undefined,
      llmProvider: workflowProvider,
      deadlineAt: undefined,
    });

    assert.deepStrictEqual(output, { source: "workflow-specific" });
    assert.deepStrictEqual(receivedOutputJsonSchema, {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { source: { type: "string" } },
      required: ["source"],
      additionalProperties: false,
    });
    assert.deepStrictEqual(readdirSync(join(workspace, ".steward", "tmp", "runs")), []);
  });

  it("does not opt generic structured agents into provider schema enforcement", async () => {
    workspace = mkdtempSync(join(tmpdir(), "steward-structured-provider-generic-"));
    let receivedOutputJsonSchema: unknown = "not-called";
    const llmProvider = createProvider("generic");
    llmProvider.runStructured = async (args: ILLMStructuredRunArgs): Promise<ILLMRunResult> => {
      receivedOutputJsonSchema = args.outputJsonSchema;
      return successfulResult("generic");
    };

    await runStructuredAgentWithProvider({
      agent,
      input: {},
      workspace,
      resumeChatId: undefined,
      llmProvider,
      deadlineAt: undefined,
    });

    assert.strictEqual(receivedOutputJsonSchema, undefined);
  });

  it("uses the supplied provider for the shared JSON-repair pass", async () => {
    workspace = mkdtempSync(join(tmpdir(), "steward-structured-provider-repair-"));
    setLlmProvider(createProvider("application-default"));
    const repairAgent: typeof agent = {
      ...agent,
      extractOutput: () => null,
    };
    const observedDeadlines: Array<number | undefined> = [];
    const observedIsolatedCodexHomes: Array<string | undefined> = [];
    const llmProvider = createSequentialProvider(
      [
        {
          ...successfulResult("unused"),
          outputText: "This response is invalid and long enough for recovery.",
        },
        {
          ...successfulResult("unused"),
          outputText: JSON.stringify({
            repairedJson: JSON.stringify({ source: "workflow-specific-repair" }),
          }),
        },
      ],
      observedDeadlines,
      observedIsolatedCodexHomes
    );
    const deadlineAt = Date.now() + 60_000;
    const isolatedCodexHome = join(workspace, "isolated-codex-home");

    const output = await runStructuredAgentWithProvider({
      agent: repairAgent,
      input: {},
      workspace,
      resumeChatId: undefined,
      llmProvider,
      deadlineAt,
      isolatedCodexHome,
    });

    assert.deepStrictEqual(output, { source: "workflow-specific-repair" });
    assert.deepStrictEqual(observedDeadlines, [deadlineAt, deadlineAt]);
    assert.deepStrictEqual(observedIsolatedCodexHomes, [isolatedCodexHome, isolatedCodexHome]);
    assert.deepStrictEqual(readdirSync(join(workspace, ".steward", "tmp", "runs")), []);
  });
});
