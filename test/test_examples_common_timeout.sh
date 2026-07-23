#!/usr/bin/env bash
set -uo pipefail

# test_examples_common_timeout.sh — RED acceptance specs for Task 4
# (.docs/plans/flow-examples.md, "lib/common.sh: assert_checkpoint,
# run_with_timeout, PASS/FAIL printer").
#
# Covers run_with_timeout and assert_checkpoint directly (in isolation from
# any flow script), per Task 4's acceptance: a passing predicate prints
# PASS/exit 0; a failing one and a timeout print FAIL/exit non-zero.
#
# Usage: ./test/test_examples_common_timeout.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
COMMON_LIB="$EXAMPLES_DIR/lib/common.sh"

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

if [ ! -f "$COMMON_LIB" ]; then
  echo "examples/lib/common.sh not found" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$COMMON_LIB"

echo "=== run_with_timeout ==="

run_with_timeout 5 true
assert "run_with_timeout exits 0 when the command succeeds well within the timeout" $?

set +e
run_with_timeout 1 sleep 5
STATUS=$?
set -e
assert "run_with_timeout exits non-zero when the command is killed for wedging" \
  "$([ "$STATUS" -ne 0 ] && echo 0 || echo 1)"

echo ""
echo "=== assert_checkpoint: passing predicate ==="

set +e
OUT=$(assert_checkpoint "inline" "small" "[ -e /dev/null ]")
STATUS=$?
set -e
case "$OUT" in
  "PASS inline/small") assert "prints 'PASS inline/small'" 0 ;;
  *) echo "$OUT"; assert "prints 'PASS inline/small'" 1 ;;
esac
assert "assert_checkpoint exits 0 for a passing predicate" \
  "$([ "$STATUS" -eq 0 ] && echo 0 || echo 1)"

echo ""
echo "=== assert_checkpoint: failing predicate ==="

set +e
OUT=$(assert_checkpoint "inline" "small" "[ -e /nonexistent/path/for/test ]" "checkpoint not found")
STATUS=$?
set -e
case "$OUT" in
  "FAIL inline/small: checkpoint not found") assert "prints 'FAIL inline/small: checkpoint not found'" 0 ;;
  *) echo "$OUT"; assert "prints 'FAIL inline/small: checkpoint not found'" 1 ;;
esac
assert "assert_checkpoint exits non-zero for a failing predicate" \
  "$([ "$STATUS" -ne 0 ] && echo 0 || echo 1)"

echo ""
echo "=== assert_checkpoint: timeout ==="

set +e
OUT=$(assert_checkpoint "inline" "small" "sleep 5" "" 1)
STATUS=$?
set -e
case "$OUT" in
  "FAIL inline/small: timeout") assert "prints 'FAIL inline/small: timeout' when the predicate command times out" 0 ;;
  *) echo "$OUT"; assert "prints 'FAIL inline/small: timeout' when the predicate command times out" 1 ;;
esac
assert "assert_checkpoint exits non-zero on timeout" \
  "$([ "$STATUS" -ne 0 ] && echo 0 || echo 1)"

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
