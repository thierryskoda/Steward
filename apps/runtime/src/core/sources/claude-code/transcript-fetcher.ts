/**
 * Claude Code transcript fetcher: Claude session files are not read by the runtime yet.
 * Mutation flow treats undefined capture as a skipped transcript, matching other providers.
 */
import type { ITranscriptFetcher } from "../transcript-fetcher.types.js";

export function createClaudeCodeTranscriptFetcher(): ITranscriptFetcher {
  return {
    async getTranscriptCapture(): Promise<undefined> {
      return undefined;
    },
  };
}
