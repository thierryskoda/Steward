/**
 * Handles transcript events for rule capture: runs rule-capture agent to detect rule suggestions and writes rule proposals; dedupes by content hash.
 * Exists so transcript ingestion can drive rule capture when enabled. Use when transcript watch is on; main wires this as a transcript subscriber.
 */
import { createHash } from "crypto";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import { runStructuredAgent } from "../../core/llm/run-structured.agent.js";
import {
  RULE_CAPTURE_FAILED_AGENT,
  RULE_CAPTURE_SKIPPED_AGENT_NO_RULE,
  RULE_CAPTURE_SKIPPED_ALREADY_SEEN,
  RULE_CAPTURE_SKIPPED_ALREADY_SEEN_RULE,
  RULE_CAPTURE_SKIPPED_DISABLED,
  RULE_CAPTURE_SKIPPED_DUPLICATE_CORPUS,
  RULE_CAPTURE_SKIPPED_DUPLICATE_RULE_TEXT,
  RULE_CAPTURE_SKIPPED_EMPTY_CONTENT,
  RULE_PROPOSAL_CREATED,
} from "./rules-log-events.js";
import { ruleCaptureAgent } from "./rule-capture.agent.js";
import {
  createRuleProposal,
  saveRuleProposal,
  readAllRuleCorporaForDedupe,
  normalizeRuleTextForDedupe,
  isExactDuplicateInCorpus,
} from "./rules-store.js";
import type { CursorEvent } from "../../core/types.js";

const seenRuleHashes = new Set<string>();

function ruleHash(messageId: string, ruleText: string): string {
  const normalized = ruleText.toLowerCase().replace(/\s+/g, " ").trim();
  return `${messageId}:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

/** Derive chat/conversation id from transcript file path (e.g. .../transcripts/abc.jsonl → abc). */
function deriveChatIdFromTranscriptPath(path: unknown): string | undefined {
  if (typeof path !== "string" || !path) return undefined;
  const base = path.split("/").pop() ?? "";
  return base.endsWith(".jsonl") ? base.slice(0, -6) : base || undefined;
}

function buildExistingRulesSection(corpus: ReturnType<typeof readAllRuleCorporaForDedupe>): string {
  if (corpus.length === 0) return "No existing rules yet.";
  const lines = corpus.map((c) => {
    const label = c.title ? `[${c.source}: ${c.title}]` : `[${c.source}]`;
    const snippet = c.ruleText.slice(0, 400).replace(/\n/g, " ");
    return `- ${label} ${snippet}`;
  });
  return `Existing rules (from DB-backed snapshots and rule proposals). Avoid duplicates:\n${lines.join("\n")}`;
}

/** Minimal feature-flag slice required by rule capture; supplied by orchestration. */
export type IRuleCaptureFeatureFlags = {
  rulesWorkflowEnabled?: boolean;
};

type IRuleCaptureAgentFn = (args: {
  messageRole: string;
  messageContent: string;
  fullCanonicalRulesContent: string;
  existingRulesSection: string;
  workspace: string;
}) => Promise<{
  relevant: boolean;
  title?: string;
  ruleText?: string;
  rationale?: string;
  reason?: string;
}>;

export function createRuleCaptureAgentRunner(): IRuleCaptureAgentFn {
  return async ({ workspace, ...input }) =>
    runStructuredAgent({
      agent: ruleCaptureAgent,
      input,
      workspace,
    });
}

export async function processMessageForRuleCapture(args: {
  event: CursorEvent;
  projectRoot: string;
  runRuleCaptureAgent: IRuleCaptureAgentFn;
  getRuleSourcesContent: (projectRoot: string) => string;
  featureFlags: IRuleCaptureFeatureFlags;
}): Promise<void> {
  const { event, projectRoot, runRuleCaptureAgent, getRuleSourcesContent, featureFlags } = args;
  const log = getRuntimeLogger();
  if (!featureFlags.rulesWorkflowEnabled) {
    log.info({ event: RULE_CAPTURE_SKIPPED_DISABLED, reason: "rulesWorkflowEnabled" });
    return;
  }
  if (!event.content.trim()) {
    log.info({ event: RULE_CAPTURE_SKIPPED_EMPTY_CONTENT, eventId: event.id });
    return;
  }

  // First-pass dedup for already seen message/rule pairs in this process.
  const h = ruleHash(event.id, event.content);
  if (seenRuleHashes.has(h)) {
    log.info({ event: RULE_CAPTURE_SKIPPED_ALREADY_SEEN, eventId: event.id });
    return;
  }

  const corpus = readAllRuleCorporaForDedupe(projectRoot);
  const normalizedMessage = normalizeRuleTextForDedupe(event.content);
  // Fast exact-match prefilter to skip unnecessary agent calls.
  if (normalizedMessage && isExactDuplicateInCorpus(normalizedMessage, corpus)) {
    log.info({ event: RULE_CAPTURE_SKIPPED_DUPLICATE_CORPUS, eventId: event.id });
    return;
  }

  const fullCanonicalRulesContent = getRuleSourcesContent(projectRoot);
  const input = {
    messageRole: event.role ?? "unknown",
    messageContent: event.content,
    fullCanonicalRulesContent,
    existingRulesSection: buildExistingRulesSection(corpus),
  };

  let output;
  try {
    output = await runRuleCaptureAgent({ ...input, workspace: projectRoot });

    if (!output.relevant || !output.ruleText || !output.title) {
      log.info({
        event: RULE_CAPTURE_SKIPPED_AGENT_NO_RULE,
        eventId: event.id,
        relevant: output.relevant,
        hasRuleText: !!output.ruleText,
        hasTitle: !!output.title,
      });
      return;
    }

    const normalizedRuleText = normalizeRuleTextForDedupe(output.ruleText);
    if (isExactDuplicateInCorpus(normalizedRuleText, corpus)) {
      log.info({ event: RULE_CAPTURE_SKIPPED_DUPLICATE_RULE_TEXT, eventId: event.id });
      return;
    }

    const ruleTextHash = ruleHash(event.id, output.ruleText);
    if (seenRuleHashes.has(ruleTextHash)) {
      log.info({ event: RULE_CAPTURE_SKIPPED_ALREADY_SEEN_RULE, eventId: event.id });
      return;
    }
    seenRuleHashes.add(ruleTextHash);
    if (seenRuleHashes.size > 1000) {
      // Prune old entries to keep in-memory dedup bounded.
      const arr = [...seenRuleHashes];
      seenRuleHashes.clear();
      arr.slice(-500).forEach((x) => seenRuleHashes.add(x));
    }

    const sourceChatId = deriveChatIdFromTranscriptPath(event.metadata?.path);
    const proposal = createRuleProposal({
      title: output.title,
      ruleText: output.ruleText,
      rationale: output.rationale ?? "",
      sourceMessageId: event.id,
      sourceChatId,
    });
    saveRuleProposal(projectRoot, proposal);
    log.info({
      event: RULE_PROPOSAL_CREATED,
      id: proposal.id,
      title: proposal.title,
      eventId: event.id,
    });
  } catch (e) {
    logError(e, {
      event: RULE_CAPTURE_FAILED_AGENT,
      component: "rules",
      operation: "ruleCapture",
      eventId: event.id,
    });
  }
}
