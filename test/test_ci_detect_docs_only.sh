#!/usr/bin/env bash
set -uo pipefail

# test_ci_detect_docs_only.sh — tests for
# .github/scripts/ci-detect-docs-only.sh (Task 1, commit 9bfdb7c4).
#
# The script reads a newline-delimited list of changed file paths from
# stdin and prints exactly one line: docs_only=true or docs_only=false.
#
#   - empty stdin                          -> docs_only=false
#   - every non-empty line matches ^\.docs/ -> docs_only=true
#   - any other line                        -> docs_only=false

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DETECT_BIN="$HARNESS_DIR/.github/scripts/ci-detect-docs-only.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert_eq() {
  local desc=$1
  local expected=$2
  local actual=$3
  TOTAL=$((TOTAL + 1))
  if [ "$expected" = "$actual" ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc} (expected: '${expected}', got: '${actual}')"
    FAIL=$((FAIL + 1))
  fi
}

echo -e "${BOLD}ci-detect-docs-only.sh${NC}"

out=$(printf '.docs/a.md\n.docs/a/b.md\n' | "$DETECT_BIN")
assert_eq "all-.docs list (including nested path) -> docs_only=true" \
  "docs_only=true" "$out"

out=$(printf '.docs/x.md\nsrc/conductor/src/index.ts\n' | "$DETECT_BIN")
assert_eq "mixed list -> docs_only=false" \
  "docs_only=false" "$out"

out=$(printf 'bin/conduct\n' | "$DETECT_BIN")
assert_eq "single non-doc line -> docs_only=false" \
  "docs_only=false" "$out"

out=$(printf '.docsaurus/x\n.docs\n' | "$DETECT_BIN")
assert_eq "lookalikes (.docsaurus/x, bare .docs) -> docs_only=false" \
  "docs_only=false" "$out"

out=$(printf '' | "$DETECT_BIN")
assert_eq "empty stdin -> docs_only=false" \
  "docs_only=false" "$out"

echo ""
echo -e "${BOLD}Results: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${FAIL} assertion(s) failed.${NC}"
  exit 1
fi
echo -e "${GREEN}All ci-detect-docs-only tests passed.${NC}"
exit 0
