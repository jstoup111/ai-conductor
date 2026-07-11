#!/usr/bin/env bash
set -euo pipefail

# test_skill_pipeline_contract.sh — Validates skills/pipeline/SKILL.md documents
# the session-hook task-stamping machinery (adr-2026-07-10-session-hook-task-stamping.md)
# rather than instructing the orchestrator to imperatively run the task CLI.
#
# Usage: ./test/test_skill_pipeline_contract.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_FILE="${HARNESS_DIR}/skills/pipeline/SKILL.md"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

FAIL=0

fail() {
  echo -e "  ${RED}FAIL${NC} $1"
  FAIL=$((FAIL + 1))
}

pass() {
  echo -e "  ${GREEN}PASS${NC} $1"
}

if [ ! -f "$SKILL_FILE" ]; then
  fail "skills/pipeline/SKILL.md exists"
  exit 1
fi
pass "skills/pipeline/SKILL.md exists"

# Must NOT contain imperative "Run `conduct-ts task start`" / "Run `conduct-ts task done`"
if grep -nE '(^|[^`])Run `conduct-ts task (start|done)' "$SKILL_FILE" >/tmp/pipeline_contract_hits.$$ 2>/dev/null; then
  fail "no imperative 'Run \`conduct-ts task start/done\`' text"
  cat /tmp/pipeline_contract_hits.$$
  rm -f /tmp/pipeline_contract_hits.$$
else
  pass "no imperative 'Run \`conduct-ts task start/done\`' text"
  rm -f /tmp/pipeline_contract_hits.$$
fi

# Must describe the session-hook marker contract
if grep -q 'Task: <id>' "$SKILL_FILE" && grep -q 'Task: none' "$SKILL_FILE"; then
  pass "documents line-1 dispatch marker contract (Task: <id> / Task: none)"
else
  fail "missing line-1 dispatch marker contract (Task: <id> / Task: none)"
fi

# Must reference the session-hook ADR or PreToolUse/PostToolUse hooks
if grep -qE 'PreToolUse|PostToolUse|session-hook-task-stamping' "$SKILL_FILE"; then
  pass "references session-hook machinery"
else
  fail "missing reference to session-hook machinery"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All pipeline contract checks passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAIL} pipeline contract check(s) failed.${NC}"
  exit 1
fi
