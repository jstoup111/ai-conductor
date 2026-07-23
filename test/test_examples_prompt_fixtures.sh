#!/usr/bin/env bash
set -uo pipefail

# test_examples_prompt_fixtures.sh — acceptance spec for plan Task 5
# (.docs/plans/flow-examples.md, "Tiered prompt fixtures
# prompts/{small,medium,large}.md").
#
# Acceptance: three files exist, non-empty, tier-appropriate size.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPTS_DIR="$HARNESS_DIR/examples/prompts"

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

echo "=== Task 5: tiered prompt fixtures exist and are non-empty ==="

declare -A SIZES

for tier in small medium large; do
  f="$PROMPTS_DIR/${tier}.md"
  if [ -s "$f" ]; then
    assert "examples/prompts/${tier}.md exists and is non-empty" 0
    SIZES[$tier]=$(wc -c < "$f")
  else
    assert "examples/prompts/${tier}.md exists and is non-empty" 1
    SIZES[$tier]=0
  fi
done

echo ""
echo "=== Task 5: tier-appropriate sizing (small < medium < large) ==="

if [ "${SIZES[small]:-0}" -gt 0 ] && [ "${SIZES[medium]:-0}" -gt 0 ] && [ "${SIZES[large]:-0}" -gt 0 ]; then
  if [ "${SIZES[small]}" -lt "${SIZES[medium]}" ] && [ "${SIZES[medium]}" -lt "${SIZES[large]}" ]; then
    assert "small.md < medium.md < large.md in size" 0
  else
    assert "small.md < medium.md < large.md in size" 1
  fi
else
  assert "small.md < medium.md < large.md in size" 1
fi

echo ""
echo "=== Task 5: large.md reads as multi-story, small.md as single-function ==="

if [ -f "$PROMPTS_DIR/large.md" ] && grep -qi "story" "$PROMPTS_DIR/large.md"; then
  assert "large.md contains multiple stories (multi-story feature)" 0
else
  assert "large.md contains multiple stories (multi-story feature)" 1
fi

if [ -f "$PROMPTS_DIR/small.md" ] && grep -qiE "function|utility" "$PROMPTS_DIR/small.md"; then
  assert "small.md describes a single function/utility" 0
else
  assert "small.md describes a single function/utility" 1
fi

echo ""
echo "=== Summary: ${PASS}/${TOTAL} passed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
