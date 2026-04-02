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

# ─── Test 11: Per-feature steps use step_done, not artifact checks ───────

echo ""
echo -e "${BOLD}Test Suite: Step Completion Uses State, Not Artifacts${NC}"
echo ""

test_step_done_authority() {
  # Per-feature steps must use step_done (state file) not check_* (artifact files)
  # for their "Already complete" guard. Otherwise inherited artifacts from prior
  # features cause steps to skip on new features.

  local per_feature_steps=("brainstorm" "stories" "conflict_check" "plan" "architecture_review" "acceptance_specs" "manual_test" "retro")

  for step in "${per_feature_steps[@]}"; do
    local func_name="run_${step}"
    # Find the function and check it uses step_done for "Already complete"
    local uses_step_done
    uses_step_done=$(grep -A3 "^${func_name}()" "$CONDUCT" | grep -c "step_done" || true)
    # Allow architecture_review which has should_skip_for_tier before step_done
    if [ "$uses_step_done" -eq 0 ]; then
      uses_step_done=$(grep -A5 "^${func_name}()" "$CONDUCT" | grep -c "step_done" || true)
    fi
    assert "${func_name} uses step_done for completion check" \
      "$([ "$uses_step_done" -ge 1 ] && echo 0 || echo 1)"
  done

  # Verify step_done helper exists
  local has_helper
  has_helper=$(grep -c '^step_done()' "$CONDUCT" || true)
  assert "step_done() helper function exists" \
    "$([ "$has_helper" -ge 1 ] && echo 0 || echo 1)"
}
test_step_done_authority

# ─── Test 12: Worktree setup only commits project-level artifacts ────────

echo ""
echo -e "${BOLD}Test Suite: Worktree Setup Commit Scope${NC}"
echo ""

test_worktree_commit_scope() {
  # The git add before worktree creation should NOT include .docs/ wholesale.
  # It should only add .docs/decisions/ (project-level), not .docs/specs/,
  # .docs/stories/, .docs/plans/, .docs/conflicts/ (per-feature).

  local worktree_setup
  worktree_setup=$(sed -n '/^run_worktree_setup/,/^}/p' "$CONDUCT")

  # Should NOT have "git add .docs/" (wholesale)
  local has_wholesale
  has_wholesale=$(echo "$worktree_setup" | grep -c 'git add .docs/ ' || true)
  assert "Worktree setup does NOT git add .docs/ wholesale" \
    "$([ "$has_wholesale" -eq 0 ] && echo 0 || echo 1)"

  # Should have "git add .docs/decisions/" (project-level only)
  local has_decisions
  has_decisions=$(echo "$worktree_setup" | grep -c 'git add .docs/decisions/' || true)
  assert "Worktree setup commits .docs/decisions/ (project-level)" \
    "$([ "$has_decisions" -ge 1 ] && echo 0 || echo 1)"

  # Should have "git add .memory/"
  local has_memory
  has_memory=$(echo "$worktree_setup" | grep -c 'git add .memory/' || true)
  assert "Worktree setup commits .memory/" \
    "$([ "$has_memory" -ge 1 ] && echo 0 || echo 1)"
}
test_worktree_commit_scope

# ─── Test 13: Gates use step_done, not artifact checks ──────────────────

echo ""
echo -e "${BOLD}Test Suite: Gates Use State Authority${NC}"
echo ""

test_gates_use_state() {
  # Gates that block progression should use step_done, not check_* functions.
  # This prevents inherited artifacts from satisfying gates for a new feature.

  # brainstorm gate (used by complexity, stories)
  local brainstorm_gates
  brainstorm_gates=$(grep -c 'step_done "brainstorm" ||' "$CONDUCT" || true)
  assert "Brainstorm gate uses step_done (2 occurrences)" \
    "$([ "$brainstorm_gates" -ge 2 ] && echo 0 || echo 1)"

  # stories gate (used by conflict-check)
  local stories_gates
  stories_gates=$(grep -c 'step_done "stories" ||' "$CONDUCT" || true)
  assert "Stories gate uses step_done" \
    "$([ "$stories_gates" -ge 1 ] && echo 0 || echo 1)"

  # plan gate (used by arch-review, acceptance-specs, build)
  local plan_gates
  plan_gates=$(grep -c 'step_done "plan" ||' "$CONDUCT" || true)
  assert "Plan gate uses step_done (3 occurrences)" \
    "$([ "$plan_gates" -ge 3 ] && echo 0 || echo 1)"
}
test_gates_use_state

