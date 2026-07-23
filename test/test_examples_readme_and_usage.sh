#!/usr/bin/env bash
set -uo pipefail

# test_examples_readme_and_usage.sh — RED acceptance specs for Story 1
# (.docs/stories/flow-examples.md, "examples/ scaffolding and README").
#
# Story 1 happy path is verified against examples/README.md directly (a
# static-content check, not a flow run). The negative path drives
# examples/inline.sh --help and an unknown-tier invocation — chosen as the
# representative script per the story's own example ("examples/inline.sh
# --help (or an unknown tier like examples/inline.sh xl)").
#
# Usage: ./test/test_examples_readme_and_usage.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
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

echo "=== Story 1: examples/ scaffolding and README ==="

README="$EXAMPLES_DIR/README.md"

if [ -f "$README" ]; then
  assert "examples/README.md exists" 0

  for scenario in inline interactive daemon engineer intake-loop; do
    if grep -qi "$scenario" "$README"; then
      assert "README lists the '${scenario}' scenario" 0
    else
      assert "README lists the '${scenario}' scenario" 1
    fi
  done

  if grep -Eq '\./(inline|interactive|daemon|engineer|intake-loop)\.sh[[:space:]]*\[?s\|m\|l\]?' "$README" \
    || grep -Eq '\./<flow>\.sh' "$README"; then
    assert "README documents the ./<flow>.sh [s|m|l] invocation" 0
  else
    assert "README documents the ./<flow>.sh [s|m|l] invocation" 1
  fi

  if grep -Eqi 'headless|self-asserting' "$README" && grep -Eqi 'guided|interactive launcher' "$README"; then
    assert "README distinguishes headless self-asserting vs guided-launcher scenarios" 0
  else
    assert "README distinguishes headless self-asserting vs guided-launcher scenarios" 1
  fi

  if grep -Eqi 'checkpoint' "$README"; then
    assert "README documents each scenario's completion checkpoint" 0
  else
    assert "README documents each scenario's completion checkpoint" 1
  fi
else
  assert "examples/README.md exists" 1
  assert "README lists the 'inline' scenario" 1
  assert "README lists the 'interactive' scenario" 1
  assert "README lists the 'daemon' scenario" 1
  assert "README lists the 'engineer' scenario" 1
  assert "README lists the 'intake-loop' scenario" 1
  assert "README documents the ./<flow>.sh [s|m|l] invocation" 1
  assert "README distinguishes headless self-asserting vs guided-launcher scenarios" 1
  assert "README documents each scenario's completion checkpoint" 1
fi

echo ""
echo "=== Story 1 negative path: usage on --help / unknown tier ==="

examples_fixture_setup
trap examples_fixture_teardown EXIT

INLINE_SCRIPT="$EXAMPLES_DIR/inline.sh"

set +e
HELP_OUT=$("$INLINE_SCRIPT" --help 2>&1 </dev/null)
HELP_STATUS=$?
set -e

assert "inline.sh --help exits non-zero" "$([ "$HELP_STATUS" -ne 0 ] && echo 0 || echo 1)"
case "$HELP_OUT" in
  *"s"*"m"*"l"*|*"small"*"medium"*"large"*)
    assert "inline.sh --help prints usage naming valid tiers (s|m|l)" 0
    ;;
  *)
    echo "$HELP_OUT"
    assert "inline.sh --help prints usage naming valid tiers (s|m|l)" 1
    ;;
esac

set +e
BAD_TIER_OUT=$("$INLINE_SCRIPT" xl 2>&1 </dev/null)
BAD_TIER_STATUS=$?
set -e

assert "inline.sh xl (unknown tier) exits non-zero" "$([ "$BAD_TIER_STATUS" -ne 0 ] && echo 0 || echo 1)"
case "$BAD_TIER_OUT" in
  *"s"*"m"*"l"*|*"small"*"medium"*"large"*)
    assert "inline.sh xl prints usage naming valid tiers (s|m|l)" 0
    ;;
  *)
    echo "$BAD_TIER_OUT"
    assert "inline.sh xl prints usage naming valid tiers (s|m|l)" 1
    ;;
esac

ARGV_AFTER_BAD_INPUT="$(examples_fixture_argv)"
assert "no flow (conduct-ts) was run for --help or an unknown tier" "$([ -z "$ARGV_AFTER_BAD_INPUT" ] && echo 0 || echo 1)"

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
