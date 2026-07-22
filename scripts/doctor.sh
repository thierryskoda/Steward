#!/usr/bin/env bash
# doctor - setup validation: .env, node/pnpm, contracts, runtime workspace, env schema. Run from repo root after clone or when troubleshooting; also used by pnpm doctor.
set -euo pipefail
cd "$(dirname "$0")/.."

FAIL=0

check() {
  if eval "$1" >/dev/null 2>&1; then
    echo "OK: $2"
  else
    echo "FAIL: $2"
    FAIL=1
  fi
}

check 'command -v node >/dev/null' "node present"
check 'command -v pnpm >/dev/null' "pnpm present"
check '[[ -f packages/contracts/package.json ]]' "contracts workspace present"
check '[[ -f apps/runtime/package.json ]]' "runtime workspace present"

SUPPORTED_AGENT_CLIS=()
for CLI in agent codex claude; do
  if command -v "$CLI" >/dev/null 2>&1; then
    SUPPORTED_AGENT_CLIS+=("$CLI")
  fi
done

if [[ ${#SUPPORTED_AGENT_CLIS[@]} -eq 0 ]]; then
  echo "FAIL: supported agent CLI present (install agent, codex, or claude)"
  FAIL=1
else
  echo "OK: supported agent CLI present (${SUPPORTED_AGENT_CLIS[*]})"
fi

if [[ -f .env ]]; then
  if OUT=$(pnpm --filter @steward/runtime validate-env 2>&1); then
    echo "OK: env valid"
  else
    echo "$OUT"
    FAIL=1
  fi
else
  echo "SKIP: env validation (.env optional; add/select project in Menubar Settings)"
fi

if [[ $FAIL -eq 1 ]]; then
  echo ""
  echo "Fix the failures above, then run 'pnpm dev'."
  exit 1
fi

echo ""
echo "All checks passed. Run 'pnpm dev' to start the menubar."
