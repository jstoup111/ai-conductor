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
YELLOW='\033[1;33m'
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

# ─── Test: negative paths (characterization) ──────────────────────────────
#
# These tests verify that existing legitimate options still work correctly,
# and that unknown options appearing after valid feature descriptions are
# also rejected. All should pass immediately against the task-3 implementation.

echo ""
echo -e "${BOLD}Test Suite: Unknown Option Guard (Negative Paths)${NC}"
echo ""

test_negative_paths() {
  # Test 1: --help flag still works
  local help_output stdout_file
  stdout_file=$(mktemp)
  local rc=0
  (
    "$CONDUCT" --help >"$stdout_file" 2>&1
  ) || rc=$?

  assert "conduct --help exits 0" \
    "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"

  assert "conduct --help output contains usage information" \
    "$(grep -iE 'usage:|conduct' "$stdout_file" >/dev/null 2>&1 && echo 0 || echo 1)"

  rm -f "$stdout_file"

  # Test 2: --status flag works in a temp repo
  local status_repo status_stderr
  status_repo=$(make_temp_repo "status-flag-repo")
  status_stderr=$(mktemp)
  rc=0
  (
    cd "$status_repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" --status >/dev/null 2>"$status_stderr"
  ) || rc=$?

  assert "conduct --status exits 0 in valid repo" \
    "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"

  rm -f "$status_stderr"

  # Test 3: unknown option after valid feature description fails
  local late_unknown_repo late_unknown_stderr
  late_unknown_repo=$(make_temp_repo "late-unknown-repo")
  late_unknown_stderr=$(mktemp)
  rc=0
  (
    cd "$late_unknown_repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" "add login form" --frobnicate >/dev/null 2>"$late_unknown_stderr"
  ) || rc=$?

  assert "conduct with valid description + unknown option exits non-zero" \
    "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"

  assert "stderr mentions unknown option for late --frobnicate" \
    "$(grep -q 'Unknown option: --frobnicate' "$late_unknown_stderr" && echo 0 || echo 1)"

  assert "stderr points to --help for late unknown option" \
    "$(grep -q -- '--help' "$late_unknown_stderr" && echo 0 || echo 1)"

  assert "no pipeline state written for late unknown option" \
    "$(assert_no_pipeline_state "$late_unknown_repo" && echo 0 || echo 1)"

  rm -f "$late_unknown_stderr"
}
test_negative_paths

# ─── Test: conduct-ts verb forwarding (RED) ──────────────────────────────
#
# These tests verify that conduct subcommands owned by conduct-ts are
# forwarded with identical argv. Today, only `daemon` is forwarded:
#   if [ "$1" = "daemon" ]; then exec conduct-ts "$@"; fi
#
# But several other verbs should also be forwarded:
#   - render-diagrams, register, create, engineer, inline, help
#
# These tests use a fake conduct-ts shim to capture argv and verify
# forwarding behavior. They will FAIL (RED) until the forwarding is
# implemented in bin/conduct.

echo ""
echo -e "${BOLD}Test Suite: Conduct-TS Verb Forwarding (RED)${NC}"
echo ""

