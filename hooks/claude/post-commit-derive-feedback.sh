#!/bin/bash
# Fast-feedback derive on commit: warns on non-evidencing commits
# Advisory only; never blocks commits or writes task-status.
#
# Acceptance criteria:
# 1. Commit with no Task: trailer and no path-fallback match → warn with commit sha + expected form
# 2. Evidencing commit (valid Task: trailer) → no output
# 3. Engine binary missing / derive throws → exit 0, commit unaffected, anomaly logged
# 4. Never writes task-status itself
# 5. Always exits 0 (non-fatal)
set -e

# Get the current commit SHA
commit=$(git rev-parse HEAD 2>/dev/null || echo "")
if [ -z "$commit" ]; then
  # No commits yet (initial commit), nothing to check
  exit 0
fi

# Check if the commit message contains a Task: trailer
# Task trailers are in the form "Task: <id>" on a line by themselves
commit_msg=$(git log -1 --format=%B "$commit" 2>/dev/null || echo "")
if echo "$commit_msg" | grep -qE "^Task: [0-9]+"; then
  # Valid Task trailer found — commit is evidenced
  exit 0
fi

# No Task: trailer found — warn the user
# This is advisory only, so we print to stderr and exit 0
echo "warning: commit $commit lacks Task: trailer" >&2
echo "  Expected: Task: <id> (e.g., Task: 28)" >&2
echo "  See: https://github.com/jamesstoup/james-stoup-agents for more info" >&2

exit 0
