#!/usr/bin/env bash
set -uo pipefail

# check_task_status_writers.sh — Audits task-status writers outside the engine.
# It scans *.sh, *.ts, and *.js files under hooks/, bin/, and skills/ for
# write-like references to task-status.json. Read-only references are allowed.
#
# Environment seams (for fixture trees):
#   HARNESS_INTEGRITY_SCAN_ROOT — root containing hooks/, bin/, and skills/
#
# Usage: bash test/check_task_status_writers.sh
# Exit:  0 = no unauthorized task-status writers found
#        1 = one or more unauthorized task-status writers found

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
scan_root="${HARNESS_INTEGRITY_SCAN_ROOT:-$HARNESS_DIR}"

if [ ! -d "$scan_root" ]; then
  echo "Cannot scan task-status writers: missing root $scan_root"
  exit 1
fi

scan_root="$(cd "$scan_root" && pwd)"

# Grep for task-status.json references in hooks/, bin/, and skills/. Only flag
# actual write operations (writeFile, .write, etc.), not documentation or
# read-only operations.
writer_audit_hits=$(grep -rn "task-status" \
  "${scan_root}/hooks" \
  "${scan_root}/bin" \
  "${scan_root}/skills" \
  --include="*.sh" --include="*.ts" --include="*.js" \
  2>/dev/null || true)

writer_audit_violations=""
if [ -n "$writer_audit_hits" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue

    filepath=$(echo "$line" | cut -d: -f1)
    content=$(echo "$line" | cut -d: -f3-)

    # Skip read-only patterns: comments, console logs, error messages, documentation
    if echo "$content" | grep -qE '^\s*(//|#|\*|\/\*|console|error|log|readFile)'; then
      continue
    fi

    # Skip string literals that are clearly just documenting task-status
    if echo "$content" | grep -qE '("|'"'"').*task-status.*\.("|'"'"')'; then
      continue
    fi

    # Now check for write operations: writeFile, .write, fs.write, appendFile
    if echo "$content" | grep -qE 'writeFile|\.write|fs\.write|fs\.appendFile|>> |> '; then
      relative_filepath="${filepath#"${scan_root}/"}"
      writer_audit_violations="${writer_audit_violations}${relative_filepath}:${line#*:}
"
    fi
  done <<< "$writer_audit_hits"
fi

if [ -z "$writer_audit_violations" ]; then
  exit 0
fi

echo "$writer_audit_violations" | while IFS= read -r violation; do
  [ -z "$violation" ] && continue
  echo "Unauthorized task-status writer: ${violation}"
done
exit 1
