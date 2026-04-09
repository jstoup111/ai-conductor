#!/bin/bash
# Block destructive git operations: force push, hard reset, branch delete
set -e

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

# Patterns that are destructive and hard to reverse
# Allow --force-with-lease (safe) but block bare --force/-f (destructive)
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*--force-with-lease'; then
  : # safe — allows push if remote hasn't changed since last fetch
elif echo "$COMMAND" | grep -qE 'git\s+push\s+.*--force|git\s+push\s+-f\b'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force push blocked by harness. Use --force-with-lease instead, or ask the user for explicit confirmation."}}' >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git\s+reset\s+--hard'; then
  echo "BLOCKED: git reset --hard is destructive and irreversible. Investigate the issue or ask the user before discarding work." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git\s+branch\s+-D\b'; then
  echo "BLOCKED: git branch -D force-deletes unmerged branches. Use -d (lowercase) for safe delete, or ask the user." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git\s+clean\s+-f'; then
  echo "BLOCKED: git clean -f permanently removes untracked files. Ask the user before cleaning." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git\s+checkout\s+--\s+\.|git\s+restore\s+\.'; then
  echo "BLOCKED: This discards all unstaged changes. Ask the user before reverting." >&2
  exit 2
fi

exit 0
