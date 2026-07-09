import { STATUS } from "@steward/contracts/schemas";
import { getRuntimeLogger } from "../../core/logger.js";
import { getProjectRoot } from "../../core/project-root.js";
import { getActionableCategories } from "../categories/category-registry.js";
import { deriveHintCandidateFromRejectedReason } from "../categories/option-hints.js";
import {
  listLearningFromRejectionFindingsForCategory,
  transitionFindingStatus,
  type ICategoryItem,
} from "../categories/categories-store.js";
import {
  createRuleProposal,
  isExactDuplicateInCorpus,
  normalizeRuleTextForDedupe,
  readAllRuleCorporaForDedupe,
  saveRuleProposal,
} from "./rules-store.js";
import {
  REJECTED_EVALUATION_RULE_CREATED,
  REJECTED_EVALUATION_SKIPPED,
  LEARNING_FROM_REJECTION_FINALIZED_TO_REJECTED,
} from "./rules-log-events.js";

const POLL_INTERVAL_MS = 10_000;

function buildRuleProposalFromRejectedFinding(item: ICategoryItem): {
  title: string;
  ruleText: string;
  rationale: string;
} | null {
  const reason = item.rejectedReason?.trim();
  if (!reason) return null;
  const candidate = deriveHintCandidateFromRejectedReason(reason);
  if (candidate === null) return null;
  return {
    title: `Avoid ${candidate.antiPattern}`.slice(0, 120),
    ruleText: candidate.instruction,
    rationale: `Created from rejected finding ${item.id}: ${reason}`,
  };
}

function processRejectedFindingForLearning(args: {
  projectRoot: string;
  categoryId: string;
  item: ICategoryItem;
}): void {
  const log = getRuntimeLogger();
  const proposalInput = buildRuleProposalFromRejectedFinding(args.item);
  if (proposalInput !== null) {
    const corpus = readAllRuleCorporaForDedupe(args.projectRoot);
    const normalizedRuleText = normalizeRuleTextForDedupe(proposalInput.ruleText);
    if (!isExactDuplicateInCorpus(normalizedRuleText, corpus)) {
      const proposal = createRuleProposal({
        ...proposalInput,
        sourceMessageId: `rejected-finding:${args.item.id}`,
        sourceChatId: args.item.workflowChatId,
      });
      saveRuleProposal(args.projectRoot, proposal);
      log.info({
        event: REJECTED_EVALUATION_RULE_CREATED,
        categoryId: args.categoryId,
        itemId: args.item.id,
        ruleId: proposal.id,
      });
    } else {
      log.info({
        event: REJECTED_EVALUATION_SKIPPED,
        categoryId: args.categoryId,
        itemId: args.item.id,
        reason: "duplicate_rule",
      });
    }
  } else {
    log.info({
      event: REJECTED_EVALUATION_SKIPPED,
      categoryId: args.categoryId,
      itemId: args.item.id,
      reason: "low_signal",
    });
  }

  const finalized = transitionFindingStatus(
    args.projectRoot,
    args.categoryId,
    args.item.id,
    STATUS.REJECTED
  );
  if (finalized) {
    log.info({
      event: LEARNING_FROM_REJECTION_FINALIZED_TO_REJECTED,
      categoryId: args.categoryId,
      itemId: args.item.id,
    });
  }
}

export function runRejectedFindingLearningProcessor(args: {
  projectRoot: string;
  isRulesWorkflowEnabled: boolean;
}): void {
  if (!args.isRulesWorkflowEnabled) return;
  for (const category of getActionableCategories()) {
    const item = listLearningFromRejectionFindingsForCategory(
      args.projectRoot,
      category.categoryId
    )[0];
    if (!item) continue;
    processRejectedFindingForLearning({
      projectRoot: args.projectRoot,
      categoryId: category.categoryId,
      item,
    });
    return;
  }
}

export function startRejectedFindingLearningProcessor(args: {
  isRulesWorkflowEnabled: boolean;
}): ReturnType<typeof setInterval> {
  return setInterval(() => {
    runRejectedFindingLearningProcessor({
      projectRoot: getProjectRoot(),
      isRulesWorkflowEnabled: args.isRulesWorkflowEnabled,
    });
  }, POLL_INTERVAL_MS);
}
