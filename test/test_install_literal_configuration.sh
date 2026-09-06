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
