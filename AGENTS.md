# AGENTS.md

This file is for LLM context that is **not reliably inferable from code alone**.
Use it as a decision contract before proposing architecture, workflow, or product changes.

## Scope Of This Guide

- Prefer codebase truth for implementation details.
- Use this file for product boundaries, architecture invariants, and operational risk checks.
- If code and this file conflict, raise the conflict explicitly instead of guessing.

## Product Constraints (Non-Negotiable)

- Human approval is required before implementation of findings where the fix solution isn't obvious. For example, we require the human approval when we could do 2 very different fixes for a problem and the direction depends on where the business wants to go. Sometimes we might already have the answer in the project context but if not we must ask the human to know the answer. Exception: the continual-learning feature may auto-update only the section **Learned Project Context** in this file (no approval required for those edits).
- Data handling is local-first; workflow state persists in target repo `.steward/`.
- Temporary agent artifacts (scratchpads, logs, intermediate state) MUST be written only to the run-scoped directory provided by the runtime (`.steward/tmp/runs/<requestId>/`). The runtime creates it before each agent run, passes the path via prompt and env `CTO_AGENT_TMP_DIR`, and removes it when the run finishes. Stale run dirs (e.g. after crash) are removed at startup by TTL cleanup (24h). If running outside the runtime (e.g. ad-hoc chat), use `.steward/tmp/` and clean up manually or rely on TTL.
- Fully autonomous code changes are out of scope.
- Cloud-only storage/processing is out of scope by default.
- We want to avoid backward compatibility and legacy stuff as much as possible.
- We strongly prefer simple, directly useful implementations over speculative architecture. Do not add categories, states, options, columns, persisted fields, tables, indexes, abstractions, or workflows for hypothetical future use. If the current behavior does not read or act on a piece of data, do not persist it.
- Stale persisted shape is product debt. When a feature changes or a data field stops being used, remove the obsolete schema/data path in the same change instead of leaving legacy DB/.steward fields, compatibility readers, or unused migration branches behind.
- During early product build, prefer happy-path-first implementations: handle essential edge cases only, avoid exhaustive edge-case branching, and favor fail-fast plus clear restart/retry flows when state is invalid or partially configured.

## Architecture Invariants

- `apps/runtime/src/main.ts` is the only composition root; it delegates to `apps/runtime/src/lifecycle` (runtime-bootstrap, fatal-handler, http-lifecycle, event-sources-lifecycle, activation-lifecycle). No other module performs app-level wiring.
- Keep dependency direction one-way: orchestration imports features; features do not import orchestration internals.
- `apps/runtime/src/core` must not import `apps/runtime/src/features`; feature behavior is injected from `main.ts`.
- Import concrete files; do not reintroduce feature barrel `index.ts` files.

## Coding Standards

### Architecture & Boundaries

- When two or more consumers share most of the same goal (e.g. “get notified of new transcript content”), centralize the logic into one pipeline and have them consume from it. Do not let each consumer implement its own discovery, reading, or subscription path for that same goal—it duplicates behavior and makes scaling and consistency harder. Example: rules (rule-capture) and continual-learning both needed to react to new chat transcripts; we use one transcript ingestion service and one checkpoint model, with rules as a message subscriber and continual-learning using the same stream state for idle detection.
- Keep feature boundaries explicit; avoid deep cross-feature imports and imports that jump across unrelated feature folders. Same dependency direction as Architecture Invariants. Import from concrete source files, not indirection layers or barrel files.
- Prefer module-level or singleton access for app-wide concerns (logging, env, primitives). In tests, set env or replace the logger in setup instead of passing them as arguments.
- Inject only what genuinely varies per composition (e.g. which store or workflow implementation the composition root wires). Do not inject primitives or built-ins unless there is a concrete need (replay, isolation, custom behavior).
- When something is injected only so tests can override it, prefer making it a global/singleton and controlling it in test-setup instead; avoid deps that only forward a single concern already available at module level.
- Keep DI at boundaries: each consumer gets only the deps it uses (small interface or Pick). Do not use or grow a single shared deps type that aggregates many unrelated deps across the app or a layer.
- New consumer → give it a minimal deps type; do not add fields to a shared deps type for each new consumer.
- Remove injected parameters that are unused or that every caller supplies identically from the same source.
- Fail fast at the root. If a composition root lacks a required dependency or environment variable, crash the app immediately on startup. Do not wait for a runtime null-pointer error deep in a workflow.
- Define lifecycle scopes strictly. Explicitly separate singletons from request-scoped dependencies. Sharing a database connection pool is good. Accidentally sharing a user-specific session service across a Node server leaks data between users.

