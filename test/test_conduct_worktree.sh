#!/usr/bin/env bash
set -euo pipefail

# test_conduct_worktree.sh — Tests for worktree isolation, resume menu,
# recover return codes, and exit signal handling in bin/conduct.
#
# Usage: ./test/test_conduct_worktree.sh
#
# Creates temporary git repos, simulates worktree state, and validates
# conduct's behavior without invoking Claude.

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
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

setup_git_repo() {
  local dir=$1
  mkdir -p "$dir"
  cd "$dir"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  echo "init" > README.md
  git add README.md
  git commit -q -m "init"
}

# Create a mock worktree with state file
create_mock_worktree() {
  local repo_dir=$1
  local slug=$2
  local feature_desc=$3
  local last_step=$4
  local step_status=$5
  local branch=${6:-"feature/${slug}"}

  local wt_dir="${repo_dir}/.worktrees/${slug}"
  mkdir -p "${wt_dir}/.pipeline"

  python3 -c "
import json, sys
state = {
    'feature_desc': sys.argv[1],
    'last_step': sys.argv[2],
    sys.argv[2]: sys.argv[3],
    'worktree_branch': sys.argv[4],
    'worktree_dir': sys.argv[5],
    'worktree': 'done',
    'run_started_at': 1711953600
}
with open(sys.argv[6], 'w') as f:
    json.dump(state, f, indent=2)
" "$feature_desc" "$last_step" "$step_status" "$branch" "$wt_dir" "${wt_dir}/.pipeline/conduct-state.json"
}

# ─── Test 1: No writes to root repo from save_worktree_state ──────────────

echo ""
echo -e "${BOLD}Test Suite: Worktree Isolation${NC}"
echo ""

test_no_root_repo_writes() {
  local repo="${TMPDIR_ROOT}/test1"
  setup_git_repo "$repo"

  # Source only the save_worktree_state function
  # We can't source the whole script (it has main logic), so test via grep
  local has_original_pipeline_dir
  has_original_pipeline_dir=$(grep -c 'ORIGINAL_PIPELINE_DIR' "$CONDUCT" || true)

  # After the fix, ORIGINAL_PIPELINE_DIR should not appear at all
  assert "ORIGINAL_PIPELINE_DIR variable removed from conduct" \
    "$([ "$has_original_pipeline_dir" -eq 0 ] && echo 0 || echo 1)"

  # save_worktree_state should NOT write to any path containing 'main_state'
  local has_main_state_write
  has_main_state_write=$(grep -c 'main_state' "$CONDUCT" || true)
  assert "No main_state write path in save_worktree_state" \
    "$([ "$has_main_state_write" -eq 0 ] && echo 0 || echo 1)"

  # save_worktree_state should have exactly one python3 -c block (read+write to STATE_FILE)
  local python_blocks
  python_blocks=$(sed -n '/^save_worktree_state/,/^}/p' "$CONDUCT" | grep -c "python3 -c" || true)
  assert "save_worktree_state has exactly one python3 block" \
    "$([ "$python_blocks" -eq 1 ] && echo 0 || echo 1)"
}
test_no_root_repo_writes

# ─── Test 2: Resume menu scans .worktrees/ ────────────────────────────────

echo ""
echo -e "${BOLD}Test Suite: Resume Menu Worktree Scanning${NC}"
echo ""

