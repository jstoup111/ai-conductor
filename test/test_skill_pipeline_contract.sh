#!/usr/bin/env bash
set -euo pipefail

# test_skill_pipeline_contract.sh — Validates cross-skill pipeline contracts.
# Pipeline documents session-hook task stamping rather than imperative task
# CLI calls, and finish delegates aggregate verification to the configured verifier.
#
# Usage: ./test/test_skill_pipeline_contract.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_FILE="${HARNESS_DIR}/skills/pipeline/SKILL.md"
CODE_REVIEW_SKILL="${HARNESS_DIR}/skills/code-review/SKILL.md"
FINISH_SKILL_FILE="${HARNESS_DIR}/skills/finish/SKILL.md"
PR_SKILL_FILE="${HARNESS_DIR}/skills/pr/SKILL.md"
ENGINEER_SKILL_FILE="${HARNESS_DIR}/skills/engineer/SKILL.md"
CONDUCT_SKILL_FILE="${HARNESS_DIR}/skills/conduct/SKILL.md"
BOOTSTRAP_SKILL_FILE="${HARNESS_DIR}/skills/bootstrap/SKILL.md"
CI_WORKFLOW_FILE="${HARNESS_DIR}/.github/workflows/ci.yml"
AUTORESOLVE_FILE="${HARNESS_DIR}/src/conductor/src/engine/autoresolve.ts"
CI_FIX_FILE="${HARNESS_DIR}/src/conductor/src/engine/ci-fix.ts"
SCOPE_CONTRACT_FILES=(
  "skills/tdd/SKILL.md"
  "skills/tdd/references/green.md"
  "skills/debugging/SKILL.md"
  "skills/pipeline/SKILL.md"
  "skills/code-review/SKILL.md"
  "skills/conduct/SKILL.md"
  "HARNESS.md"
)
LEGACY_TEST_SUITE_SKILL="${HARNESS_DIR}/skills/test-suite"

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

