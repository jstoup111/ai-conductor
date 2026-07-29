#!/bin/bash
# Cursor postToolUse adapter for post-commit-derive-feedback.sh — the
# advisory Task-trailer check that warns when a commit evidences no task.
#
# Registered with matcher "Shell". The underlying script ignores stdin and
# inspects HEAD directly, so this wrapper's job is cadence: it only invokes
# the check after a git-commit command (the Claude registration fires on
# every Bash call and re-checks the same HEAD; scoping to commits here keeps
# the same signal without the repeat noise).
#
# Advisory only — never blocks, mirrors the Claude hook's exit-0 contract.
#
# Input (Cursor stdin):  {"tool_name": "Shell", "tool_input": {"command": "..."}, ...}
# Output (Cursor stdout): {"additional_context": "..."} or {}
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOKS="${HOOK_DIR}/../claude"

quiet() { printf '{}\n'; exit 0; }

command -v python3 >/dev/null 2>&1 || quiet

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ti = d.get("tool_input") or {}
print(ti.get("command", ""))
' 2>/dev/null) || COMMAND=""
[ -n "$COMMAND" ] || quiet

# Same quote-stripped commit detection as before-shell.sh.
SCAN=$(printf '%s' "$COMMAND" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
printf '%s' "$SCAN" | grep -qE 'git[[:space:]]+(-[^[:space:]]+[[:space:]]+([^-][^[:space:]]*[[:space:]]+)?)*commit\b' || quiet

FEEDBACK=$("${CLAUDE_HOOKS}/post-commit-derive-feedback.sh" </dev/null 2>/dev/null) || true
[ -n "$FEEDBACK" ] || quiet

CONTEXT="$FEEDBACK" python3 -c '
import json, os
print(json.dumps({"additional_context": os.environ["CONTEXT"].strip()}))
' 2>/dev/null || quiet
