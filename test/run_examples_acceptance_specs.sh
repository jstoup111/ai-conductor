#!/usr/bin/env bash
set -uo pipefail

# run_examples_acceptance_specs.sh — runs every acceptance spec generated for
# .docs/stories/flow-examples.md and reports an aggregate PASS/FAIL count.
# This is the single deterministic entry point recorded in
# .pipeline/acceptance-specs-run.json for the engine's self-heal runner.
#
# Usage: ./test/run_examples_acceptance_specs.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SPECS=(
  "test_examples_readme_and_usage.sh"
  "test_examples_common_sandbox.sh"
  "test_examples_common_prompt.sh"
  "test_examples_inline.sh"
  "test_examples_interactive.sh"
  "test_examples_daemon.sh"
  "test_examples_engineer.sh"
  "test_examples_intake_loop.sh"
)

EXECUTED=0
PASSED=0
FAILED=0

for spec in "${SPECS[@]}"; do
  EXECUTED=$((EXECUTED + 1))
  echo "########## ${spec} ##########"
  if bash "${SCRIPT_DIR}/${spec}"; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
  echo ""
done

echo "=== flow-examples acceptance specs: ${PASSED}/${EXECUTED} spec files passed (${FAILED} failed) ==="
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
