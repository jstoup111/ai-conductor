#!/usr/bin/env bash
# Covers: task:8
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

WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/task-status-writers-XXXXXX")
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

run_fixture_checker() {
  HARNESS_INTEGRITY_SCAN_ROOT="$1" bash "$CHECKER" 2>&1
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

real_output=$(bash "$CHECKER" 2>&1)
real_status=$?
assert "real tree passes with default seams" "$( [ "$real_status" -eq 0 ] && echo 0 || echo 1 )"
[ "$real_status" -eq 0 ] || echo "$real_output" | sed 's/^/    /'

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
