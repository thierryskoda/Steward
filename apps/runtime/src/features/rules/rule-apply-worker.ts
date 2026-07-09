/**
 * Polls approved rules, runs rule-apply-target agent, then applies the rule to a cursor file. Single rule per tick.
 * Exists to process the rules workflow queue without blocking. Use when rules workflow is enabled; main schedules runRuleApplyWorker on an interval.
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { STATUS } from "@steward/contracts/schemas";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { getProjectRoot } from "../../core/project-root.js";
import { runStructuredAgent } from "../../core/llm/run-structured.agent.js";
import { RULE_APPLY_FAILED_AGENT, RULE_APPLIED } from "./rules-log-events.js";
import { ruleApplyTargetAgent } from "./rule-apply-target.agent.js";
import { listApprovedRules, transitionRuleStatus, type IRuleProposal } from "./rules-store.js";
import { cursorRulesDir } from "../../core/paths.js";

const POLL_INTERVAL_MS = 10000;

function listCursorRuleFiles(projectRoot: string): string[] {
  const rulesDir = cursorRulesDir(projectRoot);
  if (!existsSync(rulesDir)) return [];
  return readdirSync(rulesDir)
    .filter((f) => f.endsWith(".mdc") || f.endsWith(".md"))
    .map((f) => join(rulesDir, f));
}

function applyRuleToFile(
  projectRoot: string,
  rule: IRuleProposal,
  targetFile: string,
  _action: "append" | "create"
): void {
  const rulesDir = cursorRulesDir(projectRoot);
  mkdirSync(rulesDir, { recursive: true });
  const path = join(rulesDir, targetFile);

  const section = `\n\n## ${rule.title}\n\n${rule.ruleText}\n`;
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf-8");
    writeFileSync(path, existing + section, "utf-8");
  } else {
    const frontmatter = "---\nalwaysApply: true\n---\n\n";
    writeFileSync(path, frontmatter + rule.ruleText.trim() + "\n", "utf-8");
  }
}

export async function runRuleApplyWorker(args: {
  projectRoot: string;
  implementingMaxRetries: number;
  isRulesWorkflowEnabled: boolean;
}): Promise<void> {
  const { projectRoot, isRulesWorkflowEnabled } = args;
  void args.implementingMaxRetries;
  const log = getRuntimeLogger();
  if (!isRulesWorkflowEnabled) return;
  const ready = listApprovedRules(projectRoot);
  if (ready.length === 0) return;

  const rule = ready[0]!;
  const claimed = transitionRuleStatus(projectRoot, rule.id, STATUS.CLAIMED);
  if (!claimed) return;
  const started = transitionRuleStatus(projectRoot, rule.id, STATUS.AGENT_RUNNING);
  if (!started) return;

  const files = listCursorRuleFiles(projectRoot);

  const fileList =
    files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "(no existing rule files)";

  let decision;
  try {
    decision = await runStructuredAgent({
      agent: ruleApplyTargetAgent,
      input: {
        ruleTitle: rule.title,
        ruleContentPreview: rule.ruleText,
        existingFilesList: fileList,
      },
      workspace: projectRoot,
    });
  } catch (e) {
    const isShutdown =
      e instanceof Error &&
      (e.message.includes("Agent queue is shutting down") ||
        e.message.includes("cancelled during shutdown"));
    if (isShutdown) {
      transitionRuleStatus(projectRoot, rule.id, STATUS.APPROVED);
      log.info({
        event: "Rule apply worker cancelled due to activity stop",
        id: rule.id,
      });
      return;
    }
    transitionRuleStatus(projectRoot, rule.id, STATUS.FAILED);
    logError(e, {
      event: RULE_APPLY_FAILED_AGENT,
      component: "rules",
      operation: "runRuleApplyWorker",
      id: rule.id,
      projectRoot,
      ruleTitle: rule.title,
      candidateFileCount: files.length,
    });
    return;
  }

  applyRuleToFile(projectRoot, rule, decision.targetFile, decision.action);
  transitionRuleStatus(projectRoot, rule.id, STATUS.IMPLEMENTED);
  log.info({ event: RULE_APPLIED, id: rule.id, targetFile: decision.targetFile });
}

export function startRuleApplyWorker(args: {
  implementingMaxRetries: number;
  isRulesWorkflowEnabled: boolean;
}): ReturnType<typeof setInterval> {
  const { implementingMaxRetries, isRulesWorkflowEnabled } = args;
  return setInterval(() => {
    void runRuleApplyWorker({
      projectRoot: getProjectRoot(),
      implementingMaxRetries,
      isRulesWorkflowEnabled,
    });
  }, POLL_INTERVAL_MS);
}
