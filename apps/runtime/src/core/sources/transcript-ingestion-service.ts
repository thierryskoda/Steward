/**
 * Single-scheduler transcript ingestion: discovers paths, reads append-only from checkpoint,
 * fans out normalized message events to subscribers. One poll loop, no per-file timers.
 */
import { existsSync, statSync } from "fs";
import { getRuntimeLogger, logError } from "../logger.js";
import { TRANSCRIPT_INGESTION_STARTED, TRANSCRIPT_INGESTION_TICK } from "../runtime-log-events.js";
import type { CheckpointStore } from "./types.js";
import type { ITranscriptIngestionSubscriber, ITranscriptCheckpoint } from "./transcript.types.js";
import {
  parseTranscriptCheckpoint,
  serializeTranscriptCheckpoint,
} from "./transcript-checkpoint.js";
import { readTranscriptAppend } from "./transcript-incremental-reader.js";

const DEFAULT_CHECKPOINT_KEY_PREFIX = "transcript:";
const LOG_THROTTLE_MS = 30_000;
let lastLogAt = 0;

export type ITranscriptIngestionServiceConfig = {
  getPaths: () => string[];
  checkpointStore: CheckpointStore;
  checkpointKeyPrefix?: string;
  pollIntervalMs: number;
  subscribers: ITranscriptIngestionSubscriber[];
};

type IStreamState = {
  checkpoint: ITranscriptCheckpoint | null;
  lastSizeBytes: number;
  lastModifiedMs: number;
};

export type ITranscriptStreamSnapshot = {
  lastSizeBytes: number;
  lastModifiedMs: number;
  lastOffset: number;
};

export type ITranscriptIngestionService = {
  start(): void;
  stop(): void;
  /** Snapshot of stream state for idle/agent-running checks (e.g. continual-learning). */
  getStreamStateSnapshot(): Map<string, ITranscriptStreamSnapshot>;
};

export function createTranscriptIngestionService(
  config: ITranscriptIngestionServiceConfig
): ITranscriptIngestionService {
  const {
    getPaths,
    checkpointStore,
    checkpointKeyPrefix = DEFAULT_CHECKPOINT_KEY_PREFIX,
    pollIntervalMs,
    subscribers,
  } = config;
  const stateByPath = new Map<string, IStreamState>();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function getCheckpointKey(path: string): string {
    return `${checkpointKeyPrefix}${path}`;
  }

  function tick(): void {
    if (stopped) return;
    const paths = getPaths();
    const now = Date.now();
    let totalEvents = 0;
    let pathsWithNewContent = 0;

    for (const path of paths) {
      if (!existsSync(path)) continue;
      let size: number;
      let mtimeMs: number;
      try {
        const stat = statSync(path);
        size = stat.size;
        mtimeMs = stat.mtimeMs;
      } catch {
        continue;
      }

      let streamState = stateByPath.get(path);
      const key = getCheckpointKey(path);

      if (!streamState) {
        const raw = checkpointStore.get(key);
        const checkpoint = parseTranscriptCheckpoint(raw);
        streamState = {
          checkpoint,
          lastSizeBytes: size,
          lastModifiedMs: mtimeMs,
        };
        stateByPath.set(path, streamState);
        if (checkpoint === null && size > 0) {
          streamState.checkpoint = { offset: size };
          checkpointStore.set(key, serializeTranscriptCheckpoint(size));
          streamState.lastSizeBytes = size;
          continue;
        }
        if (checkpoint === null) continue;
      }

      if (size < streamState.lastSizeBytes) {
        streamState.checkpoint = { offset: 0 };
        streamState.lastSizeBytes = 0;
      }
      if (streamState.checkpoint === null && streamState.lastSizeBytes === 0 && size > 0) {
        streamState.checkpoint = { offset: 0 };
      }

      if (
        size <=
        (streamState.checkpoint && "offset" in streamState.checkpoint
          ? streamState.checkpoint.offset
          : 0)
      ) {
        streamState.lastSizeBytes = size;
        streamState.lastModifiedMs = mtimeMs;
        continue;
      }

      const result = readTranscriptAppend(path, streamState.checkpoint, path);
      pathsWithNewContent += result.events.length > 0 ? 1 : 0;
      totalEvents += result.events.length;

      for (const event of result.events) {
        for (const sub of subscribers) {
          try {
            sub.onMessage(event);
          } catch (err) {
            logError(err, {
              event: "Transcript ingestion subscriber error",
              component: "sources",
              path,
              subscriberId: sub.id,
            });
          }
        }
      }

      streamState.checkpoint = { offset: result.nextOffset };
      streamState.lastSizeBytes = size;
      streamState.lastModifiedMs = mtimeMs;
      checkpointStore.set(key, serializeTranscriptCheckpoint(result.nextOffset));
    }

    for (const key of stateByPath.keys()) {
      if (!paths.includes(key)) stateByPath.delete(key);
    }

    if (now - lastLogAt >= LOG_THROTTLE_MS) {
      lastLogAt = now;
      getRuntimeLogger().info({
        event: TRANSCRIPT_INGESTION_TICK,
        pathCount: paths.length,
        trackedCount: stateByPath.size,
        eventsDispatched: totalEvents,
        pathsWithNewContent,
        throttle: { intervalMs: LOG_THROTTLE_MS, lastEmittedAt: now },
      });
    }
  }

  function getStreamStateSnapshot(): Map<string, ITranscriptStreamSnapshot> {
    const out = new Map<string, ITranscriptStreamSnapshot>();
    for (const [path, streamState] of stateByPath) {
      const lastOffset =
        streamState.checkpoint && "offset" in streamState.checkpoint
          ? streamState.checkpoint.offset
          : 0;
      out.set(path, {
        lastSizeBytes: streamState.lastSizeBytes,
        lastModifiedMs: streamState.lastModifiedMs,
        lastOffset,
      });
    }
    return out;
  }

  return {
    start() {
      const initialPaths = getPaths();
      getRuntimeLogger().info({
        event: TRANSCRIPT_INGESTION_STARTED,
        pathCount: initialPaths.length,
        subscriberIds: subscribers.map((s) => s.id),
      });
      tick();
      if (pollIntervalMs > 0) {
        intervalId = setInterval(tick, pollIntervalMs);
      }
    },
    stop() {
      stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    getStreamStateSnapshot,
  };
}
