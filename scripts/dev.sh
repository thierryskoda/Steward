#!/usr/bin/env bash
# Dev entrypoint: clean processes → install deps → build → start menubar.
# Menubar is the sole orchestrator: add/select project in UI and start runtime from Settings.
# Run from repo root. Set CTO_RUNTIME_MAIN_PATH when starting menubar so Add project + Start works.
set -euo pipefail
cd "$(dirname "$0")/.."

LOGS_DIR="${DEV_LOGS_DIR:-logs}"
[[ "$LOGS_DIR" != /* ]] && LOGS_DIR="$(pwd)/${LOGS_DIR}"
mkdir -p "$LOGS_DIR"
DEV_LOG="${LOGS_DIR}/dev.log"
export CTO_LOGS_ROOT="$LOGS_DIR"
RUNTIME_MAIN_JS="$(pwd)/apps/runtime/dist/src/main.js"
RUNTIME_PROCESS_PATTERN="(apps/runtime/dist/src/main\\.js|dist/apps/runtime/src/main\\.js) --runtime"
MENUBAR_VITE_CACHE_DIR="apps/menubar/node_modules/.vite"
VITE_PORT="${DEV_VITE_PORT:-1420}"

KILL_PATTERNS=("electron" "vite")
TERM_WAIT_INTERVAL="${DEV_TERM_WAIT_INTERVAL:-0.3}"

log() {
  local line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [dev] $*"
  echo "$line" | tee -a "$DEV_LOG"
}

terminate_pids() {
  local pids="$1"
  local label="${2:-pids}"
  if [[ -z "$pids" ]]; then return; fi
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  log "sent SIGTERM to ${label}"
  sleep "$TERM_WAIT_INTERVAL"
  for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
}

kill_by_pattern() {
  local pattern="$1"
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  terminate_pids "$pids" "pattern: ${pattern}"
}

free_port() {
  local port="$1"
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  terminate_pids "$pids" "port :${port}"
}

list_runtime_pids() {
  pgrep -f "$RUNTIME_PROCESS_PATTERN" 2>/dev/null || true
}

cleanup_phase() {
  rm -f "${LOGS_DIR}"/*.log
  rm -rf "${LOGS_DIR}/agents"
  log "phase: clean processes and ports"
  for pattern in "${KILL_PATTERNS[@]}"; do kill_by_pattern "$pattern"; done
  free_port "$VITE_PORT"
  terminate_pids "$(list_runtime_pids)" "runtime processes"
}

clear_frontend_cache() {
  if [[ -d "$MENUBAR_VITE_CACHE_DIR" ]]; then
    rm -rf "$MENUBAR_VITE_CACHE_DIR"
    log "cleared Vite cache"
  fi
}

heal_electron_if_needed() {
  if (cd apps/menubar && node -e "require('electron')") 2>/dev/null; then return 0; fi
  log "Electron binary missing, reinstalling..."
  rm -rf node_modules/.pnpm/electron* node_modules/electron
  pnpm install
  if ! (cd apps/menubar && node -e "require('electron')") 2>/dev/null; then
    echo "FAIL: Electron still missing after reinstall"
    exit 1
  fi
  log "Electron reinstalled OK"
}

bootstrap_phase() {
  log "phase: clear frontend cache"
  clear_frontend_cache
  log "phase: install dependencies"
  pnpm check:lockfiles
  pnpm install
  heal_electron_if_needed
}

build_phase() {
  # Build all artifacts used at runtime: contracts (dep of both), runtime (spawned by menubar),
  # menubar (Vite bundle; Electron main is built by menubar's own build:electron on pnpm dev).
  # Explicit runtime filter ensures we never spawn a stale runtime binary from an old build.
  log "phase: build contracts + runtime + menubar"
  pnpm turbo run build --filter=@steward/runtime --filter=steward-menubar... --force
  if [[ ! -f "$RUNTIME_MAIN_JS" ]]; then
    echo "FAIL: runtime build missing at ${RUNTIME_MAIN_JS}"
    exit 1
  fi
}

log "dev.sh starting (LOGS_DIR=${LOGS_DIR})"
cleanup_phase
bootstrap_phase
build_phase

log "phase: start menubar (add/select project in Settings to start runtime)"
export CTO_RUNTIME_MAIN_PATH="$RUNTIME_MAIN_JS"
cd apps/menubar && exec pnpm dev
