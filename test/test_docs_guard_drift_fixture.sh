#!/usr/bin/env bash
# Covers: task:6
# Covers: task:7
set -uo pipefail

# test_docs_guard_drift_fixture.sh — proves the docs-guard drift fixture uses
# a disposable copy, leaving the committed hook untouched.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHECKER="${SCRIPT_DIR}/check_docs_guard_drift_fixture.sh"
HOOK="${HARNESS_DIR}/hooks/claude/docs-guard.sh"
BASH_BIN="${BASH:-$(command -v bash)}"
if [ -z "${TMPDIR:-}" ] && [ -n "${AI_CONDUCTOR_TEST_TMP_ROOT:-}" ]; then
  export TMPDIR="$AI_CONDUCTOR_TEST_TMP_ROOT"
fi
if [ -n "${TMPDIR:-}" ]; then
  fixture_dir=$(mktemp -d "$TMPDIR/test-docs-guard-drift-fixture-XXXXXX")
else
  fixture_dir=$(mktemp -d -t test-docs-guard-drift-fixture-XXXXXX)
fi || exit 1
cleanup() { rm -rf "$fixture_dir"; }
trap cleanup EXIT

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
# The checker owns a deliberately corrupted copy. Keep even that nested
# fixture beneath this test's root so a killed checker cannot strand it in the
# real tmpdir while the outer test still cleans up deterministically.
OUT=$(TMPDIR="$fixture_dir" "$BASH_BIN" "$CHECKER" 2>&1)
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

write_sleeping_generator() {
  local generator=$1
  cat > "$generator" <<'EOF'
#!/usr/bin/env bash
: > "$HARNESS_INTEGRITY_TEST_STUB_READY"
printf '%s\n' "$$" > "${HARNESS_INTEGRITY_TEST_STUB_READY}.pid"
sleep 30
EOF
  chmod +x "$generator"
}

interrupt_checker() {
  local signal=$1 generator=$2 output=$3 ready=$4
  HARNESS_INTEGRITY_DOCS_GUARD_GENERATOR="$generator" \
    HARNESS_INTEGRITY_TEST_STUB_READY="$ready" \
    TMPDIR="$fixture_dir" \
    "$BASH_BIN" "$CHECKER" > "$output" 2>&1 &
  local checker_pid=$!
  local attempt=0
  while [ ! -e "$ready" ] && [ "$attempt" -lt 50 ]; do
    sleep 0.02
    attempt=$((attempt + 1))
  done
  if [ ! -e "$ready" ]; then
    kill -KILL "$checker_pid" 2>/dev/null || true
    wait "$checker_pid" 2>/dev/null || true
    return 1
  fi
  kill "-$signal" "$checker_pid" 2>/dev/null || true
  if [ -f "${ready}.pid" ]; then
    local generator_pid
    generator_pid=$(< "${ready}.pid")
    kill -KILL "$generator_pid" 2>/dev/null || true
  fi
  wait "$checker_pid" 2>/dev/null
  local checker_code=$?
  return "$checker_code"
}

sleeping_generator="${fixture_dir}/sleeping-generator"
write_sleeping_generator "$sleeping_generator"

sigkill_before_hash=$(sha256sum "$HOOK" | awk '{print $1}')
set +e
interrupt_checker KILL "$sleeping_generator" "${fixture_dir}/sigkill.out" "${fixture_dir}/sigkill.ready"
sigkill_code=$?
set -e
sigkill_after_hash=$(sha256sum "$HOOK" | awk '{print $1}')

sigint_before_hash=$(sha256sum "$HOOK" | awk '{print $1}')
set +e
interrupt_checker INT "$sleeping_generator" "${fixture_dir}/sigint.out" "${fixture_dir}/sigint.ready"
sigint_code=$?
set -e
sigint_after_hash=$(sha256sum "$HOOK" | awk '{print $1}')

ignored_destination_generator="${fixture_dir}/ignored-destination-generator"
cat > "$ignored_destination_generator" <<'EOF'
#!/usr/bin/env bash
# Deliberately ignores GENERATE_DOCS_GUARD_HOOK_OUT and reports the tracked hook clean.
test -f "$HARNESS_INTEGRITY_TEST_TRACKED_HOOK"
exit 0
EOF
chmod +x "$ignored_destination_generator"
set +e
ignored_destination_output=$(TMPDIR="$fixture_dir" HARNESS_INTEGRITY_DOCS_GUARD_GENERATOR="$ignored_destination_generator" \
  HARNESS_INTEGRITY_TEST_TRACKED_HOOK="$HOOK" "$BASH_BIN" "$CHECKER" 2>&1)
ignored_destination_code=$?
set -e

invalid_tmp_before_hash=$(sha256sum "$HOOK" | awk '{print $1}')
set +e
invalid_tmp_output=$(TMPDIR="${fixture_dir}/does-not-exist" "$BASH_BIN" "$CHECKER" 2>&1)
invalid_tmp_code=$?
set -e
invalid_tmp_after_hash=$(sha256sum "$HOOK" | awk '{print $1}')

assert "SIGKILL during the temporary-copy generator leaves the tracked docs-guard hook hash unchanged" \
  "$( [ "$sigkill_code" -ne 0 ] && [ "$sigkill_before_hash" = "$sigkill_after_hash" ] && echo 0 || echo 1)"
assert "SIGINT during the temporary-copy generator leaves the tracked docs-guard hook hash unchanged" \
  "$( [ "$sigint_code" -ne 0 ] && [ "$sigint_before_hash" = "$sigint_after_hash" ] && echo 0 || echo 1)"
assert "checker fails when an override ignores GENERATE_DOCS_GUARD_HOOK_OUT and reports the clean tracked hook" \
  "$( [ "$ignored_destination_code" -ne 0 ] && printf '%s\n' "$ignored_destination_output" | grep -Fq 'expected generator exit 1' && echo 0 || echo 1)"
assert "checker fails closed with a temporary-copy failure when TMPDIR cannot create the fixture" \
  "$( [ "$invalid_tmp_code" -ne 0 ] && printf '%s\n' "$invalid_tmp_output" | grep -Fq 'temporary-copy failure' && [ "$invalid_tmp_before_hash" = "$invalid_tmp_after_hash" ] && echo 0 || echo 1)"

echo ""
echo "  ${PASS} passed, ${FAIL} failed"

[ "$FAIL" -eq 0 ] || exit 1
