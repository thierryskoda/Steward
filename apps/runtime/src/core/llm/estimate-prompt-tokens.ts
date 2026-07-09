/**
 * Approximate prompt token count from character length (~4 chars/token). Used for logging and size checks before sending to the model; invoke when building prompts in run-structured and run-workspace-mutation.
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
