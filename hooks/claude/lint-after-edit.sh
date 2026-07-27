#!/bin/bash
# Run the appropriate linter on an edited file after Edit/Write.
# Feeds violations back to the agent so they're fixed immediately.
#
# Dispatches by file type. Each linter is best-effort: when the tool or its
# project context is unavailable, that file type is skipped silently. This hook
# NEVER blocks — it only informs (always exits 0). The authoritative gates are CI
# and test/test_harness_integrity.sh; this is a fast feedback loop, not an enforcer.
#
#   *.ts, *.tsx               -> eslint (type-aware async-correctness rules)
#   *.sh / bash-shebang files -> shellcheck (severity=error, matching the CI gate)
#   *.rb                      -> standardrb
#
# Previously this hook handled Ruby only, in a TypeScript + bash repository (#1028).
set -e

INPUT=$(cat)

# Extract the file path from tool input
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || echo "")

# Only lint if a path came through and the file exists (Write creates new files)
[ -n "$FILE_PATH" ] || exit 0
[ -f "$FILE_PATH" ] || exit 0

# Print at most a handful of lines so the hook stays a nudge, not a wall of text.
# Takes already-filtered linter output; empty input reports nothing.
report() {
  local output=$1
  [ -n "$output" ] || return 0
  echo "Lint violations in ${FILE_PATH}:"
  echo "$output" | head -10
}

# Resolve the conductor package dir (holds eslint.config.mjs and node_modules),
# derived from this hook's own location so it works from any cwd.
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONDUCTOR_DIR="$(cd "${HOOK_DIR}/../.." && pwd)/src/conductor"

is_shell_file() {
  case "$FILE_PATH" in
    *.sh|*.bash) return 0 ;;
  esac
  # bin/ holds extensionless executables — fall back to the shebang.
  head -1 "$FILE_PATH" 2>/dev/null | grep -qE '^#!.*(bash|sh)'
}

case "$FILE_PATH" in
  *.ts|*.tsx)
    # This eslint config is type-aware, so it needs the conductor project + deps.
    [ -d "${CONDUCTOR_DIR}/node_modules" ] || exit 0
    [ -f "${CONDUCTOR_DIR}/eslint.config.mjs" ] || exit 0
    # Uses the default (stylish) formatter deliberately: ESLint 9 dropped the
    # `compact` and `unix` formatters from core, and asking for one exits 2 with
    # an install hint instead of linting — which would make this branch silently
    # report nothing on every file.
    OUTPUT=$(cd "$CONDUCTOR_DIR" && npx --no-install eslint "$FILE_PATH" 2>/dev/null) || true
    # Keep only "  line:col  severity  message  rule" finding rows.
    report "$(echo "$OUTPUT" | grep -E "^[[:space:]]+[0-9]+:[0-9]+" || true)"
    ;;
  *.rb)
    command -v bundle >/dev/null 2>&1 || exit 0
    OUTPUT=$(bundle exec standardrb --no-fix "$FILE_PATH" 2>&1) || true
    report "$(echo "$OUTPUT" | grep -E "^[^ ].*:" || true)"
    ;;
  *)
    if is_shell_file; then
      command -v shellcheck >/dev/null 2>&1 || exit 0
      # severity=error matches test/lint_shell.sh and the CI gate, so the hook
      # never nags about findings the enforced gates deliberately defer.
      OUTPUT=$(shellcheck --severity="${SHELLCHECK_SEVERITY:-error}" --format=gcc "$FILE_PATH" 2>&1) || true
      report "$OUTPUT"
    fi
    ;;
esac

# Don't block — just inform
exit 0
