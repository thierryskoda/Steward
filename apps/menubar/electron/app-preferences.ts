/**
 * App preferences: known projects and selected project. Persisted to app-data.
 */
import fs from "fs";
import path from "path";
import {
  AgentCliProviderSchema,
  AppPreferencesSchema,
  DEFAULT_AGENT_CLI_PROVIDER,
  type IAgentCliProvider,
  type IAppPreferences,
} from "@steward/contracts/schemas";
import { APP_PREFERENCES_FILENAME } from "@steward/contracts/runtime-defaults";
import { appDataPath } from "./paths.js";

function preferencesPath(): string {
  return path.join(appDataPath(), APP_PREFERENCES_FILENAME);
}

const DEFAULT_PREFERENCES: IAppPreferences = {
  knownProjectRoots: [],
  selectedProjectRoot: null,
  cliProviderByProjectRoot: {},
};

export function readAppPreferences(): IAppPreferences {
  const filePath = preferencesPath();
  if (!fs.existsSync(filePath)) return DEFAULT_PREFERENCES;
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  const result = AppPreferencesSchema.safeParse(parsed);
  if (!result.success) return DEFAULT_PREFERENCES;
  return result.data;
}

export function writeAppPreferences(prefs: IAppPreferences): void {
  const filePath = preferencesPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(prefs, null, 2), "utf8");
}

export function addKnownProject(projectRoot: string): void {
  const prefs = readAppPreferences();
  const canonical = path.resolve(projectRoot);
  if (prefs.knownProjectRoots.includes(canonical)) return;
  writeAppPreferences({
    ...prefs,
    knownProjectRoots: [...prefs.knownProjectRoots, canonical],
  });
}

export function removeKnownProject(projectRoot: string): void {
  const prefs = readAppPreferences();
  const canonical = path.resolve(projectRoot);
  const cliProviderByProjectRoot = { ...prefs.cliProviderByProjectRoot };
  delete cliProviderByProjectRoot[canonical];
  writeAppPreferences({
    ...prefs,
    knownProjectRoots: prefs.knownProjectRoots.filter((r) => r !== canonical),
    selectedProjectRoot: prefs.selectedProjectRoot === canonical ? null : prefs.selectedProjectRoot,
    cliProviderByProjectRoot,
  });
}

export function setSelectedProject(projectRoot: string | null): void {
  const prefs = readAppPreferences();
  const canonical = projectRoot ? path.resolve(projectRoot) : null;
  writeAppPreferences({ ...prefs, selectedProjectRoot: canonical });
}

export function getSelectedProject(): string | null {
  return readAppPreferences().selectedProjectRoot;
}

export function getKnownProjectRoots(): string[] {
  return readAppPreferences().knownProjectRoots;
}

export function getCliProviderForProject(projectRoot: string): IAgentCliProvider {
  const canonical = path.resolve(projectRoot);
  return readAppPreferences().cliProviderByProjectRoot[canonical] ?? DEFAULT_AGENT_CLI_PROVIDER;
}

export function setCliProviderForProject(projectRoot: string, provider: IAgentCliProvider): void {
  const parsedProvider = AgentCliProviderSchema.parse(provider);
  const canonical = path.resolve(projectRoot);
  const prefs = readAppPreferences();
  writeAppPreferences({
    ...prefs,
    cliProviderByProjectRoot: {
      ...prefs.cliProviderByProjectRoot,
      [canonical]: parsedProvider,
    },
  });
}
