#!/usr/bin/env bash
# verify - deterministic local gate: lockfiles -> format -> lint -> unused -> build -> test -> smoke.
# With --fast runs only through build/test and exits. Provider-backed checks are opt-in via --provider.
# Provider checks can invoke real agent CLIs and model calls; run only when explicitly needed.
set -e
cd "$(dirname "$0")/.."

JSON="${VERIFY_JSON:-0}"
FAILED_STEP=""

run_step() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd"; then
    [[ "$JSON" == "1" ]] && echo "{\"step\":\"$label\",\"exitCode\":0}"
    return 0
  else
    FAILED_STEP="$label"
    echo "Step \"$label\" failed. Reproduce: $cmd" >&2
    [[ "$JSON" == "1" ]] && echo "{\"step\":\"$label\",\"exitCode\":1}"
    return 1
  fi
}

run_fast_pre_steps() {
  run_step "lockfiles" "pnpm check:lockfiles" || return 1
  run_step "format" "pnpm format:check" || return 1
  run_step "lint" "pnpm lint" || return 1
  run_step "unused" "pnpm check:unused" || return 1
  run_step "doctor" "pnpm test:doctor" || return 1
}

run_fast_steps() {
  run_fast_pre_steps || exit 1
  run_step "build" "pnpm turbo run build" || exit 1
  run_step "test" "pnpm turbo run test" || exit 1
}

run_full_gate() {
  run_fast_steps || exit 1
  run_step "smoke" "pnpm smoke" || exit 1
}

run_provider_gate() {
  if [[ "${RUN_PROVIDER_CHECKS:-0}" != "1" ]]; then
    echo "Provider-backed checks are opt-in. Reproduce: pnpm verify:provider" >&2
    exit 1
  fi
  run_full_gate || exit 1
  run_step "agent-cli-contract" "command -v agent >/dev/null && pnpm run agent:contract || (echo 'agent not found, skipping Cursor contract' && true)" || exit 1
  run_step "provider-e2e" "pnpm e2e:provider" || exit 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ "${1:-}" == "--fast" ]]; then
    run_fast_steps
  elif [[ "${1:-}" == "--provider" ]]; then
    run_provider_gate
  else
    run_full_gate
  fi
fi
