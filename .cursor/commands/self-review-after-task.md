# Self-Review After Task

Use this command **after** you (the LLM) have finished implementing a task. Do a strict pass over your own work to verify quality, completeness, and alignment with the project—as if a senior reviewer were checking it.

## Mission

Review the changes you just made and confirm you didn’t miss cleanup, best practices, or important edge cases. Fix any gaps you find.

## Mandatory behavior

1. **Scope**
   - Identify every file and area you touched (edits, new files, deleted code).
   - Re-read the original request and your implementation; confirm the **intent** is fully satisfied.

2. **Completeness**
   - Nothing half-done: no TODOs you left, no “caller to implement later,” no stubbed behavior that should be real.
   - No leftover dead code: remove any code paths, exports, or imports that became unused because of your changes.
   - No leftover debug logs, commented-out blocks, or temporary workarounds unless they’re explicitly required.

3. **Best practices (AGENTS.md)**
   - Architecture: composition root, dependency direction (orchestration → features; core no feature imports), no barrel `index` reintroduced.
   - Types: no `any`; explicit return types; Zod for external JSON; `StrictOmit` over `Omit`; no unnecessary try/catch.
   - Errors: no silent catches; structured errors at boundaries; log with context.
   - State: React Query for server data, no syncing query → store; Zustand/local state only for client-only UI.
   - Testing: no mock-heavy tests that only assert calls; cover real behavior or high-risk paths where relevant.
   - Naming, boundaries, and dependency rules: small deps, no broad shared “deps” bags, fail fast at root.

4. **Edge cases**
   - Consider: empty input, missing optional data, failure paths, concurrent or repeated execution if relevant.
   - If the task involved persistence, config, or user input: validation, schema, and failure handling in place where needed.

5. **Consistency**
   - Naming and patterns match the rest of the codebase in the same feature/layer.
   - No new magic strings or duplicated constants; reuse canonical sources where they exist.

## Output (before considering the review done)

- **Intent check**: Request satisfied? (Yes / No; if No, what’s missing.)
- **Cleanup**: Any dead code, unused exports, or leftover junk to remove? (List and remove.)
- **AGENTS.md**: Any violations? (List and fix.)
- **Edge cases**: Anything risky or unhandled? (List and fix or document why acceptable.)
- **Lint/build**: Run relevant lint and typecheck (e.g. `pnpm run typecheck` or workspace-specific); fix any new issues.

## Constraints

- Be honest: if something is wrong or missing, fix it in this pass. Do not wave it away.
- Prefer fixing over listing: do the cleanup and small fixes as part of this review; only call out larger decisions that need human input.
- No scope creep: limit changes to what’s needed to make the **current** implementation correct and clean; no unrelated refactors.
