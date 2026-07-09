# Evaluate integration (library / tool / product)

Use when I want to know if a library, tool, product, or described solution is worth integrating into this codebase.

**Input:** `$ARGUMENTS` = name of the library/tool/product, or a short description of the thing to evaluate.

## What to do

1. **Gather context** (do not output this): Scan `AGENTS.md`, configured ruleSources, generated snapshots in `.steward/state.db`, relevant `package.json` and entrypoints, and how this repo does the thing the candidate touches. If the candidate is name-only, look up what it does (docs or web).
2. **Output only** the two examples below. Plain language, bullet steps. End with **Verdict:** Integrate | Consider | Reject + one-line reason (and if Consider: 1–2 conditions).

## Output format

**Example A — Where this lib helps**

- Simple scenario (any stack) where the library clearly adds value.
- Bullet steps: how an app does it _today without_ the lib (3–5 steps).
- Bullet steps: how it would look _with_ the lib and why that’s better (3–5 steps).

**Example B — Us**

- This repo, same idea.
- Bullet steps: how _we_ do it today (3–5 steps).
- Bullet steps: how it would look if we used the lib (or “we wouldn’t use it because …” with 2–3 steps).
- One-line takeaway: does it help us or not, and why.

**Verdict:** Integrate | Consider | Reject + reason. (If Consider: what would need to be true.)

## Guardrails

- Do not recommend integration that violates AGENTS.md (e.g. cloud-only, full autonomy) or project code standards (e.g. dependency-hygiene: no duplicate purpose, no “tiny fraction of a big lib”).
- Examples must be grounded in how this codebase actually works; no generic fluff.
