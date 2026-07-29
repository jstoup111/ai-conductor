#!/bin/bash
# Cursor postToolUse adapter for the edit-feedback suite: lint-after-edit,
# spec-coverage-check, and diagram-coverage-check.
#
# Registered with matcher "Write|StrReplace|Edit". In Claude these hooks
# print advisory findings to stdout and the host shows them to the model;
# Cursor's equivalent channel is the postToolUse `additional_context` field,
# so this wrapper collects the scripts' stdout and returns it there.
#
# Never blocks — mirrors the Claude suite, which always exits 0.
#
# Input (Cursor stdin):  {"tool_name": "...", "tool_input": {...}, ...}
# Output (Cursor stdout): {"additional_context": "..."} or {}
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOKS="${HOOK_DIR}/../claude"

quiet() { printf '{}\n'; exit 0; }

command -v python3 >/dev/null 2>&1 || quiet

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
if not target:
    sys.exit(1)
print(json.dumps({"tool_input": {"file_path": target}}))
' 2>/dev/null) || PAYLOAD=""
[ -n "$PAYLOAD" ] || quiet

FEEDBACK=""
for hook in lint-after-edit.sh spec-coverage-check.sh diagram-coverage-check.sh; do
  [ -x "${CLAUDE_HOOKS}/${hook}" ] || continue
  PART=$(printf '%s' "$PAYLOAD" | "${CLAUDE_HOOKS}/${hook}" 2>/dev/null) || true
  if [ -n "$PART" ]; then
    FEEDBACK="${FEEDBACK}${PART}
"
  fi
done

[ -n "$FEEDBACK" ] || quiet

CONTEXT="$FEEDBACK" python3 -c '
import json, os
print(json.dumps({"additional_context": os.environ["CONTEXT"].strip()}))
' 2>/dev/null || quiet