# This is a machine-consumed conduct contract, so inspect the entire skill rather
# than coupling the assertion to a section heading or source-file position.
conduct_suite_guidance_contract_holds() {
  local skill_file="$1"

  grep -qF 'conduct-ts test-suite' "$skill_file" \
    && grep -qF 'EXECUTED PASS' "$skill_file" \
    && grep -qF 'REUSED PASS' "$skill_file" \
    && grep -qiE 'non-zero exit.*BLOCKS' "$skill_file" \
    && grep -qF 'BUILD remediation' "$skill_file" \
    && grep -qF '/tdd' "$skill_file" \
    && grep -qF '/pipeline' "$skill_file" \
    && ! grep -qiE '(^|[^[:alnum:]_-])[/\$]test-suite\b|test-suite[[:space:]]+(skill|model)|(skill|model)[[:space:]]+test-suite' "$skill_file"
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

if grep -qF "The originating GitHub issue's assignees MUST remain unchanged throughout claim, land, handoff, verification, and cleanup; the engineer loop MUST NOT add, remove, or change assignees." "$ENGINEER_SKILL_FILE"; then
  pass "engineer preserves originating GitHub issue assignees throughout its lifecycle"
else
  fail "engineer must preserve originating GitHub issue assignees throughout claim, land, handoff, verification, and cleanup without adding, removing, or changing them"
fi

if [ -e "$LEGACY_TEST_SUITE_SKILL" ]; then
  fail "legacy skills/test-suite directory must be absent"
else
  pass "legacy skills/test-suite directory is absent"
fi

if rg -n '(^|[^[:alnum:]_-])(/test-suite|\$test-suite)([^[:alnum:]_-]|$)|skills/test-suite([^[:alnum:]_-]|$)' \
  "${SHIPPED_WORKFLOW_CONTRACTS[@]}" \
  --glob '*.md' --glob '*.yml' --glob '*.yaml' \
  >/tmp/pipeline_contract_test_suite_surface_hits.$$ 2>/dev/null; then
  cat /tmp/pipeline_contract_test_suite_surface_hits.$$ >&2
  rm -f /tmp/pipeline_contract_test_suite_surface_hits.$$
  fail "shipped skills and workflow contracts must not directly invoke or reference the removed test-suite skill"
else
  rm -f /tmp/pipeline_contract_test_suite_surface_hits.$$
  pass "shipped skills and workflow contracts contain no direct test-suite skill invocation or reference"
fi

if rg -n 'src/conductor|HARNESS\.md|bin/conduct([^[:alnum:]_-]|$)|conduct-ts[[:space:]]+test-suite' "$HARNESS_DIR/skills" --glob '*.md' 2>/dev/null \
  | grep -vF "${CONDUCT_SKILL_FILE}:" \
  | grep -vF "${BOOTSTRAP_SKILL_FILE}:" >/tmp/pipeline_contract_genericity_hits.$$; then
  cat /tmp/pipeline_contract_genericity_hits.$$ >&2
  rm -f /tmp/pipeline_contract_genericity_hits.$$
  fail "reusable skills contain a project-specific verifier command, path, legacy runner name, or harness-file reference"
else
  rm -f /tmp/pipeline_contract_genericity_hits.$$
  pass "all reusable skills are free of project-specific verifier commands, paths, legacy runner names, and harness-file references"
fi

if [ ! -f "$CONDUCT_SKILL_FILE" ]; then
  fail "skills/conduct/SKILL.md exists for deterministic suite guidance"
else
  mutated_conduct_skill="$(mktemp "${TMPDIR:-/tmp}/conduct-suite-guidance.XXXXXX")"
  trap 'rm -f "$mutated_conduct_skill"' EXIT

  # Negative control: remove every required guidance statement from an isolated
  # copy. The semantic predicate must reject that copy before it accepts the
  # production skill.
  sed -E '/conduct-ts test-suite|EXECUTED PASS|REUSED PASS|non-zero exit BLOCKS|BUILD remediation|`\/tdd` or `\/pipeline`/d' \
    "$CONDUCT_SKILL_FILE" >"$mutated_conduct_skill"

  if conduct_suite_guidance_contract_holds "$mutated_conduct_skill"; then
    fail "deterministic suite guidance predicate rejects an absent-guidance fixture"
  else
    pass "deterministic suite guidance predicate rejects an absent-guidance fixture"
  fi

  if conduct_suite_guidance_contract_holds "$CONDUCT_SKILL_FILE"; then
    pass "conduct uses deterministic suite CLI, accepts proof reuse, blocks failures, and has no skill/model fallback"
  else
    fail "conduct must use deterministic suite CLI, accept proof reuse, block failures, and forbid skill/model fallback"
  fi
fi

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

if grep -qiE 'configured aggregate verifier' <<<"$FINISH_SUITE_SECTION" \
  && ! grep -q 'conduct-ts test-suite' <<<"$FINISH_SUITE_SECTION"; then
  pass "finish delegates aggregate verification to the configured verifier"
else
  fail "finish must delegate aggregate verification without a project CLI name"
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

PR_PRE_PUSH_SECTION="$(awk '
  /^### 5\. Pre-Push Verification/ { in_section = 1; next }
  /^### 6\. Create or Update the PR/ { in_section = 0 }
  in_section
' "$PR_SKILL_FILE")"
PR_AGGREGATE_COMMAND_PATTERN='npm( run)? test|pnpm( run)? test|yarn( run)? test|bun test|npx vitest run|go test|cargo test|bundle exec rspec|pytest|mvn test|gradle test|dotnet test|mix test|conduct-ts test-suite|full (test )?suite'

pr_guard_covers_raw_commands=true
for raw_command in 'npx vitest run' 'npm run test' 'go test ./...'; do
  if ! grep -qiE "$PR_AGGREGATE_COMMAND_PATTERN" <<<"$raw_command"; then
    pr_guard_covers_raw_commands=false
  fi
done

if [ "$pr_guard_covers_raw_commands" = true ]; then
  pass "PR aggregate guard recognizes representative raw project commands"
else
  fail "PR aggregate guard must recognize npx vitest run, npm run test, and go test"
fi

if grep -qiE 'completion verification|/finish' <<<"$PR_PRE_PUSH_SECTION" \
  && ! grep -qiE "$PR_AGGREGATE_COMMAND_PATTERN" <<<"$PR_PRE_PUSH_SECTION"; then
  pass "PR preparation reuses completion verification without a local aggregate run"
else
  fail "PR preparation must defer local aggregate verification to finish"
fi

if grep -qE -- '- run: (npm test|npx vitest run)' "$CI_WORKFLOW_FILE" \
  && grep -qE 'needs: .*conductor' "$CI_WORKFLOW_FILE" \
  && grep -q 'failure|cancelled' "$CI_WORKFLOW_FILE" \
  && ! grep -q 'test-suite-evidence.json' "$CI_WORKFLOW_FILE"; then
  pass "CI independently runs and blocks on its authoritative conductor tests"
else
  fail "CI must independently run authoritative tests without local evidence"
fi

if grep -qiE 'suiteCommand|suite command' "$AUTORESOLVE_FILE" \
  && grep -q 'runSuiteGate' "$CI_FIX_FILE" \
  && ! grep -q 'test-suite-evidence.json' "$AUTORESOLVE_FILE" \
  && ! grep -q 'test-suite-evidence.json' "$CI_FIX_FILE"; then
  pass "autoresolve and CI repair retain evidence-independent mutation checks"
else
  fail "autoresolve and CI repair must retain evidence-independent mutation checks"
fi

for relative_path in "${SCOPE_CONTRACT_FILES[@]}"; do
  scope_file="${HARNESS_DIR}/${relative_path}"
  if grep -qiE 'affected[-/ ]test|scoped (test|set)|impacted test|union[- ]of[- ]affected' "$scope_file"; then
    pass "${relative_path} defaults intermediate verification to affected tests"
  else
    fail "${relative_path} must default intermediate verification to affected tests"
  fi

  if grep -qiE 'run the full test suite|full test suite passes|full suite green|always run full suite|pre-batch verification \(full test suite|test results \(full suite output\)' "$scope_file"; then
    fail "${relative_path} still mandates an unconditional aggregate run"
  else
    pass "${relative_path} has no unconditional aggregate-run mandate"
  fi
done

SCOPE_CONTRACT_TEXT="$(printf '%s\n' "${SCOPE_CONTRACT_FILES[@]}" | while read -r relative_path; do cat "${HARNESS_DIR}/${relative_path}"; done)"
GENERIC_SCOPE_TEXT="$(printf '%s\n' "${SCOPE_CONTRACT_FILES[@]}" | while read -r relative_path; do
  case "$relative_path" in
    skills/conduct/SKILL.md) ;;
    skills/*) cat "${HARNESS_DIR}/${relative_path}" ;;
  esac
done)"
TDD_RED_SECTION="$(awk '
  /^### Phase 1: RED/ { in_red = 1; next }
  /^### Phase 2: DOMAIN/ { in_red = 0 }
  in_red
' "${HARNESS_DIR}/skills/tdd/SKILL.md")"
TDD_RED_TEXT="$(tr '\n' ' ' <<<"$TDD_RED_SECTION")"

if grep -qiE 'scoped union of affected tests' <<<"$TDD_RED_TEXT" \
  && grep -qiE 'test under change.*expected failing member' <<<"$TDD_RED_TEXT" \
  && grep -qiE 'unrelated scoped (test )?failure.*block' <<<"$TDD_RED_TEXT"; then
  pass "TDD RED runs the affected-test union and blocks unrelated scoped failures"
else
  fail "TDD RED must run the affected-test union, retain the expected failing member, and block unrelated scoped failures"
fi

if grep -qiE 'RED/GREEN.*scoped union of affected tests' "${HARNESS_DIR}/HARNESS.md"; then
  pass "HARNESS intermediate policy explicitly includes RED"
else
  fail "HARNESS intermediate policy must explicitly include RED"
fi

if grep -qiE 'configured aggregate verifier' <<<"$SCOPE_CONTRACT_TEXT" \
  && ! grep -q 'conduct-ts test-suite' <<<"$GENERIC_SCOPE_TEXT" \
  && grep -qiE 'shared/core.*3\+|3\+.*(importer|production module)' <<<"$SCOPE_CONTRACT_TEXT" \
  && grep -qiE 'config.*migration.*dependenc.*test infrastructure' <<<"$SCOPE_CONTRACT_TEXT" \
  && grep -qiE 'empty.*(scoped|affected).*(set|union)|(scoped|affected).*(set|union).*empty' <<<"$SCOPE_CONTRACT_TEXT" \
  && grep -qiE 'low-confidence|cannot confidently map' <<<"$SCOPE_CONTRACT_TEXT" \
  && grep -qiE 'name.*trigger|trigger.*reason' <<<"$SCOPE_CONTRACT_TEXT"; then
  pass "aggregate fallback uses the configured verifier and names one of four explicit triggers"
else
  fail "aggregate fallback must use the configured verifier and name one of four explicit triggers"
fi

if grep -qiE 'scoped (test|set).*(fail|failure).*(block|stop)|(fail|failure).*scoped (test|set).*(block|stop)' <<<"$SCOPE_CONTRACT_TEXT"; then
  pass "known scoped failures block their current BUILD activity"
else
  fail "known scoped failures must block their current BUILD activity"
fi

if grep -q 'skills/test-suite' <<<"$SCOPE_CONTRACT_TEXT"; then
  fail "scope-only guidance must not require the deferred skills/test-suite surface"
else
  pass "scope-only guidance does not require the deferred skills/test-suite surface"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All pipeline contract checks passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAIL} pipeline contract check(s) failed.${NC}"
  exit 1
fi
