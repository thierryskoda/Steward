# Dead Code Audit (Knip)

Use this when I want to find dead code and decide what to delete vs keep. Uses the project’s `knip.json` and root scripts.

## Input

- `$ARGUMENTS`: optional. If provided, treat as extra scope (e.g. `apps/runtime` or a file path). Otherwise run knip over the whole repo.

## Mandatory behavior

1. **Run Knip**  
   From repo root, run:
   - `pnpm check:unused` (or `pnpm exec knip` if you need raw output).
   - Use the existing `knip.json` config; do not change it for this audit.

2. **Capture and structure the report**  
   Parse knip’s output and group by:
   - Unused files
   - Unused exports (file + export name)
   - Unused dependencies
   - Any other knip issue types present

3. **Present findings**  
   Output a concise, machine-friendly list so I can reply with “delete X / keep Y”:
   - One section per category (files, exports, dependencies).
   - Each item one line or a short block (e.g. `path/to/file.ts`, `path/to/file.ts::exportName`, `package-name`).

4. **Wait for my decisions**  
   Do not delete or change anything until I say what to delete and what to keep. If I don’t specify, ask.

5. **Apply only what I approve**
   - When I approve bulk or “delete all”: run `pnpm delete:unused` first (knip --fix --allow-remove-files --format). That removes unused files, strips unused exports, and removes unused deps; then format. Knip only strips the `export` keyword, so symbols may remain as “declared but never read”—fix those (remove the dead declaration or run lint) and re-run build/test.
   - For targeted deletions I approve: remove files, remove unused exports (or delete file if it becomes empty), remove dependencies as appropriate.
   - For “keep”: leave them as-is; do not add knip ignore comments unless I ask.
   - If I say “delete all” or “keep all”, treat that as the default and apply only explicit exceptions I give.

## Output format (first turn)

- **Scope:** what was run (e.g. full repo or `$ARGUMENTS`).
- **Unused files:** list (paths).
- **Unused exports:** list (file :: export or equivalent).
- **Unused dependencies:** list (package names).
- **Other:** any other knip categories.
- **Next:** “Reply with what to delete and what to keep (e.g. delete files X,Y; keep export Z; delete dep A).”

## Constraints

- Run knip from repo root so `knip.json` and workspaces are respected.
- Prefer `pnpm check:unused` for report; use `pnpm delete:unused` for automated fix (files + exports + deps) when I approve.
- No edits until I specify delete/keep.
- Follow project code standards in AGENTS.md (and configured ruleSources) when removing code (no legacy branches, no dead mode switches).
