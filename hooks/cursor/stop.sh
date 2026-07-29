#!/bin/bash
# Cursor stop adapter for stop-memory-reminder.sh.
#
# In Claude the Stop hook's stdout reaches the model as a reminder to
# persist .memory/ entries before the session ends. Cursor's stop hook
# cannot inject passive context, but it can auto-submit one follow-up
# message — so when the reminder fires, it is returned as
# `followup_message` and the agent gets one turn to persist memory.
#
# Loop safety, both belts:
#   * only fires when status is "completed" and loop_count is 0, and
#   * the hooks.json registration sets loop_limit: 1.
#
# Input (Cursor stdin):  {"status": "completed"|"aborted"|"error", "loop_count": 0, ...}
# Output (Cursor stdout): {"followup_message": "..."} or {}
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOKS="${HOOK_DIR}/../claude"

quiet() { printf '{}\n'; exit 0; }

command -v python3 >/dev/null 2>&1 || quiet

INPUT=$(cat)
GATE=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ok = d.get("status") == "completed" and int(d.get("loop_count") or 0) == 0
print("yes" if ok else "no")
' 2>/dev/null) || GATE="no"
[ "$GATE" = "yes" ] || quiet

REMINDER=$("${CLAUDE_HOOKS}/stop-memory-reminder.sh" </dev/null 2>/dev/null) || true
[ -n "$REMINDER" ] || quiet

REMINDER="$REMINDER" python3 -c '
import json, os
print(json.dumps({"followup_message": os.environ["REMINDER"].strip()}))
' 2>/dev/null || quiet
