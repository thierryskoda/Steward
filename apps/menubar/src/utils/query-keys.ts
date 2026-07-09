/** Single source of truth for TanStack Query keys. */
export const queryKeys = {
  inbox: {
    all: (): readonly ["inbox"] => ["inbox"],
    findings: (projectRoot: string): readonly ["inbox", "findings", string] => [
      "inbox",
      "findings",
      projectRoot,
    ],
    rules: (projectRoot: string): readonly ["inbox", "rules", string] => [
      "inbox",
      "rules",
      projectRoot,
    ],
  },
  cto: {
    all: (): readonly ["cto"] => ["cto"],
    items: (projectRoot: string): readonly ["cto", "items", string] => [
      "cto",
      "items",
      projectRoot,
    ],
  },
  settings: {
    all: (): readonly ["settings"] => ["settings"],
    connectionConfig: (projectRoot: string): readonly ["settings", "connection", string] => [
      "settings",
      "connection",
      projectRoot,
    ],
    runtimeStatus: (projectRoot: string): readonly ["settings", "runtime-status", string] => [
      "settings",
      "runtime-status",
      projectRoot,
    ],
    cliProvider: (projectRoot: string): readonly ["settings", "cli-provider", string] => [
      "settings",
      "cli-provider",
      projectRoot,
    ],
    scanningStatus: (projectRoot: string): readonly ["settings", "scanning-status", string] => [
      "settings",
      "scanning-status",
      projectRoot,
    ],
    logsDir: (): readonly ["settings", "logs-dir"] => ["settings", "logs-dir"],
    rulesSnapshot: (projectRoot: string): readonly ["settings", "rules-snapshot", string] => [
      "settings",
      "rules-snapshot",
      projectRoot,
    ],
    config: (projectRoot: string): readonly ["settings", "config", string] => [
      "settings",
      "config",
      projectRoot,
    ],
  },
  projects: {
    all: (): readonly ["projects"] => ["projects"],
    list: (): readonly ["projects", "list"] => ["projects", "list"],
    selected: (): readonly ["projects", "selected"] => ["projects", "selected"],
  },
} as const;
