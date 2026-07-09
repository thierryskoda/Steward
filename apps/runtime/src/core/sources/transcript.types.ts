/**
 * Shared types for the transcript ingestion pipeline: checkpoint model and subscriber contract.
 */
import type { CursorEvent } from "../types.js";

/** Checkpoint payload: v1 uses byte offset for append-only reading. */
export type ITranscriptCheckpointPayload = { v: 1; offset: number };

/** Parsed checkpoint. */
export type ITranscriptCheckpoint = { offset: number };

/**
 * Normalized message event emitted to subscribers. Same shape as CursorEvent; ingestion service
 * sets metadata.path, and optionally metadata.lineNum / metadata.offset.
 */
export type ITranscriptMessageEvent = CursorEvent;

/** Subscriber interface for the shared transcript ingestion service. */
export type ITranscriptIngestionSubscriber = {
  /** Unique id for logging. */
  id: string;
  /** Called for each new message (append) from any tracked transcript. */
  onMessage(event: ITranscriptMessageEvent): void;
  /** Optional: called when a transcript is first seen or becomes idle (e.g. for continual-learning). */
  onTranscriptIdle?(path: string, sizeBytes: number, lastEventOffset: number): void;
};

/** State for one transcript file in the ingestion service. */
export type ITranscriptStreamState = {
  path: string;
  checkpoint: ITranscriptCheckpoint | null;
  lastSizeBytes: number;
  lastModifiedMs: number;
};
