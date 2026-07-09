/**
 * One tick of continual learning: selects transcript paths that have been idle long enough and have new content, runs learn-agents-memory agent, updates the index.
 * Exists so the project context file (from configured projectContext) can be updated from transcript content without blocking. Use on a timer from main; state holds idle-by-path for debouncing.
 */
import { existsSync } from "fs";
import { getRuntimeLogger, logError } from "../../core/logger.js";
import type { ITranscriptStreamSnapshot } from "../../core/sources/transcript-ingestion-service.js";
import { readTranscriptEntries } from "../../core/llm/agent-transcript-capture.js";
import { runWorkspaceMutationAgent } from "../../core/llm/run-workspace-mutation.agent.js";
import { learnAgentsMemoryAgent } from "./learn-agents-memory.agent.js";
import {
  loadContinualLearningIndex,
  saveContinualLearningIndex,
} from "./continual-learning-index.js";
import type { IContinualLearningIdleState } from "./continual-learning.types.js";
import {
  CONTINUAL_LEARNING_RUN_FAILED,
  CONTINUAL_LEARNING_RUN_STARTED,
  CONTINUAL_LEARNING_RUN_SUCCEEDED,
  CONTINUAL_LEARNING_SKIPPED_EMPTY_TRANSCRIPT,
  CONTINUAL_LEARNING_SKIPPED_NO_PROJECT_CONTEXT,
} from "./continual-learning-log-events.js";

export type IProjectContextTarget = { targetFilePath: string; content: string };

export type IContinualLearningDeps = {
  projectRoot: string;
  findTranscriptPaths: (args: { projectRoot: string; cursorProjectsRoot?: string }) => string[];
  getStreamStateSnapshot: () => Map<string, ITranscriptStreamSnapshot>;
  getProjectContextTargetFile: (projectRoot: string) => IProjectContextTarget | null;
  cursorProjectsRoot: string | undefined;
  idleMs: number;
  cursorProjectDirFromRoot: (workspace: string) => string;
};

/**
 * One tick: use shared ingestion stream state for idle detection; run learning for any path
 * that has been idle long enough and has new content since last process.
 */
export async function runContinualLearningTick(
  deps: IContinualLearningDeps,
  state: {
    idleByPath: Map<string, IContinualLearningIdleState>;
  }
): Promise<void> {
  const {
    projectRoot,
    findTranscriptPaths,
    getStreamStateSnapshot,
    getProjectContextTargetFile,
    idleMs,
    cursorProjectDirFromRoot,
  } = deps;
  const log = getRuntimeLogger();
  const now = Date.now();
  const paths = findTranscriptPaths({ projectRoot, cursorProjectsRoot: deps.cursorProjectsRoot });
  const snapshot = getStreamStateSnapshot();
  const index = loadContinualLearningIndex(projectRoot);

  for (const path of paths) {
    if (!existsSync(path)) continue;
    const streamState = snapshot.get(path);
    if (!streamState) continue;
    const size = streamState.lastSizeBytes;
    const elapsed = now - streamState.lastModifiedMs;
    if (elapsed < idleMs) continue;

    let idleState = state.idleByPath.get(path);
    if (!idleState) {
      idleState = { lastSize: size, lastSeenAtMs: now, inFlight: false };
      state.idleByPath.set(path, idleState);
    }
    if (idleState.inFlight) continue;

    const entry = index.transcripts[path];
    if (entry !== undefined && size <= entry.lastProcessedSize) {
      continue;
    }

    idleState.inFlight = true;
    const target = getProjectContextTargetFile(projectRoot);
    if (!target) {
      log.info({
        event: CONTINUAL_LEARNING_SKIPPED_NO_PROJECT_CONTEXT,
        transcriptPath: path,
        projectRoot,
      });
      idleState.inFlight = false;
      continue;
    }
    const entries = readTranscriptEntries(path);
    if (!entries || entries.length === 0) {
      log.info({
        event: CONTINUAL_LEARNING_SKIPPED_EMPTY_TRANSCRIPT,
        transcriptPath: path,
        transcriptSize: size,
      });
      idleState.inFlight = false;
      index.transcripts[path] = {
        lastProcessedSize: size,
        lastProcessedAt: new Date().toISOString(),
      };
      saveContinualLearningIndex(projectRoot, index);
      continue;
    }
    const transcriptContent = entries
      .map((e) => {
        const text = (e.message?.content ?? [])
          .filter(
            (c): c is { type: "text"; text: string } =>
              c?.type === "text" && typeof (c as { text?: string }).text === "string"
          )
          .map((c) => (c as { text: string }).text)
          .join("");
        return `${e.role}: ${text}`;
      })
      .join("\n\n");

    log.info({
      event: CONTINUAL_LEARNING_RUN_STARTED,
      transcriptPath: path,
      transcriptSize: size,
      entriesCount: entries.length,
    });

    try {
      const result = await runWorkspaceMutationAgent({
        agent: learnAgentsMemoryAgent,
        input: {
          transcriptContent,
          targetFilePath: target.targetFilePath,
          targetFileContent: target.content,
        },
        workspace: projectRoot,
        deps: { cursorProjectDirFromRoot: cursorProjectDirFromRoot },
      });
      if (result.outcome === "succeeded") {
        log.info({
          event: CONTINUAL_LEARNING_RUN_SUCCEEDED,
          transcriptPath: path,
          summary: result.summary?.slice(0, 200),
        });
      } else {
        log.warn({
          event: CONTINUAL_LEARNING_RUN_FAILED,
          transcriptPath: path,
          outcome: result.outcome,
          summary: result.summary?.slice(0, 200),
        });
      }
    } catch (err) {
      logError(err, {
        event: CONTINUAL_LEARNING_RUN_FAILED,
        component: "continual-learning",
        transcriptPath: path,
      });
    } finally {
      idleState.inFlight = false;
      index.transcripts[path] = {
        lastProcessedSize: size,
        lastProcessedAt: new Date().toISOString(),
      };
      saveContinualLearningIndex(projectRoot, index);
    }
  }

  const currentPathSet = new Set(paths);
  let pruned = false;
  for (const key of Object.keys(index.transcripts)) {
    if (!currentPathSet.has(key)) {
      delete index.transcripts[key];
      pruned = true;
    }
  }
  if (pruned) saveContinualLearningIndex(projectRoot, index);
}

export function createContinualLearningRunner(deps: {
  projectRoot: string;
  findTranscriptPaths: (args: { projectRoot: string; cursorProjectsRoot?: string }) => string[];
  getStreamStateSnapshot: () => Map<string, ITranscriptStreamSnapshot>;
  getProjectContextTargetFile: (projectRoot: string) => IProjectContextTarget | null;
  cursorProjectsRoot: string | undefined;
  idleMs: number;
  cursorProjectDirFromRoot: (workspace: string) => string;
}): {
  tick: (state: { idleByPath: Map<string, IContinualLearningIdleState> }) => Promise<void>;
} {
  return {
    tick: (state) => runContinualLearningTick({ ...deps }, state),
  };
}
