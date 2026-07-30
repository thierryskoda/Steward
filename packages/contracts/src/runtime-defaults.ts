/**
 * Canonical default values shared by project runtime and menubar. SSOT for CTO_HTTP_PORT default.
 */

export const DEFAULT_HTTP_PORT = 7711;

/** Filename for the project runtime registry under app-data. */
export const REGISTRY_FILENAME = "registry.json";

/** Filename for app preferences (known projects, selected project) under app-data. */
export const APP_PREFERENCES_FILENAME = "app-preferences.json";

/** Codex executable bundled with the macOS ChatGPT app. */
export const CHATGPT_BUNDLED_CODEX_PATH = "/Applications/ChatGPT.app/Contents/Resources/codex";

export function selectCodexCliCommand(input: {
  configuredPath: string | undefined;
  platform: string;
  bundledCodexExists: boolean;
}): string {
  if (input.configuredPath !== undefined) return input.configuredPath;
  if (input.platform === "darwin" && input.bundledCodexExists) {
    return CHATGPT_BUNDLED_CODEX_PATH;
  }
  return "codex";
}