# ─── Test 14: Single session per feature (no fresh session in interactive) ──

echo ""
echo -e "${BOLD}Test Suite: Single Session Per Feature${NC}"
echo ""

test_single_session() {
  # Interactive branch should NOT create a fresh session via new UUID
  local run_claude_block
  run_claude_block=$(sed -n '/^run_claude()/,/^}/p' "$CONDUCT")

  # Should NOT have: --session-id "$(python3 -c 'import uuid; print(uuid.uuid4())')"
  local fresh_sessions
  fresh_sessions=$(echo "$run_claude_block" | grep -c 'import uuid; print(uuid.uuid4())' || true)
  assert "Interactive branch does not create fresh sessions" \
    "$([ "$fresh_sessions" -eq 0 ] && echo 0 || echo 1)"

  # Should use $session_flag in the interactive branch (reuses feature session)
  local uses_session_flag
  uses_session_flag=$(echo "$run_claude_block" | grep -c 'claude $session_flag' || true)
  assert "Interactive branch reuses feature session via \$session_flag" \
    "$([ "$uses_session_flag" -ge 1 ] && echo 0 || echo 1)"
}
test_single_session

# ─── Test 15: Task extraction functions exist ───────────────────────────

echo ""
echo -e "${BOLD}Test Suite: Task Extraction Functions${NC}"
echo ""

test_task_extraction_functions() {
  # get_plan_file function exists
  local has_get_plan
  has_get_plan=$(grep -c '^get_plan_file()' "$CONDUCT" || true)
  assert "get_plan_file() function exists" \
    "$([ "$has_get_plan" -ge 1 ] && echo 0 || echo 1)"

  # get_task_count function exists
  local has_count
  has_count=$(grep -c '^get_task_count()' "$CONDUCT" || true)
  assert "get_task_count() function exists" \
    "$([ "$has_count" -ge 1 ] && echo 0 || echo 1)"

  # extract_task function exists
  local has_extract
  has_extract=$(grep -c '^extract_task()' "$CONDUCT" || true)
  assert "extract_task() function exists" \
    "$([ "$has_extract" -ge 1 ] && echo 0 || echo 1)"

  # extract_task_files function exists
  local has_files
  has_files=$(grep -c '^extract_task_files()' "$CONDUCT" || true)
  assert "extract_task_files() function exists" \
    "$([ "$has_files" -ge 1 ] && echo 0 || echo 1)"

  # extract_task_deps function exists
  local has_deps
  has_deps=$(grep -c '^extract_task_deps()' "$CONDUCT" || true)
  assert "extract_task_deps() function exists" \
    "$([ "$has_deps" -ge 1 ] && echo 0 || echo 1)"

  # is_task_complete function exists
  local has_complete
  has_complete=$(grep -c '^is_task_complete()' "$CONDUCT" || true)
  assert "is_task_complete() function exists" \
    "$([ "$has_complete" -ge 1 ] && echo 0 || echo 1)"

  # set_task_status function exists
  local has_set
  has_set=$(grep -c '^set_task_status()' "$CONDUCT" || true)
  assert "set_task_status() function exists" \
    "$([ "$has_set" -ge 1 ] && echo 0 || echo 1)"
}
test_task_extraction_functions

# ─── Test 16: Task extraction works on real plan format ─────────────────

echo ""
echo -e "${BOLD}Test Suite: Task Extraction Parsing${NC}"
echo ""

