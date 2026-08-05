#!/usr/bin/env bash
set -euo pipefail

# Unit-level contract coverage for bin/migrate's durable, per-consumer ledger.

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

TEST_HOME="$TMP_ROOT/home"
CONSUMER="$TMP_ROOT/consumer"
OTHER_CONSUMER="$TMP_ROOT/other-consumer"
mkdir -p "$TEST_HOME" "$CONSUMER" "$OTHER_CONSUMER"

# Source the helper region without invoking the runner.
# The current entry point has no library mode; the production change will make
# this seam explicit alongside the ledger helpers.
# shellcheck disable=SC1090
HOME="$TEST_HOME" source <(sed '/# ─── Main/,$d' "$MIGRATE_SRC")

LEDGER=$(cd "$CONSUMER" && HOME="$TEST_HOME" ledger_path)
OTHER_LEDGER=$(cd "$OTHER_CONSUMER" && HOME="$TEST_HOME" ledger_path)
EXPECTED_PREFIX="$TEST_HOME/.ai-conductor/migrations/"
assert 'ledger path is documented under the consumer-owned ai-conductor home' \
  "$(case "$LEDGER" in "$EXPECTED_PREFIX"*.json) echo 0 ;; *) echo 1 ;; esac)"
assert 'ledger path is distinct for each consumer project' \
  "$([ "$LEDGER" != "$OTHER_LEDGER" ] && echo 0 || echo 1)"

EMPTY_LEDGER=$(cd "$CONSUMER" && HOME="$TEST_HOME" ledger_read)
assert 'a new ledger declares schema version 1 and an empty per-block record list' \
  "$(LEDGER_JSON="$EMPTY_LEDGER" python3 - <<'PY'
import json
import os

ledger = json.loads(os.environ['LEDGER_JSON'])
print(0 if ledger == {'schemaVersion': 1, 'appliedBlocks': []} else 1)
PY
)"

BODY=$'printf \'migrate\\n\'\n'
IDENTITY=$(block_identity '1.2.0' "$BODY")
SAME_IDENTITY=$(block_identity '1.2.0' "$BODY")
CHANGED_RELEASE=$(block_identity '1.2.1' "$BODY")
CHANGED_BODY=$(block_identity '1.2.0' $'printf \'other\\n\'\n')
assert 'block identity is stable for the same release label and body' \
  "$([ "$IDENTITY" = "$SAME_IDENTITY" ] && echo 0 || echo 1)"
assert 'block identity changes when either the release label or body changes' \
  "$([ "$IDENTITY" != "$CHANGED_RELEASE" ] && [ "$IDENTITY" != "$CHANGED_BODY" ] && echo 0 || echo 1)"

(cd "$CONSUMER" && HOME="$TEST_HOME" ledger_record_applied '1.2.0' "$BODY")
assert 'an applied block is recorded with its stable identity, release, and body hash' \
  "$(LEDGER_PATH="$LEDGER" EXPECTED_IDENTITY="$IDENTITY" python3 - <<'PY'
import json
import os
from pathlib import Path

ledger = json.loads(Path(os.environ['LEDGER_PATH']).read_text())
blocks = ledger.get('appliedBlocks')
ok = (
    ledger.get('schemaVersion') == 1
    and isinstance(blocks, list)
    and len(blocks) == 1
    and blocks[0].get('identity') == os.environ['EXPECTED_IDENTITY']
    and blocks[0].get('release') == '1.2.0'
    and len(blocks[0].get('bodyHash', '')) == 64
)
print(0 if ok else 1)
PY
)"

CHANGELOG="$TMP_ROOT/CHANGELOG.md"
python3 - "$CHANGELOG" <<'PY'
import sys
from pathlib import Path

Path(sys.argv[1]).write_text('''## [1.0.0] - 2026-01-01

## Migration

```bash migration
printf 'first\\n'
```

## [1.1.0] - 2026-02-01

## Migration

```bash migration
printf 'second\\n'
```

## [1.2.0] - 2026-03-01

## Migration

```bash migration
printf 'ran\\n' > "$MIGRATION_EFFECT"
```
''')
PY

