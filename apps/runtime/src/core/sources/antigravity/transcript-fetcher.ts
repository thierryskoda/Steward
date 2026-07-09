/**
 * Antigravity transcript fetcher: automated Antigravity execution is currently unsupported.
 * This fetcher only keeps provider selection exhaustive at the transcript boundary.
 */
import type { ITranscriptFetcher } from "../transcript-fetcher.types.js";

export function createAntigravityTranscriptFetcher(): ITranscriptFetcher {
  return {
    async getTranscriptCapture(): Promise<undefined> {
      return undefined;
    },
  };
}
