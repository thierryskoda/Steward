# Architecture

`steward` is a local-first desktop/runtime system for codebase health workflows.

## Modules

- `apps/menubar`: Electron app for project selection, settings, inbox, and item review.
- `apps/runtime`: local runtime process that scans a selected target repo, stores workflow state, runs agents, and exposes a local HTTP API.
- `packages/contracts`: shared route constants and Zod schemas used by the runtime and menubar.

## Runtime Model

The menubar starts one runtime process per selected target project. The runtime writes persistent workflow state to the target repo at `.steward/state.db`. Temporary agent files belong under `.steward/tmp/runs/<requestId>/`.

Global runtime connection data lives outside the repo under `~/.steward/`, including registry entries, per-project endpoints, HTTP tokens, and logs.

### Service Repository vs. Target Projects

This repository contains the Steward service: the menubar app, runtime, and shared contracts. It is separate from the target repositories Steward analyzes.

The menubar is the sole runtime orchestrator. It adds, selects, starts, and stops projects through the app. Project roots are passed to runtimes when they start; they are not configured through `.env`.

### Runtime Artifacts

- **Global registry:** `~/.steward/registry.json` records running runtimes so the menubar can discover them.
- **Per-project connection data:** `~/.steward/projects/<projectKey>/` contains the runtime PID, HTTP token, endpoint, and runtime metadata.
- **Target-project state:** `.steward/state.db` is the persistent workflow source of truth for that project.
- **Temporary agent files:** `.steward/tmp/runs/<requestId>/` contains run-scoped scratch files and is cleaned by the runtime.
- **Logs:** `~/.steward/logs` is the default location; the development launcher can use this repository's `logs/` directory instead.

## Workflow

The main finding workflow is:

1. Detect a finding.
2. Generate solution options.
3. Wait for human approval.
4. Claim and run an implementation agent.
5. Mark the item implemented or failed.

Rules and continual-learning flows share the same local-first constraints and use the runtime's SQLite-backed state as the source of truth.

The next-commitment workflow is separate and manual:

1. The user starts a review for the selected project.
2. The runtime records a queued run in that project's SQLite database, finds recent tasks associated with the exact project root, and creates bounded immutable snapshots containing only user/assistant messages from exact-project turns.
3. Codex runs ephemerally with automatic project instructions, user config, plugins, apps, web access, both shell implementations, and inherited nonessential environment variables disabled. The prompt provides logical locators rather than injecting project files or conversations.
4. A Steward-owned MCP broker eagerly loads only the sanitized snapshot, exposes bounded read/list/search tools keyed by repository-relative paths or task ids, and records successful content reads. The agent can inspect at most four task snapshots and forty project evidence locators, including repository state.
5. Steward requires the reported project-file, repository-state, and task inspection lists to exactly match the broker's actual-read audit before persistence. Listing recent task metadata is a selection step, not task-content inspection; a manifest citation is still accepted only when that listing succeeded.
6. Steward persists one recommendation, an explicit no-recommendation result, or a blocked result. It supersedes the review if the project changes while the agent is working or after completion but before Codex handoff.
7. For a persisted recommendation, **Start in Codex** revalidates the selected project, exact run, and captured Git snapshot, then the Electron host creates, names, and submits one persisted Codex Desktop task through the local app-server protocol. It waits for the review turn and requires a non-empty `final_answer` agent message before opening the task. Restart reconciliation performs a bounded search for the submission id stored as the first message's client id, preventing duplicate tasks. That review uses the signed-in Desktop ChatGPT account and must report the exact selected project as its only runtime workspace root. The exact root is marked untrusted for executable Codex configuration and its permission profile denies root filesystem access; automatic project-doc injection, local environments, both shell implementations, effective MCP servers, network access, host notification and telemetry channels, skills, subagents, external web search, and progress commentary are disabled. The task reviews only the recommendation agent's bounded, provenance-checked evidence packet and produces one concise decision instead of reopening host files or starting another agent workflow.

Next-commitment results and their Codex review tasks are advisory. They do not enter the implementation workflow or authorize code changes; implementation requires a separate explicitly approved workflow.

## Agent Providers

The runtime currently supports:

- `cursor_cli`: default provider, uses the Cursor Agent CLI command `agent`.
- `codex_cli`: optional provider, uses the Codex CLI command `codex`.
- `claude_code_cli`: optional provider, uses the Claude Code CLI command `claude`.

The provider id `antigravity_cli` is accepted in preferences and env parsing, but it is not exposed as a selectable runtime provider. Automated runtime execution fails fast with a clear unsupported-provider error until Antigravity exposes a stable non-interactive CLI mode.

Provider selection is controlled by `CTO_LLM_PROVIDER`; the menubar also stores per-project provider preferences.

## Boundaries

- `apps/runtime/src/main.ts` is the runtime composition root.
- Runtime core code must not import feature modules.
- Feature behavior is injected from the composition root.
- Import concrete source files; do not add feature barrel `index.ts` files.
