#!/usr/bin/env bash
set -uo pipefail

# test_examples_interactive.sh — RED acceptance specs for Story 5
# (.docs/stories/flow-examples.md, "interactive flow example (guided
# launcher)").
#
# conduct-ts is stubbed at the PATH boundary for the happy path (same
# rationale as test_examples_inline.sh) so the exec + argv wiring can be
# verified without a real, credentialed Claude Code session. The negative
# path drives the real absence of conduct-ts from PATH (no stub involved —
# that IS the scenario under test).
#
# Usage: ./test/test_examples_interactive.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
INTERACTIVE_SCRIPT="$EXAMPLES_DIR/interactive.sh"
source "$SCRIPT_DIR/test_helpers.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=0
FAIL=0
TOTAL=0
assert() {
  local desc=$1
  local result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Story 5 happy path: interactive.sh sets up, prints checkpoint, execs conduct-ts --interactive ==="

examples_fixture_setup
trap examples_fixture_teardown EXIT
examples_fixture_set_mode done

set +e
HAPPY_OUT=$(timeout 30 "$INTERACTIVE_SCRIPT" large 2>&1 </dev/null)
HAPPY_STATUS=$?
set -e

assert "interactive.sh large exits 0 (the stubbed conduct-ts exits 0)" \
  "$([ "$HAPPY_STATUS" -eq 0 ] && echo 0 || echo 1)"

case "$HAPPY_OUT" in
  *"DONE"*|*"done"*|*"checkpoint"*|*"Checkpoint"*|*"feature_complete"*)
    assert "prints the completion checkpoint to watch for before running" 0
    ;;
  *)
    echo "$HAPPY_OUT"
    assert "prints the completion checkpoint to watch for before running" 1
    ;;
esac

ARGV="$(examples_fixture_argv)"
case "$ARGV" in
  *"inline"*"--interactive"*)
    assert "execs conduct-ts inline ... --interactive" 0
    ;;
  *)
    echo "  argv log: '${ARGV}'"
    assert "execs conduct-ts inline ... --interactive" 1
    ;;
esac

echo ""
echo "=== Story 5 negative path: conduct-ts missing from PATH ==="

examples_fixture_teardown
ORIG_PATH="$PATH"
export PATH="/usr/bin:/bin"

set +e
MISSING_OUT=$("$INTERACTIVE_SCRIPT" large 2>&1 </dev/null)
MISSING_STATUS=$?
set -e

export PATH="$ORIG_PATH"

assert "interactive.sh exits non-zero when conduct-ts is not on PATH" \
  "$([ "$MISSING_STATUS" -ne 0 ] && echo 0 || echo 1)"
case "$MISSING_OUT" in
  *"conduct-ts"*"not found"*|*"conduct-ts: command not found"*|*"not found"*"conduct-ts"*)
    assert "prints a clear 'conduct-ts not found' error" 0
    ;;
  *)
    echo "$MISSING_OUT"
    assert "prints a clear 'conduct-ts not found' error" 1
    ;;
esac

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
