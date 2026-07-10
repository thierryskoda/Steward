# Contributing

Thanks for helping improve `steward`.

## Setup

Use the pinned toolchain from `package.json`:

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
pnpm doctor
```

Start the app with:

```bash
pnpm dev
```

## Before Opening A PR

Run the public gate:

```bash
pnpm verify:ci
```

For runtime or agent-flow changes, also run the relevant focused script or test. Run the deterministic local gate before merge:

```bash
pnpm verify
```

Provider-backed checks are opt-in because they can invoke real agent CLIs and model calls:

```bash
pnpm verify:provider
```

### Validation Commands

- `pnpm verify:changed` — preferred development loop; verifies affected workspaces and falls back to the fast gate when no Git base is available.
- `pnpm verify:ci` — canonical public GitHub Actions gate.
- `pnpm verify` — complete deterministic local gate, including smoke checks.
- `pnpm verify:provider` — opt-in checks that can invoke real agent CLIs and model providers.
- `pnpm build` — build the workspace graph.
- `pnpm test` — run the workspace test graph.
- `pnpm e2e` — run deterministic runtime end-to-end scenarios.
- `pnpm e2e:provider` — run opt-in provider-backed end-to-end scenarios.
- `pnpm smoke` — validate runtime state-database setup in isolation.

To run one runtime test, pass its path from `apps/runtime`:

```bash
pnpm test -- src/core/env.test.ts
```

Substring arguments such as `env.test` are unreliable and can run the full suite.

## Project Rules

- Read `AGENTS.md` before larger changes; it is the detailed project contract.
- Keep data handling local-first. Do not add cloud-only storage or processing by default.
- Preserve the human approval gate before implementation side effects.
- Do not commit `.env`, `.steward/`, logs, generated build output, or local app data.
- Prefer simple current behavior over speculative compatibility layers.

## Agent Workflow Helpers

The repository includes `.cursor/commands/` and `.agents/skills/` for maintainers working with coding agents. They are not needed to run Steward, but changes to them must stay aligned with the actual scripts, verification flow, and project constraints.

## Pull Requests

Keep PRs focused. Include:

- What changed and why.
- How you verified it.
- Any setup, provider, or migration notes.

If a change touches user-facing behavior, update the relevant README or docs in the same PR.
