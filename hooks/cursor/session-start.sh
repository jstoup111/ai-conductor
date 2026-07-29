#!/bin/bash
# Cursor sessionStart adapter for session-start-context.sh.
#
# In Claude the SessionStart hook's stdout is injected into the context
# window mechanically — that is how HARNESS.md, .memory/, and .docs/ state
# reach every session without relying on the model choosing to read them.
# Cursor's equivalent channel is the sessionStart `additional_context`
# output field, so this wrapper captures the script's stdout and returns it
# there. Without this hook, Cursor sessions get HARNESS.md only when the
# project's CLAUDE.md/AGENTS.md nudges the agent to read it (advisory, not
# mechanical).
#
# Input (Cursor stdin):  {"session_id": "...", "composer_mode": "...", ...}
# Output (Cursor stdout): {"additional_context": "..."} or {}
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOKS="${HOOK_DIR}/../claude"

quiet() { printf '{}\n'; exit 0; }

command -v python3 >/dev/null 2>&1 || quiet

# The context script ignores stdin and reads the project from cwd (Cursor
# runs hooks from the project root, same convention as the Claude host).
CONTEXT=$("${CLAUDE_HOOKS}/session-start-context.sh" </dev/null 2>/dev/null) || true
[ -n "$CONTEXT" ] || quiet

CONTEXT="$CONTEXT" python3 -c '
import json, os
print(json.dumps({"additional_context": os.environ["CONTEXT"].strip()}))
' 2>/dev/null || quiet
