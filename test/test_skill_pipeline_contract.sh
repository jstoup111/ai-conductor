#!/usr/bin/env bash
set -euo pipefail

# test_skill_pipeline_contract.sh — Validates cross-skill pipeline contracts.
# Pipeline documents session-hook task stamping rather than imperative task
# CLI calls, and finish delegates aggregate verification to the shared CLI.
#
# Usage: ./test/test_skill_pipeline_contract.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_FILE="${HARNESS_DIR}/skills/pipeline/SKILL.md"
CODE_REVIEW_SKILL="${HARNESS_DIR}/skills/code-review/SKILL.md"
FINISH_SKILL_FILE="${HARNESS_DIR}/skills/finish/SKILL.md"

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

if [ ! -f "$FINISH_SKILL_FILE" ]; then
  fail "skills/finish/SKILL.md exists"
  exit 1
fi
pass "skills/finish/SKILL.md exists"

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

# Batch verification and its evaluator must share one named affected-test union, retaining a full-suite fallback.
if [ -f "$CODE_REVIEW_SKILL" ] \
  && grep -qF 'Batch verification MUST run only the named `BATCH_AFFECTED_TESTS` union.' "$SKILL_FILE" \
  && grep -qF 'The evaluator MUST receive that same `BATCH_AFFECTED_TESTS` union and its result set.' "$SKILL_FILE" \
  && grep -qF 'Only when `BATCH_AFFECTED_TESTS` cannot be determined with confidence MUST the full test suite run instead.' "$SKILL_FILE" \
  && grep -qF 'For batch reviews, use the provided `BATCH_AFFECTED_TESTS` result set; require a full-suite result only when the batch scope was indeterminate.' "$CODE_REVIEW_SKILL" \
  && ! tr '\n' ' ' < "$SKILL_FILE" \
    | grep -oiE 'batch boundar(y|ies).{0,200}full (test )?suite|full (test )?suite.{0,200}batch boundar(y|ies)' \
    | grep -viE 'uncertain|cannot be determined|fallback|only when' >/dev/null \
  && ! tr '\n' ' ' < "$CODE_REVIEW_SKILL" \
    | grep -oiE '.{0,160}(batch.{0,200}full[- ](test )?suite|full[- ](test )?suite.{0,200}batch|test results \(full suite output\)).{0,160}' \
    | grep -viE 'indeterminate|uncertain|cannot be determined|fallback|only when' >/dev/null; then
  pass "batch verification and evaluator use affected-test union with uncertainty fallback"
else
  fail "batch verification and evaluator must use affected-test union, with full suite only when scope is uncertain"
fi

FINISH_SUITE_SECTION="$(sed -n '/^### 1\. Fresh Verification/,/^### 1b\./p' "$FINISH_SKILL_FILE")"

if grep -q 'conduct-ts test-suite' <<<"$FINISH_SUITE_SECTION"; then
  pass "finish delegates aggregate verification to conduct-ts test-suite"
else
  fail "finish does not delegate aggregate verification to conduct-ts test-suite"
fi

if grep -q 'EXECUTED' <<<"$FINISH_SUITE_SECTION" && grep -q 'REUSED' <<<"$FINISH_SUITE_SECTION"; then
  pass "finish accepts both EXECUTED and REUSED passing proof"
else
  fail "finish must recognize both EXECUTED and REUSED passing proof"
fi

if grep -qiE '\*\*Full test suite\*\*.*Run it fresh|Run (it|the full test suite) fresh' <<<"$FINISH_SUITE_SECTION"; then
  fail "finish still mandates an unconditional fresh aggregate process run"
else
  pass "finish has no unconditional fresh aggregate process-run mandate"
fi

if grep -qiE 'npm (test|run test)|npx (vitest|jest)|(^|[[:space:]])pytest([[:space:]]|$)|bundle exec rspec|go test' "$FINISH_SKILL_FILE"; then
  fail "finish contains a raw project-suite command"
else
  pass "finish contains no raw project-suite command"
fi

if grep -qiE 'non-?zero' <<<"$FINISH_SUITE_SECTION" \
  && grep -q 'STOP' <<<"$FINISH_SUITE_SECTION" \
  && grep -q 'finish-choice' <<<"$FINISH_SUITE_SECTION" \
  && grep -qiE 'choice|options' <<<"$FINISH_SUITE_SECTION"; then
  pass "finish blocks non-zero verifier results before completion choices"
else
  fail "finish must block non-zero verifier results before choices/finish-choice"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All pipeline contract checks passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAIL} pipeline contract check(s) failed.${NC}"
  exit 1
fi
