#!/usr/bin/env bash
# verify:changed - same pre-turbo steps as verify (lockfiles, format, lint, unused) via verify.sh, then turbo build/test --affected; fallback to verify:fast if git base unavailable.
set -euo pipefail
cd "$(dirname "$0")/.."

# Single source of truth: run fast pre-steps from verify.sh then turbo --affected
source scripts/verify.sh
run_fast_pre_steps || exit 1
set -euo pipefail

BASE_REF="${1:-origin/main}"
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="HEAD~1"
fi
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "verify:changed: no git base ref, running verify:fast"
  exec pnpm verify:fast
fi

if ! git diff --name-only "$BASE_REF" >/dev/null 2>&1; then
  echo "verify:changed: unable to diff from ${BASE_REF}, running verify:fast"
  exec pnpm verify:fast
fi

CHANGED_COUNT=$(git diff --name-only "$BASE_REF" | wc -l | tr -d ' ')
if [[ "$CHANGED_COUNT" == "0" ]]; then
  echo "verify:changed: no changes from ${BASE_REF}, running verify:fast"
  exec pnpm verify:fast
fi

echo "verify:changed: running turbo --affected from base ${BASE_REF}"
export TURBO_SCM_BASE="$BASE_REF"
export TURBO_SCM_HEAD="HEAD"

if ! pnpm turbo run build test --affected; then
  echo "Step \"turbo\" failed. Reproduce: TURBO_SCM_BASE=$BASE_REF pnpm turbo run build test --affected" >&2
  echo "verify:changed: turbo affected run failed, running verify:fast" >&2
  exec pnpm verify:fast
fi
