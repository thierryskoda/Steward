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
  local version="${2:-}"
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$version" >"$STUB_BIN/$command_name"
  chmod +x "$STUB_BIN/$command_name"
}

create_stub node "v22.0.0"
create_stub pnpm "11.0.0"

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

create_stub node "v21.9.0"
if output=$(env PATH="$STUB_BIN:/usr/bin:/bin" /bin/bash scripts/doctor.sh 2>&1); then
  echo "Expected doctor to fail when Node.js is older than version 22." >&2
  echo "$output" >&2
  exit 1
fi
if [[ "$output" != *"FAIL: Node.js 22 or newer required (found v21.9.0)"* ]]; then
  echo "Doctor did not explain the unsupported Node.js version." >&2
  echo "$output" >&2
  exit 1
fi

create_stub node "v22.0.0"
create_stub pnpm "10.9.0"
if output=$(env PATH="$STUB_BIN:/usr/bin:/bin" /bin/bash scripts/doctor.sh 2>&1); then
  echo "Expected doctor to fail when pnpm is older than version 11." >&2
  echo "$output" >&2
  exit 1
fi
if [[ "$output" != *"FAIL: pnpm 11 or newer required (found 10.9.0)"* ]]; then
  echo "Doctor did not explain the unsupported pnpm version." >&2
  echo "$output" >&2
  exit 1
fi

echo "doctor contract passed"
