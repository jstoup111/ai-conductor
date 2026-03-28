#!/bin/bash
# When Claude stops, check if .memory/ was populated during this session.
# Nudges Claude to persist decisions if memory is empty.
set -e

MEMORY_DIR=".memory"

# If no memory dir, harness not bootstrapped — skip
if [ ! -d "$MEMORY_DIR" ]; then
  exit 0
fi

# Count non-empty memory files (excluding index.md)
ENTRY_COUNT=0
for dir in decisions patterns gotchas context; do
  if [ -d "${MEMORY_DIR}/${dir}" ]; then
    COUNT=$(find "${MEMORY_DIR}/${dir}" -name "*.md" -not -empty 2>/dev/null | wc -l)
    ENTRY_COUNT=$((ENTRY_COUNT + COUNT))
  fi
done

if [ "$ENTRY_COUNT" -eq 0 ]; then
  echo "MEMORY EMPTY: No decisions, patterns, or gotchas have been persisted to .memory/. If you made architectural decisions or discovered patterns in this session, persist them before ending."
fi

exit 0
