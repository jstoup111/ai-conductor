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
run_permissions() {
  bash -c '
  ok() { printf "OK: %s\\n" "$*"; }; warn() { printf "WARN: %s\\n" "$*" >&2; }; info() { :; }
  HARNESS_PERMISSIONS=("Bash(example:*)")
  source "$1"
  configure_permissions "$2"
' _ "$TMP_ROOT/function.sh" "$SETTINGS_FILE"
}
run_permissions
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
    ok() { printf "OK: %s\\n" "$*"; }; warn() { printf "WARN: %s\\n" "$*" >&2; }; info() { :; }
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
if run_permissions > "$TMP_ROOT/permissions-out" 2> "$TMP_ROOT/permissions-error"; then exit 1; fi
after=$(sha256sum "$SETTINGS_FILE")
[ "$before" = "$after" ]
grep -Fq 'Could not configure permissions automatically' "$TMP_ROOT/permissions-error"
! grep -Fq 'OK:' "$TMP_ROOT/permissions-out"
if run_hooks 2> "$TMP_ROOT/hooks-error"; then exit 1; fi
after=$(sha256sum "$SETTINGS_FILE")
[ "$before" = "$after" ]
grep -Fq 'Could not configure hooks automatically' "$TMP_ROOT/hooks-error"
[ ! -e "$TMP_ROOT/SHOULD_NOT_RUN" ]

# Both helpers report an unavailable or failing interpreter rather than a
# successful merge.  The shim is only data for PATH lookup; it never runs the
# settings values above.
mkdir "$TMP_ROOT/no-python"
if PATH="$TMP_ROOT/no-python" run_permissions > "$TMP_ROOT/no-python-out" 2> "$TMP_ROOT/no-python-error"; then exit 1; fi
grep -Fq 'python3 not found' "$TMP_ROOT/no-python-error"
! grep -Fq 'OK:' "$TMP_ROOT/no-python-out"
if PATH="$TMP_ROOT/no-python" run_hooks > "$TMP_ROOT/no-python-hooks-out" 2> "$TMP_ROOT/no-python-hooks-error"; then exit 1; fi
grep -Fq 'python3 not found' "$TMP_ROOT/no-python-hooks-error"
! grep -Fq 'OK:' "$TMP_ROOT/no-python-hooks-out"

mkdir "$TMP_ROOT/failing-python"
printf '#!/bin/sh\nexit 42\n' > "$TMP_ROOT/failing-python/python3"
chmod +x "$TMP_ROOT/failing-python/python3"
if PATH="$TMP_ROOT/failing-python:$PATH" run_permissions > "$TMP_ROOT/failing-python-out" 2> "$TMP_ROOT/failing-python-error"; then exit 1; fi
grep -Fq 'Could not configure permissions automatically' "$TMP_ROOT/failing-python-error"
! grep -Fq 'OK:' "$TMP_ROOT/failing-python-out"
if PATH="$TMP_ROOT/failing-python:$PATH" run_hooks > "$TMP_ROOT/failing-python-hooks-out" 2> "$TMP_ROOT/failing-python-hooks-error"; then exit 1; fi
grep -Fq 'Could not configure hooks automatically' "$TMP_ROOT/failing-python-hooks-error"
! grep -Fq 'OK:' "$TMP_ROOT/failing-python-hooks-out"

# install() retains its warning-and-continue callers for both helpers.
grep -Fq 'configure_permissions "$settings_file" || warn "Permissions configuration incomplete — continuing"' "$HARNESS_DIR/bin/install"
grep -Fq 'configure_hooks "$settings_file" || warn "Hooks configuration incomplete — continuing"' "$HARNESS_DIR/bin/install"
