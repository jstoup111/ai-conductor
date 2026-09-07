#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT
SETTINGS_FILE="$TMP_ROOT/settings with 'quotes' and \$literal.json"
printf '{"custom":true}' > "$SETTINGS_FILE"

start=$(grep -n '^configure_permissions() {$' "$HARNESS_DIR/bin/install" | head -1 | cut -d: -f1)
end=$(awk -v start="$start" 'NR > start && /^}$/ { print NR; exit }' "$HARNESS_DIR/bin/install")
sed -n "${start},${end}p" "$HARNESS_DIR/bin/install" > "$TMP_ROOT/function.sh"
bash -c '
  ok() { :; }; warn() { :; }; info() { :; }
  HARNESS_PERMISSIONS=("Bash(example:*)")
  source "$1"
  configure_permissions "$2"
' _ "$TMP_ROOT/function.sh" "$SETTINGS_FILE"
python3 - "$SETTINGS_FILE" <<'PY'
import json, sys
with open(sys.argv[1]) as f: settings = json.load(f)
assert settings['custom'] is True
assert settings['permissions']['allow'] == ['Bash(example:*)']
PY

# Exercise configure_hooks through the same extracted real-function boundary.
# The directory grammar deliberately includes a newline and shell-looking text;
# it is data in settings, never source for the Python process.
HOOKS_HOME="$TMP_ROOT/hooks 'quote' \\ path
\$(touch SHOULD_NOT_RUN) \`ticks\`"
mkdir -p "$HOOKS_HOME"
printf '{"custom":true,"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/custom.sh","timeout":5}]}]}}' > "$SETTINGS_FILE"
hooks_start=$(grep -n '^configure_hooks() {$' "$HARNESS_DIR/bin/install" | head -1 | cut -d: -f1)
hooks_heredoc=$(awk -v start="$hooks_start" 'NR > start && /^PYEOF$/ { print NR; exit }' "$HARNESS_DIR/bin/install")
hooks_end=$(awk -v start="$hooks_heredoc" 'NR > start && /^}$/ { print NR; exit }' "$HARNESS_DIR/bin/install")
sed -n "${hooks_start},${hooks_end}p" "$HARNESS_DIR/bin/install" > "$TMP_ROOT/hooks-function.sh"
run_hooks() {
  bash -c '
    ok() { :; }; warn() { :; }; info() { :; }
    HARNESS_DIR=$1
    source "$2"
    configure_hooks "$3"
  ' _ "$HOOKS_HOME" "$TMP_ROOT/hooks-function.sh" "$SETTINGS_FILE"
}
run_hooks
run_hooks
python3 - "$SETTINGS_FILE" "$HOOKS_HOME" <<'PY'
import json, sys
with open(sys.argv[1]) as f: settings = json.load(f)
hooks_dir = sys.argv[2]
assert settings['custom'] is True
commands = [h['command'] for entries in settings['hooks'].values() for entry in entries for h in entry.get('hooks', [])]
assert '/custom.sh' in commands
assert len(commands) == len(set(commands))
assert len([command for command in commands if command.startswith(hooks_dir + '/')]) == 10
assert all(command.startswith(hooks_dir + '/') for command in commands if command != '/custom.sh')
PY
[ ! -e "$TMP_ROOT/SHOULD_NOT_RUN" ]

# Neither helper may replace malformed bytes on a failed JSON parse.
printf '{not json and $(touch SHOULD_NOT_RUN)}' > "$SETTINGS_FILE"
before=$(sha256sum "$SETTINGS_FILE")
if run_hooks 2> "$TMP_ROOT/hooks-error"; then exit 1; fi
after=$(sha256sum "$SETTINGS_FILE")
[ "$before" = "$after" ]
[ ! -e "$TMP_ROOT/SHOULD_NOT_RUN" ]
