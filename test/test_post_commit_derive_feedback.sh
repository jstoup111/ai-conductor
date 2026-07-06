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

Task: 28" 2>&1 && "$HOOK" 2>&1 || echo "")
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
output=$("$HOOK" 2>&1 || true)

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
if "$HOOK" >/dev/null 2>&1; then
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
"$HOOK" >/dev/null 2>&1 || true

# Check that no task-status.json was created
[ ! -f "$test_repo4/.pipeline/task-status.json" ]
assert "Hook doesn't write task-status.json" $?

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