test_conduct_ts_forwarding_red() {
  # Test 1: conduct render-diagrams --check X forwards argv correctly
  local repo
  repo=$(make_temp_repo "render-diagrams-repo")

  local shim_info shim_path capture_path shim_dir
  shim_info=$(make_conduct_ts_shim 0)
  shim_path="${shim_info%%|*}"
  capture_path="${shim_info##*|}"
  shim_dir=$(dirname "$shim_path")

  local rc=0
  (
    cd "$repo"
    export PATH="${shim_dir}:$PATH"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" render-diagrams --check myfile.md >/dev/null 2>&1
  ) || rc=$?

  assert "conduct render-diagrams --check X exits 0 when forwarded" \
    "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"

  assert "conduct-ts shim captured argv for render-diagrams" \
    "$([ -f "$capture_path" ] && echo 0 || echo 1)"

  assert "captured argv contains 'render-diagrams'" \
    "$([ -f "$capture_path" ] && grep -q '^render-diagrams$' "$capture_path" && echo 0 || echo 1)"

  assert "captured argv contains '--check'" \
    "$([ -f "$capture_path" ] && grep -q '^--check$' "$capture_path" && echo 0 || echo 1)"

  assert "captured argv contains 'myfile.md'" \
    "$([ -f "$capture_path" ] && grep -q '^myfile.md$' "$capture_path" && echo 0 || echo 1)"

  # Test 1b: verify exit codes pass through for render-diagrams
  shim_info=$(make_conduct_ts_shim 3)
  shim_path="${shim_info%%|*}"
  shim_dir=$(dirname "$shim_path")
  rc=0
  (
    cd "$repo"
    export PATH="${shim_dir}:$PATH"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" render-diagrams --check other.md >/dev/null 2>&1
  ) || rc=$?

  assert "conduct render-diagrams forwards exit code 3" \
    "$([ "$rc" -eq 3 ] && echo 0 || echo 1)"

  # Test 2: conduct daemon status still forwards (regression check)
  shim_info=$(make_conduct_ts_shim 0)
  shim_path="${shim_info%%|*}"
  capture_path="${shim_info##*|}"
  shim_dir=$(dirname "$shim_path")
  rc=0
  (
    cd "$repo"
    export PATH="${shim_dir}:$PATH"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" daemon status >/dev/null 2>&1
  ) || rc=$?

  assert "conduct daemon status exits 0 (regression)" \
    "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"

  assert "daemon capture contains 'daemon'" \
    "$([ -f "$capture_path" ] && grep -q '^daemon$' "$capture_path" && echo 0 || echo 1)"

  assert "daemon capture contains 'status'" \
    "$([ -f "$capture_path" ] && grep -q '^status$' "$capture_path" && echo 0 || echo 1)"

  # Test 2b: daemon exit codes pass through
  shim_info=$(make_conduct_ts_shim 7)
  shim_path="${shim_info%%|*}"
  shim_dir=$(dirname "$shim_path")
  rc=0
  (
    cd "$repo"
    export PATH="${shim_dir}:$PATH"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" daemon stop >/dev/null 2>&1
  ) || rc=$?

  assert "conduct daemon forwards exit code 7" \
    "$([ "$rc" -eq 7 ] && echo 0 || echo 1)"

  # Test 3: No pipeline state created during forwarding
  local fresh_repo
  fresh_repo=$(make_temp_repo "no-pipeline-state-repo")

  shim_info=$(make_conduct_ts_shim 0)
  shim_path="${shim_info%%|*}"
  shim_dir=$(dirname "$shim_path")
  rc=0
  (
    cd "$fresh_repo"
    export PATH="${shim_dir}:$PATH"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" daemon status >/dev/null 2>&1
  ) || rc=$?

  assert "no .pipeline/ state created for daemon forwarding" \
    "$(assert_no_pipeline_state "$fresh_repo" && echo 0 || echo 1)"
}
test_conduct_ts_forwarding_red

# ─── Test: Real Binary Smoke (requires conduct-ts) ──────────────────────
#
# This is a quick integration test that the forwarding works with the actual
# conduct-ts binary (if installed). It should:
# 1. Skip gracefully if conduct-ts is not available
# 2. Create a valid Mermaid diagram
# 3. Run conduct render-diagrams --check against the real binary
# 4. Verify exit code 0 (success)
# 5. Verify no pipeline state was created

echo ""
echo -e "${BOLD}Test Suite: Real Binary Smoke (requires conduct-ts)${NC}"
echo ""

test_real_binary_smoke() {
  # Skip this test if conduct-ts is not installed
  if ! command -v conduct-ts >/dev/null 2>&1; then
    echo -e "  ${YELLOW}SKIP${NC} Real binary smoke test (conduct-ts not installed)"
    echo -e "  ${YELLOW}SKIP${NC} Set-up guide: https://github.com/anthropics/ai-conductor"
    return 0
  fi

  local repo
  repo=$(make_temp_repo "real-binary-smoke")

  # Create a valid Mermaid diagram file
  local mermaid_file="${repo}/diagram.md"
  cat > "$mermaid_file" << 'MERMAID'
# Test Diagram

```mermaid
graph TD
    A[Start] --> B[Process]
    B --> C[End]
```
MERMAID

  # Run the real conduct render-diagrams --check
  local rc=0
  (
    cd "$repo"
    timeout 10 "$CONDUCT" render-diagrams --check "$mermaid_file" >/dev/null 2>&1
  ) || rc=$?

  assert "conduct render-diagrams --check with real binary exits 0" \
    "$([ "$rc" -eq 0 ] && echo 0 || echo 1)"

  assert "no pipeline state created by real render-diagrams" \
    "$(assert_no_pipeline_state "$repo" && echo 0 || echo 1)"
}
test_real_binary_smoke

