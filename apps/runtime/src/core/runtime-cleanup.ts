import { updateRuntimeState } from "./state.js";
import { releasePidLock } from "./status-store.js";
import { unregisterRuntime } from "./runtime-registry.js";
import { getProjectRoot } from "./project-root.js";
import { getRuntimeLogger, logError } from "./logger.js";
import {
  RUNTIME_LIFECYCLE_CLEANUP_ERROR,
  RUNTIME_LIFECYCLE_CLEANUP_STARTED,
  RUNTIME_LIFECYCLE_STOPPED,
} from "./runtime-log-events.js";
import { shutdownAgentQueue, SHUTDOWN_QUEUE_TIMEOUT_MS } from "./llm/run-agent-cli-process.js";

type IntervalRef = { current: ReturnType<typeof setInterval> | null };

type IStoppableServer = { close(): void };

/** Minimal refs needed for teardown; single cohesive concern. */
export type ICleanupRefs = {
  transcriptIngestionServiceRef: { current: { stop(): void } | null };
  staleSweepIntervalRef?: IntervalRef;
  continualLearningIntervalRef?: IntervalRef;
  stopGitPollRef?: { current: (() => void) | null };
  findingImplementationWorkerIntervalRef?: IntervalRef;
  ruleApplyWorkerIntervalRef: IntervalRef;
  rejectedFindingLearningIntervalRef?: IntervalRef;
};

export function createCleanup(args: {
  httpServer: IStoppableServer;
  heartbeatInterval: ReturnType<typeof setInterval>;
  refs: ICleanupRefs;
}): () => void {
  const log = getRuntimeLogger();
  let cleanupStarted = false;
  const { httpServer, heartbeatInterval, refs } = args;
  return () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    log.info(RUNTIME_LIFECYCLE_CLEANUP_STARTED);
    updateRuntimeState({ state: "stopped" });
    refs.transcriptIngestionServiceRef.current?.stop();
    refs.transcriptIngestionServiceRef.current = null;
    void shutdownAgentQueue({
      timeoutMs: SHUTDOWN_QUEUE_TIMEOUT_MS,
    })
      .then(() => {
        httpServer.close();
        clearInterval(heartbeatInterval);
        if (refs.staleSweepIntervalRef?.current) clearInterval(refs.staleSweepIntervalRef.current);
        if (refs.continualLearningIntervalRef?.current)
          clearInterval(refs.continualLearningIntervalRef.current);
        refs.stopGitPollRef?.current?.();
        if (refs.findingImplementationWorkerIntervalRef?.current)
          clearInterval(refs.findingImplementationWorkerIntervalRef.current);
        if (refs.ruleApplyWorkerIntervalRef.current)
          clearInterval(refs.ruleApplyWorkerIntervalRef.current);
        if (refs.rejectedFindingLearningIntervalRef?.current)
          clearInterval(refs.rejectedFindingLearningIntervalRef.current);
        const projectRoot = getProjectRoot();
        unregisterRuntime(projectRoot);
        releasePidLock(projectRoot);
        log.info(RUNTIME_LIFECYCLE_STOPPED);
        process.exit(0);
      })
      .catch((err: unknown) => {
        logError(err, {
          event: RUNTIME_LIFECYCLE_CLEANUP_ERROR,
          component: "runtime",
          operation: "cleanup",
          phase: "cleanup",
          projectRoot: getProjectRoot(),
        });
        process.exit(1);
      });
  };
}