assert_corrupt_ledger_refuses_migrations() {
  local description=$1 ledger_contents=$2 expected_condition=$3
  local case_consumer="$TMP_ROOT/${expected_condition}-ledger-consumer"
  local case_ledger case_effect ledger_digest output status

  mkdir -p "$case_consumer"
  case_ledger=$(cd "$case_consumer" && HOME="$TEST_HOME" ledger_path)
  mkdir -p "$(dirname "$case_ledger")"
  if [ "$expected_condition" = 'empty' ]; then
    : > "$case_ledger"
  else
    printf '%s' "$ledger_contents" > "$case_ledger"
  fi
  ledger_digest=$(sha256sum "$case_ledger" | awk '{print $1}')

  case_effect="$case_consumer/migration-side-effect"
  if output=$(cd "$case_consumer" && HOME="$TEST_HOME" AUTO_YES=true CHANGELOG="$CHANGELOG" FROM_VERSION='0.9.0' TO_VERSION='1.2.0' MIGRATION_EFFECT="$case_effect" run_project_migrations 2>&1); then
    status=0
  else
    status=$?
  fi

  assert "$description" "$(
    case "$output" in
      *"$expected_condition"*) condition_reported=0 ;;
      *) condition_reported=1 ;;
    esac
    [ "$status" -ne 0 ] && [ "$condition_reported" -eq 0 ] && [ ! -e "$case_effect" ] \
      && [ "$ledger_digest" = "$(sha256sum "$case_ledger" | awk '{print $1}')" ] && echo 0 || echo 1
  )"
}

assert_corrupt_ledger_refuses_migrations \
  'an empty ledger is reported and prevents migration side effects' '' 'empty'
assert_corrupt_ledger_refuses_migrations \
  'invalid ledger JSON is reported and prevents migration side effects' '{invalid json' 'invalid'
assert_corrupt_ledger_refuses_migrations \
  'an unknown ledger schema version is reported and prevents migration side effects' \
  '{"schemaVersion": 999, "appliedBlocks": []}' 'schema'

FIRST_BODY=$'printf \'first\\n\'\n'
SECOND_BODY=$'printf \'second\\n\'\n'
THIRD_BODY=$'printf \'ran\\n\' > "$MIGRATION_EFFECT"\n'
(cd "$CONSUMER" && HOME="$TEST_HOME" ledger_record_applied '1.0.0' "$FIRST_BODY")
(cd "$CONSUMER" && HOME="$TEST_HOME" ledger_record_applied '1.1.0' "$SECOND_BODY")
(cd "$CONSUMER" && HOME="$TEST_HOME" ledger_record_applied '1.2.0' "$THIRD_BODY")
ALL_APPLIED_CANDIDATES=$(cd "$CONSUMER" && HOME="$TEST_HOME" select_migration_candidates)
assert 'a pre-seeded ledger leaves no migration candidates' \
  "$( [ -z "$ALL_APPLIED_CANDIDATES" ] && echo 0 || echo 1)"

PARTIAL_CONSUMER="$TMP_ROOT/partial-consumer"
mkdir -p "$PARTIAL_CONSUMER"
(cd "$PARTIAL_CONSUMER" && HOME="$TEST_HOME" ledger_record_applied '1.0.0' "$FIRST_BODY")
(cd "$PARTIAL_CONSUMER" && HOME="$TEST_HOME" ledger_record_applied '1.2.0' "$THIRD_BODY")
PARTIAL_CANDIDATES=$(cd "$PARTIAL_CONSUMER" && HOME="$TEST_HOME" select_migration_candidates)
assert 'a partial ledger leaves exactly the unapplied migration block' \
  "$( [ "$PARTIAL_CANDIDATES" = $'---MIGRATION-BLOCK--- version=1.1.0\nprintf \'second\\n\'' ] && echo 0 || echo 1)"

FIRST_RUN_CONSUMER="$TMP_ROOT/first-run-consumer"
mkdir -p "$FIRST_RUN_CONSUMER"
FIRST_RUN_CANDIDATES=$(cd "$FIRST_RUN_CONSUMER" && HOME="$TEST_HOME" && FROM_VERSION='1.0.0' && TO_VERSION='1.1.0' && select_migration_candidates)
assert 'an absent ledger bounds its first run to the installed-version range' \
  "$( [ "$FIRST_RUN_CANDIDATES" = $'---MIGRATION-BLOCK--- version=1.1.0\nprintf \'second\\n\'' ] && echo 0 || echo 1)"

MAIN_CONSUMER="$TMP_ROOT/main-consumer"
TAGGED_CONSUMER="$TMP_ROOT/tagged-consumer"
mkdir -p "$MAIN_CONSUMER" "$TAGGED_CONSUMER"
MAIN_CANDIDATES=$(cd "$MAIN_CONSUMER" && HOME="$TEST_HOME" && FROM_VERSION='main@deadbeef' && TO_VERSION='1.1.0' && select_migration_candidates)
TAGGED_CANDIDATES=$(cd "$TAGGED_CONSUMER" && HOME="$TEST_HOME" && FROM_VERSION='1.1.0' && TO_VERSION='1.1.0' && select_migration_candidates)
assert 'a main@sha installed version offers the same candidates as its tagged baseline' \
  "$( [ -z "$TAGGED_CANDIDATES" ] && [ "$MAIN_CANDIDATES" = "$TAGGED_CANDIDATES" ] && echo 0 || echo 1)"

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
