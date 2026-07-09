/**
 * Rules feature transcript subscriber: consumes shared ingestion events and runs rule capture.
 * No per-path file monitors; main wires this subscriber into the core transcript ingestion service.
 */
import type { ITranscriptIngestionSubscriber } from "../../core/sources/transcript.types.js";
import { getRuntimeLogger } from "../../core/logger.js";
import { CURSOR_MESSAGE_RECEIVED } from "./rules-log-events.js";
import type { IRuleCaptureFeatureFlags } from "./rule-capture.js";
import { processMessageForRuleCapture } from "./rule-capture.js";

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

export type ICreateRulesTranscriptSubscriberDeps = {
  projectRoot: string;
  seenIds: Set<string>;
  createRuleCaptureAgentRunner: () => IRuleCaptureAgentFn;
  getRuleSourcesContent: (projectRoot: string) => string;
  getFeatureFlags: () => IRuleCaptureFeatureFlags;
};

export function createRulesTranscriptSubscriber(
  deps: ICreateRulesTranscriptSubscriberDeps
): ITranscriptIngestionSubscriber {
  const log = getRuntimeLogger();
  const runRuleCaptureAgent = deps.createRuleCaptureAgentRunner();
  return {
    id: "rules",
    onMessage(event) {
      if (deps.seenIds.has(event.id)) return;
      deps.seenIds.add(event.id);
      log.info({
        event: CURSOR_MESSAGE_RECEIVED,
        role: event.role ?? "unknown",
        contentLength: event.content.length,
      });
      void processMessageForRuleCapture({
        event,
        projectRoot: deps.projectRoot,
        runRuleCaptureAgent,
        getRuleSourcesContent: deps.getRuleSourcesContent,
        featureFlags: deps.getFeatureFlags(),
      });
    },
  };
}
