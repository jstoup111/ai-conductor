#!/usr/bin/env bash
set -uo pipefail

# Deterministic feature-level runner consumed by the acceptance RED evidence.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FAILURES=0

run_spec() {
  local name=$1
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@"; then
    return 0
  fi
  FAILURES=$((FAILURES + 1))
  return 0
}

run_spec 'Codex installation' "$SCRIPT_DIR/test_codex_skill_installation.sh"
run_spec 'Codex repository guidance' "$SCRIPT_DIR/test_codex_guidance_contract.sh"
run_spec 'Shared provider skill contracts' "$SCRIPT_DIR/test_provider_skill_contracts.sh"

printf '\n=== Daemon provider-native lifecycle dispatch ===\n'
if (
  cd "$HARNESS_DIR/src/conductor" || exit 1
  npm test -- --run test/acceptance/first-class-codex-harness-parity-904.acceptance.test.ts
); then
  :
else
  FAILURES=$((FAILURES + 1))
fi

printf '\n#904 acceptance files failing: %d of 4\n' "$FAILURES"
[ "$FAILURES" -eq 0 ]
