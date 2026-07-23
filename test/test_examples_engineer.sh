#!/usr/bin/env bash
set -uo pipefail

# test_examples_engineer.sh — RED acceptance specs for Story 7
# (.docs/stories/flow-examples.md, "engineer flow example (headless
# primitives + guided full loop)") and the examples/fixtures/engineer/
# fixture (plan Task 10).
#
# conduct-ts is stubbed at the PATH boundary (see test_examples_inline.sh for
# the rationale). The stub's engineer subcommands mirror the real CLI JSON
# kinds verified against src/conductor/src/engine/engineer-cli.ts:
# {kind:'worktree',...}, {kind:'land'}/{kind:'reject'} (via stderr + exit 1),
# {kind:'pr-opened',url}/{kind:'local-commit'} for handoff.
#
# Usage: ./test/test_examples_engineer.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
ENGINEER_SCRIPT="$EXAMPLES_DIR/engineer.sh"
ENGINEER_FIXTURE_DIR="$EXAMPLES_DIR/fixtures/engineer"
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

echo "=== Task 10 fixture: examples/fixtures/engineer/ ==="

if [ -d "$ENGINEER_FIXTURE_DIR" ] && ! grep -rl "^Status: DRAFT" "$ENGINEER_FIXTURE_DIR" >/dev/null 2>&1; then
  assert "engineer fixture exists with no DRAFT ADR" 0
else
  assert "engineer fixture exists with no DRAFT ADR" 1
fi

if find "$ENGINEER_FIXTURE_DIR" -path "*stories*" -name "*.md" 2>/dev/null | xargs grep -l "^Status: Accepted" >/dev/null 2>&1; then
  assert "engineer fixture stories are Accepted" 0
else
  assert "engineer fixture stories are Accepted" 1
fi

echo ""
echo "=== Story 7 happy path (headless): worktree -> land -> handoff reaches pr-opened/local-commit ==="

examples_fixture_setup
trap examples_fixture_teardown EXIT
examples_fixture_set_mode done

set +e
HAPPY_OUT=$(timeout 30 "$ENGINEER_SCRIPT" medium 2>&1 </dev/null)
HAPPY_STATUS=$?
set -e

assert "engineer.sh medium exits 0 on pr-opened/local-commit" "$([ "$HAPPY_STATUS" -eq 0 ] && echo 0 || echo 1)"
case "$HAPPY_OUT" in
  *"PASS engineer/medium"*)
    assert "prints 'PASS engineer/medium'" 0
    ;;
  *)
    echo "$HAPPY_OUT"
    assert "prints 'PASS engineer/medium'" 1
    ;;
esac

ARGV="$(examples_fixture_argv)"
case "$ARGV" in
  *"engineer worktree"*|*"engineer"*"worktree"*)
    assert "invokes engineer worktree" 0
    ;;
  *)
    echo "  argv log: '${ARGV}'"
    assert "invokes engineer worktree" 1
    ;;
esac
case "$ARGV" in
  *"engineer land"*|*"engineer"*"land"*)
    assert "invokes engineer land" 0
    ;;
  *)
    assert "invokes engineer land" 1
    ;;
esac
case "$ARGV" in
  *"engineer handoff"*|*"engineer"*"handoff"*)
    assert "invokes engineer handoff" 0
    ;;
  *)
    assert "invokes engineer handoff" 1
    ;;
esac

echo ""
echo "=== Story 7 happy path (guided): --interactive execs the full conduct-ts engineer loop ==="

examples_fixture_teardown
examples_fixture_setup
examples_fixture_set_mode done

set +e
GUIDED_OUT=$(timeout 30 "$ENGINEER_SCRIPT" medium --interactive 2>&1 </dev/null)
GUIDED_STATUS=$?
set -e

assert "engineer.sh medium --interactive exits 0 (the stubbed conduct-ts exits 0)" \
  "$([ "$GUIDED_STATUS" -eq 0 ] && echo 0 || echo 1)"

GUIDED_ARGV="$(examples_fixture_argv)"
case "$GUIDED_ARGV" in
  *"engineer"*)
    assert "execs the real conduct-ts engineer loop after sandbox setup" 0
    ;;
  *)
    echo "  argv log: '${GUIDED_ARGV}'"
    assert "execs the real conduct-ts engineer loop after sandbox setup" 1
    ;;
esac

echo ""
echo "=== Story 7 negative path: land rejects the fixture ==="

examples_fixture_teardown
examples_fixture_setup
examples_fixture_set_mode reject

set +e
NEG_OUT=$(timeout 30 "$ENGINEER_SCRIPT" medium 2>&1 </dev/null)
NEG_STATUS=$?
set -e

assert "engineer.sh medium exits non-zero when land rejects the fixture" \
  "$([ "$NEG_STATUS" -ne 0 ] && echo 0 || echo 1)"
case "$NEG_OUT" in
  *"FAIL engineer/medium: land rejected"*"DRAFT ADR present"*)
    assert "prints 'FAIL engineer/medium: land rejected — <reason>' surfacing the guard message" 0
    ;;
  *)
    echo "$NEG_OUT"
    assert "prints 'FAIL engineer/medium: land rejected — <reason>' surfacing the guard message" 1
    ;;
esac

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
