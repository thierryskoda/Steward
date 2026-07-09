# Fix

Fix the error(s) I paste below. Goal: make it work **cleanly**—no bandaids, no new tech debt, no unclean code. Follow project best practices and architecture (see AGENTS.md). Think through the solution; sometimes it’s a small change, sometimes a refactor elsewhere is required for a clean fix and a clean architecture.

## Input

- **Errors / context**: I will paste the error(s), stack trace(s), or failing behavior in the chat (or in `$ARGUMENTS`).

## Mandatory behavior

1. **Understand**
   - Reproduce or infer root cause from the paste (and code if needed).
   - Decide whether the fix is local or touches other modules/architecture.

2. **Solution quality**
   - Prefer the **clean** fix: correct types, proper error handling, aligned with existing patterns.
   - No bandaids: no `as any`, silent catches, or workarounds that hide the real issue.
   - If the right fix implies a refactor elsewhere (e.g. call site, interface, or layering), do that refactor so the fix is coherent and the architecture stays clean.

3. **Uncertainty**
   - If you are **not sure** (e.g. framework behavior, intended product behavior, or multiple valid approaches): **do not implement**. Ask me concrete questions and wait for answers before changing code.

4. **Scope**
   - Change only what’s needed for the fix (and any minimal refactor it depends on).
   - No unrelated refactors or “while we’re here” changes unless they are required for the fix.

## Output (before applying)

- **Root cause**: (brief).
- **Proposed fix**: (what you’ll change and why).
- **Refactor needed?**: Yes/No; if yes, where and how it keeps the architecture clean.
- **Uncertain?**: If anything is unclear, list questions and do not apply until I answer.

## Constraints

- Follow AGENTS.md (coding standards, error handling, types, boundaries).
- No destructive git/file ops without explicit confirmation.
- If the fix is non-trivial or touches multiple areas, state the plan first; apply after you’re confident (or after I confirm).
