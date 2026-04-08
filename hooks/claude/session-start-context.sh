#!/bin/bash
# On session start, load harness context into Claude's context window.
# Injects HARNESS.md behavioral rules, .memory/index.md, and .docs/ state.
set -e

# Resolve harness directory from this script's location
HARNESS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HARNESS_MD="${HARNESS_DIR}/HARNESS.md"

MEMORY_INDEX=".memory/index.md"
STORIES_DIR=".docs/stories"
PLANS_DIR=".docs/plans"
PIPELINE_STATE=".pipeline/task-status.json"

# Inject HARNESS.md behavioral rules (mechanical guarantee — not advisory)
if [ -f "$HARNESS_MD" ]; then
  echo "=== Harness Behavioral Rules (from ${HARNESS_MD}) ==="
  cat "$HARNESS_MD"
  echo "=== End Harness Behavioral Rules ==="
  echo ""
fi

# Check if project CLAUDE.md references HARNESS.md (skip if this IS the harness repo)
if [ -f "CLAUDE.md" ] && [ -f "$HARNESS_MD" ]; then
  PROJECT_DIR="$(pwd)"
  if [ "$HARNESS_DIR" != "$PROJECT_DIR" ]; then
    if ! grep -q "HARNESS.md" CLAUDE.md 2>/dev/null; then
      echo "=== HARNESS.md Missing ==="
      echo "WARNING: This project's CLAUDE.md does not reference HARNESS.md."
      echo "Run /conduct or add manually:"
      echo ""
      echo "  ## Harness Behavioral Rules"
      echo ""
      echo "  All behavioral rules, model selection, communication protocol, and conventions are defined in:"
      echo "  \`${HARNESS_MD}\`"
      echo ""
      echo "  Claude MUST read and follow HARNESS.md at the start of every session."
      echo "=== End HARNESS.md Missing ==="
      echo ""
    fi
  fi
fi

echo "=== Harness Context ==="

# Memory
if [ -f "$MEMORY_INDEX" ]; then
  ENTRY_COUNT=$(grep -c "^-" "$MEMORY_INDEX" 2>/dev/null || echo "0")
  echo "Memory: ${ENTRY_COUNT} entries in .memory/index.md"
  if [ "$ENTRY_COUNT" -gt 0 ]; then
    head -20 "$MEMORY_INDEX"
  fi
else
  echo "Memory: none (fresh project)"
fi

# Stories
if compgen -G "${STORIES_DIR}/*.md" > /dev/null 2>&1; then
  STORY_COUNT=$(ls -1 "${STORIES_DIR}/"*.md 2>/dev/null | wc -l)
  echo "Stories: ${STORY_COUNT} files in .docs/stories/"
  DRAFT_COUNT=$(grep -rl "Status: DRAFT" "$STORIES_DIR" 2>/dev/null | wc -l || echo "0")
  if [ "$DRAFT_COUNT" -gt 0 ]; then
    echo "  (${DRAFT_COUNT} still in DRAFT status — need /stories review)"
  fi
fi

# Pipeline
if [ -f "$PIPELINE_STATE" ]; then
  python3 -c "
import json
with open('$PIPELINE_STATE') as f:
    state = json.load(f)
total = len(state)
done = sum(1 for v in state.values() if isinstance(v, dict) and v.get('status') == 'completed')
print(f'Pipeline: {done}/{total} tasks completed')
" 2>/dev/null || true
fi

# Record memory entry count for session-delta check at stop
MEMORY_DIR=".memory"
MEMORY_START_COUNT=0
for dir in decisions patterns gotchas context; do
  if [ -d "${MEMORY_DIR}/${dir}" ]; then
    COUNT=$(find "${MEMORY_DIR}/${dir}" -name "*.md" -not -empty 2>/dev/null | wc -l)
    MEMORY_START_COUNT=$((MEMORY_START_COUNT + COUNT))
  fi
done
mkdir -p .pipeline
echo "$MEMORY_START_COUNT" > .pipeline/.memory-count-at-start

echo "=== End Harness Context ==="
exit 0
