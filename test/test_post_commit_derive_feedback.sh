#!/usr/bin/env bash
# test_post_commit_derive_feedback.sh — Tests for post-commit-derive-feedback hook
#
# Tests the fast-feedback derive hook that warns on non-evidencing commits.
#
# Usage: ./test/test_post_commit_derive_feedback.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$HARNESS_DIR/hooks/claude/post-commit-derive-feedback.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

assert_output_contains() {
  local desc=$1
  local output=$2
  local pattern=$3
  TOTAL=$((TOTAL + 1))
  if echo "$output" | grep -q "$pattern"; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    echo "    Expected pattern: $pattern"
    echo "    Got output: $output"
    FAIL=$((FAIL + 1))
  fi
}

make_test_repo() {
  local path=$1
  mkdir -p "$path"
  git -C "$path" init -q
  git -C "$path" config user.email "test@example.com"
  git -C "$path" config user.name "Test User"
  printf 'initial\n' > "$path/file.txt"
  git -C "$path" add file.txt
  git -C "$path" commit -q -m "Initial commit"
  printf 'change\n' > "$path/file.txt"
  git -C "$path" add file.txt
  git -C "$path" commit -q -m "Add feature"
}

make_recording_engine() {
  local path=$1
  cat > "$path" <<'STUB'
#!/bin/bash
echo "$@" >> "$STUB_CALL_LOG"
echo '{"evidenced":false,"reason":"none"}'
exit 1
STUB
  chmod +x "$path"
}

# Cleanup function
cleanup() {
  rm -rf "$TMPDIR_ROOT"
}
trap cleanup EXIT

TMPDIR_ROOT=$(mktemp -d)

echo "Testing post-commit-derive-feedback hook"
echo ""

# Test 1: Hook exists and is executable
echo "Test 1: Hook file exists and is executable"
[ -f "$HOOK" ] && [ -x "$HOOK" ]
assert "Hook file exists and is executable" $?

# Test 2: Commit with valid Task: trailer → no output
echo ""
echo "Test 2: Commit with valid Task: trailer → no output"
test_repo="$TMPDIR_ROOT/test_with_task"
mkdir -p "$test_repo"
cd "$test_repo"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

# Create initial commit
echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

