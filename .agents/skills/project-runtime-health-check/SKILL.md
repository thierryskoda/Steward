---
name: project-runtime-health-check
description: Inspect a local-first project runtime backed by .steward/state.db to verify setup, runtime health, SQLite contents, snapshots, workflow rows, temp layout, logs, and whether background workers are progressing normally. Use when the user asks if a connected project is running, healthy, initialized, stuck, misconfigured, watching the right path, or whether the project DB/state looks good.
---

# Project Runtime Health Check

Use this when checking whether a selected/local project runtime is correctly initialized and running smoothly.

The target product shape is:

```text
<projectRoot>/.steward/state.db
<projectRoot>/.steward/state.db-wal
<projectRoot>/.steward/state.db-shm
<projectRoot>/.steward/tmp/runs/<requestId>/*
```

Everything else persistent under `<projectRoot>/.steward` is suspicious unless the current project explicitly documents otherwise.

## Inputs To Resolve

Find the connected project root from the most reliable source available:

1. User-provided path.
2. App registry, usually `~/.steward/registry.json`.
3. App preferences, usually `~/.steward/app-preferences.json`.
4. Runtime logs showing `targetProjectRoot`.
5. UI-selected project path if visible.

If multiple projects are running, inspect the selected project unless the user asks for all projects.

## Health Check Workflow

### 1. Confirm Runtime Ownership

Check process and registry state:

```sh
pgrep -fl "apps/runtime/dist/src/main\\.js|--runtime" || true
cat ~/.steward/registry.json 2>/dev/null || true
cat ~/.steward/app-preferences.json 2>/dev/null || true
```

Expected:

- Registry has one entry for the selected project root.
- Runtime PID exists.
- Endpoint host/port is present.
- Selected project matches the path the user expects.

If registry says running but PID is gone, report stale registry and prefer reset/restart.

### 2. Confirm `.steward` Layout

Run:

```sh
find "$PROJECT_ROOT/.steward" -maxdepth 4 -type f -o -type d | sort
```

Expected persistent entries:

- `state.db`
- `state.db-wal`
- `state.db-shm`
- `tmp/runs`

Flag as stale/legacy if present:

- `.steward/config.json`
- `.steward/categories`
- `.steward/rules`
- `.steward/generated`
- `.steward/notifications`
- `.steward/memory`
- `.steward/sources/checkpoints`
- ad-hoc files under `.steward/tmp` outside `.steward/tmp/runs`

Do not delete automatically unless the user asks or the current repo policy clearly allows aggressive pre-launch cleanup. If deleting, preserve `state.db*` and `.steward/tmp/runs`.

### 3. Inspect SQLite Schema

Run:

```sh
sqlite3 "$PROJECT_ROOT/.steward/state.db" ".tables"
sqlite3 "$PROJECT_ROOT/.steward/state.db" \
  "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name;"
```

Expected tables for the Steward runtime:

- `schema_migrations`
- `project_config`
- `findings`
- `rules`
- `generated_snapshots`
- `source_checkpoints`
- `option_hints`
- `continual_learning_index`

Expected indexes:

- `findings_status_idx`
- `findings_category_status_idx`
- `findings_category_dedupe_key_idx`
- `rules_status_idx`
- `rules_source_message_idx`
- `option_hints_category_idx`

Missing schema objects mean migrations did not run or the wrong DB is being inspected.

### 4. Inspect Core Rows

Run:

```sh
sqlite3 "$PROJECT_ROOT/.steward/state.db" <<'SQL'
.headers on
.mode column
SELECT 'schema_migrations' AS table_name, COUNT(*) AS rows FROM schema_migrations UNION ALL
SELECT 'project_config', COUNT(*) FROM project_config UNION ALL
SELECT 'generated_snapshots', COUNT(*) FROM generated_snapshots UNION ALL
SELECT 'findings', COUNT(*) FROM findings UNION ALL
SELECT 'rules', COUNT(*) FROM rules UNION ALL
SELECT 'source_checkpoints', COUNT(*) FROM source_checkpoints UNION ALL
SELECT 'option_hints', COUNT(*) FROM option_hints UNION ALL
SELECT 'continual_learning_index', COUNT(*) FROM continual_learning_index;
SELECT version, datetime(applied_at / 1000, 'unixepoch') AS applied_at FROM schema_migrations ORDER BY version;
SELECT id, schema_version, datetime(updated_at / 1000, 'unixepoch') AS updated_at, payload_json FROM project_config;
SELECT kind, sources_hash, generator_version, datetime(generated_at / 1000, 'unixepoch') AS generated_at, length(payload_json) AS payload_bytes FROM generated_snapshots ORDER BY kind;
SELECT status, COUNT(*) AS count FROM findings GROUP BY status ORDER BY status;
SELECT status, COUNT(*) AS count FROM rules GROUP BY status ORDER BY status;
SQL
```

