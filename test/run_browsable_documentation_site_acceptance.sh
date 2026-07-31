#!/usr/bin/env bash
set -uo pipefail

# Deterministic runner for the acceptance specs generated from
# .docs/stories/browsable-documentation-site.md.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPECS=(
  "test_docs_navigation.sh"
  "test_docs_pages_smoke.sh"
)

EXECUTED=0
PASSED=0
FAILED=0

for spec in "${SPECS[@]}"; do
  EXECUTED=$((EXECUTED + 1))
  printf '########## %s ##########\n' "$spec"
  if bash "$SCRIPT_DIR/$spec"; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
  printf '\n'
done

printf '=== browsable-documentation-site acceptance specs: %s/%s spec files passed (%s failed) ===\n' \
  "$PASSED" "$EXECUTED" "$FAILED"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