# ─── Test: conduct-ts missing from PATH (TECH-2 negative) ─────────────────
#
# These tests verify that when a conduct-ts-only verb (e.g. render-diagrams)
# is invoked but conduct-ts is NOT available on PATH, conduct fails loudly:
#   1. Exit code 127 (standard "command not found" code)
#   2. Stderr mentions "conduct-ts" so user understands what's missing
#   3. No pipeline state is created (conduct-ts forwarding never happens)

echo ""
echo -e "${BOLD}Test Suite: Conduct-TS Forwarding (Missing Binary)${NC}"
echo ""

test_missing_conduct_ts() {
  local repo
  repo=$(make_temp_repo "missing-conduct-ts-repo")

  # Run conduct with a stripped PATH (no conduct-ts available)
  local rc=0
  (
    cd "$repo"
    # Remove any fake or real conduct-ts from PATH, use only system paths
    PATH=/bin:/usr/bin:/usr/local/bin timeout 5 "$CONDUCT" render-diagrams --check file.md >/dev/null 2>&1
  ) || rc=$?

  assert "conduct render-diagrams without conduct-ts exits 127" \
    "$([ "$rc" -eq 127 ] && echo 0 || echo 1)"

  # Check for error message (optional but helpful)
  local stderr_file
  stderr_file=$(mktemp)
  (
    cd "$repo"
    PATH=/bin:/usr/bin:/usr/local/bin timeout 5 "$CONDUCT" render-diagrams --check file.md 2>"$stderr_file"
  ) || true

  assert "stderr mentions 'conduct-ts' when missing" \
    "$(grep -qi 'conduct-ts' "$stderr_file" && echo 0 || echo 1)"

  assert "no pipeline state created when conduct-ts missing" \
    "$(assert_no_pipeline_state "$repo" && echo 0 || echo 1)"

  rm -f "$stderr_file"
}
test_missing_conduct_ts

# ─── Test: Bare Word Rejection (TECH-3) ──────────────────────────────────
#
# These tests verify that bare single words (without quotes) are rejected.
# They are likely typos for multi-word feature descriptions, and we want to
# force users to quote them: conduct "add user authentication"
#
# Test cases:
# 1. `conduct auth` — single word, should fail with "Unknown command: auth"
# 2. `conduct rendr-diagrams` — single word typo, should fail similarly
#
# Both should:
# - Exit with non-zero code
# - Print "Unknown command: <word>" to stderr
# - Print a hint about quoting to stderr
# - NOT create any .pipeline/ state (no pipeline launch)
#
# Multi-word descriptions like `conduct "add login form"` should still work.

echo ""
echo -e "${BOLD}Test Suite: Bare Word Rejection (TECH-3)${NC}"
echo ""

