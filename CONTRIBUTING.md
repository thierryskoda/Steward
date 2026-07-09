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

## Project Rules

- Read `AGENTS.md` before larger changes; it is the detailed project contract.
- Keep data handling local-first. Do not add cloud-only storage or processing by default.
- Preserve the human approval gate before implementation side effects.
- Do not commit `.env`, `.steward/`, logs, generated build output, or local app data.
- Prefer simple current behavior over speculative compatibility layers.

## Pull Requests

Keep PRs focused. Include:

- What changed and why.
- How you verified it.
- Any setup, provider, or migration notes.

If a change touches user-facing behavior, update the relevant README or docs in the same PR.
