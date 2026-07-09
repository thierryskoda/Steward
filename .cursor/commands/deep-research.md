# Deep Research

Use this when I ask a question that needs deep repo understanding.

If args exist, treat as the question/context: `$ARGUMENTS`.

## Mission

- Explore codebase deeply before answering.
- Determine exactly how feature integrates: dependencies, structure, data flow, edge cases (within reason), constraints.
- Surface unclear/ambiguous parts in my request and in current implementation.
- Be extremely concise. Sacrifice grammar for cohesion.

## Method

1. Map feature boundaries + entrypoints.
2. Trace call paths end-to-end (API, services, stores, workers, scripts, UI as relevant).
3. Identify dependency graph (internal modules, external libs, env/config/filesystem/network).
4. Check behavior shaping factors: flags, defaults, retries, error handling, timeouts, fallbacks.
5. Capture realistic edge cases and failure modes; avoid over-theorizing.
6. Note evidence for every claim (file/symbol based).
7. If critical path unclear, say so explicitly, then ask focused clarifying questions.

## Output (required)

- `Answer`: direct answer first.
- `Integration map`: where/how it plugs in.
- `Dependencies`: key internal + external deps.
- `Flow`: short step sequence of runtime behavior.
- `Edge cases`: high-signal only.
- `Constraints`: technical/product/operational limits.
- `Ambiguities found`: unclear points in spec or code.
- `Questions for me`: numbered, only what is needed to de-risk.
- `Confidence`: high/med/low + why (1 line).

## Guardrails

- Don’t guess hidden behavior; mark unknowns.
- Don’t pad; dense signal only.
- Prefer correctness over completeness when evidence is partial.
