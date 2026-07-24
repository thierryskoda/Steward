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

check_minimum_major() {
  local command_name="$1"
  local display_name="$2"
  local minimum_major="$3"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "FAIL: $display_name present"
    FAIL=1
    return
  fi

  local version
  version=$("$command_name" --version)
  local major="${version#v}"
  major="${major%%.*}"

  if [[ "$major" =~ ^[0-9]+$ ]] && ((major >= minimum_major)); then
    echo "OK: $display_name $minimum_major or newer ($version)"
  else
    echo "FAIL: $display_name $minimum_major or newer required (found $version)"
    FAIL=1
  fi
}

check_minimum_major node "Node.js" 22
check_minimum_major pnpm "pnpm" 11

if GIT_VERSION=$(git --version 2>/dev/null); then
  echo "OK: Git present ($GIT_VERSION)"
else
  echo "FAIL: Git present (install Git and ensure git is on PATH)"
  FAIL=1
fi

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
