/**
 * Creates the transcript fetcher for the selected LLM provider. Set at composition root.
 */

import { loadEnv } from "../env.js";
import { AppError } from "../app-error.js";
import { ERR_TRANSCRIPT_FETCHER } from "../error-codes.js";
import { createAntigravityTranscriptFetcher } from "./antigravity/transcript-fetcher.js";
import { createClaudeCodeTranscriptFetcher } from "./claude-code/transcript-fetcher.js";
import { createCodexTranscriptFetcher } from "./codex/transcript-fetcher.js";
import { createCursorTranscriptFetcher } from "./cursor/transcript-fetcher.js";
import type { ITranscriptFetcher } from "./transcript-fetcher.types.js";

let _fetcher: ITranscriptFetcher | null = null;

export function setTranscriptFetcher(fetcher: ITranscriptFetcher): void {
  _fetcher = fetcher;
}

export function getTranscriptFetcher(): ITranscriptFetcher {
  if (_fetcher === null) {
    throw new AppError(
      "Transcript fetcher not set. Ensure composition root calls setTranscriptFetcher before mutation runs.",
      ERR_TRANSCRIPT_FETCHER,
      { component: "transcript-fetcher-factory" }
    );
  }
  return _fetcher;
}

type ICreateTranscriptFetcherDeps = {
  cursorProjectDirFromRoot: (workspace: string) => string;
};

export function createTranscriptFetcher(deps: ICreateTranscriptFetcherDeps): ITranscriptFetcher {
  const id = loadEnv().CTO_LLM_PROVIDER;
  if (id === "cursor_cli") {
    return createCursorTranscriptFetcher({
      cursorProjectDirFromRoot: deps.cursorProjectDirFromRoot,
    });
  }
  if (id === "codex_cli") return createCodexTranscriptFetcher();
  if (id === "claude_code_cli") return createClaudeCodeTranscriptFetcher();
  if (id === "antigravity_cli") return createAntigravityTranscriptFetcher();
  const _exhaustive: never = id;
  return _exhaustive;
}
