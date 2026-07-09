/**
 * Cursor transcript fetcher: resolves agent-transcripts path (flat/nested) and reads JSONL.
 */

import { existsSync } from "fs";
import { join } from "path";
import { loadEnv } from "../../env.js";
import type { ITranscriptCapture } from "../../llm/mutation-result.types.js";
import type { ITranscriptFetcher } from "../transcript-fetcher.types.js";
import { readTranscriptEntries } from "../../llm/agent-transcript-capture.js";

type ICursorTranscriptFetcherDeps = {
  cursorProjectDirFromRoot: (workspace: string) => string;
};

export function createCursorTranscriptFetcher(
  deps: ICursorTranscriptFetcherDeps
): ITranscriptFetcher {
  const { cursorProjectDirFromRoot } = deps;
  return {
    async getTranscriptCapture(args: {
      conversationId: string;
      workspace: string;
    }): Promise<ITranscriptCapture | undefined> {
      const { conversationId, workspace } = args;
      const env = loadEnv();
      const projDir = cursorProjectDirFromRoot(workspace);
      const transcriptsDir = join(env.CTO_CURSOR_PROJECTS_ROOT, projDir, "agent-transcripts");
      const candidates: Array<{ path: string }> = [
        { path: join(transcriptsDir, `${conversationId}.jsonl`) },
        { path: join(transcriptsDir, conversationId, `${conversationId}.jsonl`) },
      ];
      const found = candidates.find((c) => existsSync(c.path));
      const resolvedPath = found?.path;
      if (!resolvedPath) return undefined;
      const entries = readTranscriptEntries(resolvedPath);
      if (entries === undefined) return undefined;
      return { chatId: conversationId, path: resolvedPath, entries };
    },
  };
}