Interpretation:

- `project_config = 1`: initialized.
- `project_config = 0`: runtime should be `needs-config`.
- `generated_snapshots` should contain whatever startup needs. For this Steward runtime, healthy initialized projects usually have `exclude`, `rules`, and `project-context` after setup finishes.
- Empty `findings` and `rules` can be healthy if no detection/capture has produced items yet.
- Workflow rows in `claimed` or `agent-running` are not automatically bad; compare with logs and active agent processes.

### 5. Query Runtime HTTP Status

Resolve token and endpoint from app-data:

```sh
PROJECT_KEY="<registry key>"
TOKEN="$(cat ~/.steward/projects/$PROJECT_KEY/http-token)"
PORT="<registry endpoint port>"
curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/runtime/status"
curl -sS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/config"
```

Expected status:

- `running` with `lastError: null`: healthy.
- `needs-config`: DB config is missing.
- `reconciling`: setup/config activation is still in progress.
- `error`: inspect `lastError` and runtime logs.

If HTTP is unreachable but process exists, inspect endpoint/token staleness and host logs.

### 6. Inspect Logs For Progress Or Stalls

Start with:

```sh
tail -200 logs/runtime.log 2>/dev/null || true
tail -200 logs/menubar-host.log 2>/dev/null || true
```

Look for:

- Startup phase sequence: DB open/migrate, repo-scope, starting services, ready.
- Agent runs: queued, started, finished, failed.
- Repeated restarts with different PIDs.
- Repeated snapshot cache misses.
- Runtime `error` or fatal logs.
- Requests failing with `fetch failed`, timeout, 401, 503.

When setup uses LLM-backed snapshot generation, multi-minute setup can be normal. Treat it as healthy if logs show active agent progress and no fatal/error state.

### 7. Check Active Agent Work

Run:

```sh
pgrep -fl "agent --use-system-ca|cursor-agent|worker-server" || true
find "$PROJECT_ROOT/.steward/tmp/runs" -maxdepth 2 -type f -o -type d | sort | tail -80
```

Healthy:

- Active agent process corresponds to a current runtime log request id.
- Run dirs are under `.steward/tmp/runs/<requestId>`.

Suspicious:

- Agent process remains long after runtime died.
- Many stale run dirs after restart.
- Run dirs outside `.steward/tmp/runs`.

### 8. Decide Health Status

Report one of:

- **Healthy and running**: runtime is `running`, DB initialized, expected snapshots exist, no stale persistent `.steward` dirs, logs show normal progress.
- **Healthy but busy**: runtime is running/reconciling and an agent/detection job is actively progressing.
- **Initialized but idle**: config/snapshots exist, runtime running, no findings/rules yet.
- **Partially initialized**: config exists but missing required snapshots or setup still incomplete.
- **Stale local state**: legacy `.steward` folders/files are present or registry has dead runtimes.
- **Broken**: runtime state is `error`, HTTP unreachable with live registry, migrations missing, DB unreadable, or repeated failing logs.

## Response Shape

Keep the final answer concise and concrete:

- State: healthy/busy/partial/broken.
- Project root inspected.
- Runtime status and PID/port if relevant.
- DB facts: config present, snapshots present, row counts.
- Any suspicious findings.
- Next action: wait, restart, delete stale dirs, run a feature, or inspect specific logs.

Do not claim “nothing is missing” unless schema, config, snapshots, runtime status, `.steward` layout, and logs all support it.
