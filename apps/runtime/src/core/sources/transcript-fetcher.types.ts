/**
 * Provider-neutral transcript fetch port. Mutation flow reads transcript through this;
 * implementations read provider-specific conversation history.
 */

import type { ITranscriptCapture } from "../llm/mutation-result.types.js";

export type ITranscriptFetcher = {
  getTranscriptCapture(args: {
    conversationId: string;
    workspace: string;
  }): Promise<ITranscriptCapture | undefined>;
};
