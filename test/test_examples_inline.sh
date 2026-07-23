#!/usr/bin/env bash
set -uo pipefail

# test_examples_inline.sh — RED acceptance specs for Story 4
# (.docs/stories/flow-examples.md, "inline flow example (headless,
# self-asserting)").
#
# conduct-ts is stubbed at the PATH boundary (examples_fixture_setup, see
# test_helpers.sh) so this spec runs fast and deterministically instead of
# invoking a real, credentialed Claude Code session. The stub's `done` mode
# writes the same observable artifact the real CLI produces on completion —
# a `feature_complete` line in .pipeline/events.jsonl (verified against
# src/conductor/src/engine/event-persister.ts and src/conductor/src/index.ts)
# — so the DONE-marker check under test is real, only the underlying CLI is
# faked. `nodone` mode reproduces the negative-path criterion directly (a
# flow that runs but never reaches DONE).
#
# Usage: ./test/test_examples_inline.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
INLINE_SCRIPT="$EXAMPLES_DIR/inline.sh"
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

examples_fixture_setup
trap examples_fixture_teardown EXIT

echo "=== Story 4 happy path: inline.sh reaches DONE ==="

examples_fixture_set_mode done

set +e
HAPPY_OUT=$(timeout 30 "$INLINE_SCRIPT" medium 2>&1 </dev/null)
HAPPY_STATUS=$?
set -e

assert "inline.sh medium exits 0 on reaching DONE" "$([ "$HAPPY_STATUS" -eq 0 ] && echo 0 || echo 1)"
case "$HAPPY_OUT" in
  *"PASS inline/medium"*)
    assert "prints 'PASS inline/medium'" 0
    ;;
  *)
    echo "$HAPPY_OUT"
    assert "prints 'PASS inline/medium'" 1
    ;;
esac

ARGV="$(examples_fixture_argv)"
case "$ARGV" in
  *"inline"*"--auto"*)
    assert "invokes conduct-ts inline ... --auto" 0
    ;;
  *)
    echo "  argv log: '${ARGV}'"
    assert "invokes conduct-ts inline ... --auto" 1
    ;;
esac

echo ""
echo "=== Story 4 negative path: no DONE marker ==="

examples_fixture_set_mode nodone

set +e
NEG_OUT=$(timeout 30 "$INLINE_SCRIPT" medium 2>&1 </dev/null)
NEG_STATUS=$?
set -e

assert "inline.sh medium exits non-zero when no DONE marker is reached" \
  "$([ "$NEG_STATUS" -ne 0 ] && echo 0 || echo 1)"
case "$NEG_OUT" in
  *"FAIL inline/medium: no DONE marker"*)
    assert "prints 'FAIL inline/medium: no DONE marker'" 0
    ;;
  *)
    echo "$NEG_OUT"
    assert "prints 'FAIL inline/medium: no DONE marker'" 1
    ;;
esac

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
