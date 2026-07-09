# Iterate Script Until Goal

Run a script, inspect logs/output, patch code, and repeat until the goal is achieved.

If args are provided, treat them as execution context: `$ARGUMENTS`.

## Required inputs

- `goal`: explicit success condition (what must be true).
- `run`: exact command to execute (example: `yarn tsx apps/runtime/scripts/my-script.ts`).

## Optional inputs

- `scope`: files/folders allowed to change.
- `logs`: log files to prioritize (example: `logs/runtime.log, logs/dev.log`).
- `maxIterations`: hard cap for fix/run cycles (default `5`).
- `mode`: `report` (analyze only) | `apply` (default, patch and rerun).

## Workflow

1. Restate goal as a binary pass/fail check.
2. Run `run` command and collect:
   - exit code
   - stdout/stderr
   - relevant log excerpts
3. Diagnose highest-signal failure first.
4. Propose smallest fix tied to evidence.
5. In `mode=apply`, apply patch, rerun, and re-evaluate.
6. Repeat until:
   - goal is met, or
   - `maxIterations` reached, or
   - blocked by missing info/permissions.
7. If blocked, return minimal unblock request.

## Logging policy

- Add temporary logs only when needed to disambiguate behavior.
- Prefer structured, searchable logs.
- Remove or downgrade noisy debug logs before finalizing, unless user asks to keep them.

## Safety constraints

- No destructive git/file operations.
- No unrelated refactors while iterating.
- Keep patches minimal and goal-directed.
- If risk is medium/high, explain before applying broad changes.

## Quality of fixes

- Fixes must follow project best practices and conventions—no bandaids or workarounds that ignore patterns.
- If a fix would require library/framework behavior you're unsure about, or you'd want to check official docs, **ask the user** instead of guessing.
- Prefer looking up or asking for documentation over implementing something that might conflict with best practices.

## Output format (required)

- `Goal check`:
  - `goal`
  - `status` (`met` | `not-met`)
  - `proof`
- `Iteration log` (per cycle):
  - `iteration`
  - `command`
  - `result` (`pass` | `fail`)
  - `key evidence`
  - `change made`
- `Final`:
  - `outcome`
  - `files changed`
  - `remaining gaps` (if any)
  - `next best action`
