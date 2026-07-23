#!/usr/bin/env bash
set -uo pipefail

# test_examples_daemon.sh — RED acceptance specs for Story 6
# (.docs/stories/flow-examples.md, "daemon flow example (headless, seeded
# fixture)") and the examples/fixtures/daemon/ fixture (plan Task 8).
#
# conduct-ts is stubbed at the PATH boundary (see test_examples_inline.sh for
# the rationale) so the drain-once run completes fast and deterministically.
#
# Usage: ./test/test_examples_daemon.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
DAEMON_SCRIPT="$EXAMPLES_DIR/daemon.sh"
DAEMON_FIXTURE_DIR="$EXAMPLES_DIR/fixtures/daemon"
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

echo "=== Task 8 fixture: examples/fixtures/daemon/ ==="

if [ -d "$DAEMON_FIXTURE_DIR" ] \
  && find "$DAEMON_FIXTURE_DIR" -path "*stories*" -name "*.md" 2>/dev/null | grep -q . \
  && find "$DAEMON_FIXTURE_DIR" -path "*plans*" -name "*.md" 2>/dev/null | grep -q .; then
  assert "daemon fixture has an accepted story + a plan" 0
else
  assert "daemon fixture has an accepted story + a plan" 1
fi

echo ""
echo "=== Story 6 happy path: daemon.sh reaches DONE with a recorded PR/local-commit ==="

examples_fixture_setup
trap examples_fixture_teardown EXIT
examples_fixture_set_mode done

set +e
HAPPY_OUT=$(timeout 30 "$DAEMON_SCRIPT" small 2>&1 </dev/null)
HAPPY_STATUS=$?
set -e

assert "daemon.sh small exits 0 on reaching DONE" "$([ "$HAPPY_STATUS" -eq 0 ] && echo 0 || echo 1)"
case "$HAPPY_OUT" in
  *"PASS daemon/small"*)
    assert "prints 'PASS daemon/small'" 0
    ;;
  *)
    echo "$HAPPY_OUT"
    assert "prints 'PASS daemon/small'" 1
    ;;
esac

ARGV="$(examples_fixture_argv)"
case "$ARGV" in
  *"daemon"*)
    assert "invokes conduct-ts daemon (drain once)" 0
    ;;
  *)
    echo "  argv log: '${ARGV}'"
    assert "invokes conduct-ts daemon (drain once)" 1
    ;;
esac
case "$ARGV" in
  *"--continuous"*)
    assert "does not pass --continuous (drains once, does not idle-poll)" 1
    ;;
  *)
    assert "does not pass --continuous (drains once, does not idle-poll)" 0
    ;;
esac

echo ""
echo "=== Story 6 negative path: feature never reaches DONE ==="

examples_fixture_set_mode nodone

set +e
NEG_OUT=$(timeout 30 "$DAEMON_SCRIPT" small 2>&1 </dev/null)
NEG_STATUS=$?
set -e

assert "daemon.sh small exits non-zero when the feature never reaches DONE" \
  "$([ "$NEG_STATUS" -ne 0 ] && echo 0 || echo 1)"
case "$NEG_OUT" in
  *"FAIL daemon/small: feature did not reach DONE"*)
    assert "prints 'FAIL daemon/small: feature did not reach DONE'" 0
    ;;
  *)
    echo "$NEG_OUT"
    assert "prints 'FAIL daemon/small: feature did not reach DONE'" 1
    ;;
esac
assert "no PR is opened against the real remote (gh never invoked)" \
  "$(examples_fixture_gh_invoked && echo 1 || echo 0)"

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