test_resume_menu_scan() {
  local repo="${TMPDIR_ROOT}/test2"
  setup_git_repo "$repo"

  # Create two mock worktrees
  create_mock_worktree "$repo" "auth-system" "Build user auth" "stories" "done" "feature/auth-system"
  create_mock_worktree "$repo" "payment-api" "Add payment processing" "build" "in_progress" "feature/payment-api"

  # Run the Python scanning logic directly (extracted from resume menu)
  local scan_output
  scan_output=$(python3 -c "
import json, os, sys

worktrees_dir = os.path.join(sys.argv[1], '.worktrees')
features = []

if os.path.isdir(worktrees_dir):
    for entry in sorted(os.listdir(worktrees_dir)):
        wt_dir = os.path.join(worktrees_dir, entry)
        if not os.path.isdir(wt_dir):
            continue
        state_path = os.path.join(wt_dir, '.pipeline', 'conduct-state.json')
        if not os.path.exists(state_path):
            continue
        try:
            with open(state_path) as f:
                state = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue
        feat = state.get('feature_desc', entry)
        last_step = state.get('last_step', '?')
        status = state.get(last_step, 'pending')
        branch = state.get('worktree_branch', '')
        features.append({
            'desc': feat,
            'step': last_step,
            'status': status,
            'dir': wt_dir,
            'branch': branch
        })

for i, f in enumerate(features):
    print(f\"{i}|{f['desc']}|{f['step']}|{f['status']}|{f['dir']}|{f['branch']}\")
" "$repo" 2>/dev/null)

  # Should find both worktrees
  local line_count
  line_count=$(echo "$scan_output" | wc -l)
  assert "Scanner finds 2 worktrees" \
    "$([ "$line_count" -eq 2 ] && echo 0 || echo 1)"

  # First should be auth-system (sorted alphabetically)
  local first_feat
  first_feat=$(echo "$scan_output" | head -1 | cut -d'|' -f2)
  assert "First feature is 'Build user auth'" \
    "$([ "$first_feat" = "Build user auth" ] && echo 0 || echo 1)"

  # Second should be payment-api
  local second_feat
  second_feat=$(echo "$scan_output" | tail -1 | cut -d'|' -f2)
  assert "Second feature is 'Add payment processing'" \
    "$([ "$second_feat" = "Add payment processing" ] && echo 0 || echo 1)"

  # Check step and status are correct
  local first_step first_status
  first_step=$(echo "$scan_output" | head -1 | cut -d'|' -f3)
  first_status=$(echo "$scan_output" | head -1 | cut -d'|' -f4)
  assert "First worktree step is 'stories'" \
    "$([ "$first_step" = "stories" ] && echo 0 || echo 1)"
  assert "First worktree status is 'done'" \
    "$([ "$first_status" = "done" ] && echo 0 || echo 1)"

  local second_step second_status
  second_step=$(echo "$scan_output" | tail -1 | cut -d'|' -f3)
  second_status=$(echo "$scan_output" | tail -1 | cut -d'|' -f4)
  assert "Second worktree step is 'build'" \
    "$([ "$second_step" = "build" ] && echo 0 || echo 1)"
  assert "Second worktree status is 'in_progress'" \
    "$([ "$second_status" = "in_progress" ] && echo 0 || echo 1)"

  # Check branch info
  local first_branch
  first_branch=$(echo "$scan_output" | head -1 | cut -d'|' -f6)
  assert "First worktree branch is 'feature/auth-system'" \
    "$([ "$first_branch" = "feature/auth-system" ] && echo 0 || echo 1)"
}
test_resume_menu_scan

# ─── Test 3: Scanner handles empty/missing/corrupt state ──────────────────

echo ""
echo -e "${BOLD}Test Suite: Scanner Edge Cases${NC}"
echo ""

test_scanner_edge_cases() {
  local repo="${TMPDIR_ROOT}/test3"
  setup_git_repo "$repo"

  # Create worktree with no state file
  mkdir -p "${repo}/.worktrees/no-state/.pipeline"

  # Create worktree with corrupt JSON
  mkdir -p "${repo}/.worktrees/corrupt/.pipeline"
  echo "not json" > "${repo}/.worktrees/corrupt/.pipeline/conduct-state.json"

  # Create valid worktree
  create_mock_worktree "$repo" "valid-feat" "Valid feature" "plan" "done"

  # Create a file (not directory) in .worktrees/
  touch "${repo}/.worktrees/not-a-dir"

  local scan_output
  scan_output=$(python3 -c "
import json, os, sys
worktrees_dir = os.path.join(sys.argv[1], '.worktrees')
features = []
if os.path.isdir(worktrees_dir):
    for entry in sorted(os.listdir(worktrees_dir)):
        wt_dir = os.path.join(worktrees_dir, entry)
        if not os.path.isdir(wt_dir):
            continue
        state_path = os.path.join(wt_dir, '.pipeline', 'conduct-state.json')
        if not os.path.exists(state_path):
            continue
        try:
            with open(state_path) as f:
                state = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue
        feat = state.get('feature_desc', entry)
        last_step = state.get('last_step', '?')
        status = state.get(last_step, 'pending')
        branch = state.get('worktree_branch', '')
        features.append({'desc': feat, 'step': last_step, 'status': status, 'dir': wt_dir, 'branch': branch})
for i, f in enumerate(features):
    print(f\"{i}|{f['desc']}|{f['step']}|{f['status']}|{f['dir']}|{f['branch']}\")
" "$repo" 2>/dev/null)

  local line_count
  line_count=$(echo "$scan_output" | grep -c '|' || true)
  assert "Scanner finds only valid worktree (skips no-state, corrupt, non-dir)" \
    "$([ "$line_count" -eq 1 ] && echo 0 || echo 1)"

  local feat
  feat=$(echo "$scan_output" | head -1 | cut -d'|' -f2)
  assert "Valid worktree feature is 'Valid feature'" \
    "$([ "$feat" = "Valid feature" ] && echo 0 || echo 1)"
}
test_scanner_edge_cases

# ─── Test 4: No .worktrees/ dir → nothing to resume ──────────────────────

echo ""
echo -e "${BOLD}Test Suite: No Worktrees Directory${NC}"
echo ""

test_no_worktrees_dir() {
  local repo="${TMPDIR_ROOT}/test4"
  setup_git_repo "$repo"

  # No .worktrees/ directory — scanner should produce empty output
  local scan_output
  scan_output=$(python3 -c "
import json, os, sys
worktrees_dir = os.path.join(sys.argv[1], '.worktrees')
features = []
if os.path.isdir(worktrees_dir):
    for entry in sorted(os.listdir(worktrees_dir)):
        wt_dir = os.path.join(worktrees_dir, entry)
        if not os.path.isdir(wt_dir): continue
        state_path = os.path.join(wt_dir, '.pipeline', 'conduct-state.json')
        if not os.path.exists(state_path): continue
        try:
            with open(state_path) as f: state = json.load(f)
        except: continue
        feat = state.get('feature_desc', entry)
        last_step = state.get('last_step', '?')
        status = state.get(last_step, 'pending')
        branch = state.get('worktree_branch', '')
        features.append({'desc': feat, 'step': last_step, 'status': status, 'dir': wt_dir, 'branch': branch})
for i, f in enumerate(features):
    print(f\"{i}|{f['desc']}|{f['step']}|{f['status']}|{f['dir']}|{f['branch']}\")
" "$repo" 2>/dev/null || echo "")

  assert "No .worktrees/ produces empty output" \
    "$([ -z "$scan_output" ] && echo 0 || echo 1)"
}
test_no_worktrees_dir

# ─── Test 5: set -e recovery fix ─────────────────────────────────────────

echo ""
echo -e "${BOLD}Test Suite: set -e Recovery Fix${NC}"
echo ""

test_set_e_recovery() {
  # The critical bug: recover() returns non-zero (1=skip, 2=retry).
  # With set -e, calling `recover "step"` (not in conditional) kills the script.
  # Fix: `recover "step" && rc=0 || rc=$?`

  # Verify the fix is present in the code
  local fixed_pattern
  fixed_pattern=$(grep -c 'recover "${ALL_STEPS\[$i\]}" && recover_rc=0 || recover_rc=\$?' "$CONDUCT" || true)
  assert "recover() call uses && ... || pattern (set -e safe)" \
    "$([ "$fixed_pattern" -ge 1 ] && echo 0 || echo 1)"

  # Verify the old vulnerable pattern is NOT present
  local old_pattern
  old_pattern=$(grep -cE '^\s+recover "\$\{ALL_STEPS\[' "$CONDUCT" | head -1 || true)
  # The fixed line should be the only one matching "recover "${ALL_STEPS["
  # and it should have the && pattern on the same line
  local vulnerable
  vulnerable=$(grep 'recover "${ALL_STEPS\[' "$CONDUCT" | grep -cv '&&' || true)
  assert "No vulnerable recover() call without && guard" \
    "$([ "$vulnerable" -eq 0 ] && echo 0 || echo 1)"

  # Functional test: simulate set -e with non-zero function returns
  local test_script="${TMPDIR_ROOT}/test_set_e.sh"
  cat > "$test_script" << 'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

mock_recover() {
  local choice=$1
  case "$choice" in
    skip)  return 1 ;;
    retry) return 2 ;;
    fix)   return 0 ;;
  esac
}

# Test: return code 1 (skip) should NOT kill the script
mock_recover "skip" && rc=0 || rc=$?
[ "$rc" -eq 1 ] || { echo "FAIL: expected rc=1, got rc=$rc"; exit 1; }

# Test: return code 2 (retry) should NOT kill the script
mock_recover "retry" && rc=0 || rc=$?
[ "$rc" -eq 2 ] || { echo "FAIL: expected rc=2, got rc=$rc"; exit 1; }

# Test: return code 0 (fix) should work
mock_recover "fix" && rc=0 || rc=$?
[ "$rc" -eq 0 ] || { echo "FAIL: expected rc=0, got rc=$rc"; exit 1; }

echo "ALL_OK"
SCRIPT
  chmod +x "$test_script"

  local output
  output=$("$test_script" 2>&1)
  assert "set -e does not kill script on non-zero recover returns" \
    "$([ "$output" = "ALL_OK" ] && echo 0 || echo 1)"
}
test_set_e_recovery

# ─── Test 6: HUP trap ────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Test Suite: Signal Handling${NC}"
echo ""

test_hup_trap() {
  # Verify HUP is in the trap
  local has_hup
  has_hup=$(grep -c "trap 'cleanup_and_exit' INT TERM HUP" "$CONDUCT" || true)
  assert "HUP signal included in cleanup trap" \
    "$([ "$has_hup" -ge 1 ] && echo 0 || echo 1)"
}
test_hup_trap

# ─── Test 7: restore_worktree_state detects git worktree ────────────────

echo ""
echo -e "${BOLD}Test Suite: Worktree Detection${NC}"
echo ""

test_worktree_detection() {
  local repo="${TMPDIR_ROOT}/test7"
  setup_git_repo "$repo"

  # Create a real git worktree
  mkdir -p "${repo}/.worktrees"
  git -C "$repo" worktree add -q -b feature/test-feat "${repo}/.worktrees/test-feat" 2>/dev/null

  # In the worktree, git-common-dir != git-dir
  local git_common git_dir
  git_common=$(git -C "${repo}/.worktrees/test-feat" rev-parse --git-common-dir 2>/dev/null || echo "")
  git_dir=$(git -C "${repo}/.worktrees/test-feat" rev-parse --git-dir 2>/dev/null || echo "")

  assert "Worktree: git-common-dir differs from git-dir" \
    "$([ "$git_common" != "$git_dir" ] && echo 0 || echo 1)"

  # In the main repo, git-common-dir == git-dir
  git_common=$(git -C "$repo" rev-parse --git-common-dir 2>/dev/null || echo "")
  git_dir=$(git -C "$repo" rev-parse --git-dir 2>/dev/null || echo "")
  assert "Main repo: git-common-dir equals git-dir" \
    "$([ "$git_common" = "$git_dir" ] && echo 0 || echo 1)"

  # Clean up worktree
  git -C "$repo" worktree remove "${repo}/.worktrees/test-feat" 2>/dev/null || true
}
test_worktree_detection

# ─── Test 8: enter_worktree preserves session on resume ──────────────────

echo ""
echo -e "${BOLD}Test Suite: Session Preservation on Resume${NC}"
echo ""

test_session_preservation() {
  # Verify the session deletion is inside the if-block for first entry only.
  # Use absolute line numbers from the file.

  local session_rm_line state_check_line func_start
  func_start=$(grep -n '^enter_worktree()' "$CONDUCT" | head -1 | cut -d: -f1)
  session_rm_line=$(grep -n 'rm -f "\$SESSION_FILE"' "$CONDUCT" | awk -F: -v start="$func_start" '$1 > start && $1 < start+50 {print $1; exit}')
  state_check_line=$(grep -n '! -f "\$STATE_FILE"' "$CONDUCT" | awk -F: -v start="$func_start" '$1 > start && $1 < start+50 {print $1; exit}')

  # Session deletion should appear AFTER the state file check (inside the guard)
  assert "Session file deletion is inside first-entry guard" \
    "$([ -n "$session_rm_line" ] && [ -n "$state_check_line" ] && [ "$session_rm_line" -gt "$state_check_line" ] && echo 0 || echo 1)"

  # Count session deletions within the function (within 50 lines of func_start)
  local occurrence_count
  occurrence_count=$(grep -n 'rm -f "\$SESSION_FILE"' "$CONDUCT" | awk -F: -v start="$func_start" '$1 > start && $1 < start+50' | wc -l)
  assert "Session file deletion occurs exactly once in enter_worktree" \
    "$([ "$occurrence_count" -eq 1 ] && echo 0 || echo 1)"
}
test_session_preservation

# ─── Test 9: Resume menu extends to --from flag ──────────────────────────

echo ""
echo -e "${BOLD}Test Suite: --from Flag Worktree Menu${NC}"
echo ""

test_from_flag_menu() {
  # The resume menu condition should include START_STEP (--from)
  local has_start_step
  has_start_step=$(grep -c '\[ -n "\$START_STEP" \]' "$CONDUCT" | head -1)
  # The resume menu condition should be:
  # if ([ "$MODE" = "resume" ] || [ -n "$START_STEP" ]) && ...
  local condition_correct
  condition_correct=$(grep -c 'MODE.*=.*resume.*START_STEP.*FEATURE_DESC.*worktrees' "$CONDUCT" || true)
  assert "--from flag triggers worktree menu (combined condition)" \
    "$([ "$condition_correct" -ge 1 ] && echo 0 || echo 1)"
}
test_from_flag_menu

# ─── Test 10: cleanup_and_exit doesn't reference worktree-specific paths ─

echo ""
echo -e "${BOLD}Test Suite: Cleanup Instructions${NC}"
echo ""

test_cleanup_instructions() {
  local cleanup_block
  cleanup_block=$(sed -n '/^cleanup_and_exit/,/^}/p' "$CONDUCT")

  # Should NOT reference WORKTREE_DIR or suggest cd-ing to worktree
  local has_worktree_ref
  has_worktree_ref=$(echo "$cleanup_block" | grep -c 'WORKTREE_DIR\|cd.*worktree' || true)
  assert "cleanup_and_exit does not reference worktree-specific paths" \
    "$([ "$has_worktree_ref" -eq 0 ] && echo 0 || echo 1)"

  # Should always suggest simple 'conduct --resume'
  local has_simple_resume
  has_simple_resume=$(echo "$cleanup_block" | grep -c 'conduct --resume' || true)
  assert "cleanup_and_exit suggests simple 'conduct --resume'" \
    "$([ "$has_simple_resume" -ge 1 ] && echo 0 || echo 1)"
}
test_cleanup_instructions

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
