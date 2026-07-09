# steward

Local-first AI copilot for agent-driven repos.
Runtime analyzes activity, persists project state in target repo `.steward/state.db`, and exposes a local API consumed by the menubar app.

## Non-Negotiables

- Human approval gate before implement/reject side effects.
- Local-first persistence in target project `.steward/state.db`.
- Internal backward compatibility is not a default constraint; prefer direct refactors over compatibility bridges.
- Mutating runtime routes require bearer auth.

## Service vs Target Repo

- This repository is the service runtime (`apps/runtime`, `apps/menubar`, `packages/contracts`).
- One runtime process per target project; the menubar is the sole orchestrator (add/select/start/stop project in Settings).
- Workflow state lives in each project’s `.steward/state.db`. Menubar discovers running runtimes via a global registry and connects to the selected project’s endpoint. Project root is passed at runtime spawn time (not via `.env`).

## Minimal Setup

Prerequisites:

- Node.js 22 or newer.
- Corepack enabled so the repo uses the pinned pnpm version.
- A supported agent CLI for runtime LLM work:
  - Cursor Agent CLI: available as `agent` on `PATH` and used by default.
  - Codex CLI: available as `codex` on `PATH`; set `CTO_LLM_PROVIDER=codex_cli`.
  - Claude Code CLI: available as `claude` on `PATH`; set `CTO_LLM_PROVIDER=claude_code_cli`.

