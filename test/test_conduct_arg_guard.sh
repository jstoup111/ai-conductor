#!/usr/bin/env bash
set -euo pipefail

# test_conduct_arg_guard.sh — Tests for bin/conduct unknown-subcommand guard:
# fail loudly instead of silently launching the SDLC pipeline when an
# unrecognized subcommand/flag is passed.
#
# Usage: ./test/test_conduct_arg_guard.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONDUCT="$HARNESS_DIR/bin/conduct"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2  # 0 = pass, non-zero = fail
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

# ─── Setup ─────────────────────────────────────────────────────────────────

TMPDIR_ROOT=$(mktemp -d)
cleanup() {
  rm -rf "$TMPDIR_ROOT"
}
trap cleanup EXIT

# make_temp_repo <name>
# Creates a minimal git repo with harness markers, returns the path via echo.
make_temp_repo() {
  local name=$1
  local dir="${TMPDIR_ROOT}/${name}"
  mkdir -p "$dir"
  (
    cd "$dir"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    mkdir -p .claude skills
    echo "# Test Project" > CLAUDE.md
    echo "init" > README.md
    git add CLAUDE.md README.md
    git commit -q -m "init"
  )
  echo "$dir"
}

# make_conduct_ts_shim <exit_code>
# Writes an executable fake conduct-ts binary into TMPDIR_ROOT/bin that
# records its invocation args to a capture file and exits with the given
# code. Prints the path to the shim and the path to the capture file,
# separated by a pipe: "<shim_path>|<capture_file>"
make_conduct_ts_shim() {
  local exit_code=${1:-0}
  local bin_dir="${TMPDIR_ROOT}/fake-bin-$$-${RANDOM}"
  mkdir -p "$bin_dir"
  local shim="${bin_dir}/conduct-ts"
  local capture="${bin_dir}/capture.txt"

  cat > "$shim" << SHIM
#!/usr/bin/env bash
printf '%s\n' "\$@" > "${capture}"
exit ${exit_code}
SHIM
  chmod +x "$shim"

  echo "${shim}|${capture}"
}

# assert_no_pipeline_state <repo>
# Asserts that <repo>/.pipeline/ contains no state/session/log artifacts,
# i.e. the pipeline was never launched.
assert_no_pipeline_state() {
  local repo=$1
  local pipeline_dir="${repo}/.pipeline"

  if [ ! -d "$pipeline_dir" ]; then
    return 0
  fi

  local artifact_count
  artifact_count=$(find "$pipeline_dir" -type f \( \
    -name 'conduct-state.json' -o \
    -name 'conduct-session-id' -o \
    -name '*.log' \
    \) 2>/dev/null | wc -l)

  [ "$artifact_count" -eq 0 ]
}

# ─── Self-test: helpers work as expected ──────────────────────────────────

echo ""
echo -e "${BOLD}Test Suite: Arg Guard Harness Self-Test${NC}"
echo ""