test_bare_word_rejection_red() {
  # Test 1: conduct auth (bare single word should be rejected)
  local repo
  repo=$(make_temp_repo "bare-word-auth-repo")

  local stderr_file
  stderr_file=$(mktemp)

  local rc=0
  (
    cd "$repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" auth >/dev/null 2>"$stderr_file"
  ) || rc=$?

  assert "conduct auth exits non-zero" \
    "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"

  assert "stderr mentions 'Unknown command: auth'" \
    "$(grep -q 'Unknown command: auth' "$stderr_file" && echo 0 || echo 1)"

  assert "stderr mentions quoting hint" \
    "$(grep -qiE 'must be quoted|quoting|Feature descriptions' "$stderr_file" && echo 0 || echo 1)"

  assert "no pipeline state created for bare word 'auth'" \
    "$(assert_no_pipeline_state "$repo" && echo 0 || echo 1)"

  rm -f "$stderr_file"

  # Test 2: conduct rendr-diagrams (typo, also bare single word)
  local typo_repo
  typo_repo=$(make_temp_repo "bare-word-typo-repo")

  local typo_stderr
  typo_stderr=$(mktemp)

  rc=0
  (
    cd "$typo_repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" rendr-diagrams >/dev/null 2>"$typo_stderr"
  ) || rc=$?

  assert "conduct rendr-diagrams exits non-zero" \
    "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"

  assert "stderr mentions 'Unknown command: rendr-diagrams'" \
    "$(grep -q 'Unknown command: rendr-diagrams' "$typo_stderr" && echo 0 || echo 1)"

  assert "stderr contains quoting hint for typo" \
    "$(grep -qiE 'must be quoted|quoting|Feature descriptions' "$typo_stderr" && echo 0 || echo 1)"

  assert "no pipeline state created for typo 'rendr-diagrams'" \
    "$(assert_no_pipeline_state "$typo_repo" && echo 0 || echo 1)"

  rm -f "$typo_stderr"

  # Test 3: Multi-word descriptions still work (quoted)
  # This is a sanity check that the fix doesn't break valid usage.
  local multi_repo
  multi_repo=$(make_temp_repo "multi-word-description-repo")

  local multi_stderr
  multi_stderr=$(mktemp)

  rc=0
  (
    cd "$multi_repo"
    # This should NOT fail on the argument parsing level, even if it fails later
    # (e.g. because claude isn't available). We're testing that the argument itself
    # is accepted.
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" "add login form" >/dev/null 2>"$multi_stderr" || true
  )

  # For this test, we just verify the error is NOT "Unknown command"
  assert "multi-word description is not rejected as unknown command" \
    "$(! grep -q 'Unknown command: add' "$multi_stderr" && echo 0 || echo 1)"

  rm -f "$multi_stderr"
}
test_bare_word_rejection_red

# ─── Test: Characterization — Multi-word Descriptions & Flag Combos (TECH-4) ─
#
# These tests verify that the unknown-subcommand guard does NOT break existing
# legitimate behaviors:
#
# 1. Multi-word feature descriptions with quoted strings still parse correctly:
#    `conduct "add user login"` should set FEATURE_DESC and proceed
#
# 2. Flag + multi-word description combinations work:
#    `conduct --auto "add user login"` should parse both flag and description
#
# 3. Dash-leading quoted strings are correctly rejected by the guard:
#    `conduct "--weird feature name"` should fail (string starts with dash)
#    This is a NEGATIVE test: we expect rejection.
#
# All should pass immediately against the TECH-4 implementation (the guard
# is already in place). These are characterization tests — they verify that
# existing behavior remains intact.

echo ""
echo -e "${BOLD}Test Suite: Characterization — Multi-word Descriptions & Flag Combos (TECH-4)${NC}"
echo ""

test_characterization_tech4() {
  # Test 1: conduct "add user login" — multi-word description should parse OK
  local repo stderr_file rc=0
  repo=$(make_temp_repo "characterization-multiword-repo")
  stderr_file=$(mktemp)
  (
    cd "$repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" "add user login" >/dev/null 2>"$stderr_file"
  ) || rc=$?

  # Should NOT be rejected with the "Unknown command/option" error
  # Exit code might be 124 (timeout) or 0 if it reaches pipeline, but NOT 1 (our rejection)
  assert "conduct with multi-word quoted description parses successfully" \
    "$([ "$rc" -ne 1 ] && echo 0 || echo 1)"

  assert "no 'Unknown command' error for multi-word description" \
    "$(! grep -q 'Unknown command' "$stderr_file" && echo 0 || echo 1)"

  assert "no 'Unknown option' error for multi-word description" \
    "$(! grep -q 'Unknown option' "$stderr_file" && echo 0 || echo 1)"

  rm -f "$stderr_file"

  # Test 2: conduct --auto "add user login" — flag + multi-word description
  repo=$(make_temp_repo "characterization-auto-flag-repo")
  stderr_file=$(mktemp)
  rc=0
  (
    cd "$repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" --auto "add user login" >/dev/null 2>"$stderr_file"
  ) || rc=$?

  assert "conduct with --auto flag + multi-word description parses successfully" \
    "$([ "$rc" -ne 1 ] && echo 0 || echo 1)"

  assert "no error for --auto flag combined with description" \
    "$(! grep -qE 'Unknown (command|option)' "$stderr_file" && echo 0 || echo 1)"

  rm -f "$stderr_file"

  # Test 3: conduct "--weird feature name" — dash-leading quoted string SHOULD be rejected
  repo=$(make_temp_repo "characterization-dash-leading-repo")
  stderr_file=$(mktemp)
  rc=0
  (
    cd "$repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" "--weird feature name" >/dev/null 2>"$stderr_file"
  ) || rc=$?

  assert "dash-leading quoted string is rejected (exit non-zero)" \
    "$([ "$rc" -ne 0 ] && echo 0 || echo 1)"

  assert "dash-leading string triggers 'Unknown option' message" \
    "$(grep -q 'Unknown option' "$stderr_file" && echo 0 || echo 1)"

  assert "error points to --help for dash-leading string" \
    "$(grep -q -- '--help' "$stderr_file" && echo 0 || echo 1)"

  assert "no pipeline state from dash-leading quoted string rejection" \
    "$(assert_no_pipeline_state "$repo" && echo 0 || echo 1)"

  rm -f "$stderr_file"

  # Test 4: Verify --auto alone (valid single flag) still works (does not trigger Unknown option)
  repo=$(make_temp_repo "characterization-auto-alone-repo")
  stderr_file=$(mktemp)
  rc=0
  (
    cd "$repo"
    CONDUCT_TEST_NO_CLAUDE=1 timeout 5 "$CONDUCT" --auto >/dev/null 2>"$stderr_file"
  ) || rc=$?

  # --auto without a feature description may fail, but NOT with "Unknown option: --auto"
  assert "--auto flag alone does not trigger Unknown option error" \
    "$(! grep -q 'Unknown option: --auto' "$stderr_file" && echo 0 || echo 1)"

  rm -f "$stderr_file"
}
test_characterization_tech4

