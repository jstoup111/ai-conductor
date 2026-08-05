#!/usr/bin/env bash
set -euo pipefail

# Unit-level coverage for migration block process isolation and strict shell
# semantics. The runner helper is sourced without invoking installation.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE_SRC="$REPO_ROOT/bin/migrate"

PASS=0
FAIL=0

assert() {
  local description=$1 result=$2
  if [ "$result" -eq 0 ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  fi
}

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

# shellcheck disable=SC1090
source <(sed '/# ─── Main/,$d' "$MIGRATE_SRC")

if ! declare -F execute_migration_block >/dev/null; then
  printf 'FAIL migration blocks have a dedicated fail-fast executor\n'
  exit 1
fi

HARNESS_DIR="$TMP_ROOT/harness"
CONSUMER="$TMP_ROOT/consumer"
mkdir -p "$HARNESS_DIR" "$CONSUMER"

run_block() {
  local script=$1
  set +e
  (cd "$CONSUMER" && execute_migration_block "$script")
  BLOCK_STATUS=$?
  set -e
}

run_block $'false\nprintf "late\\n" > should-not-exist'
assert 'a failed command stops the remaining commands in its block' \
  "$([ "$BLOCK_STATUS" -ne 0 ] && [ ! -e "$CONSUMER/should-not-exist" ] && echo 0 || echo 1)"

run_block $'printf "%s\\n" "$UNSET_MIGRATION_VALUE"'
assert 'an unset variable fails the block' "$([ "$BLOCK_STATUS" -ne 0 ] && echo 0 || echo 1)"

run_block 'false | true'
assert 'a failed pipeline element fails the block' "$([ "$BLOCK_STATUS" -ne 0 ] && echo 0 || echo 1)"

run_block $'printf "%s\\n" "$HARNESS_DIR" > harness-location\nprintf "%s\\n" "$PWD" > working-directory'
assert 'each block receives the harness location and consumer working directory' \
  "$([ "$BLOCK_STATUS" -eq 0 ] && [ "$(cat "$CONSUMER/harness-location")" = "$HARNESS_DIR" ] && [ "$(cat "$CONSUMER/working-directory")" = "$CONSUMER" ] && echo 0 || echo 1)"

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
