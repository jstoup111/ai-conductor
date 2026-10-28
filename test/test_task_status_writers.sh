#!/usr/bin/env bash
# Covers: task:8, task:9
set -uo pipefail

# test_task_status_writers.sh — Focused fixture spec for
# test/check_task_status_writers.sh. It invokes the checker against disposable
# scan roots so each prohibited writer boundary is observable in isolation.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECKER="${SCRIPT_DIR}/check_task_status_writers.sh"

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

# The aggregate verifier can invoke this fixture after Vitest has installed a
# run root but without forwarding TMPDIR. Prefer that owned root to the real
# system tmpdir so the fixture remains contained.
if [ -n "${AI_CONDUCTOR_TEST_TMP_ROOT:-}" ] && { [ -z "${TMPDIR:-}" ] || [ "$TMPDIR" = "/tmp" ]; }; then
  export TMPDIR="$AI_CONDUCTOR_TEST_TMP_ROOT"
fi
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/task-status-writers-XXXXXX")
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

run_fixture_checker() {
  HARNESS_INTEGRITY_SCAN_ROOT="$1" bash "$CHECKER" 2>&1
}

run_prose_fixture_checker() {
  HARNESS_INTEGRITY_SCAN_ROOT="$1" \
    HARNESS_INTEGRITY_TASK_STATUS_PROSE_ALLOWLIST="${2:-}" \
    bash "$CHECKER" 2>&1
}

writer_failure_is_reported() {
  local root=$1 path=$2 output status
  output=$(run_fixture_checker "$root")
  status=$?
  if [ "$status" -ne 0 ] && [[ "$output" == *"${path}:1:"* ]]; then
    return 0
  fi
  echo "$output" | sed 's/^/    /'
  return 1
}

skills_root="${WORKDIR}/skills-case"
mkdir -p "${skills_root}/skills/x"
printf "%s\n" "echo '{}' > .pipeline/task-status.json" > "${skills_root}/skills/x/run.sh"
writer_failure_is_reported "$skills_root" "skills/x/run.sh"
skills_writer_status=$?
assert "skills/x/run.sh writer exits non-zero and names skills/x/run.sh:1" "$skills_writer_status"

hooks_root="${WORKDIR}/hooks-case"
mkdir -p "${hooks_root}/hooks"
printf "%s\n" "echo '{}' > .pipeline/task-status.json" > "${hooks_root}/hooks/write.sh"
writer_failure_is_reported "$hooks_root" "hooks/write.sh"
hooks_writer_status=$?
assert "hooks/write.sh writer exits non-zero and names hooks/write.sh:1" "$hooks_writer_status"

bin_root="${WORKDIR}/bin-case"
mkdir -p "${bin_root}/bin"
printf "%s\n" "echo '{}' > .pipeline/task-status.json" > "${bin_root}/bin/write.sh"
writer_failure_is_reported "$bin_root" "bin/write.sh"
bin_writer_status=$?
assert "bin/write.sh writer exits non-zero and names bin/write.sh:1" "$bin_writer_status"

clean_root="${WORKDIR}/clean-case"
mkdir -p "${clean_root}/hooks" "${clean_root}/bin" "${clean_root}/skills/x"
printf "%s\n" "echo 'no task status write'" > "${clean_root}/skills/x/run.sh"
clean_output=$(run_fixture_checker "$clean_root")
clean_status=$?
assert "clean fixture tree passes" "$( [ "$clean_status" -eq 0 ] && echo 0 || echo 1 )"
[ "$clean_status" -eq 0 ] || echo "$clean_output" | sed 's/^/    /'

prose_failure_is_reported() {
  local root=$1 path=$2 output status
  output=$(run_prose_fixture_checker "$root")
  status=$?
  if [ "$status" -ne 0 ] && [[ "$output" == *"${path}:1:"* ]]; then
    return 0
  fi
  echo "$output" | sed 's/^/    /'
  return 1
}

completed_root="${WORKDIR}/completed-prose-case"
mkdir -p "${completed_root}/skills/x"
printf '%s\n' 'Mark the task `completed` in `.pipeline/task-status.json`.' > "${completed_root}/skills/x/SKILL.md"
prose_failure_is_reported "$completed_root" "skills/x/SKILL.md"
completed_prose_status=$?
assert "completed SKILL.md instruction exits non-zero and names skills/x/SKILL.md:1" "$completed_prose_status"

skipped_root="${WORKDIR}/skipped-prose-case"
mkdir -p "${skipped_root}/skills/x"
printf '%s\n' 'Set the row to `skipped` in `.pipeline/task-status.json`.' > "${skipped_root}/skills/x/SKILL.md"
prose_failure_is_reported "$skipped_root" "skills/x/SKILL.md"
skipped_prose_status=$?
assert "skipped SKILL.md instruction exits non-zero and names skills/x/SKILL.md:1" "$skipped_prose_status"

allowed_prose_root="${WORKDIR}/allowed-prose-case"
mkdir -p "${allowed_prose_root}/skills/x"
allowed_prose_line='Mark the task `completed` in `.pipeline/task-status.json`.'
printf '%s\n' "$allowed_prose_line" > "${allowed_prose_root}/skills/x/SKILL.md"
allowed_prose_entry="skills/x/SKILL.md|${allowed_prose_line}|legacy instruction covered during migration"
allowed_prose_output=$(run_prose_fixture_checker "$allowed_prose_root" "$allowed_prose_entry")
allowed_prose_status=$?
assert "reasoned prose allowlist entry permits a completed instruction" "$( [ "$allowed_prose_status" -eq 0 ] && echo 0 || echo 1 )"
[ "$allowed_prose_status" -eq 0 ] || echo "$allowed_prose_output" | sed 's/^/    /'

empty_reason_entry="skills/x/SKILL.md|${allowed_prose_line}|"
empty_reason_output=$(run_prose_fixture_checker "$allowed_prose_root" "$empty_reason_entry")
empty_reason_status=$?
if [ "$empty_reason_status" -ne 0 ] && [[ "$empty_reason_output" == *"${empty_reason_entry}"* ]]; then
  empty_reason_assertion=0
else
  empty_reason_assertion=1
  echo "$empty_reason_output" | sed 's/^/    /'
fi
assert "empty-reason prose allowlist entry exits non-zero and names the entry" "$empty_reason_assertion"

legal_prose_root="${WORKDIR}/legal-prose-case"
mkdir -p "${legal_prose_root}/skills/x"
printf '%s\n' \
  '2. **Reset the task to `pending`** in `.pipeline/task-status.json` if you marked it `in_progress`.' \
  '`task-9`) flips that row to `in_progress` in `.pipeline/task-status.json` and writes' \
  'Then read `.pipeline/task-status.json` and confirm the row reads `completed`.' \
  > "${legal_prose_root}/skills/x/SKILL.md"
legal_prose_output=$(run_prose_fixture_checker "$legal_prose_root")
legal_prose_status=$?
assert "pending reset, descriptive hook, and read-only SKILL.md prose pass" "$( [ "$legal_prose_status" -eq 0 ] && echo 0 || echo 1 )"
[ "$legal_prose_status" -eq 0 ] || echo "$legal_prose_output" | sed 's/^/    /'

real_output=$(bash "$CHECKER" 2>&1)
real_status=$?
assert "real tree passes with default seams" "$( [ "$real_status" -eq 0 ] && echo 0 || echo 1 )"
[ "$real_status" -eq 0 ] || echo "$real_output" | sed 's/^/    /'

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
