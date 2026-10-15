#!/usr/bin/env bash
# Covers: task:6
set -uo pipefail

# test_docs_guard_drift_fixture.sh — proves the docs-guard drift fixture uses
# a disposable copy, leaving the committed hook untouched.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHECKER="${SCRIPT_DIR}/check_docs_guard_drift_fixture.sh"
HOOK="${HARNESS_DIR}/hooks/claude/docs-guard.sh"
BASH_BIN="${BASH:-$(command -v bash)}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=0
FAIL=0

assert() {
  local description=$1 result=$2
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${description}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${description}"
    FAIL=$((FAIL + 1))
  fi
}

if [ ! -f "$CHECKER" ]; then
  echo "Missing checker: $CHECKER"
  exit 1
fi

before_hash=$(sha256sum "$HOOK" | awk '{print $1}')
OUT=$("$BASH_BIN" "$CHECKER" 2>&1)
CODE=$?
after_hash=$(sha256sum "$HOOK" | awk '{print $1}')
hook_status=$(git -C "$HARNESS_DIR" status --porcelain hooks/claude/docs-guard.sh)

echo ""
echo "Docs-guard drift fixture — fixture spec"

assert "checker passes because the generator reports drift (exit 1) for its corrupted temporary copy" \
  "$( [ "$CODE" -eq 0 ] && printf '%s\n' "$OUT" | grep -Fq 'generator detected drift in temporary copy (exit 1)' && echo 0 || echo 1)"
assert "tracked docs-guard hook hash remains identical after the drift fixture" \
  "$( [ "$before_hash" = "$after_hash" ] && echo 0 || echo 1)"
assert "tracked docs-guard hook remains absent from git status after the drift fixture" \
  "$( [ -z "$hook_status" ] && echo 0 || echo 1)"

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
