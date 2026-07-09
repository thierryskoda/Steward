/**
 * Prepends quality-first and tmp-dir instructions to agent prompts. Used so all CLI-driven agents get consistent guidance on correctness and where to write temp files; invoked when building prompts in run-structured and run-workspace-mutation flows.
 */
const QUALITY_FIRST_BASE = `
- Prioritize quality and correctness over speed.
- Avoid speculative or rushed answers; take time to reason and verify.
`.trim();

function tmpDirLine(agentTmpDir: string | undefined): string {
  if (agentTmpDir) {
    return `- If you need to write temporary files (scratchpads, logs, state tracking) to help you reason and verify, ONLY use the directory in the CTO_AGENT_TMP_DIR environment variable.`;
  }
  return `- If you need to write temporary files (scratchpads, logs, state tracking) to help you reason and verify, ONLY use a run-scoped directory under \`.steward/tmp/runs/\`.`;
}

export function prependQualityFirstInstruction(prompt: string, agentTmpDir?: string): string {
  const instruction = [QUALITY_FIRST_BASE, tmpDirLine(agentTmpDir)].join("\n");
  return `${instruction}\n\n${prompt}`;
}
