#!/usr/bin/env -S npx tsx
/**
 * Runs all generic categories for one project. Project root from --project-root or CTO_TARGET_PROJECT_ROOT.
 * Invoke via: pnpm generate-categories --project-root /path/to/project (from apps/runtime).
 */
import "./load-env.js";
import { getRuntimeLogger, initRuntimeLogger } from "../src/core/logger.js";
import { SCRIPT_CATEGORY_GENERATION_CRASHED } from "../src/core/runtime-log-events.js";
import { resolveLogsDir } from "../src/core/log-paths.js";
import { loadEnv } from "../src/core/env.js";
import { getProjectRootFromStartupInput } from "../src/core/startup-input.js";
import {
  generateAllGenericCategories,
  type IGenerateCategoryDeps,
} from "../src/features/categories/generate-category.js";
import { createChatId } from "../src/core/llm/agent-transcript-capture.js";
import { runStructuredAgent } from "../src/core/llm/run-structured.agent.js";
import {
  getExclude,
  getIgnoreMatcher,
  readRepoScopeConfigFromDisk,
} from "../src/features/context/repo-scope-config.js";
import { buildProjectContextForAgent } from "../src/features/context/project-context-builder.js";
import { buildCursorRulesContext } from "../src/features/context/cursor-rules-context.js";
import { getCurrentContextFingerprint } from "../src/features/categories/context-fingerprint.js";
import { readSourceDocs } from "../src/features/categories/rules-snapshot.js";
import { loadProjectContextSnapshot } from "../src/features/context/project-context-snapshot.js";
import { DEFAULT_APPROVAL_MODE } from "@steward/contracts/schemas";

async function main(): Promise<void> {
  const env = loadEnv();
  initRuntimeLogger(resolveLogsDir({ logsRootOverride: env.CTO_LOGS_ROOT }));
  const projectRoot = getProjectRootFromStartupInput(env);
  const log = getRuntimeLogger();

  log.info({ event: "Manual category generation started.", projectRoot });

  const repoConfig = readRepoScopeConfigFromDisk(projectRoot);
  const approvalMode = repoConfig?.approvalMode ?? DEFAULT_APPROVAL_MODE;

  const categoryDeps: IGenerateCategoryDeps = {
    createChatId,
    runStructuredAgent,
    buildProjectContextForAgent,
    buildCursorRulesContext: (root) =>
      buildCursorRulesContext(root, { getSourceDocs: readSourceDocs }),
    getApprovalMode: () => approvalMode,
    readRepoScopeConfigFromDisk,
    getExclude: (projectRoot) => getExclude(projectRoot),
    getIgnoreMatcher: (projectRoot) => getIgnoreMatcher(projectRoot),
    getCurrentContextFingerprint: (projectRoot) =>
      getCurrentContextFingerprint(projectRoot, {
        loadProjectContextSnapshot: (root) => {
          const s = loadProjectContextSnapshot(root);
          return s ? { sourcesHash: s.sourcesHash, extractorVersion: s.extractorVersion } : null;
        },
      }),
  };

  try {
    await generateAllGenericCategories({ projectRoot, deps: categoryDeps });
    log.info({ event: "Manual category generation (all) completed.", projectRoot });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.info({ event: "Manual category generation failed.", projectRoot, error: msg });
    process.exit(1);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  let projectRoot: string;
  try {
    projectRoot = getProjectRootFromStartupInput(loadEnv());
  } catch {
    projectRoot = process.cwd();
  }
  getRuntimeLogger().error({
    event: SCRIPT_CATEGORY_GENERATION_CRASHED,
    projectRoot,
    errorMessage: msg,
    err: e instanceof Error ? e : new Error(String(e)),
  });
  process.exit(1);
});
