#!/bin/bash
# Cursor preToolUse adapter for docs-guard.sh — the write-surface gate that
# freezes .docs/ spec artifacts while a build phase is active.
#
# Registered with matcher "Write|StrReplace|Edit" (EditNotebook matches
# "Edit"). Translates Cursor's tool_input field names (path, target_notebook)
# to the file_path key the Claude-shaped guard parses, then delegates the
# allow/deny decision entirely to hooks/claude/docs-guard.sh.
#
# Input (Cursor stdin):  {"tool_name": "...", "tool_input": {...}, ...}
# Output (Cursor stdout): {"permission": "allow"|"deny", "user_message", "agent_message"}
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOKS="${HOOK_DIR}/../claude"

allow() { printf '{"permission":"allow"}\n'; exit 0; }

# Fast-path mirror of docs-guard: no active phase marker means the gate is
# off. Deciding this here avoids paying the payload translation on every
# edit outside a build.
[ -f ".pipeline/phase-active" ] || allow

command -v python3 >/dev/null 2>&1 || allow

INPUT=$(cat)
PAYLOAD=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ti = d.get("tool_input") or {}
target = ""
for key in ("file_path", "path", "notebook_path", "target_notebook"):
    value = ti.get(key)
    if isinstance(value, str) and value:
        target = value
        break
print(json.dumps({"tool_input": {"file_path": target}}))
' 2>/dev/null) || PAYLOAD=""

# Unparseable payload: forward an empty tool_input and let docs-guard apply
# its own policy (it fails closed while a phase is active).
[ -n "$PAYLOAD" ] || PAYLOAD='{"tool_input":{}}'

MSG=$(printf '%s' "$PAYLOAD" | "$CLAUDE_HOOKS/docs-guard.sh" 2>&1 >/dev/null)
CODE=$?
if [ "$CODE" -eq 2 ]; then
  REASON="${MSG:-docs-guard: write blocked while a build phase is active.}" python3 -c '
import json, os
m = os.environ["REASON"].strip()
print(json.dumps({"permission": "deny", "user_message": m, "agent_message": m}))
'
  exit 0
fi

allow
