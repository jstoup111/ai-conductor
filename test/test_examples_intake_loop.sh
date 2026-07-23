#!/usr/bin/env bash
set -uo pipefail

# test_examples_intake_loop.sh — RED acceptance specs for Story 8
# (.docs/stories/flow-examples.md, "intake-loop flow example (headless,
# seeded queue)") and the examples/fixtures/intake/ fixture (plan Task 12).
#
# conduct-ts is stubbed at the PATH boundary (see test_examples_inline.sh for
# the rationale). intake-status.json's path (verified against
# src/conductor/src/intake-loop-cli.ts: join(engineerDir, 'intake-status.json'))
# is written under $AI_CONDUCTOR_ENGINEER_DIR, matching sandbox_up's
# isolation (Story 2).
#
# Usage: ./test/test_examples_intake_loop.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
INTAKE_SCRIPT="$EXAMPLES_DIR/intake-loop.sh"
INTAKE_FIXTURE_DIR="$EXAMPLES_DIR/fixtures/intake"
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

echo "=== Task 12 fixture: examples/fixtures/intake/ ==="

if [ -d "$INTAKE_FIXTURE_DIR" ] && find "$INTAKE_FIXTURE_DIR" -type f 2>/dev/null | grep -q .; then
  assert "intake fixture queue/issue set exists" 0
else
  assert "intake fixture queue/issue set exists" 1
fi

echo ""
echo "=== Story 8 happy path: intake-loop.sh writes intake-status.json ==="

examples_fixture_setup
trap examples_fixture_teardown EXIT
examples_fixture_set_mode done

set +e
HAPPY_OUT=$(timeout 30 "$INTAKE_SCRIPT" small 2>&1 </dev/null)
HAPPY_STATUS=$?
set -e

assert "intake-loop.sh small exits 0 when intake-status.json is written" \
  "$([ "$HAPPY_STATUS" -eq 0 ] && echo 0 || echo 1)"
case "$HAPPY_OUT" in
  *"PASS intake-loop/small"*)
    assert "prints 'PASS intake-loop/small'" 0
    ;;
  *)
    echo "$HAPPY_OUT"
    assert "prints 'PASS intake-loop/small'" 1
    ;;
esac

ARGV="$(examples_fixture_argv)"
case "$ARGV" in
  *"intake-loop"*"--once"*)
    assert "invokes conduct-ts intake-loop --once" 0
    ;;
  *)
    echo "  argv log: '${ARGV}'"
    assert "invokes conduct-ts intake-loop --once" 1
    ;;
esac

assert "no claude session is spawned" "$(examples_fixture_claude_invoked && echo 1 || echo 0)"
assert "no PR is opened (gh never invoked)" "$(examples_fixture_gh_invoked && echo 1 || echo 0)"

echo ""
echo "=== Story 8 negative path: no intake-status.json written ==="

examples_fixture_set_mode nodone

set +e
NEG_OUT=$(timeout 30 "$INTAKE_SCRIPT" small 2>&1 </dev/null)
NEG_STATUS=$?
set -e

assert "intake-loop.sh small exits non-zero when intake-status.json is never written" \
  "$([ "$NEG_STATUS" -ne 0 ] && echo 0 || echo 1)"
case "$NEG_OUT" in
  *"FAIL intake-loop/small: no intake-status.json"*)
    assert "prints 'FAIL intake-loop/small: no intake-status.json'" 0
    ;;
  *)
    echo "$NEG_OUT"
    assert "prints 'FAIL intake-loop/small: no intake-status.json'" 1
    ;;
esac

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
