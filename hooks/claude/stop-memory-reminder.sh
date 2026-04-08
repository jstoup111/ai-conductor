#!/bin/bash
# When Claude stops, check if memory was written during this session.
# Compares entry count at session start vs now. Only warns if work happened
# but no memory was persisted.
set -e

MEMORY_DIR=".memory"

# If no memory dir, harness not bootstrapped — skip
if [ ! -d "$MEMORY_DIR" ]; then
  exit 0
fi

# Count current non-empty memory files (excluding index.md)
CURRENT_COUNT=0
for dir in decisions patterns gotchas context; do
  if [ -d "${MEMORY_DIR}/${dir}" ]; then
    COUNT=$(find "${MEMORY_DIR}/${dir}" -name "*.md" -not -empty 2>/dev/null | wc -l)
    CURRENT_COUNT=$((CURRENT_COUNT + COUNT))
  fi
done

# Read start count (recorded by session-start-context.sh)
START_COUNT=0
if [ -f ".pipeline/.memory-count-at-start" ]; then
  START_COUNT=$(cat ".pipeline/.memory-count-at-start" 2>/dev/null || echo "0")
fi

# Check if work happened this session (git commits or pipeline state changes)
WORK_HAPPENED=false
if git log --oneline -1 --since="1 hour ago" >/dev/null 2>&1; then
  RECENT_COMMITS=$(git log --oneline --since="1 hour ago" 2>/dev/null | wc -l)
  if [ "$RECENT_COMMITS" -gt 0 ]; then
    WORK_HAPPENED=true
  fi
fi
if [ -f ".pipeline/task-status.json" ]; then
  WORK_HAPPENED=true
fi

# Warn if work happened but no new memory entries were written
if [ "$WORK_HAPPENED" = true ] && [ "$CURRENT_COUNT" -le "$START_COUNT" ]; then
  echo "MEMORY: No new entries persisted this session (${CURRENT_COUNT} entries, same as start). If you made decisions, discovered patterns, or hit gotchas, persist them to .memory/ before ending. Check skill Memory Checkpoint sections for what to write."
fi

exit 0