test_self_test() {
  # SCRIPT_DIR/HARNESS_DIR/CONDUCT resolve to real paths
  assert "SCRIPT_DIR resolves to test/ directory" \
    "$([ -d "$SCRIPT_DIR" ] && echo 0 || echo 1)"
  assert "HARNESS_DIR resolves to repo root" \
    "$([ -f "${HARNESS_DIR}/CLAUDE.md" ] && echo 0 || echo 1)"
  assert "CONDUCT points at bin/conduct" \
    "$([ -f "$CONDUCT" ] && echo 0 || echo 1)"

  # make_temp_repo produces a usable git repo with harness markers
  local repo
  repo=$(make_temp_repo "self-test-repo")
  assert "make_temp_repo creates a directory" \
    "$([ -d "$repo" ] && echo 0 || echo 1)"
  assert "make_temp_repo initializes a git repo" \
    "$(git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 && echo 0 || echo 1)"
  assert "make_temp_repo writes CLAUDE.md marker" \
    "$([ -f "${repo}/CLAUDE.md" ] && echo 0 || echo 1)"

  # make_conduct_ts_shim writes an executable shim that captures args
  local shim_info shim_path capture_path
  shim_info=$(make_conduct_ts_shim 0)
  shim_path="${shim_info%%|*}"
  capture_path="${shim_info##*|}"

  assert "make_conduct_ts_shim creates an executable file" \
    "$([ -x "$shim_path" ] && echo 0 || echo 1)"

  "$shim_path" foo --bar baz
  assert "conduct-ts shim exits 0 when configured" "$?"
  assert "conduct-ts shim captures its arguments" \
    "$(grep -q 'foo' "$capture_path" && grep -q -- '--bar' "$capture_path" && grep -q 'baz' "$capture_path" && echo 0 || echo 1)"

  local shim_info2 shim_path2
  shim_info2=$(make_conduct_ts_shim 42)
  shim_path2="${shim_info2%%|*}"
  local rc=0
  "$shim_path2" anything || rc=$?
  assert "conduct-ts shim honors a custom exit code" \
    "$([ "$rc" -eq 42 ] && echo 0 || echo 1)"

  # assert_no_pipeline_state passes when .pipeline/ absent
  assert "assert_no_pipeline_state passes with no .pipeline/ dir" \
    "$(assert_no_pipeline_state "$repo" && echo 0 || echo 1)"

  # assert_no_pipeline_state passes when .pipeline/ exists but is empty
  mkdir -p "${repo}/.pipeline"
  assert "assert_no_pipeline_state passes with empty .pipeline/ dir" \
    "$(assert_no_pipeline_state "$repo" && echo 0 || echo 1)"

  # assert_no_pipeline_state fails when state file present
  touch "${repo}/.pipeline/conduct-state.json"
  assert "assert_no_pipeline_state fails when conduct-state.json present" \
    "$(assert_no_pipeline_state "$repo" && echo 1 || echo 0)"
  rm -f "${repo}/.pipeline/conduct-state.json"

  # assert_no_pipeline_state fails when session file present
  touch "${repo}/.pipeline/conduct-session-id"
  assert "assert_no_pipeline_state fails when conduct-session-id present" \
    "$(assert_no_pipeline_state "$repo" && echo 1 || echo 0)"
  rm -f "${repo}/.pipeline/conduct-session-id"

  # assert_no_pipeline_state fails when a log file present
  touch "${repo}/.pipeline/run.log"
  assert "assert_no_pipeline_state fails when a .log file present" \
    "$(assert_no_pipeline_state "$repo" && echo 1 || echo 0)"
  rm -f "${repo}/.pipeline/run.log"
}
test_self_test

# ─── Test: unknown option is rejected (TECH-1 happy) ──────────────────────
#
# Today `bin/conduct`'s arg parser has a catch-all branch:
#   *) FEATURE_DESC="$1" ;;
# which means an unrecognized flag like `--frobnicate` silently becomes the
# feature description and conduct proceeds to try to launch the SDLC
# pipeline (invoking `claude` directly, prompting interactively, etc).
#
# These tests assert the desired behavior instead: unknown options must be
# rejected loudly (non-zero exit, a clear "Unknown option" message that
# points at --help) and must NEVER touch .pipeline/ state.
#
# CONDUCT_TEST_NO_CLAUDE=1 is a guard env var (not yet honored by
# bin/conduct) intended to short-circuit any attempt to launch the real
# `claude` binary during tests. We also wrap invocations in `timeout` so
# that if the guard isn't honored (as today), the test fails fast instead
# of hanging or actually spawning a pipeline.

echo ""
echo -e "${BOLD}Test Suite: Unknown Option Guard (RED)${NC}"
echo ""

test_unknown_option_rejected() {
  local repo
  repo=$(make_temp_repo "unknown-option-repo")

  local stderr_file
  stderr_file=$(mktemp)

  local rc=0
  (
    cd "$repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" --frobnicate >/dev/null 2>"$stderr_file"
  ) || rc=$?

  assert "conduct --frobnicate exits non-zero" \
    "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"

  assert "stderr mentions 'Unknown option: --frobnicate'" \
    "$(grep -q 'Unknown option: --frobnicate' "$stderr_file" && echo 0 || echo 1)"

  assert "stderr mentions --help" \
    "$(grep -q -- '--help' "$stderr_file" && echo 0 || echo 1)"

  assert "no pipeline state was written for --frobnicate" \
    "$(assert_no_pipeline_state "$repo" && echo 0 || echo 1)"

  rm -f "$stderr_file"
}
test_unknown_option_rejected

# ─── Summary ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Results: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}${FAIL} test(s) failed${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
else
  echo -e "  ${GREEN}All tests passed${NC}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
fi
