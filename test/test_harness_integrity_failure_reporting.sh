#!/usr/bin/env bash
# Covers: task:1, task:3, task:4
set -euo pipefail

# Focused fixture spec for the integrity suite's failure-reporting seam. It
# extracts the production reporting region rather than copying its counters or
# reporters, so these cases exercise the code that the suite actually runs.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SUITE="$HARNESS_DIR/test/test_harness_integrity.sh"
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/integrity-failure-reporting-XXXXXX")

cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

extract_reporting_region() {
  local source=$1 destination=$2
  awk '
    /^# BEGIN integrity failure reporting$/ { found_begin=1; capture=1; next }
    /^# END integrity failure reporting$/ { found_end=1; capture=0; exit }
    capture { print }
    END {
      if (!found_begin || !found_end) {
        exit 1
      }
    }
  ' "$source" > "$destination" || return 1
  [ -s "$destination" ]
}

reject_raw_reporter_statuses() {
  local source=$1
  awk '
    /(assert|warn_check)[[:space:]].*\$\?/ {
      printf "%s:%d: raw reporter status: %s\\n", FILENAME, FNR, $0
      found=1
    }
    END { exit(found ? 1 : 0) }
  ' "$source"
}

run_fixture() {
  local fixture=$1 output=$2
  set +e
  bash "$fixture" >"$output" 2>&1
  local status=$?
  set -e
  return "$status"
}

fixture="$WORKDIR/reporting-fixture.sh"
if ! extract_reporting_region "$SUITE" "$fixture"; then
  fail "reporting-region markers are missing from $SUITE"
fi

cat >> "$fixture" <<'FIXTURE'
failed_status=0
false || failed_status=$?
assert "fixture failing check" "$failed_status"

passed_status=0
true || passed_status=$?
assert "fixture passing check" "$passed_status"

summarize_and_exit
FIXTURE

fixture_output="$WORKDIR/fixture.out"
if run_fixture "$fixture" "$fixture_output"; then
  fail "fixture exited zero after a failed check"
fi

grep -Fq 'FAIL' "$fixture_output" || fail "fixture did not report its failing check"
grep -Fq 'fixture failing check' "$fixture_output" || fail "fixture failure omitted its name"
grep -Fq 'PASS' "$fixture_output" || fail "fixture did not continue to its passing check"
grep -Fq 'fixture passing check' "$fixture_output" || fail "fixture pass omitted its name"
grep -Eq '1 passed.*1 failed' "$fixture_output" || fail "fixture summary was not one passed and one failed"

if ! reject_raw_reporter_statuses "$SUITE" >"$WORKDIR/raw-status.out" 2>&1; then
  cat "$WORKDIR/raw-status.out" >&2
  fail "real suite still hands a raw status to a reporter"
fi

raw_status_fixture="$WORKDIR/raw-status-suite.sh"
cp "$SUITE" "$raw_status_fixture"
printf '\nfalse\nassert "raw status fixture" $?\n' >> "$raw_status_fixture"
if reject_raw_reporter_statuses "$raw_status_fixture" >"$WORKDIR/raw-status-fixture.out" 2>&1; then
  fail "raw-status mutation passed the drift guard"
fi
grep -Fq "${raw_status_fixture}:" "$WORKDIR/raw-status-fixture.out" \
  || fail "raw-status rejection omitted its line number"

chain_raw_status_fixture="$WORKDIR/chain-raw-status-suite.sh"
cp "$SUITE" "$chain_raw_status_fixture"
printf '\nprintf "fixture" \\\n+  && true\nassert "chain raw status fixture" $?\n' >> "$chain_raw_status_fixture"
if reject_raw_reporter_statuses "$chain_raw_status_fixture" >"$WORKDIR/chain-raw-status-fixture.out" 2>&1; then
  fail "multi-line raw-status mutation passed the drift guard"
fi
grep -Fq "${chain_raw_status_fixture}:" "$WORKDIR/chain-raw-status-fixture.out" \
  || fail "multi-line raw-status rejection omitted its line number"

abort_fixture="$WORKDIR/abort-fixture.sh"
extract_reporting_region "$SUITE" "$abort_fixture" || fail "could not extract abort fixture"
printf '\nfalse\n' >> "$abort_fixture"
abort_output="$WORKDIR/abort.out"
if run_fixture "$abort_fixture" "$abort_output"; then
  fail "unguarded failure exited zero"
fi
grep -Eq 'ABORT.*line [0-9]+.*exit 1' "$abort_output" \
  || fail "unguarded failure did not report its line and exit status"
abort_count=$(grep -c '^ABORT:' "$abort_output" || true)
[ "$abort_count" -eq 1 ] \
  || fail "unguarded failure emitted ${abort_count} abort diagnostics instead of one"

non_errexit_fixture="$WORKDIR/non-errexit-fixture.sh"
extract_reporting_region "$SUITE" "$non_errexit_fixture" || fail "could not extract non-errexit fixture"
cat >> "$non_errexit_fixture" <<'FIXTURE'
set +e
false
set -e
summarize_and_exit
FIXTURE
non_errexit_output="$WORKDIR/non-errexit.out"
if ! run_fixture "$non_errexit_fixture" "$non_errexit_output"; then
  cat "$non_errexit_output" >&2
  fail "non-errexit fixture did not reach its summary"
fi
if grep -Fq 'ABORT' "$non_errexit_output"; then
  fail "non-errexit failure emitted an abort diagnostic"
fi

markerless="$WORKDIR/markerless-suite.sh"
sed '/^# BEGIN integrity failure reporting$/d; /^# END integrity failure reporting$/d' \
  "$SUITE" > "$markerless"
if extract_reporting_region "$markerless" "$WORKDIR/markerless-region.sh"; then
  fail "markerless suite produced a reporting region"
fi

echo "PASS: reporting region reports failure, continues, summarizes, and rejects missing markers"
