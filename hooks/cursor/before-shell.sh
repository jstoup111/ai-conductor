#!/bin/bash
# Cursor beforeShellExecution adapter — bridges Cursor's hook payload to the
# Claude PreToolUse(Bash) gate scripts so mechanical enforcement behaves the
# same in both clients. Logic stays single-sourced in hooks/claude/; this
# wrapper only translates JSON shapes.
#
# Input (Cursor stdin):  {"command": "<terminal command>", "cwd": "...", ...}
# Output (Cursor stdout): {"permission": "allow"|"deny", "user_message", "agent_message"}
#
# Gates applied, in order:
#   1. block-destructive-git.sh — force push, hard reset, unmerged branch -D,
#      clean -f, checkout -- . (exit 2 = block)
#   2. tdd-commit-gate.sh — blocks `git commit` outside the COMMIT phase.
#      Scoped to git-commit commands here (the script's documented intent);
#      the .pipeline/tdd-phase file remains the opt-in switch.
#
# Fail-open by design: an unparseable payload allows the command through,
# matching both the Claude hooks' behavior and Cursor's default failure mode.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOOKS="${HOOK_DIR}/../claude"

allow() { printf '{"permission":"allow"}\n'; exit 0; }

deny() {
  REASON="$1" python3 -c '
import json, os
m = os.environ["REASON"].strip() or "Blocked by harness gate."
print(json.dumps({"permission": "deny", "user_message": m, "agent_message": m}))
'
  exit 0
}

command -v python3 >/dev/null 2>&1 || allow

INPUT=$(cat)
# On parse failure the variable is RESET, not captured — a broken python3
# (e.g. a version-manager shim outside its config) prints noise to stdout,
# and `|| echo ""` would keep that noise as the value.
COMMAND=$(printf '%s' "$INPUT" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("command",""))' 2>/dev/null) || COMMAND=""
[ -n "$COMMAND" ] || allow

# Rebuild the Claude PreToolUse payload shape the gate scripts parse.
PAYLOAD=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(json.dumps({"tool_input": {"command": d.get("command", "")}}))
' 2>/dev/null) || PAYLOAD=""
[ -n "$PAYLOAD" ] || allow

# Gate 1: destructive git operations. The gate writes its reason to stderr;
# the force-push branch emits Claude-shaped JSON there, so unwrap it before
# forwarding the reason to Cursor.
GATE_MSG=$(printf '%s' "$PAYLOAD" | "$CLAUDE_HOOKS/block-destructive-git.sh" 2>&1 >/dev/null)
GATE_CODE=$?
if printf '%s' "$GATE_MSG" | grep -q 'hookSpecificOutput'; then
  UNWRAPPED=$(printf '%s' "$GATE_MSG" | python3 -c '
import sys, json
raw = sys.stdin.read()
try:
    print(json.loads(raw)["hookSpecificOutput"]["permissionDecisionReason"])
except Exception:
    sys.stdout.write(raw)
' 2>/dev/null) && GATE_MSG="$UNWRAPPED"
fi
if [ "$GATE_CODE" -eq 2 ]; then
  deny "${GATE_MSG:-Blocked by harness destructive-git gate.}"
fi

# Gate 2: TDD commit gate — only for git-commit commands. Match on a
# quote-stripped copy so a commit message that merely mentions "git commit"
# cannot trigger it. Tolerates pre-subcommand flags (git -C <path> commit,
# git -c k=v commit).
SCAN=$(printf '%s' "$COMMAND" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
if printf '%s' "$SCAN" | grep -qE 'git[[:space:]]+(-[^[:space:]]+[[:space:]]+([^-][^[:space:]]*[[:space:]]+)?)*commit\b'; then
  TDD_MSG=$(printf '%s' "$PAYLOAD" | "$CLAUDE_HOOKS/tdd-commit-gate.sh" 2>&1 >/dev/null)
  TDD_CODE=$?
  if [ "$TDD_CODE" -eq 2 ]; then
    deny "${TDD_MSG:-TDD gate: commit blocked outside COMMIT phase.}"
  fi
fi

# Non-blocking notes from gate 1 (e.g. the rebase reminder) ride along as
# agent context on the allow decision.
if [ -n "$GATE_MSG" ]; then
  REASON="$GATE_MSG" python3 -c '
import json, os
print(json.dumps({"permission": "allow", "agent_message": os.environ["REASON"].strip()}))
' 2>/dev/null || allow
  exit 0
fi

allow