test_task_extraction_parsing() {
  local plan_file="${TMPDIR_ROOT}/test_plan.md"
  cat > "$plan_file" << 'PLAN'
# Implementation Plan: Test Feature

## Tasks

### Task 1: Add user model
**Story:** 1.1 (user registration)
**Type:** infrastructure

**Steps:**
1. Write test for User model
2. Verify test fails (RED)
3. Create User model with name, email
4. Verify test passes (GREEN)
5. Commit: "Add User model"

**Files likely touched:**
- app/models/user.rb — new model
- spec/models/user_spec.rb — new test

**Dependencies:** none

### Task 2: Add registration endpoint
**Story:** 1.2 (registration API)
**Type:** happy-path

**Steps:**
1. Write request spec for POST /users
2. Verify test fails (RED)
3. Add UsersController#create
4. Verify test passes (GREEN)
5. Commit: "Add registration endpoint"

**Files likely touched:**
- app/controllers/users_controller.rb — new controller
- spec/requests/users_spec.rb — new test

**Dependencies:** Task 1

## Verification
- [x] All tasks mapped
PLAN

  # Test get_task_count
  # Source the function from conduct by extracting it
  local task_count
  task_count=$(grep -cE '^### Task [0-9]+:' "$plan_file")
  assert "get_task_count finds 2 tasks" \
    "$([ "$task_count" -eq 2 ] && echo 0 || echo 1)"

  # Test extract_task via python (same logic as the function)
  local task1
  task1=$(python3 -c "
import re, sys
with open(sys.argv[1]) as f:
    content = f.read()
pattern = r'(### Task 1:.*?)(?=\n### Task \d+:|\n## [^#]|\Z)'
match = re.search(pattern, content, re.DOTALL)
if match: print(match.group(1).strip())
" "$plan_file")
  assert "extract_task gets Task 1 content" \
    "$(echo "$task1" | grep -q 'Add user model' && echo 0 || echo 1)"
  assert "extract_task includes files section" \
    "$(echo "$task1" | grep -q 'app/models/user.rb' && echo 0 || echo 1)"
  assert "extract_task stops before Task 2" \
    "$(echo "$task1" | grep -q 'registration endpoint' && echo 1 || echo 0)"

  # Test extract_task for Task 2
  local task2
  task2=$(python3 -c "
import re, sys
with open(sys.argv[1]) as f:
    content = f.read()
pattern = r'(### Task 2:.*?)(?=\n### Task \d+:|\n## [^#]|\Z)'
match = re.search(pattern, content, re.DOTALL)
if match: print(match.group(1).strip())
" "$plan_file")
  assert "extract_task gets Task 2 content" \
    "$(echo "$task2" | grep -q 'registration endpoint' && echo 0 || echo 1)"

  # Test dependencies extraction
  local deps1
  deps1=$(echo "$task1" | grep -oP '\*\*Dependencies:\*\*\s*\K.*')
  assert "Task 1 dependencies is 'none'" \
    "$(echo "$deps1" | grep -qi 'none' && echo 0 || echo 1)"

  local deps2
  deps2=$(echo "$task2" | grep -oP '\*\*Dependencies:\*\*\s*\K.*')
  assert "Task 2 depends on Task 1" \
    "$(echo "$deps2" | grep -q '1' && echo 0 || echo 1)"
}
test_task_extraction_parsing

# ─── Test 17: Conductor-driven build loop ───────────────────────────────

echo ""
echo -e "${BOLD}Test Suite: Conductor-Driven Build Loop${NC}"
echo ""

test_conductor_build_loop() {
  local build_func
  build_func=$(sed -n '/^run_build()/,/^}/p' "$CONDUCT")

  # run_build should call get_plan_file
  local uses_plan_file
  uses_plan_file=$(echo "$build_func" | grep -c 'get_plan_file' || true)
  assert "run_build calls get_plan_file" \
    "$([ "$uses_plan_file" -ge 1 ] && echo 0 || echo 1)"

  # run_build should call get_task_count
  local uses_task_count
  uses_task_count=$(echo "$build_func" | grep -c 'get_task_count' || true)
  assert "run_build calls get_task_count" \
    "$([ "$uses_task_count" -ge 1 ] && echo 0 || echo 1)"

  # run_build should call extract_task
  local uses_extract
  uses_extract=$(echo "$build_func" | grep -c 'extract_task ' || true)
  assert "run_build calls extract_task" \
    "$([ "$uses_extract" -ge 1 ] && echo 0 || echo 1)"

  # run_build should iterate with a for loop over tasks
  local has_task_loop
  has_task_loop=$(echo "$build_func" | grep -c 'for task_num in' || true)
  assert "run_build has a task iteration loop" \
    "$([ "$has_task_loop" -ge 1 ] && echo 0 || echo 1)"

  # run_build should require subagent dispatch (not direct implementation)
  local requires_subagent
  requires_subagent=$(echo "$build_func" | grep -c 'dispatch a subagent\|Agent tool\|do NOT implement directly' || true)
  assert "run_build requires subagent dispatch for implementation" \
    "$([ "$requires_subagent" -ge 1 ] && echo 0 || echo 1)"

  # run_build should check is_task_complete after each task
  local checks_complete
  checks_complete=$(echo "$build_func" | grep -c 'is_task_complete' || true)
  assert "run_build checks task completion status" \
    "$([ "$checks_complete" -ge 2 ] && echo 0 || echo 1)"

  # run_build should dispatch evaluator at batch boundaries
  local has_evaluator
  has_evaluator=$(echo "$build_func" | grep -c 'evaluator' || true)
  assert "run_build dispatches evaluator at batch boundaries" \
    "$([ "$has_evaluator" -ge 2 ] && echo 0 || echo 1)"

  # run_build should NOT use "interactive" mode
  local uses_interactive
  uses_interactive=$(echo "$build_func" | grep -c '"interactive"' || true)
  assert "run_build does not use interactive mode" \
    "$([ "$uses_interactive" -eq 0 ] && echo 0 || echo 1)"
}
test_conductor_build_loop

# ─── Test 18: Session model documented in conduct skill ─────────────────

echo ""
echo -e "${BOLD}Test Suite: Session Model Documentation${NC}"
echo ""

test_session_model_docs() {
  local conduct_skill="$HARNESS_DIR/skills/conduct/SKILL.md"
  local pipeline_skill="$HARNESS_DIR/skills/pipeline/SKILL.md"

  # Conduct skill documents single session per feature
  local has_session_model
  has_session_model=$(grep -ci 'one.*session per feature\|single.*session' "$conduct_skill" || true)
  assert "Conduct skill documents single-session-per-feature model" \
    "$([ "$has_session_model" -ge 1 ] && echo 0 || echo 1)"

  # Pipeline skill documents subagent isolation
  local has_subagent_model
  has_subagent_model=$(grep -ci 'subagent.*isolated\|subagent.*discard\|context.*discard' "$pipeline_skill" || true)
  assert "Pipeline skill documents subagent context isolation" \
    "$([ "$has_subagent_model" -ge 1 ] && echo 0 || echo 1)"

  # Pipeline skill documents conductor-driven loop
  local has_conductor
  has_conductor=$(grep -ci 'drives the task loop\|conductor.*loop\|conduct.*drives' "$pipeline_skill" || true)
  assert "Pipeline skill documents conductor-driven task loop" \
    "$([ "$has_conductor" -ge 1 ] && echo 0 || echo 1)"
}
test_session_model_docs

# ─── Test 19: Rate limit cooldown ───────────────────────────────────────

echo ""
echo -e "${BOLD}Test Suite: Rate Limit Cooldown${NC}"
echo ""

test_rate_limit_cooldown() {
  local has_cooldown
  has_cooldown=$(grep -c '^STEP_COOLDOWN=10' "$CONDUCT" || true)
  assert "STEP_COOLDOWN variable exists with default 10" \
    "$([ "$has_cooldown" -ge 1 ] && echo 0 || echo 1)"

  local has_counter
  has_counter=$(grep -c '^CLAUDE_CALL_COUNT=0' "$CONDUCT" || true)
  assert "CLAUDE_CALL_COUNT variable exists with default 0" \
    "$([ "$has_counter" -ge 1 ] && echo 0 || echo 1)"

  local has_flag
  has_flag=$(grep -c '\-\-cooldown)' "$CONDUCT" || true)
  assert "--cooldown flag parsed in argument handler" \
    "$([ "$has_flag" -ge 1 ] && echo 0 || echo 1)"

  local increments
  increments=$(grep -c 'CLAUDE_CALL_COUNT=\$((CLAUDE_CALL_COUNT + 1))' "$CONDUCT" || true)
  assert "run_claude increments CLAUDE_CALL_COUNT" \
    "$([ "$increments" -ge 1 ] && echo 0 || echo 1)"
}
test_rate_limit_cooldown

# ─── Test 20: Skill rate limit delay instructions ───────────────────────

echo ""
echo -e "${BOLD}Test Suite: Skill Rate Limit Instructions${NC}"
echo ""

test_skill_delay_instructions() {
  local assess_skill="$HARNESS_DIR/skills/assess/SKILL.md"
  local pipeline_skill="$HARNESS_DIR/skills/pipeline/SKILL.md"

  local assess_delays
  assess_delays=$(grep -ci 'cooldown.*sleep 30' "$assess_skill" || true)
  assert "Assess skill has 30s inter-batch cooldown instructions" \
    "$([ "$assess_delays" -ge 3 ] && echo 0 || echo 1)"

  local pipeline_delay
  pipeline_delay=$(grep -ci 'cooldown.*sleep 15' "$pipeline_skill" || true)
  assert "Pipeline skill has 15s pre-evaluator cooldown" \
    "$([ "$pipeline_delay" -ge 1 ] && echo 0 || echo 1)"
}
test_skill_delay_instructions

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
