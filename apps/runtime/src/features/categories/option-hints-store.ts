import { randomUUID } from "crypto";
import { getRuntimeDb } from "../../core/db/runtime-db.js";
import { parseJsonFromDb, stringifyJsonForDb } from "../../core/db/sqlite-json.js";
import {
  OptionHintSchema,
  type IOptionHint,
  type IOptionHintTrigger,
} from "./option-hints.schemas.js";
import { deriveHintCandidateFromRejectedReason } from "./option-hints.js";

export type ICreateOptionHintInput = {
  categoryId: string;
  trigger: IOptionHintTrigger;
  antiPattern: string;
  instruction: string;
  confidence: number;
  evidenceItemId: string;
  keywords?: string[];
};

export function readOptionHints(projectRoot: string): IOptionHint[] {
  void projectRoot;
  const rows = getRuntimeDb()
    .prepare("SELECT id, payload_json FROM option_hints ORDER BY created_at ASC")
    .all() as { id: string; payload_json: string }[];
  return rows.map((row) =>
    parseJsonFromDb({
      raw: row.payload_json,
      schema: OptionHintSchema,
      context: { table: "option_hints", id: row.id },
    })
  );
}

function normalizeForDedupe(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function createOptionHint(
  projectRoot: string,
  input: ICreateOptionHintInput
): { created: boolean; hint: IOptionHint } {
  const hints = readOptionHints(projectRoot);
  const antiPattern = normalizeForDedupe(input.antiPattern);
  const instruction = input.instruction.trim();
  const existing = hints.find(
    (hint) =>
      hint.categoryId === input.categoryId &&
      normalizeForDedupe(hint.antiPattern) === antiPattern &&
      normalizeForDedupe(hint.instruction) === normalizeForDedupe(instruction)
  );
  if (existing) {
    return { created: false, hint: existing };
  }
  const next: IOptionHint = {
    id: randomUUID(),
    categoryId: input.categoryId,
    trigger: input.trigger,
    antiPattern: input.antiPattern.trim(),
    instruction,
    confidence: input.confidence,
    createdAt: Date.now(),
    evidenceItemId: input.evidenceItemId,
    ...(input.keywords !== undefined && input.keywords.length > 0
      ? { keywords: input.keywords }
      : {}),
  };
  const parsed = OptionHintSchema.parse(next);
  getRuntimeDb()
    .prepare(
      "INSERT INTO option_hints (id, category_id, trigger, payload_json, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      parsed.id,
      parsed.categoryId,
      parsed.trigger,
      stringifyJsonForDb(parsed),
      parsed.createdAt
    );
  return { created: true, hint: next };
}

export function createOptionHintFromRejectedFinding(args: {
  projectRoot: string;
  categoryId: string;
  itemId: string;
  rejectedReason: string;
}):
  | { outcome: "created"; hint: IOptionHint }
  | { outcome: "duplicate"; hint: IOptionHint }
  | { outcome: "skipped"; reason: "low_signal" } {
  const candidate = deriveHintCandidateFromRejectedReason(args.rejectedReason);
  if (candidate === null) {
    return { outcome: "skipped", reason: "low_signal" };
  }
  const result = createOptionHint(args.projectRoot, {
    categoryId: args.categoryId,
    trigger: "rejected_reason",
    antiPattern: candidate.antiPattern,
    instruction: candidate.instruction,
    confidence: candidate.confidence,
    evidenceItemId: args.itemId,
    keywords: candidate.keywords,
  });
  if (!result.created) {
    return { outcome: "duplicate", hint: result.hint };
  }
  return { outcome: "created", hint: result.hint };
}
