#!/bin/bash
# Warn if running BUILD phase commands outside a worktree.
# This is advisory — doesn't block, just logs a warning.
set -e

# Only check if we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  exit 0
fi

# Check if we're in a worktree (git-dir differs from git-common-dir)
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)

if [ "$GIT_DIR" = "$GIT_COMMON" ]; then
  # We're in the main repo, not a worktree
  # Only warn during BUILD phase (check pipeline state)
  if [ -f ".pipeline/conduct-state.json" ]; then
    PHASE=$(python3 -c "
import json
with open('.pipeline/conduct-state.json') as f:
    s = json.load(f)
# If build is in_progress or acceptance_specs is done, we're in BUILD
if s.get('acceptance_specs') in ('done', 'skipped') and s.get('build') not in ('done',):
    print('BUILD')
elif s.get('worktree') == 'skipped':
    print('OK')  # Worktree was intentionally skipped
else:
    print('OK')
" 2>/dev/null || echo "OK")
    if [ "$PHASE" = "BUILD" ]; then
      echo "WARNING: Running BUILD phase outside a worktree. Consider using a worktree for isolation."
    fi
  fi
fi

exit 0