`antigravity_cli` is recognized in provider preferences, but automated runtime execution is intentionally unsupported until a stable non-interactive CLI mode exists.

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
pnpm doctor
pnpm dev
```

`pnpm dev` starts the menubar only; add a project with the folder picker, start it from Settings, and initialize project config through the app. Project selection is in the UI only; do not set project root in `.env`. Optional: copy `.env.example` to `.env` to override runtime/agent settings. Persistent project state lives in `.steward/state.db`; temporary agent artifacts live under `.steward/tmp/runs/<requestId>/`.

`pnpm-workspace.yaml` explicitly approves native build scripts for `better-sqlite3`, `electron`, and `esbuild`. If pnpm reports ignored builds after install, run `pnpm ignored-builds`; every required package should already be listed under `allowBuilds`.

## Minimal Command Surface

- `pnpm dev` - primary local entrypoint.
- `pnpm doctor` - setup validation.
- `pnpm verify:ci` - public CI gate (`verify:fast`).
- `pnpm verify` - deterministic local gate (lockfiles -> format -> lint -> unused -> build -> test -> smoke).
- `pnpm verify:provider` - opt-in provider-backed gate that can invoke real agent CLIs and model calls.

## Project Docs

- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Agent Workflow Helpers

This repo intentionally includes `.cursor/commands/` and `.agents/skills/` as public maintainer workflow helpers. They are not required to run the app, but they should stay aligned with the actual scripts, verification flow, and project constraints.

## Product Ideas

These are active backlog signals, not committed roadmap promises:

- Let users choose which finding categories are enabled and which ones can be auto-implemented.
- Support multiple rule sources for category generation and make rule source selection explicit.
- Allow provider/model choice by stage: finding detection, option generation/planning, and implementation.
- Show agent transcripts in the UI with the reason for each change and the specific rules/project context the agent followed.
- Keep human gates where product or business direction is ambiguous, while allowing higher-autonomy flows for obvious fixes.
- Track current project goals, focus, and the main limiting factor blocking progress.
- Make "implemented" defensible with visible evidence such as tests, typecheck, smoke checks, and changed files.
- Add configurable autonomy levels for detection sensitivity, option count, rule-capture strictness, and auto-implementation behavior.
- Support undo/revert for automatically implemented changes, especially when verification fails.
- Keep the inbox high-signal by summarizing the problem, options, and expected change in a few bullets.
- Control generated project context and rules from the app instead of only ingesting existing repo docs.
- Revisit hosted execution later only if the security, privacy, and operations tradeoffs become worth it.
- Explore how reusable agent skills can improve implementation quality and user guidance.

Open product questions:

- What should the default auto-implement behavior be, and where must hard human gates remain?
- What minimum evidence should mark work as truly done?
- How should findings be prioritized as inbox volume grows?
- How much transcript and decision transparency do users need to approve changes confidently?
- When does hosted execution justify the added security, privacy, and operational complexity?

## Codebase Principles

- Keep full-stack TypeScript strict across frontend, backend, and shared contracts.
- Prefer realistic integration and e2e coverage for crucial paths over mock-heavy tests.
- Make logs and errors operationally useful: clear start/completion/failure signals, stable identifiers, and enough context for humans and agents to diagnose issues.
- Keep coupling low, dependencies few, and abstractions local until multiple real call sites need the same behavior.
- Avoid optional mode flags that make flows hard to reason about; prefer explicit functions and direct composition.
- Group code by domain, not by generic file type.
- Keep project context and agent rules current so AI contributors inherit the same product constraints as humans.
- Delete dead code and stale compatibility paths quickly.
- Keep scripts easy to run and reproducible so agents and humans use the same validation flow.
- Standardize error contracts across the stack.
- Design writes to be idempotent by default.
- Keep magic strings, status values, and shared constants in one source of truth.
- Maintain strict state boundaries between server data, persisted workflow state, and client-only UI state.
- Use explicit state machines instead of boolean combinations that can represent impossible states.
- Prefer semantic names and predictable sibling file naming over clever short names.
- Add comments for business rules, constraints, and non-obvious side effects that code structure alone cannot explain.
- Prefer convention over custom wiring where predictable structure reduces context loading.
- Avoid over-engineering edge cases early; favor simple happy paths, fail-fast behavior, and clear retry/restart flows.

## Autonomous / Agent Scripts

- `pnpm verify:ci` - canonical GitHub Actions gate (lockfiles -> format -> lint -> unused -> build -> test).
- `pnpm verify` - deterministic local gate (lockfiles -> format -> lint -> unused -> build -> test -> smoke).
- `pnpm verify:fast` - lockfiles + format + lint + check:unused + turbo build/test (no e2e).
- `pnpm verify:changed` - lockfiles + format + lint + check:unused + turbo `--affected` build/test (fallback to `verify:fast` if git base is unavailable).
- `pnpm verify:provider` - opt-in provider-backed gate; can call real agent CLIs and model providers.
- `pnpm build` - turbo workspace build graph.
- `pnpm test` - turbo workspace test graph.
- `pnpm e2e` - deterministic runtime smoke graph.
- `pnpm e2e:provider` - opt-in provider-backed e2e scenarios.
- **Running a single runtime test:** from `apps/runtime` pass the **path**: `pnpm test -- src/core/env.test.ts`. Substring args (e.g. `env.test`) are unreliable and may run the full suite. Canonical rule: AGENTS.md § Running runtime tests.
- `pnpm smoke` - deterministic isolated smoke for runtime state DB setup.
- `pnpm reset-runtime` - stop all runtime processes and clear app-data runtime (registry, per-project pid/token).
- `pnpm agent:probe` - probe agent CLI behavior and emit report artifacts.

Default loop for agents: `pnpm verify:changed`. Fallback to `pnpm verify` before merge. Run `pnpm verify:provider` only when validating real provider behavior.

## Canonical Runtime Artifacts

- **Global:** `~/.steward/registry.json` – running runtime entries (projectKey, endpoint, pid). Menubar reads this to list/connect to projects.
- **Per-project:** `~/.steward/projects/<projectKey>/` – `pid`, `http-token`, `endpoint.json`, `runtime.json` for that project’s runtime.
- **Target project:** `.steward/state.db` for persistent state and `.steward/tmp/runs/<requestId>/` for temporary agent artifacts.
- Logs default to `~/.steward/logs` (dev launcher may use repo `logs/`).
