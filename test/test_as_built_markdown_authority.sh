#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="$SCRIPT_DIR/check_as_built_markdown_authority.sh"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

ENGINE="$ROOT/src/conductor/src/engine"
mkdir -p "$ENGINE"

for fixture in report-reader verdict-regex; do
  cp "$SCRIPT_DIR/fixtures/as-built-markdown-authority/$fixture.ts" "$ENGINE/$fixture.ts"
  set +e
  output="$(bash "$CHECKER" "$ROOT" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ] || ! printf '%s' "$output" | rg -F "$fixture.ts" >/dev/null; then
    printf 'expected %s fixture to fail and name its module\n%s\n' "$fixture" "$output" >&2
    exit 1
  fi
  rm "$ENGINE/$fixture.ts"
done

bash "$CHECKER" "$(cd "$SCRIPT_DIR/.." && pwd)"