# ─── Test: Help & Discoverability (TECH-3/TECH-4 Done When) ──────────────
#
# These tests verify that the --help output contains helpful hints about
# the new unknown-command guard:
# 1. Multi-word feature descriptions must be quoted
# 2. Bare single words are rejected
# 3. Conduct-TS forwarded verbs are documented
#
# This ensures users discover the constraints and understand the behavior
# without needing to read error messages.

echo ""
echo -e "${BOLD}Test Suite: Help & Discoverability${NC}"
echo ""

test_help_contains_multi_word_hint() {
  local help_output
  help_output=$("$CONDUCT" --help)

  assert "conduct --help contains 'multi-word' hint" \
    "$(echo "$help_output" | grep -qi 'multi.word' && echo 0 || echo 1)"

  assert "conduct --help shows quoted example (add user login)" \
    "$(echo "$help_output" | grep -q 'add user login' && echo 0 || echo 1)"

  assert "conduct --help shows rejected bare word example (auth)" \
    "$(echo "$help_output" | grep -q 'conduct auth' && echo 0 || echo 1)"

  assert "conduct --help explains feature descriptions must be quoted" \
    "$(echo "$help_output" | grep -qi 'Feature descriptions.*quoted' && echo 0 || echo 1)"
}
test_help_contains_multi_word_hint

test_help_lists_conduct_ts_verbs() {
  local help_output
  help_output=$("$CONDUCT" --help)

  assert "conduct --help mentions conduct-ts forwarded verbs" \
    "$(echo "$help_output" | grep -qi 'Conduct-TS.*Forwarded' && echo 0 || echo 1)"

  assert "conduct --help lists 'daemon' verb" \
    "$(echo "$help_output" | grep -q 'daemon' && echo 0 || echo 1)"

  assert "conduct --help lists 'render-diagrams' verb" \
    "$(echo "$help_output" | grep -q 'render-diagrams' && echo 0 || echo 1)"

  assert "conduct --help lists 'engineer' verb" \
    "$(echo "$help_output" | grep -q 'engineer' && echo 0 || echo 1)"

  assert "conduct --help lists 'help' verb" \
    "$(echo "$help_output" | grep -q '^\s*help\s' && echo 0 || echo 1)"
}
test_help_lists_conduct_ts_verbs

test_help_references_unknown_command_guard() {
  local help_output
  help_output=$("$CONDUCT" --help)

  assert "conduct --help mentions unknown-command guard" \
    "$(echo "$help_output" | grep -qi 'unknown.*guard' && echo 0 || echo 1)"

  assert "conduct --help mentions failure behavior" \
    "$(echo "$help_output" | grep -qi 'fail loudly' && echo 0 || echo 1)"

  assert "conduct --help contains GitHub documentation link" \
    "$(echo "$help_output" | grep -q 'github.com.*ai-conductor.*unknown-command' && echo 0 || echo 1)"
}
test_help_references_unknown_command_guard

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
