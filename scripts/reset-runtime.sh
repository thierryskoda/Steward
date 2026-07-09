#!/usr/bin/env bash
# reset-runtime: stop all runtime processes and remove app-data runtime (registry, per-project pid/token/endpoint). Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_DATA="${HOME:?}/.steward"
RUNTIME_PROCESS_PATTERN="(apps/runtime/dist/src/main\\.js|dist/apps/runtime/src/main\\.js) --runtime"
TERM_WAIT="${RESET_TERM_WAIT:-0.3}"

terminate_pids() {
  local pids="$1"
  local label="${2:-pids}"
  [[ -z "$pids" ]] && return
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  echo "reset-runtime: sent SIGTERM to ${label}"
  sleep "$TERM_WAIT"
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  done
}

list_runtime_pids() {
  pgrep -f "$RUNTIME_PROCESS_PATTERN" 2>/dev/null || true
}

pids=$(list_runtime_pids)
if [[ -n "$pids" ]]; then
  terminate_pids "$pids" "runtime processes"
fi

rm -f "${APP_DATA}/registry.json"
[[ -d "${APP_DATA}/projects" ]] && rm -rf "${APP_DATA}/projects"
echo "reset-runtime: removed registry and per-project runtime"

if [[ -d "${APP_DATA}/logs" ]]; then
  rm -rf "${APP_DATA}/logs"
  mkdir -p "${APP_DATA}/logs"
  echo "reset-runtime: cleared logs"
fi

echo "reset-runtime: done"
