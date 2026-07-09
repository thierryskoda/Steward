import { describe, it } from "vitest";
import assert from "node:assert";
import { learnAgentsMemoryAgent } from "./learn-agents-memory.agent.js";

describe("learn-agents-memory agent", () => {
  it("buildPrompt embeds transcriptContent and targetFileContent so model receives both inputs", () => {
    const transcript = "user: the runtime is single-process per project";
    const targetContent = "# Context\n\n## Learned Project Context\n- (Placeholder.)\n";
    const prompt = learnAgentsMemoryAgent.buildPrompt({
      transcriptContent: transcript,
      targetFilePath: "README.md",
      targetFileContent: targetContent,
    });
    assert.ok(prompt.includes(transcript), "transcript must appear in prompt");
    assert.ok(prompt.includes("README.md"), "target file path must appear in prompt");
    assert.ok(prompt.includes("Learned Project Context"), "section heading must appear");
  });
});
