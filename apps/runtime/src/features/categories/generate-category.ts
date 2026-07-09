/**
 * Orchestrates category generation: detect finding → generate options → humanize → persist to pending or approved.
 * Exists to run the full detect–plan flow for a category when activation or scheduler triggers it. Use when a category
 * should produce new items from the current codebase state; called from main/activation.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { relative, resolve } from "path";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { AgentEmptyOutputError, runStructuredAgent } from "../../core/llm/run-structured.agent.js";
import { detectCategoryAgent } from "./detect-category.agent.js";
import { generateDetectionQuestionsAgent } from "./generate-detection-questions.agent.js";
import { generateFixConstraintsAgent } from "./generate-fix-constraints.agent.js";
import { generateOptionsAgent } from "./generate-options.agent.js";
import { humanizeCategoryAgent, type IHumanizeCategoryOutput } from "./humanize-category.agent.js";
import { judgeGeneratedFindingAgent } from "./judge-generated-finding.agent.js";
import { repairGeneratedFindingAgent } from "./repair-generated-finding.agent.js";
import {
  DEFAULT_APPROVAL_MODE,
  FindingShortLabelSchema,
  hasWordCountBetween,
  STATUS,
} from "@steward/contracts/schemas";
import {
  createFinding,
  getItemLocations,
  getItemTitle,
  listReviewFindingsForCategory,
  listAgentRunningFindingsForCategory,
  listClaimedFindingsForCategory,
  listApprovedFindingsForCategory,
  transitionFindingStatus,
  saveFinding,
} from "./categories-store.js";
import {
  combineContextFingerprintWithLocations,
  computeLocationsContentHash,
} from "./context-fingerprint.js";
import { getGenericCategoriesForDetection, loadCategoryRegistry } from "./category-registry.js";
import { getCategoryWithOldestRun, recordDetectionRun } from "./detection-run-store.js";
import { AGENT_STRUCTURED_CHAT_CREATED } from "../../core/runtime-log-events.js";
import {
  CATEGORY_ALL_BUSY,
  CATEGORY_GENERATION_COMPLETED,
  CATEGORY_GENERATION_AUTO_APPROVED_SINGLE_OPTION,
  CATEGORY_GENERATION_AUTO_APPROVE_FAILED,
  CATEGORY_GENERATION_DEDUPE_SKIPPED,
  CATEGORY_GENERATION_FINDING_DROPPED_EXCLUDED_LOCATIONS,
  CATEGORY_GENERATION_QUALITY_GATE_ACCEPTED,
  CATEGORY_GENERATION_QUALITY_GATE_DROPPED,
  CATEGORY_GENERATION_QUALITY_GATE_REPAIR_STARTED,
  CATEGORY_GENERATION_QUALITY_GATE_STARTED,
  CATEGORY_GENERATION_SKIPPED_IN_FLIGHT,
  CATEGORY_GENERATION_STARTED,
  CATEGORY_GENERATION_PERSISTING,
  CATEGORY_FINDING_TITLE_WORD_COUNT_DEVIATION,
  CATEGORY_OPTION_NAME_WORD_COUNT_DEVIATION,
  CATEGORY_OPTION_TECHNICAL_PLAN_MIN_LENGTH_DEVIATION,
  CATEGORY_GENERATION_FAILED,
  CATEGORY_GENERATION_QUESTIONS_STARTED,
  CATEGORY_GENERATION_TECHNICAL_DETECT_STARTED,
  CATEGORY_CONSTRAINTS_COUNT_DEVIATION,
  CATEGORY_GENERATION_CONSTRAINTS_STARTED,
  CATEGORY_GENERATION_TECHNICAL_OPTIONS_STARTED,
  CATEGORY_HUMANIZATION_STARTED,
  CATEGORY_HUMANIZATION_SKIPPED,
  CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
  OPTION_HINT_APPLIED,
  OPTION_HINT_SKIPPED_LOW_SIMILARITY,
  OPTION_HINT_SUPPRESSED_BY_RULE,
  OPTION_HINTS_DISABLED_BY_CONFIG,
  OPTION_HINTS_LOADED,
} from "./categories-log-events.js";
import type { IApprovalMode } from "@steward/contracts/schemas";
import type { IDetectCategoryOutput } from "./detect-category.agent.js";
import type { ICategoryItem, IFindingDecision, IFindingProblem } from "./categories-store.js";
import { readOptionHints } from "./option-hints-store.js";
import { selectHintsForGenerateOptions } from "./option-hints.js";

export type IRepoScopeConfigForCategory = {
  ruleSources?: string[];
  approvalMode?: IApprovalMode;
  projectContext?: string[];
  features?: {
    optionHintsEnabled?: boolean;
  };
};

export type IGenerateCategoryDeps = {
  createChatId: () => Promise<string | null>;
  runStructuredAgent: typeof runStructuredAgent;
  buildProjectContextForAgent: (root: string) => Promise<string>;
  buildCursorRulesContext: (root: string) => string;
  getApprovalMode: () => IApprovalMode;
  readRepoScopeConfigFromDisk: (projectRoot: string) => IRepoScopeConfigForCategory | null;
  getExclude: (projectRoot: string) => string[];
  getIgnoreMatcher: (projectRoot: string) => (path: string) => boolean;
  getCurrentContextFingerprint: (projectRoot: string) => string | null;
};

const MAX_IN_FLIGHT_FINDINGS_FOR_CONTEXT = 25;
const MAX_QUALITY_GATE_EVIDENCE_LOCATIONS = 8;
const MAX_QUALITY_GATE_EVIDENCE_CHARS = 4000;

function normalizeForDedupe(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s/._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ILocationEvidence = {
  location: string;
  excerpt: string;
};

type IQualityGateCandidate = {
  problem: IFindingProblem;
  decision: IFindingDecision;
};

function resolveRepoRelativePath(projectRoot: string, location: string): string | null {
  const relPath = location.split(":")[0]?.trim().replaceAll("\\", "/") ?? "";
  if (!relPath || relPath.startsWith("..") || relPath.includes("/..")) return null;
  const root = resolve(projectRoot);
  const fullPath = resolve(root, relPath);
  const relativePath = relative(root, fullPath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\")
  ) {
    return null;
  }
  return fullPath;
}

function buildLocationEvidence(projectRoot: string, locations: string[]): ILocationEvidence[] {
  const evidence: ILocationEvidence[] = [];
  const seen = new Set<string>();
  for (const location of locations) {
    if (evidence.length >= MAX_QUALITY_GATE_EVIDENCE_LOCATIONS) break;
    const fullPath = resolveRepoRelativePath(projectRoot, location);
    if (fullPath === null || seen.has(fullPath) || !existsSync(fullPath)) continue;
    seen.add(fullPath);
    try {
      if (!statSync(fullPath).isFile()) continue;
      const excerpt = readFileSync(fullPath, "utf-8")
        .slice(0, MAX_QUALITY_GATE_EVIDENCE_CHARS)
        .trim();
      if (!excerpt) continue;
      evidence.push({ location, excerpt });
    } catch {
      continue;
    }
  }
  return evidence;
}

export type IGenerateCategoryResult = { didRun: boolean; findingsCount: number };

export async function generateCategory(args: {
  projectRoot: string;
  categoryId: string;
  deps: IGenerateCategoryDeps;
}): Promise<IGenerateCategoryResult> {
  const { projectRoot, categoryId, deps } = args;
  const log = getRuntimeLogger();
  const registry = loadCategoryRegistry();
  const entry = registry.find((entry) => entry.categoryId === categoryId);
  if (!entry) {
    log.info({
      event: "Category generation skipped: not found.",
      categoryId,
    });
    return { didRun: false, findingsCount: 0 };
  }

  const inFlightAtStart = [
    ...listReviewFindingsForCategory(projectRoot, categoryId),
    ...listApprovedFindingsForCategory(projectRoot, categoryId),
    ...listClaimedFindingsForCategory(projectRoot, categoryId),
    ...listAgentRunningFindingsForCategory(projectRoot, categoryId),
  ];
  if (inFlightAtStart.length > 0) {
    log.info({
      event: CATEGORY_GENERATION_SKIPPED_IN_FLIGHT,
      projectRoot,
      categoryId,
      inFlightCount: inFlightAtStart.length,
    });
    return { didRun: false, findingsCount: 0 };
  }

  const createChatIdFn = deps.createChatId;
  const runStructuredAgentFn = deps.runStructuredAgent;
  const buildProjectContextFn = deps.buildProjectContextForAgent;
  const buildRulesContextFn = deps.buildCursorRulesContext;

  try {
    const startedAt = Date.now();
    log.info({ event: CATEGORY_GENERATION_STARTED, projectRoot, categoryId });

    const workflowChatId = await createChatIdFn();
    if (!workflowChatId) {
      log.info({ event: "Category generation skipped: failed to create chat.", categoryId });
      return { didRun: false, findingsCount: 0 };
    }
    log.info({
      event: AGENT_STRUCTURED_CHAT_CREATED,
      categoryId,
      workspace: projectRoot,
      chatId: workflowChatId,
    });

    const projectContext = await buildProjectContextFn(projectRoot);
    const inFlightItemsForContext = [
      ...listReviewFindingsForCategory(projectRoot, categoryId),
      ...listApprovedFindingsForCategory(projectRoot, categoryId),
      ...listClaimedFindingsForCategory(projectRoot, categoryId),
      ...listAgentRunningFindingsForCategory(projectRoot, categoryId),
    ];
    const existingFindingsContext =
      inFlightItemsForContext.length === 0
        ? "none"
        : inFlightItemsForContext
            .slice(0, MAX_IN_FLIGHT_FINDINGS_FOR_CONTEXT)
            .map((item) => {
              const locations = getItemLocations(item);
              const normalizedLocations = locations
                .map((location) => location.trim())
                .filter((location) => location.length > 0)
                .slice(0, 3);
              const findingSummary =
                item.problem !== undefined
                  ? item.problem.humanSummary?.trim() || item.problem.technicalFinding?.trim()
                  : item.fixPlan !== undefined
                    ? item.fixPlan?.trim()
                    : "no-summary";
              return [
                `categoryId=${item.categoryId}`,
                `status=${item.status}`,
                `title=${getItemTitle(item).trim()}`,
                `locations=${normalizedLocations.join(", ") || "none"}`,
                `finding=${findingSummary || "no-summary"}`,
              ].join("; ");
            })
            .join("\n");
    const repoConfig = deps.readRepoScopeConfigFromDisk(projectRoot);
    const excludedPatterns = deps.getExclude(projectRoot);

    log.info({ event: CATEGORY_GENERATION_QUESTIONS_STARTED, categoryId });
    let questionsResult: { questions: string[] };
    try {
      questionsResult = await runStructuredAgentFn({
        agent: generateDetectionQuestionsAgent,
        input: {
          categoryId,
          ruleContent: entry.ruleContent,
          projectContext,
        },
        workspace: projectRoot,
        resumeChatId: workflowChatId,
      });
    } catch (err) {
      if (err instanceof AgentEmptyOutputError) {
        log.info({
          event: CATEGORY_GENERATION_COMPLETED,
          projectRoot,
          categoryId,
          durationMs: Date.now() - startedAt,
          persistedCount: 0,
          itemTitles: [],
          note: "Agent exited 0 with empty stdout; treating as no findings.",
        });
        return { didRun: true, findingsCount: 0 };
      }
      throw err;
    }

    log.info({ event: CATEGORY_GENERATION_TECHNICAL_DETECT_STARTED, categoryId });
    const detectResult = await runStructuredAgentFn({
      agent: detectCategoryAgent,
      input: {
        categoryId,
        ruleContent: entry.ruleContent,
        existingFindingsContext,
        detectionQuestions: questionsResult.questions,
        excludedPatterns,
      },
      workspace: projectRoot,
      resumeChatId: workflowChatId,
    });

    if ("noFinding" in detectResult && detectResult.noFinding === true) {
      log.info({
        event: CATEGORY_GENERATION_COMPLETED,
        projectRoot,
        categoryId,
        durationMs: Date.now() - startedAt,
        persistedCount: 0,
        itemTitles: [],
      });
      return { didRun: true, findingsCount: 0 };
    }
    const findingResult = detectResult as Extract<
      IDetectCategoryOutput,
      { title: string; locations: string[]; finding: string; findingKey: string }
    >;

    if (!hasWordCountBetween(findingResult.title, 3, 5)) {
      log.warn({
        event: CATEGORY_FINDING_TITLE_WORD_COUNT_DEVIATION,
        categoryId,
        title: findingResult.title,
      });
    }

    if (repoConfig) {
      const isExcluded = deps.getIgnoreMatcher(projectRoot);
      const hasExcludedLocation = findingResult.locations.some((loc: string) =>
        isExcluded(loc.trim())
      );
      if (hasExcludedLocation) {
        log.info({
          event: CATEGORY_GENERATION_FINDING_DROPPED_EXCLUDED_LOCATIONS,
          projectRoot,
          categoryId,
          title: findingResult.title,
          locations: findingResult.locations,
        });
        log.info({
          event: CATEGORY_GENERATION_COMPLETED,
          projectRoot,
          categoryId,
          durationMs: Date.now() - startedAt,
          persistedCount: 0,
          itemTitles: [],
        });
        return { didRun: true, findingsCount: 0 };
      }
    }

    const rulesContext = buildRulesContextFn(projectRoot);
    const approvalMode = deps.getApprovalMode();
    const optionHintsEnabled = repoConfig?.features?.optionHintsEnabled ?? false;

    log.info({ event: CATEGORY_GENERATION_CONSTRAINTS_STARTED, categoryId });
    const constraintsResult = await runStructuredAgentFn({
      agent: generateFixConstraintsAgent,
      input: {
        title: findingResult.title,
        finding: findingResult.finding,
        locations: findingResult.locations,
        rulesContext,
      },
      workspace: projectRoot,
      resumeChatId: workflowChatId,
    });

    const constraintCount = constraintsResult.constraints.length;
    if (constraintCount < 3 || constraintCount > 12) {
      log.warn({
        event: CATEGORY_CONSTRAINTS_COUNT_DEVIATION,
        categoryId,
        count: constraintCount,
      });
    }

    log.info({ event: CATEGORY_GENERATION_TECHNICAL_OPTIONS_STARTED, categoryId });
    const allOptionHints = optionHintsEnabled ? readOptionHints(projectRoot) : [];
    if (!optionHintsEnabled) {
      log.info({
        event: OPTION_HINTS_DISABLED_BY_CONFIG,
        categoryId,
        projectRoot,
      });
    }
    const selectedHints = optionHintsEnabled
      ? selectHintsForGenerateOptions({
          hints: allOptionHints,
          categoryId,
          title: findingResult.title,
          finding: findingResult.finding,
          locations: findingResult.locations,
          rulesContext,
          maxApplied: 3,
          similarityThreshold: 0.2,
        })
      : { applied: [], skipped: [], suppressed: [] };
    log.info({
      event: OPTION_HINTS_LOADED,
      categoryId,
      projectRoot,
      totalHintsCount: allOptionHints.length,
      consideredCount: allOptionHints.filter((hint) => hint.categoryId === categoryId).length,
      appliedCount: selectedHints.applied.length,
      skippedCount: selectedHints.skipped.length,
      suppressedCount: selectedHints.suppressed.length,
    });
    for (const applied of selectedHints.applied) {
      log.info({
        event: OPTION_HINT_APPLIED,
        categoryId,
        hintId: applied.hint.id,
        trigger: applied.hint.trigger,
        similarityScore: applied.similarityScore,
      });
    }
    for (const skipped of selectedHints.skipped) {
      log.info({
        event: OPTION_HINT_SKIPPED_LOW_SIMILARITY,
        categoryId,
        hintId: skipped.hint.id,
        trigger: skipped.hint.trigger,
        similarityScore: skipped.similarityScore,
      });
    }
    for (const suppressed of selectedHints.suppressed) {
      log.info({
        event: OPTION_HINT_SUPPRESSED_BY_RULE,
        categoryId,
        hintId: suppressed.hint.id,
        trigger: suppressed.hint.trigger,
        reason: suppressed.reason,
      });
    }
    const optionsResult = await runStructuredAgentFn({
      agent: generateOptionsAgent,
      input: {
        title: findingResult.title,
        finding: findingResult.finding,
        locations: findingResult.locations,
        implementationConstraints: constraintsResult.constraints,
        approvalMode,
        ruleContent: entry.ruleContent,
        optionHints: selectedHints.applied.map((applied) => ({
          antiPattern: applied.hint.antiPattern,
          instruction: applied.hint.instruction,
          confidence: applied.hint.confidence,
        })),
      },
      workspace: projectRoot,
      resumeChatId: workflowChatId,
    });

    for (const option of optionsResult.options) {
      if (!hasWordCountBetween(option.name, 3, 5)) {
        log.warn({
          event: CATEGORY_OPTION_NAME_WORD_COUNT_DEVIATION,
          categoryId,
          optionId: option.id,
          name: option.name,
        });
      }
      if (option.technicalPlan.length < 50) {
        log.warn({
          event: CATEGORY_OPTION_TECHNICAL_PLAN_MIN_LENGTH_DEVIATION,
          categoryId,
          optionId: option.id,
          length: option.technicalPlan.length,
        });
      }
    }

    let humanResult: IHumanizeCategoryOutput | undefined;

    if (optionsResult.options.length > 1) {
      log.info({
        event: CATEGORY_HUMANIZATION_STARTED,
        categoryId,
        optionCount: optionsResult.options.length,
      });
      humanResult = await runStructuredAgentFn({
        agent: humanizeCategoryAgent,
        input: {
          categoryId,
          title: findingResult.title,
          finding: findingResult.finding,
          locations: findingResult.locations,
          options: optionsResult.options.map((o) => ({
            id: o.id,
            name: o.name,
            technicalPlan: o.technicalPlan,
            ruleConsideration: o.ruleConsideration,
          })),
        },
        workspace: projectRoot,
        resumeChatId: workflowChatId,
      });
      if (humanResult) {
        if (humanResult.humanSummary.length < 8) {
          log.warn({
            event: CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
            categoryId,
            field: "humanSummary",
            detail: `length ${humanResult.humanSummary.length}, prefer 8+`,
          });
        }
        if (humanResult.humanCurrentBehavior.length < 8) {
          log.warn({
            event: CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
            categoryId,
            field: "humanCurrentBehavior",
            detail: `length ${humanResult.humanCurrentBehavior.length}, prefer 8+`,
          });
        }
        if (humanResult.humanWhyItMatters.length < 8) {
          log.warn({
            event: CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
            categoryId,
            field: "humanWhyItMatters",
            detail: `length ${humanResult.humanWhyItMatters.length}, prefer 8+`,
          });
        }
        if (humanResult.humanDecisionQuestion.length < 8) {
          log.warn({
            event: CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
            categoryId,
            field: "humanDecisionQuestion",
            detail: `length ${humanResult.humanDecisionQuestion.length}, prefer 8+`,
          });
        }
        for (const opt of humanResult.options) {
          if (opt.humanSummary.length < 8) {
            log.warn({
              event: CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
              categoryId,
              field: `options.${opt.id}.humanSummary`,
              detail: `length ${opt.humanSummary.length}, prefer 8+`,
            });
          }
          if (opt.humanChooseThisIf.length < 8) {
            log.warn({
              event: CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
              categoryId,
              field: `options.${opt.id}.humanChooseThisIf`,
              detail: `length ${opt.humanChooseThisIf.length}, prefer 8+`,
            });
          }
          if (opt.humanTradeoff.length < 8) {
            log.warn({
              event: CATEGORY_HUMANIZE_OUTPUT_LENGTH_DEVIATION,
              categoryId,
              field: `options.${opt.id}.humanTradeoff`,
              detail: `length ${opt.humanTradeoff.length}, prefer 8+`,
            });
          }
        }
      }
    } else {
      log.info({ event: CATEGORY_HUMANIZATION_SKIPPED, categoryId });
    }

    const decisionOptions = optionsResult.options.map(
      (option: {
        id: "A" | "B";
        name: string;
        technicalPlan: string;
        ruleConsideration: string;
      }) => {
        const humanOption = humanResult?.options.find((o) => o.id === option.id);
        return {
          id: option.id,
          name: FindingShortLabelSchema.parse(option.name),
          technicalPlan: option.technicalPlan,
          ruleConsideration: option.ruleConsideration,
          humanSummary: humanOption?.humanSummary,
          humanChooseThisIf: humanOption?.humanChooseThisIf,
          humanTradeoff: humanOption?.humanTradeoff,
        };
      }
    );

    let candidate: IQualityGateCandidate = {
      problem: {
        title: FindingShortLabelSchema.parse(findingResult.title.trim()),
        locations: findingResult.locations.map((location) => location.trim()),
        technicalFinding: findingResult.finding.trim(),
        ...(humanResult?.humanSummary !== undefined && {
          humanSummary: humanResult.humanSummary.trim(),
        }),
        ...(humanResult?.humanCurrentBehavior !== undefined && {
          humanCurrentBehavior: humanResult.humanCurrentBehavior.trim(),
        }),
        ...(humanResult?.humanWhyItMatters !== undefined && {
          humanWhyItMatters: humanResult.humanWhyItMatters.trim(),
        }),
        ...(humanResult?.humanEvidence !== undefined && {
          humanEvidence: humanResult.humanEvidence,
        }),
        ...(humanResult?.humanDecisionQuestion !== undefined && {
          humanDecisionQuestion: humanResult.humanDecisionQuestion.trim(),
        }),
      },
      decision: { options: decisionOptions, selectedOptionId: undefined },
    };

    log.info({
      event: CATEGORY_GENERATION_QUALITY_GATE_STARTED,
      categoryId,
      title: candidate.problem.title,
      locationsCount: candidate.problem.locations.length,
    });
    const locationEvidence = buildLocationEvidence(projectRoot, candidate.problem.locations);
    let qualityDecision = await runStructuredAgentFn({
      agent: judgeGeneratedFindingAgent,
      input: {
        categoryId,
        ruleContent: entry.ruleContent,
        projectContext,
        rulesContext,
        problem: candidate.problem,
        decision: candidate.decision,
        locationEvidence,
      },
      workspace: projectRoot,
      resumeChatId: workflowChatId,
    });
    let wasRepaired = false;

    if (qualityDecision.decision === "repair") {
      wasRepaired = true;
      log.info({
        event: CATEGORY_GENERATION_QUALITY_GATE_REPAIR_STARTED,
        categoryId,
        reasons: qualityDecision.reasons,
      });
      candidate = await runStructuredAgentFn({
        agent: repairGeneratedFindingAgent,
        input: {
          categoryId,
          ruleContent: entry.ruleContent,
          projectContext,
          rulesContext,
          problem: candidate.problem,
          decision: candidate.decision,
          judgeReasons: qualityDecision.reasons,
        },
        workspace: projectRoot,
        resumeChatId: workflowChatId,
      });
      qualityDecision = await runStructuredAgentFn({
        agent: judgeGeneratedFindingAgent,
        input: {
          categoryId,
          ruleContent: entry.ruleContent,
          projectContext,
          rulesContext,
          problem: candidate.problem,
          decision: candidate.decision,
          locationEvidence: buildLocationEvidence(projectRoot, candidate.problem.locations),
        },
        workspace: projectRoot,
        resumeChatId: workflowChatId,
      });
    }

    if (qualityDecision.decision !== "accept") {
      log.info({
        event: CATEGORY_GENERATION_QUALITY_GATE_DROPPED,
        projectRoot,
        categoryId,
        title: candidate.problem.title,
        decision: qualityDecision.decision,
        reasons: qualityDecision.reasons,
      });
      log.info({
        event: CATEGORY_GENERATION_COMPLETED,
        projectRoot,
        categoryId,
        durationMs: Date.now() - startedAt,
        persistedCount: 0,
        itemTitles: [],
      });
      return { didRun: true, findingsCount: 0 };
    }

    log.info({
      event: CATEGORY_GENERATION_QUALITY_GATE_ACCEPTED,
      categoryId,
      title: candidate.problem.title,
      repaired: wasRepaired,
    });

    log.info({ event: CATEGORY_GENERATION_PERSISTING, categoryId, validCount: 1 });

    const normalizedLocationsForDedupe = [...candidate.problem.locations]
      .map((location) => normalizeForDedupe(location))
      .filter(Boolean)
      .sort();
    const normalizedProblemForDedupe = normalizeForDedupe(
      findingResult.findingKey && findingResult.findingKey.trim().length > 0
        ? findingResult.findingKey
        : `${candidate.problem.title} ${candidate.problem.technicalFinding}`
    );
    const dedupeKey = createHash("sha256")
      .update(
        JSON.stringify({
          categoryId,
          normalizedProblem: normalizedProblemForDedupe,
          normalizedLocations: normalizedLocationsForDedupe,
        })
      )
      .digest("hex")
      .slice(0, 40);
    const existingInFlightItemsForDedupe = [
      ...listReviewFindingsForCategory(projectRoot, categoryId),
      ...listApprovedFindingsForCategory(projectRoot, categoryId),
      ...listClaimedFindingsForCategory(projectRoot, categoryId),
      ...listAgentRunningFindingsForCategory(projectRoot, categoryId),
    ];
    const duplicateExists = existingInFlightItemsForDedupe.some(
      (item: ICategoryItem): boolean =>
        (item.status === STATUS.NEEDS_REVIEW ||
          item.status === STATUS.APPROVED ||
          item.status === STATUS.CLAIMED ||
          item.status === STATUS.AGENT_RUNNING) &&
        item.dedupeKey === dedupeKey
    );
    if (duplicateExists) {
      log.info({
        event: CATEGORY_GENERATION_DEDUPE_SKIPPED,
        categoryId,
        title: candidate.problem.title,
        findingSummary: candidate.problem.technicalFinding,
      });
      log.info({
        event: CATEGORY_GENERATION_COMPLETED,
        projectRoot,
        categoryId,
        durationMs: Date.now() - startedAt,
        persistedCount: 0,
        itemTitles: [],
      });
      return { didRun: true, findingsCount: 0 };
    }

    const globalFingerprint = deps.getCurrentContextFingerprint(projectRoot) ?? undefined;
    const contextFingerprint =
      globalFingerprint !== undefined
        ? combineContextFingerprintWithLocations(
            globalFingerprint,
            computeLocationsContentHash(projectRoot, candidate.problem.locations)
          )
        : undefined;
    const item = createFinding({
      categoryId,
      workflowChatId,
      dedupeKey,
      contextFingerprint,
      problem: candidate.problem,
      decision: candidate.decision,
    });
    saveFinding(projectRoot, item);
    if (
      approvalMode === DEFAULT_APPROVAL_MODE &&
      item.decision !== undefined &&
      item.decision.options.length === 1
    ) {
      const selectedOptionId = item.decision.options[0]!.id;
      const autoApproved = transitionFindingStatus(
        projectRoot,
        categoryId,
        item.id,
        STATUS.APPROVED,
        { selectedOptionId }
      );
      if (!autoApproved) {
        log.info({
          event: CATEGORY_GENERATION_AUTO_APPROVE_FAILED,
          projectRoot,
          categoryId,
          itemId: item.id,
          selectedOptionId,
        });
      } else {
        log.info({
          event: CATEGORY_GENERATION_AUTO_APPROVED_SINGLE_OPTION,
          projectRoot,
          categoryId,
          itemId: item.id,
          selectedOptionId,
        });
      }
    }

    log.info({
      event: CATEGORY_GENERATION_COMPLETED,
      projectRoot,
      categoryId,
      durationMs: Date.now() - startedAt,
      persistedCount: 1,
      itemTitles: [getItemTitle(item)],
    });
    return { didRun: true, findingsCount: 1 };
  } catch (error) {
    const requestId = (error as Error & { requestId?: string }).requestId;
    logError(error, {
      event: CATEGORY_GENERATION_FAILED,
      component: "categories",
      operation: "generateCategoryFindings",
      categoryId,
      projectRoot,
      ...(requestId !== undefined && { requestId }),
    });
    const err = error instanceof Error ? error : new Error(String(error));
    (err as Error & { categoryId?: string }).categoryId = categoryId;
    throw err;
  }
}

export async function generateAllGenericCategories(args: {
  projectRoot: string;
  deps: IGenerateCategoryDeps;
}): Promise<void> {
  const log = getRuntimeLogger();
  const categories = getGenericCategoriesForDetection();
  const nonBusyCategoryIds = categories
    .filter((c) => {
      const items = [
        ...listReviewFindingsForCategory(args.projectRoot, c.categoryId),
        ...listApprovedFindingsForCategory(args.projectRoot, c.categoryId),
        ...listClaimedFindingsForCategory(args.projectRoot, c.categoryId),
        ...listAgentRunningFindingsForCategory(args.projectRoot, c.categoryId),
      ];
      return items.length === 0;
    })
    .map((c) => c.categoryId);
  if (categories.length > 0 && nonBusyCategoryIds.length === 0) {
    log.info({ event: CATEGORY_ALL_BUSY, projectRoot: args.projectRoot });
    return;
  }
  const selectedId = getCategoryWithOldestRun(nonBusyCategoryIds);
  if (selectedId === undefined) return;
  const entry = categories.find((c) => c.categoryId === selectedId);
  if (!entry) return;
  try {
    const result = await generateCategory({
      projectRoot: args.projectRoot,
      categoryId: selectedId,
      deps: args.deps,
    });
    if (result.didRun) {
      recordDetectionRun(selectedId, result.findingsCount);
    }
  } catch (error) {
    recordDetectionRun(selectedId, 0);
    throw error;
  }
}