### Abstractions & Function Design

- Keep abstractions local by default: if logic has only one call site, keep it inline or in the same file near that call site. Do not generalize flows unless multiple real call sites need identical behavior.
- Avoid indirection layers that hide execution without reducing complexity. Keep orchestration linear: main execution flow should be readable top-to-bottom without jumping through helper chains.
- Avoid helper layers with a single call site and no reuse value; avoid generic utility extraction that increases branching or flags; avoid abstractions that remove domain intent from call sites. Keep startup/bootstrap flows as small named helpers; avoid deep nesting there.
- Keep function contracts minimal and explicit; use module-level globals (e.g. env, logger) for app-wide concerns instead of threading them through every call.
- Prefer explicit error paths or caller-provided values; do not invent defaults inside a function to make it "work". For failure semantics (no fallback values hiding errors), see Error Handling & Observability below.
- Avoid optional behavior flags that switch modes inside one function (e.g. `force?`, `mode?`, `regenerate?`); prefer separate, named functions per behavior path.
- Remove stale/unused parameters unless required by framework signatures; prefix intentionally unused args with `_` (e.g. Express handlers).
- Prefer guard clauses and shallow control flow; avoid if/else depth that hides execution intent in core orchestration paths.
- For runtime-control arguments (e.g., mode, sandbox, resume ids), prefer required `value | undefined` over optional `?` so callers must choose explicitly. If every call site passes a concrete value for a parameter, make that parameter required; do not leave it optional or `T | undefined`.
- Avoid broad argument objects; prefer minimal parameter sets. At composition boundaries, no single "deps" object that carries many unrelated concerns—each callee declares only what it uses.
- Remove unreachable, unused, or stale code paths in the same refactor/change that makes them obsolete; remove unused exports, symbols, and orphan modules.
- Do not preserve legacy branches when no caller uses them; remove compatibility branches retained after migrations. Remove obsolete exports, files, scripts, and queue item shapes.
- Remove dead mode switches where callers always pass a fixed mode (or where all launch paths pass one fixed value). Avoid test-only conditional behavior embedded in production code.

### Type Safety & Data Contracts

