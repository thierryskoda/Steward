import type { IOptionHint } from "./option-hints.schemas.js";

export type IHintSelectionSkipped = {
  hint: IOptionHint;
  similarityScore: number;
  reason: "low_similarity";
};

export type IHintSelectionSuppressed = {
  hint: IOptionHint;
  reason: "already_covered_by_rules_context";
};

export type IHintSelectionApplied = {
  hint: IOptionHint;
  similarityScore: number;
};

export type IHintSelectionResult = {
  applied: IHintSelectionApplied[];
  skipped: IHintSelectionSkipped[];
  suppressed: IHintSelectionSuppressed[];
};

export type IRejectedReasonHintCandidate = {
  antiPattern: string;
  instruction: string;
  confidence: number;
  keywords: string[];
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  const matches = value.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of matches) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function computeSimilarityScore(targetTokens: Set<string>, hintTokens: string[]): number {
  if (hintTokens.length === 0) return 0;
  let overlap = 0;
  for (const token of hintTokens) {
    if (targetTokens.has(token)) overlap += 1;
  }
  return overlap / hintTokens.length;
}

function hintKeywords(hint: IOptionHint): string[] {
  if (hint.keywords !== undefined && hint.keywords.length > 0) return hint.keywords;
  return tokenize(`${hint.antiPattern} ${hint.instruction}`);
}

function isSuppressedByRulesContext(args: { hint: IOptionHint; rulesContext: string }): boolean {
  const hintInstruction = normalizeText(args.hint.instruction);
  if (hintInstruction.length === 0) return false;
  return normalizeText(args.rulesContext).includes(hintInstruction);
}

export function deriveHintCandidateFromRejectedReason(
  rejectedReason: string
): IRejectedReasonHintCandidate | null {
  const reason = rejectedReason.trim();
  if (reason.length < 15) return null;
  const reasonNorm = normalizeText(reason);
  const sameOptionsPattern =
    /(same|similar|identical).{0,30}(option|a\/b|a and b|b and a)|(option|a\/b|a and b|b and a).{0,30}(same|similar|identical)/;
  if (sameOptionsPattern.test(reasonNorm)) {
    return {
      antiPattern: "Options are not materially different",
      instruction:
        "Ensure Option A and Option B differ in strategy and tradeoff, not only polish or extra checks.",
      confidence: 0.85,
      keywords: ["option", "strategy", "tradeoff", "different", "scope"],
    };
  }
  const broadScopePattern = /(too broad|scope too big|too much|too large)/;
  if (broadScopePattern.test(reasonNorm)) {
    return {
      antiPattern: "Option scope is too broad",
      instruction:
        "Keep option scope tightly aligned to the finding; avoid adding unrelated cleanup work.",
      confidence: 0.7,
      keywords: ["scope", "broad", "finding", "aligned", "unrelated"],
    };
  }
  const keywords = tokenize(reason).slice(0, 8);
  if (keywords.length === 0) return null;
  return {
    antiPattern: `Rejected reason pattern: ${reason.slice(0, 120)}`,
    instruction: `Avoid repeating this rejection pattern: ${reason.slice(0, 220)}`,
    confidence: 0.6,
    keywords,
  };
}

export function selectHintsForGenerateOptions(args: {
  hints: IOptionHint[];
  categoryId: string;
  title: string;
  finding: string;
  locations: string[];
  rulesContext: string;
  maxApplied: number;
  similarityThreshold: number;
}): IHintSelectionResult {
  const inputTokens = new Set<string>(
    tokenize(`${args.title} ${args.finding} ${args.locations.join(" ")}`)
  );
  const applied: IHintSelectionApplied[] = [];
  const skipped: IHintSelectionSkipped[] = [];
  const suppressed: IHintSelectionSuppressed[] = [];
  const sameCategoryHints = args.hints.filter((hint) => hint.categoryId === args.categoryId);
  for (const hint of sameCategoryHints) {
    if (isSuppressedByRulesContext({ hint, rulesContext: args.rulesContext })) {
      suppressed.push({ hint, reason: "already_covered_by_rules_context" });
      continue;
    }
    const score = computeSimilarityScore(inputTokens, hintKeywords(hint));
    if (score < args.similarityThreshold) {
      skipped.push({ hint, similarityScore: score, reason: "low_similarity" });
      continue;
    }
    applied.push({ hint, similarityScore: score });
  }
  applied.sort((a, b) => b.similarityScore - a.similarityScore);
  return {
    applied: applied.slice(0, args.maxApplied),
    skipped,
    suppressed,
  };
}
