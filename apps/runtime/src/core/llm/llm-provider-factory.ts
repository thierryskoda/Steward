/**
 * Instantiates the LLM provider from env. Single selection point at composition root.
 * Composition root sets the provider once; facades use getLlmProvider().
 */

import { loadEnv } from "../env.js";
import type { ILLMProviderId } from "../env.js";
import { AppError } from "../app-error.js";
import { ERR_LLM_PROVIDER } from "../error-codes.js";
import { createClaudeCodeCliLlmProvider } from "./claude-code-cli-llm-provider.js";
import { createCodexCliLlmProvider } from "./codex-cli-llm-provider.js";
import { createCursorCliLlmProvider } from "./cursor-cli-llm-provider.js";
import type { ILLMProvider } from "./llm-provider.types.js";

let _provider: ILLMProvider | null = null;

export function setLlmProvider(provider: ILLMProvider): void {
  _provider = provider;
}

export function getLlmProvider(): ILLMProvider {
  if (_provider === null) {
    throw new AppError(
      "LLM provider not set. Ensure composition root calls setLlmProvider before any agent run.",
      ERR_LLM_PROVIDER,
      { component: "llm-provider-factory" }
    );
  }
  return _provider;
}

export function createLlmProvider(): ILLMProvider {
  const id: ILLMProviderId = loadEnv().CTO_LLM_PROVIDER;
  if (id === "cursor_cli") return createCursorCliLlmProvider();
  if (id === "codex_cli") return createCodexCliLlmProvider();
  if (id === "claude_code_cli") return createClaudeCodeCliLlmProvider();
  if (id === "antigravity_cli") {
    throw new AppError(
      "Antigravity CLI provider is not supported for automated runtime execution because the official CLI currently documents an interactive TUI, not a non-interactive JSON/print mode.",
      ERR_LLM_PROVIDER,
      {
        provider: id,
        reason: "no_documented_non_interactive_cli_mode",
      }
    );
  }
  const _exhaustive: never = id;
  return _exhaustive;
}
