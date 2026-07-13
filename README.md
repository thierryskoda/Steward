# Steward

Steward is a local-first AI maintenance companion for codebases built with AI. It continuously looks for places where a project has drifted from your engineering practices, turns them into clear findings, and helps an AI agent fix them.

## Why Steward Exists

I built Steward because I was working on many projects with AI and kept accumulating the same kind of technical debt. Coding agents could build quickly, but they would forget practices I cared about, miss cleanup work, or make a locally reasonable change that did not fit the rest of the codebase.

Remembering every rule in every prompt does not scale. Neither does repeatedly auditing every project by hand.

Steward makes that maintenance continuous. It uses the rules and context already in a project to find issues such as dead code, inconsistent architecture, missing safeguards, weak tests, or outdated documentation. It then presents the problem and possible fixes for review. When the direction is clear or you approve an option, an agent can implement the change and keep the workflow moving.

The goal is simple: **let AI help maintain the quality of AI-built software, not just add more code to it.**

## How It Works

1. **Connect a project.** Add a repository from the desktop menubar app.
2. **Give Steward its sources of truth.** Point it at project rules such as `AGENTS.md` and the files that explain the product or architecture.
3. **Let it monitor the codebase.** A local runtime watches project activity and scans for improvements in code quality, security, architecture, testing, and documentation.
4. **Review focused findings.** Steward explains what is wrong, why it matters, and the meaningful implementation options.
5. **Approve the direction.** You keep control when a fix involves a product, architecture, or risk tradeoff.
6. **Let an agent implement it.** Steward runs the selected coding agent, tracks the result, and supports reverting an implemented finding.

Optional rules and continual-learning workflows can also capture durable guidance from your agent conversations and rejected findings, so the project gets better at preserving the practices that matter to you.

## Product Principles

- **Local-first:** project workflow state stays in the target repository at `.steward/state.db`.
- **Human-directed:** ambiguous or consequential changes require human approval before implementation.
- **Project-aware:** findings and fixes use the repository's own rules and product context.
- **Continuous:** maintenance happens alongside development instead of waiting for a large cleanup phase.
- **Practical:** Steward favors focused fixes and direct refactors over speculative abstractions or legacy compatibility layers.

## Current Status

Steward is in active development and currently runs from source. The desktop app manages one local runtime per project and supports Cursor Agent, Codex CLI, and Claude Code as agent providers.

## Quick Start

### Prerequisites

- Node.js 22 or newer
- [pnpm 11 or newer](https://pnpm.io/installation)
- At least one supported agent CLI on your `PATH`:
  - [Cursor Agent CLI](https://docs.cursor.com/en/cli/overview) as `agent` (default)
  - [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) as `codex`
  - [Claude Code](https://code.claude.com/docs/en/overview) as `claude`

### Run Steward

```bash
pnpm install
pnpm doctor
pnpm dev
```

When the app opens:

1. Add a project folder.
2. Choose the rule sources and project-context paths Steward should follow.
3. Select an approval mode and agent CLI.
4. Start the project runtime and review findings in the app.

An `.env` file is not required for normal use. Copy `.env.example` to `.env` only when you need to override runtime or agent settings. Project selection and configuration happen in the app.

## Main Commands

| Command               | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `pnpm dev`            | Build and start the desktop app                         |
| `pnpm doctor`         | Validate the local setup                                |
| `pnpm verify:changed` | Check the workspaces affected by the current changes    |
| `pnpm verify:ci`      | Run the public CI gate                                  |
| `pnpm verify`         | Run the complete deterministic local verification suite |

See [CONTRIBUTING.md](CONTRIBUTING.md) for focused tests, provider-backed checks, and the contributor workflow.

## Repository Structure

- `apps/menubar` — Electron desktop app for projects, settings, findings, and rules.
- `apps/runtime` — local codebase monitor, workflow engine, agent runner, and HTTP API.
- `packages/contracts` — shared API routes and validated data contracts.
- `docs` — architecture notes and product planning that do not belong in the project introduction.

For the process model, state locations, and module boundaries, see [docs/architecture.md](docs/architecture.md).

## Documentation

- [Architecture](docs/architecture.md) — how the desktop app, runtimes, workflows, and local state fit together.
- [Product ideas](docs/product-ideas.md) — active ideas and open questions, not roadmap commitments.
- [Contributing](CONTRIBUTING.md) — setup, verification, and pull-request guidance.
- [Project contract](AGENTS.md) — detailed product constraints and engineering rules for humans and agents.
- [Security](SECURITY.md) — supported versions and vulnerability reporting.