- Do not unnecessarily add `try`/`catch`.
- Never use `any`; use inference, explicit types, or `unknown` for untrusted input.
- Prefer `type` aliases (prefixed with `I`) for object shapes, unions, and intersections. Prefer explicit types at function boundaries; use inference for simple local values.
- Never manually type callback parameters (e.g., in `.map`, `.filter`, `.forEach`) when TypeScript can infer them from the source collection. Manual typing in these contexts is a bug as it can mask `null`/`undefined` values and create "type lies." Add explicit callback parameter types only when logic is non-trivial, generic, or reused and inference fails.
- Prefer `Pick<IType, "prop1" | "prop2">[]` over inline object arrays.
- Always prefer `StrictOmit` over `Omit` for better type safety. Import `StrictOmit` from `@/core/general.types`. Example: `type IUserInput = StrictOmit<IUser, "id" | "created_at">;`
- Always add explicit return types on every function; do not rely on inference for return types. Add explicit parameter types on exported/public functions for local, immediate failures.
- Always import and reuse existing types from source modules; never duplicate existing unions, variants, or prop types. Use `Pick` to declare exactly which fields a consumer depends on. Prefer composing from existing types (`Pick`, intersections, unions) over redefining overlapping object shapes.
- Always validate external JSON with Zod; never `JSON.parse(raw) as T`. Prefer `safeParse` for uncertain or external shapes; handle the result explicitly (log, skip, or fail). Use `parse` only when the shape is trusted/stable and fail-fast is desired. Define schemas in adjacent `.schemas.ts` files. Use `z.infer<typeof schema>` when schema is source of truth.
- For data we cannot get types from (third-party APIs, file formats, logs, vendor payloads): still aim for typed data; avoid leaving it as `unknown`. Workflow: (1) Inspect the data—log what we receive or open example files/payloads to see real structure. (2) Define our own Zod schema from that evidence (e.g. in adjacent `.schemas.ts`). (3) Use `safeParse` (not `parse`) so invalid input does not throw. (4) On failure: log the error (e.g. `result.error.flatten()`) and skip or fail the item; use logs to adapt the schema when the source shape changes. (5) Use the parsed result so the rest of the code sees typed data. Prefer `safeParse` + explicit handling and logging over `parse` when we are not 100% sure of the external shape.
- Use branded types for IDs and other domain primitives that share base types; brand from existing domain fields (e.g., `IRequest["id"]`) to avoid drift.
- Use `.types.ts` re-export files for shared third-party types. Prefix re-exported third-party types consistently (e.g., `IDaytona...`). Re-export only types currently used.
- Avoid `as` assertions by default; `as const` is allowed. Never use `as never`. Prefer type guards (`value is T`) and assertion functions (`asserts value is T`) for runtime narrowing; e.g. `function assertIsString(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error("Expected string"); }`. Do not cast just to access known properties; fix the type instead. Controlled `as` assertions are acceptable at validated boundaries.
- Do not add null/undefined checks for values that types guarantee as non-null; add null/undefined checks only when the type allows it.
- Prefer object params for function arguments. Derive values from passed objects; do not pass both object and fields from that object. Prefer minimal parameter sets with explicit `Pick<T, K>` dependencies. Prefer passing minimal subsets over full objects; pass full objects only when it improves clarity. For when to use optional vs required and `value | undefined`, see Abstractions & Function Design.
- Define boundary/view types with `Pick<DomainType, ...>` near the consumer. Keep domain types in domain modules; keep consumer-specific view types with the consumer. Use adapters when mapping requires logic or multiple source types.
- Avoid enums; use string literals instead. Use `as const` to preserve literals. Use discriminated unions for complex state. Use exhaustive checking with `never` assignment (e.g., `const _exhaustive: never = value`) to ensure all union members are handled in switch/if-else blocks. Use generics with meaningful type parameters and constraints.
- Use conditional types for type-level logic; prefer simple cases over deeply nested conditions. Use mapped types to transform object shapes. Use template literal types for string-based patterns when they add clarity. Use `infer` in conditional types to extract types. Prefer built-in utility types over custom equivalents when they suffice.
- Use `satisfies` for config objects and literal maps when you need both type checking and preserved narrowing (e.g. `const config = { api: "https://api", timeout: 5000 } satisfies Record<string, string | number>;`). Avoid `satisfies` when simple type annotation or inference is enough.
- Add type tests (e.g., Vitest `expectTypeOf`, tsd) for complex exported generic utilities, API contracts, and type-level helpers. Keep tests minimal; focus on contract boundaries likely to regress.
- Avoid deeply nested conditional types; prefer simpler alternatives or limit recursion depth. Avoid complex mapped/conditional types in hot paths. If TS reports excessive stack depth or slow compilation, simplify recursive types or split into smaller units. Rare exception: in known TS performance hotspots, `interface extends` may reduce intersection instantiation cost.
- Enable `strict: true`; treat it as non-negotiable. For stricter type safety, evaluate and adopt `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, and `noPropertyAccessFromIndexSignature` incrementally. Use `skipLibCheck: true` only when type-checking performance is critical. Prefer project scripts (`npm run typecheck`, `yarn tsc --noEmit`) over raw `tsc` in docs and CI. Use one-shot checks (no watch) for CI and automated validation. Run `npm run build` (or equivalent) to validate that types and build pipeline align.
- Align import style and path aliases with existing `baseUrl` and `paths` in tsconfig. Remember TypeScript path mappings are compile-time only; runtime must resolve paths separately.
- Do not use `z.coerce.boolean()` for environment variables. Parse env booleans with explicit string mapping (e.g., `"true"/"1" => true`, `"false"/"0"/"" => false`). Set defaults after explicit parsing so `.env` values like `false` are respected.
- Strict Zod parsing (applies whether using `parse` or `safeParse`): do not use schema-level `.catch(...)` to recover invalid values. Prefer strict parse failures over fallback/default normalization. Use `.default()` only for truly optional missing fields (`undefined`), not invalid provided values. Do not keep backward-compatibility parsing branches in this project unless explicitly requested for a one-off migration.

### Error Handling & Observability

- Keep error contracts consistent across similar operations; avoid inconsistent status codes or messages for equivalent failures.
- Do not swallow failures silently; do not use catch blocks that return fallback values with no signal/log, or fallback/default branches that hide failures from callers; avoid `||`/`??` fallback defaults on critical operational paths.
- Prefer catching at boundaries or integration points; avoid try/catch in the middle of pure logic unless adding context.
- Catch-and-rethrow with domain context is good when wrapping third-party calls—rethrow a clear domain error that includes or wraps the original. Do not rewrap if the third-party already exposes a clear, reliable error contract that we can map directly.
- Convert low-level errors into clear domain/HTTP errors at boundaries. Preserve useful error context while avoiding noisy duplication.
- Keep API client error parsing centralized for read and write operations; avoid endpoint-specific ad-hoc error mapping when shared mapping exists. Avoid endpoint-specific duplicate 401/error mapping logic.
- Prefer explicit failure over implicit fallback behavior. Do not return default/fallback values for operational errors unless explicitly documented as product behavior.
- On unexpected state, fail loudly via early return with clear error, thrown error, or propagated domain error.
- Remove stale bridge APIs and unused public exports that keep dead error paths alive.
- Emit structured logs for operationally meaningful transitions and failures; when errors are caught or logged, always emit telemetry—do not handle failures with no structured log.
- Include stable identifiers (item id, request id, actor, feature) in logs; ensure logs have enough context to correlate incidents.
- Keep failure logs actionable: include what failed, where it failed, and the immediate next diagnostic step.
- Emit start/completion/failure signals for async and background workflows.

**Runtime error and log standards (apps/runtime):** At IO/schema/runtime boundaries, throw the app’s structured error type with a human message, a machine-searchable code, and a flat context object (e.g. filePath, reason, issues). Use the native `cause` option to attach the underlying error; do not invent a custom cause field. When logging errors, use the central error logger so every error produces one flat log line with code, message, context, and cause chain—do not log with ad-hoc `errorMessage` or raw `err` only. Put enough in context to diagnose without opening code (e.g. expected vs actual, formatted validation issues, safe config snapshot). Format validation output (e.g. Zod) into short `path: message` strings before adding to context; do not dump raw validation objects into logs. Do not add a dedicated helper function per error kind; throw inline with message + code + context. Redact or truncate context in the logging layer, not at throw sites.

### State, Idempotency & Workflow Safety

- Model state with explicit status values and allowed transitions; enforce transition guards at write points and avoid boolean combinations that represent impossible states.
- Avoid multiple booleans that encode one hidden state machine.
- Persist only state that is required to resume, audit, or drive current product behavior. Derived values, UI-only groupings, speculative categories, and "might be useful later" fields should stay out of durable storage.
- Keep server/runtime/client state boundaries clear; avoid mixed ownership where one state is mutated by unrelated layers.
- Write/side-effect operations must be retry-safe by default; if an operation cannot be idempotent, document why and add explicit duplicate-execution guards.
- Prevent duplicate execution for queue/event driven workflows; use idempotency keys for externally retried operations.
- Use stable dedupe keys or state transitions to guard repeated work; avoid non-atomic state transitions that allow double processing.

### Client state: React Query vs Zustand

- Treat React Query as async state management for server/host/backend data, not just a fetch helper. Never sync query data into local/store state.
- Prefer React Query (TanStack Query) for all server/host/backend data (IPC, API, persisted prefs). Single source of truth; derive UI state from query data. Do not copy the same data into a Zustand store.
- Use Zustand (or React local state) only for client-only state: UI toggles, local form state, active tab, transient UI choices. No mirroring of server/host data.
- Do not keep the same piece of data in both React Query and Zustand. Avoid `useEffect` that syncs query result into a store; derive state from the query in render instead.
- When selection or list data comes from the host (e.g. selected project, project list), use the query as the only source; shell state and guards derive from that. Accept refetch delay after mutations instead of optimistic store updates for that data.
- Use array query keys only, with hierarchical key factories (generic -> specific), so invalidation is precise and predictable.
- Prefer rendering stale-but-valid data over hard error replacement during background refetches; check data first, then error/loading for UX continuity.
- Keep custom query/mutation hooks data-focused and side-effect-light. Put UI side effects (toasts, redirects, modal close) in caller-level callbacks.
- For TypeScript, type fetcher boundaries (return promises) and rely on React Query inference in hooks/components; avoid redundant generic noise.
- Prefer query invalidation over manual cache writes by default; use manual cache edits only when strictly needed for correctness/UX.
- Use `select` to subscribe to minimal derived slices and reduce unnecessary re-renders from large payloads.
- When a query is needed both for full data and for a derived value (e.g. count), expose two named hooks (e.g. `useInboxRulesQuery` and `useInboxRulesCountQuery`) that share the same query key; do not use overloaded function signatures.

### React (UI behavior & performance)

- Prefer derived values in render over mirrored state. Do not use `useEffect` just to sync one piece of state from another.
- Keep side effects at interaction/boundary points (event handlers, query/mutation callbacks, subscription setup/cleanup), not in broad reactive chains.
- Use functional state updates (`setState(prev => ...)`) whenever next state depends on previous state to avoid stale closures and dependency churn.
- Use `useRef` for mutable, non-visual values (timers, latest callback, transient measurements) that should not trigger re-renders.
- Initialize expensive state lazily (`useState(() => initialValue)`) so cost is paid on mount only.
- Keep hook dependencies primitive/stable. Depend on `user.id` or memoized selectors, not whole object literals recreated every render.
- Use `useTransition` (and debounce/throttle where appropriate) for non-urgent heavy updates so typing/clicking stays responsive.
- Run independent async work concurrently (`Promise.all`) and defer `await` until the branch that actually requires the result.
- Prefer immutable array operations in state updates (`toSorted`, `toSpliced`, spreads); never mutate arrays/objects held in React state.
- Use explicit conditionals in JSX (`condition ? <View /> : null`) and avoid truthy-number rendering pitfalls.
- Favor direct imports over barrels in React/UI code paths to reduce unnecessary module loading and parse work.
- Do not add `useMemo`/`useCallback` by default; add them only when profiling shows a real re-render or compute hotspot.
- For frequently queried collections in hot render paths, pre-index once (`Map`/`Set`) and avoid repeated linear lookups.
- Optimize for clarity first; apply micro-optimizations only when they target measured bottlenecks.

### Testing

- You can implement integration/e2e tests for critical behavior paths. Prefer using real values and dependencies over mocks. It is okay to create some data/files and at the end delete them so that the tests are more realistic. If it is easier, you can even create some script files and run them. Integration/e2e tests can be long, we do not mind waiting for them if they truly test the right behavior using realistic scenarios.
- Ensure high-risk failure paths are tested.
- Avoid mock-heavy tests that assert implementation details over behavior; avoid tests that only verify mocks/calls with no user-visible behavior.
- Keep tests aligned with production data flow and wiring; avoid tests that rely on test-only production code branches.
- Use mocks only when isolation is necessary.
- Prioritize tests by risk: cover core behavior paths and high-impact failure modes before edge-case permutations.
- Do not test obvious behavior; in a TypeScript codebase, typecheck passing and correct types at boundaries often suffice—no extra tests needed for trivial or type-verified code.
- Prefer verbose describe and it strings that state what is tested and why, so intent is clear and redundant or useless tests are easy to spot.
- Avoid duplicating the same assertion across many tests; prefer one test (or a small set) per behavior or contract so maintenance stays low.
- Use the smallest data/setup that still proves the behavior; avoid large datasets or long waits when a smaller case suffices.
- For prompts or generated text: assert that key inputs or modes affect the output (e.g. key inputs included, varies by level); avoid asserting exact wording or many regex matches on copy.
- When testing error or recovery paths, assert the observable outcome (e.g. bad lines skipped, state correct); avoid asserting exact log events or mock call order unless operationally required.
- Delete stale tests when behavior/contracts changed and the test no longer protects meaningful risk.
- When mocked data is required, derive it from existing TypeScript types or Zod schemas.

### Tooling, CI & Script Integrity

- Keep local and CI validation flows explicit and reproducible: document and script the exact commands used in CI so they can be run locally unchanged.
- Ensure scripts for build/test/typecheck/format exist and pass from a clean checkout.
- Avoid hidden/manual-only release or verification steps.
- Keep automation failures actionable: outputs must identify which step failed and the command needed to reproduce it.
- Use Prettier as formatting source of truth. Keep `.prettierrc` and `.prettierignore` maintained at project level.
- Use `eslint-config-prettier` to avoid ESLint/Prettier rule conflicts. Do not add ESLint rules that conflict with Prettier.
- Keep tool configs in sync with the codebase: ESLint, Prettier, Knip (`knip.json`), tsconfig (paths, includes, references), and similar. When workspaces, entry points, or source layout change, update the relevant config so tools stay accurate and avoid false positives or missed issues (e.g. knip reporting real code as unused because a workspace has no entry, or tsconfig excluding new dirs).
- Expose common operations as named scripts in `package.json` instead of undocumented ad-hoc command sequences. Each script (in package.json or under scripts/) must have a clear purpose description at the top of the file.
- Maintain one entry-point dev script (e.g. `scripts/dev.sh`) that starts the full stack with one command. Add `dev-clean.sh` (or equivalent) when reset steps are required.
- Ensure validation scripts in package manifests exist and work; avoid CI/local mismatch; ensure critical workflows have automated checks.
- Run one-shot checks (e.g. knip) in verify/CI so config drift is detected.

### Naming, Conventions & Readability

- Keep naming, file layout, and flow conventions predictable: new files should follow existing naming/location patterns unless a documented exception is added.
- Use established file naming patterns (e.g., `*.agent.ts`, `*-store.ts`, routes naming). Keep feature structure consistent so location implies behavior.
- Use explicit agent filenames by responsibility (`<action>.agent.ts`), not generic `agent.ts`; one agent file per responsibility—avoid packing multiple responsibilities into one agent file.
- Use consistent terminology for the same domain concept.
- Prefer semantically rich names over short/ambiguous names; avoid opaque names (`x`, `tmp`, `handler2`) in non-trivial logic.
- Add brief intent comments only for non-obvious flow, constraints, or side effects; add guiding intent comments for non-obvious orchestration; avoid verbose comments that restate obvious code.
- Keep orchestration flow readable (see Abstractions & Function Design for guard clauses and shallow control flow).
- Keep prompt text and agent instructions explicit, versionable, and easy to diff.
- When a file/script is uncommon or repeatedly misunderstood, add a short intent block at the top explaining what it does, why it exists, and when it should be used.

### Dependencies & Security

- Add dependencies only with explicit rationale (problem solved, alternatives considered, why existing deps are insufficient).
- Avoid duplicate libraries serving the same purpose.
- Keep dependency boundaries explicit; avoid leaking infra deps into domain layers; do not import tooling/build-only packages from feature or runtime code.
- Remove unused dependencies and stale wrappers.
- Prefer established libraries when they materially reduce risk or maintenance versus custom code. Avoid adding a library for trivial functionality we can implement safely in a few lines.
- Flag concrete security risks in code review (e.g., command injection, path traversal, auth bypass, secret exposure, unsafe deserialization).
- For each flagged risk, provide a specific remediation step and where to apply it.

### Documentation Freshness & Single Source Of Truth

- Keep shared constants, keys, enum-like literals, and status values in one source; do not duplicate status unions or constants across multiple features; avoid drift between declared canonical values and usage.
- Do not duplicate magic strings/numbers across modules; avoid repeated literals representing one domain concept. Reuse canonical domain symbols instead of redefining variants.
- Keep docs synchronized with behavior, ownership, and constraints; do not add docs that only restate obvious implementation details.
- Update context artifacts when behavior, constraints, or ownership changes; after major feature changes, update the relevant context docs in the same change.
- Avoid contradictory guidance across docs.

## Runtime layout and workflow baseline

- **Module ownership (apps/runtime/src):**
  - **core:** shared infra—env, status-store, logger, SQLite DB helpers (`core/db/*`), llm harness, git, sources (SQLite-backed checkpoints plus transcript ingestion), paths, state, bootstrap, runtime-log-events, lifecycle-types, activity-helpers, json-schema-file, runtime-cleanup, runtime-registry, agent-failure-reason, log-paths, app-data-permissions, types, debug, agent-tmp-dir, test-helpers.
  - **lifecycle:** bootstrap, fatal handling, HTTP server, event sources, activation—runtime-bootstrap, fatal-handler, http-lifecycle, event-sources-lifecycle, activation-lifecycle. Called only from main.ts.
  - **features:** domain behavior—config (DB-backed project config), categories/findings (SQLite-backed finding store/service, detection/generation agents, stale-context scan/revalidation, implementation worker/processor, option hints), rules (SQLite-backed proposals, transcript subscriber, rule capture, rule apply worker, rejected-finding learning processor), continual-learning (DB-backed index, timer runner), context (DB-backed generated snapshots, repo-scope config, rules/project-context builders), workflow (allowed transitions and workflow log events).
  - **http:** route mounts and middleware—app, server, routes (health, runtime status/shutdown, inbox, items, rules, findings, config), middleware (cors, request-timeout, request-id, request-log, readiness-gate, error-handler, auth), auth-token, api-response, validation-helpers.
- **Workflow (generic category):** detect finding → generate options → human approval → `approved` → `claimed` → `agent-running` → `implemented`/`failed`; rejection is `rejected` or `learning-from-rejection` when rules learning is enabled. SQLite status is the source of truth.
- **Per-project .steward paths:** persistent project state is `.steward/state.db` only. Temporary agent artifacts live under `.steward/tmp/runs/<requestId>/` only.
- **Menubar UI (`apps/menubar/src/ui`):** shell and feature views (`app-layout.tsx`, `finding-detail-view.tsx`, `toast/`, etc.); shared controls are concrete modules under `ui/primitives/` (e.g. `button.tsx`, `modal.tsx`, `badge-input.tsx`, `cn.ts`)—no barrel `index.ts`.

## Workflow Modeling Decisions

- SQLite rows are the source of truth for finding/rule status.
- Generic category items reuse one shared chat across finding -> plan -> implement via `workflowChatId`.
- Static built-in (`rule-capture`) and dynamic rule-based categories are intentionally different internally; this is expected.
- Categories listed under `rules/` today are a snapshot for this repo, but the deployed product regenerates them dynamically based on whatever rule set the target project ships.
- Rules/static guidance injection belongs to **plan** stage, not finding/implement stages.

## Operations: Drift Risks To Prioritize

- Contract/route drift between `packages/contracts/src/routes.ts` and runtime route mounts.
- SQLite payload/schema drift causing inbox/item parse failures.
- Stale implementing items when recovery thresholds are misconfigured.
- Documentation drift after workflow/state model changes.

## Schema evolution

- Persistent project state lives in SQLite migrations under `apps/runtime/src/core/db/sqlite-migrations.ts`.
- No JSON-to-SQL compatibility migration exists for old pre-launch `.steward` state.
- Schema changes must be demand-driven: add a persisted field only when current runtime/UI behavior consumes it.
- Validate JSON payload columns with adjacent Zod schemas before they enter domain code.

## Minimal Release Gate

- Verify gate (including check:unused) passes.
- Route constants and mounted handlers still align.
- SQLite schemas parse current persisted items.
- Stale-item recovery returns stuck work to a valid next state; items are skipped (and logged) when the status transition is not in the allowed set.
- CTO_HTTP_PORT and CTO_IMPLEMENTING_STALE_MS / CTO_AGENT_MAX_QUEUE_AGE_MS / CTO_AGENT_QUEUE_WARN_WAIT_MS control runtime port and recovery/queue thresholds.

## Running runtime tests

- To run a single test file, from `apps/runtime` pass the **path**: `pnpm test -- src/core/env.test.ts`. Substring args (e.g. `env.test`) are unreliable and may run the full suite.

## Refactor Policy

- Prefer direct call-path migration and cleanup over compatibility bridges.
- Do not preserve compatibility layers by default for internal architecture changes.

## Learned Project Context

- (Plain bullet points only. Updated automatically by continual-learning from transcript content. High-signal, durable facts about the project not inferable from code alone. No coding rules—those are captured by rule-capture.)

## Product Success Signals (Minimal)

- Inbox remains high-signal and actionable.
- Accepted changes reduce architecture/process drift over time.
