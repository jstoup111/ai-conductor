#!/usr/bin/env bash
set -euo pipefail

# test_install_docs_guard_wiring.sh — Real-binary smoke test asserting
# bin/install wires hooks/claude/docs-guard.sh into the primary-checkout
# PreToolUse settings (#788, Task 12).
#
# Invokes bin/install's configure_hooks() function directly (sourced, real
# implementation, no mocks) against a scratch settings.json, and asserts:
#   - a PreToolUse entry with matcher "Edit|Write|NotebookEdit" whose command
#     is "<hooks_dir>/docs-guard.sh" is present after the merge
#   - a pre-existing user-defined PreToolUse entry is preserved
#   - re-running the merge does not duplicate the docs-guard entry

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
TOTAL=0

assert() {
  local desc=$1
  local result=$2
  TOTAL=$((TOTAL + 1))
  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} ${desc}"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

HARNESS_DIR="$HARNESS_DIR" # used inside configure_hooks via hooks_dir var
SETTINGS_FILE="$TMP_ROOT/settings.json"

# Seed a pre-existing user-defined PreToolUse entry to prove it survives.
cat > "$SETTINGS_FILE" << 'JSON'
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "/some/user/custom-hook.sh", "timeout": 5 }
        ]
      }
    ]
  }
}
JSON

# Extract just the configure_hooks() function body (by exact line range,
# located via its start marker and the next top-level "}") and exec it in a
# subshell — bin/install runs main logic when invoked/sourced directly, so we
# can't source the whole file.
FUNC_START=$(grep -n '^configure_hooks() {$' "$HARNESS_DIR/bin/install" | head -1 | cut -d: -f1)
HEREDOC_END=$(awk -v start="$FUNC_START" 'NR > start && /^PYEOF$/ { print NR; exit }' "$HARNESS_DIR/bin/install")
FUNC_END=$(awk -v start="$HEREDOC_END" 'NR > start && /^}$/ { print NR; exit }' "$HARNESS_DIR/bin/install")
FUNC_BODY="$TMP_ROOT/configure_hooks_fn.sh"
sed -n "${FUNC_START},${FUNC_END}p" "$HARNESS_DIR/bin/install" > "$FUNC_BODY"

run_configure_hooks() {
  bash -c "
    HARNESS_DIR='$HARNESS_DIR'
    ok() { :; }
    warn() { :; }
    info() { :; }
    source '$FUNC_BODY'
    configure_hooks '$SETTINGS_FILE'
  "
}

run_configure_hooks >/dev/null

HOOKS_DIR="$HARNESS_DIR/hooks/claude"
EXPECTED_CMD="${HOOKS_DIR}/docs-guard.sh"

assert "settings.json contains a docs-guard PreToolUse entry with matcher Edit|Write|NotebookEdit" \
  "$(python3 -c "
import json, sys
with open('$SETTINGS_FILE') as f:
    s = json.load(f)
for entry in s['hooks'].get('PreToolUse', []):
    if entry.get('matcher') == 'Edit|Write|NotebookEdit':
        for h in entry.get('hooks', []):
            if h.get('command') == '$EXPECTED_CMD':
                sys.exit(0)
sys.exit(1)
"; echo $?)"

assert "pre-existing user-defined PreToolUse Bash entry is preserved" \
  "$(python3 -c "
import json, sys
with open('$SETTINGS_FILE') as f:
    s = json.load(f)
for entry in s['hooks'].get('PreToolUse', []):
    for h in entry.get('hooks', []):
        if h.get('command') == '/some/user/custom-hook.sh':
            sys.exit(0)
sys.exit(1)
"; echo $?)"

# Re-run the merge — must not duplicate the docs-guard entry.
run_configure_hooks >/dev/null

assert "re-running the merge leaves exactly one docs-guard entry (no duplicates)" \
  "$(python3 -c "
import json, sys
with open('$SETTINGS_FILE') as f:
    s = json.load(f)
count = 0
for entry in s['hooks'].get('PreToolUse', []):
    for h in entry.get('hooks', []):
        if h.get('command') == '$EXPECTED_CMD':
            count += 1
sys.exit(0 if count == 1 else 1)
"; echo $?)"

echo ""
echo -e "${BOLD}Results: ${PASS}/${TOTAL} passed${NC}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${FAIL} assertion(s) failed.${NC}"
  exit 1
fi
echo -e "${GREEN}All docs-guard install-wiring tests passed.${NC}"
exit 0
