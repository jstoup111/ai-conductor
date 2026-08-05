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

# A multi-release jump must persist each successful prefix block before moving
# to the next candidate. Use candidate markers directly so this fixture stays
# focused on the execution/ledger seam rather than changelog parsing.
MIGRATION_HOME="$TMP_ROOT/migration-home"
MIGRATION_CONSUMER="$TMP_ROOT/migration-consumer"
mkdir -p "$MIGRATION_HOME" "$MIGRATION_CONSUMER"
CHANGELOG="$TMP_ROOT/CHANGELOG.md"
printf '# Changelog\n' > "$CHANGELOG"
FROM_VERSION='1.0.0'
TO_VERSION='1.3.0'
AUTO_YES=true
DRY_RUN=false

FIRST_BLOCK=$'printf "first\\n" > first-applied\n'
FAILING_BLOCK=$'false\n'
UNREACHABLE_BLOCK=$'printf "third\\n" > third-should-not-run\n'
select_migration_candidates() {
  printf '%s' "---MIGRATION-BLOCK--- version=1.1.0
$FIRST_BLOCK---MIGRATION-BLOCK--- version=1.2.0
$FAILING_BLOCK---MIGRATION-BLOCK--- version=1.3.0
$UNREACHABLE_BLOCK"
}

if MIGRATION_OUTPUT=$(cd "$MIGRATION_CONSUMER" && HOME="$MIGRATION_HOME" run_project_migrations 2>&1); then
  MIGRATION_STATUS=0
else
  MIGRATION_STATUS=$?
fi
MIGRATION_LEDGER=$(cd "$MIGRATION_CONSUMER" && HOME="$MIGRATION_HOME" ledger_path)
FIRST_IDENTITY=$(block_identity '1.1.0' "$FIRST_BLOCK")
FAILING_IDENTITY=$(block_identity '1.2.0' "$FAILING_BLOCK")
UNREACHABLE_IDENTITY=$(block_identity '1.3.0' "$UNREACHABLE_BLOCK")

assert 'a failed candidate stops a multi-version migration jump' \
  "$([ "$MIGRATION_STATUS" -ne 0 ] && [ -f "$MIGRATION_CONSUMER/first-applied" ] && [ ! -e "$MIGRATION_CONSUMER/third-should-not-run" ] && echo 0 || echo 1)"
assert 'a failed candidate leaves only the successful prefix in the ledger' \
  "$(if [ ! -f "$MIGRATION_LEDGER" ]; then echo 1; else LEDGER_PATH="$MIGRATION_LEDGER" FIRST_IDENTITY="$FIRST_IDENTITY" FAILING_IDENTITY="$FAILING_IDENTITY" UNREACHABLE_IDENTITY="$UNREACHABLE_IDENTITY" python3 - <<'PY'
import json
import os
from pathlib import Path

ledger = json.loads(Path(os.environ['LEDGER_PATH']).read_text())
identities = [block['identity'] for block in ledger['appliedBlocks']]
print(0 if identities == [os.environ['FIRST_IDENTITY']] and os.environ['FAILING_IDENTITY'] not in identities and os.environ['UNREACHABLE_IDENTITY'] not in identities else 1)
PY
fi)"
assert 'the failure report names release 1.2.0 and candidate block position 2' \
  "$(case "$MIGRATION_OUTPUT" in *'1.2.0'*) release_named=0 ;; *) release_named=1 ;; esac; case "$MIGRATION_OUTPUT" in *'block 2'*|*'position 2'*) position_named=0 ;; *) position_named=1 ;; esac; if [ "$release_named" -eq 0 ] && [ "$position_named" -eq 0 ]; then echo 0; else echo 1; fi)"

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
