#!/usr/bin/env bash
# doctor contract test - proves setup validation rejects a missing agent CLI and accepts any supported provider.
set -euo pipefail
cd "$(dirname "$0")/.."

TEST_TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/steward-doctor-test.XXXXXX")
trap 'rm -rf "$TEST_TMP_DIR"' EXIT

STUB_BIN="$TEST_TMP_DIR/bin"
mkdir -p "$STUB_BIN"

create_stub() {
  local command_name="$1"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$STUB_BIN/$command_name"
  chmod +x "$STUB_BIN/$command_name"
}

create_stub node
create_stub pnpm

if output=$(env PATH="$STUB_BIN:/usr/bin:/bin" /bin/bash scripts/doctor.sh 2>&1); then
  echo "Expected doctor to fail without agent, codex, or claude on PATH." >&2
  echo "$output" >&2
  exit 1
fi

if [[ "$output" != *"FAIL: supported agent CLI present (install agent, codex, or claude)"* ]]; then
  echo "Doctor did not explain how to fix the missing agent CLI." >&2
  echo "$output" >&2
  exit 1
fi

for supported_cli in agent codex claude; do
  rm -f "$STUB_BIN/agent" "$STUB_BIN/codex" "$STUB_BIN/claude"
  create_stub "$supported_cli"
  output=$(env PATH="$STUB_BIN:/usr/bin:/bin" /bin/bash scripts/doctor.sh)

  if [[ "$output" != *"OK: supported agent CLI present ($supported_cli)"* ]]; then
    echo "Doctor did not report the detected $supported_cli CLI." >&2
    echo "$output" >&2
    exit 1
  fi
done

echo "doctor contract passed"