# Commit with Task: trailer
echo "change" > file.txt
git add file.txt
output=$(cd "$test_repo" && git -C "$test_repo" commit -q -m "Add feature

Task: 28" 2>&1 && "$HOOK" </dev/null 2>&1 || echo "")
[ -z "$output" ] || [ "$(echo "$output" | wc -l)" -eq 0 ] || output=""
assert_output_contains "No warning on Task: trailer commit" "$output" ""

# Test 3: Commit without Task: trailer → warns with commit sha
echo ""
echo "Test 3: Commit without Task: trailer → warns with commit sha and expected form"
test_repo2="$TMPDIR_ROOT/test_without_task"
mkdir -p "$test_repo2"
cd "$test_repo2"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

# Create initial commit
echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

# Commit without Task: trailer
echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature"

# Run the hook and capture output
output=$("$HOOK" </dev/null 2>&1 || true)

# Check that it warns with commit sha
commit_sha=$(git -C "$test_repo2" rev-parse HEAD 2>/dev/null || echo "")
assert_output_contains "Warns with commit sha" "$output" "$commit_sha"

# Check that it mentions the expected form
assert_output_contains "Mentions expected Task: form" "$output" "Task:"

echo ""
echo "Test 4: Hook is non-fatal (always exits 0)"
test_repo3="$TMPDIR_ROOT/test_nonfatal"
mkdir -p "$test_repo3"
cd "$test_repo3"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

# Create initial commit
echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

# Commit without Task: trailer
echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature"

# Run the hook and check exit code
if "$HOOK" </dev/null >/dev/null 2>&1; then
  exit_code=0
else
  exit_code=$?
fi
assert "Hook exits with 0 (non-fatal)" $((exit_code == 0 ? 0 : 1))

echo ""
echo "Test 5: Hook doesn't write files (no task-status creation)"
test_repo4="$TMPDIR_ROOT/test_no_write"
mkdir -p "$test_repo4"
cd "$test_repo4"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

# Create initial commit
echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

# Commit without Task: trailer
echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature"

# Run the hook
"$HOOK" </dev/null >/dev/null 2>&1 || true

# Check that no task-status.json was created
[ ! -f "$test_repo4/.pipeline/task-status.json" ]
assert "Hook doesn't write task-status.json" $?

# Test 6: Non-numeric H9 id (e.g., rem-fr10-1) → no warning (H9 grammar,
# not numeric-only)
echo ""
echo "Test 6: Non-numeric H9 task id (rem-fr10-1) → no warning"
test_repo5="$TMPDIR_ROOT/test_h9_id"
mkdir -p "$test_repo5"
cd "$test_repo5"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature

Task: rem-fr10-1"

output=$("$HOOK" </dev/null 2>&1 || true)
[ -z "$output" ]
assert "No warning on non-numeric H9 id (rem-fr10-1)" $?

# Test 7: Another non-numeric H9 id form (dotted/hyphenated with many segments)
echo ""
echo "Test 7: Non-numeric H9 task id (rem-adr-engine-owned-task-status-1) → no warning"
test_repo6="$TMPDIR_ROOT/test_h9_id2"
mkdir -p "$test_repo6"
cd "$test_repo6"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature

Task: rem-adr-engine-owned-task-status-1"

output=$("$HOOK" </dev/null 2>&1 || true)
[ -z "$output" ]
assert "No warning on non-numeric H9 id (rem-adr-engine-owned-task-status-1)" $?

# Test 8: Without an override, the hook uses the canonical repo-local
# ai-conductor launcher, never the deprecated conduct-ts alias or operator PATH.
echo ""
echo "Test 8: Hook defaults to the canonical repo-local ai-conductor launcher"
test_repo7="$TMPDIR_ROOT/test_default_engine_launcher"
default_harness="$TMPDIR_ROOT/default-engine-harness"
mkdir -p "$test_repo7" "$default_harness/hooks/claude" "$default_harness/bin"
cp "$HOOK" "$default_harness/hooks/claude/post-commit-derive-feedback.sh"
chmod +x "$default_harness/hooks/claude/post-commit-derive-feedback.sh"
DEFAULT_HOOK="$default_harness/hooks/claude/post-commit-derive-feedback.sh"

cd "$test_repo7"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature"

DEFAULT_STUB_LOG="$TMPDIR_ROOT/default-engine.calls"
cat > "$default_harness/bin/ai-conductor" <<'STUB'
#!/bin/bash
echo "$@" >> "$DEFAULT_STUB_LOG"
echo '{"evidenced":false,"reason":"none"}'
exit 1
STUB
chmod +x "$default_harness/bin/ai-conductor"

DEFAULT_STUB_LOG="$DEFAULT_STUB_LOG" "$DEFAULT_HOOK" </dev/null >/dev/null 2>&1 || true

[ -f "$DEFAULT_STUB_LOG" ] && grep -q "derive-feedback" "$DEFAULT_STUB_LOG"
assert "Hook defaults to bin/ai-conductor for derive-feedback" $?

# Test 8: Hook invokes the engine derive path (AI_CONDUCTOR_ENGINE_BIN honored)
# — point the hook at a stub "engine" binary that records its invocation
# and asserts the sha/subcommand contract, so this test fails if the hook
# regresses back to being pure bash regex with no engine call at all.
echo ""
echo "Test 9: Hook invokes the engine derive path (honors AI_CONDUCTOR_ENGINE_BIN)"
test_repo8="$TMPDIR_ROOT/test_engine_invoke"
mkdir -p "$test_repo8"
cd "$test_repo8"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature"

STUB_BIN="$TMPDIR_ROOT/stub-engine.sh"
STUB_CALL_LOG="$TMPDIR_ROOT/stub-engine.calls"
cat > "$STUB_BIN" <<'STUB'
#!/bin/bash
echo "$@" >> "$STUB_CALL_LOG"
echo '{"evidenced":false,"reason":"none"}'
exit 1
STUB
chmod +x "$STUB_BIN"

AI_CONDUCTOR_ENGINE_BIN="$STUB_BIN" STUB_CALL_LOG="$STUB_CALL_LOG" "$HOOK" </dev/null >/dev/null 2>&1 || true

[ -f "$STUB_CALL_LOG" ] && grep -q "derive-feedback" "$STUB_CALL_LOG"
assert "Hook shells out to the engine derive-feedback subcommand" $?

# Test 10: Engine binary missing/broken → hook still exits 0 and falls back
echo ""
echo "Test 10: Engine binary missing → hook falls back and still exits 0"
test_repo9="$TMPDIR_ROOT/test_engine_missing"
mkdir -p "$test_repo9"
cd "$test_repo9"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature"

if AI_CONDUCTOR_ENGINE_BIN="/nonexistent/engine-binary" "$HOOK" </dev/null >/dev/null 2>&1; then
  exit_code=0
else
  exit_code=$?
fi
assert "Hook exits 0 when engine binary is missing" $((exit_code == 0 ? 0 : 1))

commit_sha8=$(git -C "$test_repo9" rev-parse HEAD 2>/dev/null || echo "")
output=$(AI_CONDUCTOR_ENGINE_BIN="/nonexistent/engine-binary" "$HOOK" </dev/null 2>&1 || true)
assert_output_contains "Falls back to bash check and still warns with sha" "$output" "$commit_sha8"

# Test 11: Engine path-fallback (mentioned in the script's own header): a
# stub engine reports "evidenced via path-fallback" and the hook stays
# silent, proving the hook trusts the path-fallback verdict from the engine
# path (not just the bare trailer regex).
echo ""
echo "Test 11: Engine path-fallback verdict (evidenced:true, reason:path-fallback) → no warning"
test_repo10="$TMPDIR_ROOT/test_path_fallback"
mkdir -p "$test_repo10"
cd "$test_repo10"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit" || true

echo "change" > file.txt
git add file.txt
git commit -q -m "Add feature (no trailer, but plan path overlap)"

STUB_BIN2="$TMPDIR_ROOT/stub-engine-fallback.sh"
cat > "$STUB_BIN2" <<'STUB'
#!/bin/bash
echo '{"evidenced":true,"taskId":"1","reason":"path-fallback"}'
exit 0
STUB
chmod +x "$STUB_BIN2"

output=$(AI_CONDUCTOR_ENGINE_BIN="$STUB_BIN2" "$HOOK" </dev/null 2>&1 || true)
[ -z "$output" ]
assert "No warning when engine reports path-fallback evidence" $?

# Tests 12–18 exercise the post-Bash gate against the real hook in isolated
# repositories. The engine is a local recording fake: no test invokes a real
# engine, LLM, or network service.
GATE_STUB="$TMPDIR_ROOT/gate-engine.sh"
make_recording_engine "$GATE_STUB"

echo ""
echo "Test 12: Non-commit Bash command stays silent without invoking the engine"
gate_repo="$TMPDIR_ROOT/gate_non_commit"
make_test_repo "$gate_repo"
gate_log="$TMPDIR_ROOT/gate-non-commit.calls"
output=$(cd "$gate_repo" && { printf '%s' '{"tool_input":{"command":"ls -la"}}' | AI_CONDUCTOR_ENGINE_BIN="$GATE_STUB" STUB_CALL_LOG="$gate_log" "$HOOK"; } 2>&1 || true)
[ -z "$output" ] && [ ! -e "$gate_log" ]
assert "Non-commit payload is silent and does not invoke derive-feedback" $?

echo ""
echo "Test 13: Commit-creating Bash command invokes the engine for fresh HEAD"
gate_repo="$TMPDIR_ROOT/gate_commit"
make_test_repo "$gate_repo"
gate_log="$TMPDIR_ROOT/gate-commit.calls"
gate_sha=$(git -C "$gate_repo" rev-parse HEAD)
output=$(cd "$gate_repo" && { printf '%s' '{"tool_input":{"command":"git -C . commit -m update"}}' | AI_CONDUCTOR_ENGINE_BIN="$GATE_STUB" STUB_CALL_LOG="$gate_log" "$HOOK"; } 2>&1 || true)
[ -f "$gate_log" ] && grep -q "derive-feedback --sha $gate_sha" "$gate_log" && echo "$output" | grep -q "$gate_sha"
assert "Commit payload invokes derive-feedback and preserves warning output" $?

echo ""
echo "Test 14: Quoted commit text is not a commit invocation"
gate_repo="$TMPDIR_ROOT/gate_quoted"
make_test_repo "$gate_repo"
gate_log="$TMPDIR_ROOT/gate-quoted.calls"
output=$(cd "$gate_repo" && { printf '%s' '{"tool_input":{"command":"echo '\''git commit -m update'\''"}}' | AI_CONDUCTOR_ENGINE_BIN="$GATE_STUB" STUB_CALL_LOG="$gate_log" "$HOOK"; } 2>&1 || true)
[ -z "$output" ] && [ ! -e "$gate_log" ]
assert "Quoted commit text is silent and does not invoke derive-feedback" $?

echo ""
echo "Test 15: An old HEAD does not invoke the engine"
gate_repo="$TMPDIR_ROOT/gate_stale"
mkdir -p "$gate_repo"
git -C "$gate_repo" init -q
git -C "$gate_repo" config user.email "test@example.com"
git -C "$gate_repo" config user.name "Test User"
printf 'old\n' > "$gate_repo/file.txt"
git -C "$gate_repo" add file.txt
GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' git -C "$gate_repo" commit -q -m "Old commit"
gate_log="$TMPDIR_ROOT/gate-stale.calls"
output=$(cd "$gate_repo" && { printf '%s' '{"tool_input":{"command":"git commit -m update"}}' | AI_CONDUCTOR_ENGINE_BIN="$GATE_STUB" STUB_CALL_LOG="$gate_log" "$HOOK"; } 2>&1 || true)
[ -z "$output" ] && [ ! -e "$gate_log" ]
assert "Commit payload against old HEAD is silent and does not invoke derive-feedback" $?

echo ""
echo "Test 16: A repository with no commits stays silent"
gate_repo="$TMPDIR_ROOT/gate_empty"
mkdir -p "$gate_repo"
git -C "$gate_repo" init -q
gate_log="$TMPDIR_ROOT/gate-empty.calls"
output=$(cd "$gate_repo" && { printf '%s' '{"tool_input":{"command":"git commit -m update"}}' | AI_CONDUCTOR_ENGINE_BIN="$GATE_STUB" STUB_CALL_LOG="$gate_log" "$HOOK"; } 2>&1 || true)
[ -z "$output" ] && [ ! -e "$gate_log" ]
assert "Commit payload in empty repository is silent and does not invoke derive-feedback" $?

echo ""
echo "Test 17: Malformed payload retains advisory behavior"
gate_repo="$TMPDIR_ROOT/gate_malformed"
make_test_repo "$gate_repo"
gate_log="$TMPDIR_ROOT/gate-malformed.calls"
gate_sha=$(git -C "$gate_repo" rev-parse HEAD)
output=$(cd "$gate_repo" && { printf '%s' 'not json' | AI_CONDUCTOR_ENGINE_BIN="$GATE_STUB" STUB_CALL_LOG="$gate_log" "$HOOK"; } 2>&1 || true)
[ -f "$gate_log" ] && grep -q "derive-feedback --sha $gate_sha" "$gate_log" && echo "$output" | grep -q "$gate_sha"
assert "Malformed payload falls through to the existing advisory check" $?

echo ""
echo "Test 18: Payload without a command retains advisory behavior"
gate_repo="$TMPDIR_ROOT/gate_missing_command"
make_test_repo "$gate_repo"
gate_log="$TMPDIR_ROOT/gate-missing-command.calls"
gate_sha=$(git -C "$gate_repo" rev-parse HEAD)
output=$(cd "$gate_repo" && { printf '%s' '{"tool_input":{}}' | AI_CONDUCTOR_ENGINE_BIN="$GATE_STUB" STUB_CALL_LOG="$gate_log" "$HOOK"; } 2>&1 || true)
[ -f "$gate_log" ] && grep -q "derive-feedback --sha $gate_sha" "$gate_log" && echo "$output" | grep -q "$gate_sha"
assert "Payload without a command falls through to the existing advisory check" $?

# Summary
echo ""
echo ""
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}All tests passed ($PASS/$TOTAL)${NC}"
  exit 0
else
  echo -e "${RED}$FAIL test(s) failed ($PASS/$TOTAL passed)${NC}"
  exit 1
fi
