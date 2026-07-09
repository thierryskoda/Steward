import { getRuntimeLogger } from "../../core/logger.js";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";
import {
  CONTINUAL_LEARNING_INDEX_LOADED,
  CONTINUAL_LEARNING_INDEX_SAVED,
} from "./continual-learning-log-events.js";
import {
  continualLearningIndexSchema,
  type IContinualLearningIndex,
} from "./continual-learning-index.schemas.js";

function fallbackIndex(): IContinualLearningIndex {
  return {
    version: 1,
    transcripts: {},
  };
}

export function loadContinualLearningIndex(projectRoot: string): IContinualLearningIndex {
  void projectRoot;
  const row = getRuntimeDb()
    .prepare("SELECT payload_json FROM continual_learning_index WHERE id = 'active'")
    .get() as { payload_json: string } | undefined;
  if (!row) return fallbackIndex();
  const log = getRuntimeLogger();
  const index = parseJsonFromDb({
    raw: row.payload_json,
    schema: continualLearningIndexSchema,
    context: { table: "continual_learning_index", id: "active" },
  });
  log.info({
    event: CONTINUAL_LEARNING_INDEX_LOADED,
    transcriptCount: Object.keys(index.transcripts).length,
  });
  return index;
}

export function saveContinualLearningIndex(
  projectRoot: string,
  index: IContinualLearningIndex
): void {
  void projectRoot;
  getRuntimeDb()
    .prepare(
      `INSERT INTO continual_learning_index (id, payload_json, updated_at)
       VALUES ('active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    )
    .run(stringifyJsonForDb(index), Date.now());
  getRuntimeLogger().info({
    event: CONTINUAL_LEARNING_INDEX_SAVED,
    transcriptCount: Object.keys(index.transcripts).length,
  });
}

export function getIndexPath(projectRoot: string): string {
  return `${projectRoot}/.steward/state.db:continual_learning_index`;
}
