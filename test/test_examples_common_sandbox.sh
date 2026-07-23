#!/usr/bin/env bash
set -uo pipefail

# test_examples_common_sandbox.sh — RED acceptance specs for Story 2
# (.docs/stories/flow-examples.md, "shared sandbox + prompt library
# (lib/common.sh)" — sandbox_up/sandbox_down half).
#
# ASSUMPTION (not pinned by the story; low impact, rename-only if wrong):
# sandbox_up exports the fresh project root's path via $SANDBOX_PROJECT_ROOT
# so callers (and this spec) can locate it. Flagged per the verify-claims
# correctness gate rather than silently guessed; the /tdd implementer should
# confirm or rename.
#
# The negative path (timeout kills a wedged flow) drives run_with_timeout,
# which Task 4 also owns — tested here because Story 2's own negative-path
# criterion is written in terms of common.sh's behavior end-to-end
# (kill + FAIL print + sandbox_down + non-zero exit), not run_with_timeout in
# isolation.
#
# Usage: ./test/test_examples_common_sandbox.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLES_DIR="$HARNESS_DIR/examples"
COMMON_LIB="$EXAMPLES_DIR/lib/common.sh"
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

echo "=== Story 2 happy path: sandbox_up isolates state, sandbox_down cleans up ==="

ORIG_HOME="$HOME"
ORIG_REGISTRY="${AI_CONDUCTOR_REGISTRY:-}"
ORIG_ENGINEER_DIR="${AI_CONDUCTOR_ENGINEER_DIR:-}"

if [ -f "$COMMON_LIB" ]; then
  assert "examples/lib/common.sh exists" 0

  # Run in a subshell: sandbox_up/sandbox_down mutate HOME/PATH/traps, and we
  # want the EXIT trap to fire (and be observed) without touching this
  # script's own environment.
  RESULT_FILE=$(mktemp)
  (
    set -uo pipefail
    # shellcheck source=/dev/null
    source "$COMMON_LIB"
    sandbox_up

    {
      [ -n "${SANDBOX_PROJECT_ROOT:-}" ] && [ -d "$SANDBOX_PROJECT_ROOT" ]
      echo "PROJECT_ROOT_SET=$?"
    } >> "$RESULT_FILE"

    {
      [ "$HOME" != "$ORIG_HOME" ]
      echo "HOME_ISOLATED=$?"
    } >> "$RESULT_FILE"

    {
      [ -n "${AI_CONDUCTOR_REGISTRY:-}" ] && [ "$AI_CONDUCTOR_REGISTRY" != "$ORIG_REGISTRY" ]
      echo "REGISTRY_ISOLATED=$?"
    } >> "$RESULT_FILE"

    {
      [ -n "${AI_CONDUCTOR_ENGINEER_DIR:-}" ] && [ "$AI_CONDUCTOR_ENGINEER_DIR" != "$ORIG_ENGINEER_DIR" ]
      echo "ENGINEER_DIR_ISOLATED=$?"
    } >> "$RESULT_FILE"

    {
      git -C "$SANDBOX_PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1
      echo "PROJECT_ROOT_IS_GIT_REPO=$?"
    } >> "$RESULT_FILE"

    echo "SANDBOX_PROJECT_ROOT_PATH=${SANDBOX_PROJECT_ROOT:-}" >> "$RESULT_FILE"
  )
  # shellcheck disable=SC1090
  source "$RESULT_FILE"

  assert "sandbox_up exposes a project root directory" "${PROJECT_ROOT_SET:-1}"
  assert "sandbox_up points HOME at a throwaway root" "${HOME_ISOLATED:-1}"
  assert "sandbox_up points AI_CONDUCTOR_REGISTRY at a throwaway root" "${REGISTRY_ISOLATED:-1}"
  assert "sandbox_up points AI_CONDUCTOR_ENGINEER_DIR at a throwaway root" "${ENGINEER_DIR_ISOLATED:-1}"
  assert "the sandbox project root is a fresh git repo" "${PROJECT_ROOT_IS_GIT_REPO:-1}"

  if [ -n "${SANDBOX_PROJECT_ROOT_PATH:-}" ] && [ -d "$SANDBOX_PROJECT_ROOT_PATH" ]; then
    assert "sandbox_down (EXIT trap) removes the throwaway root after the subshell exits" 1
  else
    assert "sandbox_down (EXIT trap) removes the throwaway root after the subshell exits" 0
  fi

  rm -f "$RESULT_FILE"
else
  assert "examples/lib/common.sh exists" 1
  assert "sandbox_up exposes a project root directory" 1
  assert "sandbox_up points HOME at a throwaway root" 1
  assert "sandbox_up points AI_CONDUCTOR_REGISTRY at a throwaway root" 1
  assert "sandbox_up points AI_CONDUCTOR_ENGINEER_DIR at a throwaway root" 1
  assert "the sandbox project root is a fresh git repo" 1
  assert "sandbox_down (EXIT trap) removes the throwaway root after the subshell exits" 1
fi

echo ""
echo "=== Story 2 negative path: timeout kills a wedged flow ==="

examples_fixture_setup
trap examples_fixture_teardown EXIT
examples_fixture_set_mode hang

INLINE_SCRIPT="$EXAMPLES_DIR/inline.sh"

if [ -x "$INLINE_SCRIPT" ]; then
  START=$(date +%s)
  set +e
  TIMEOUT_OUT=$(timeout 20 "$INLINE_SCRIPT" small 2>&1 </dev/null)
  TIMEOUT_STATUS=$?
  set -e
  END=$(date +%s)
  ELAPSED=$((END - START))

  assert "a wedged flow is killed well before the outer 20s test timeout (per-example timeout enforced)" \
    "$([ "$ELAPSED" -lt 15 ] && echo 0 || echo 1)"
  assert "inline.sh exits non-zero when the flow is killed for wedging" \
    "$([ "$TIMEOUT_STATUS" -ne 0 ] && echo 0 || echo 1)"
  case "$TIMEOUT_OUT" in
    *"FAIL inline/small: timeout"*)
      assert "prints 'FAIL inline/small: timeout'" 0
      ;;
    *)
      echo "$TIMEOUT_OUT"
      assert "prints 'FAIL inline/small: timeout'" 1
      ;;
  esac
else
  assert "a wedged flow is killed well before the outer 20s test timeout (per-example timeout enforced)" 1
  assert "inline.sh exits non-zero when the flow is killed for wedging" 1
  assert "prints 'FAIL inline/small: timeout'" 1
fi

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
