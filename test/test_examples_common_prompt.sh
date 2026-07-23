#!/usr/bin/env bash
set -uo pipefail

# test_examples_common_prompt.sh — RED acceptance specs for Story 3
# (.docs/stories/flow-examples.md, "tiered prompt fixtures") and the
# resolve_prompt half of Story 2's lib/common.sh (plan Task 3).
#
# Only the deterministic resolution paths are automated here: a tier arg
# (short or long form), and no-arg + no-TTY. The no-arg + TTY interactive
# prompt ("Which prompt? [s/m/l]") requires a real pseudo-tty to drive
# non-interactively and is left as a manual/operator check — automating a
# pty harness for one prompt line is not justified by this story's stakes.
# This is a scoped-down assumption, not a silent gap: it is called out here
# so the /tdd implementer and reviewer both see it.
#
# Usage: ./test/test_examples_common_prompt.sh

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

echo "=== Story 3 happy path: a tier arg resolves prompts/<tier>.md ==="

if [ -f "$COMMON_LIB" ]; then
  assert "examples/lib/common.sh exists" 0

  for pair in "medium:medium" "m:medium" "s:small" "l:large"; do
    arg="${pair%%:*}"
    want="${pair##*:}"
    OUT=$(
      cd "$EXAMPLES_DIR" || exit 1
      # shellcheck source=/dev/null
      source "$COMMON_LIB"
      resolve_prompt "$arg" 2>/dev/null
    )
    case "$OUT" in
      *"prompts/${want}.md")
        assert "resolve_prompt ${arg} -> prompts/${want}.md" 0
        ;;
      *)
        echo "  got: '${OUT}'"
        assert "resolve_prompt ${arg} -> prompts/${want}.md" 1
        ;;
    esac
  done
else
  assert "examples/lib/common.sh exists" 1
  assert "resolve_prompt medium -> prompts/medium.md" 1
  assert "resolve_prompt m -> prompts/medium.md" 1
  assert "resolve_prompt s -> prompts/small.md" 1
  assert "resolve_prompt l -> prompts/large.md" 1
fi

echo ""
echo "=== Story 3 negative path: no arg + no TTY errors, never defaults ==="

if [ -f "$COMMON_LIB" ]; then
  set +e
  NO_TTY_OUT=$(
    cd "$EXAMPLES_DIR" || exit 1
    # shellcheck source=/dev/null
    source "$COMMON_LIB"
    resolve_prompt </dev/null 2>&1
  )
  NO_TTY_STATUS=$?
  set -e

  assert "resolve_prompt with no arg and no TTY exits non-zero" \
    "$([ "$NO_TTY_STATUS" -ne 0 ] && echo 0 || echo 1)"
  case "$NO_TTY_OUT" in
    *"prompts/small.md"|*"prompts/medium.md"|*"prompts/large.md")
      echo "  got: '${NO_TTY_OUT}'"
      assert "never silently defaults to a tier" 1
      ;;
    *)
      assert "never silently defaults to a tier" 0
      ;;
  esac
  case "$NO_TTY_OUT" in
    *"s"*"m"*"l"*|*"small"*"medium"*"large"*|*sage*|*Usage*)
      assert "prints usage when it cannot resolve a tier" 0
      ;;
    *)
      echo "  got: '${NO_TTY_OUT}'"
      assert "prints usage when it cannot resolve a tier" 1
      ;;
  esac
else
  assert "resolve_prompt with no arg and no TTY exits non-zero" 1
  assert "never silently defaults to a tier" 1
  assert "prints usage when it cannot resolve a tier" 1
fi

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
