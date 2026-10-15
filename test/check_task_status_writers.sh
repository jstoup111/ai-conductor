#!/usr/bin/env bash
set -uo pipefail

# check_task_status_writers.sh — Audits task-status writers outside the engine.
# It scans *.sh, *.ts, and *.js files under hooks/, bin/, and skills/ for
# write-like references to task-status.json, plus completed/skipped write
# instructions in skills/*/SKILL.md. Read-only references are allowed.
#
# Environment seams (for fixture trees):
#   HARNESS_INTEGRITY_SCAN_ROOT — root containing hooks/, bin/, and skills/
#   HARNESS_INTEGRITY_TASK_STATUS_PROSE_ALLOWLIST — newline-separated
#     path|line-text|reason entries for allowed SKILL.md instructions
#
# Usage: bash test/check_task_status_writers.sh
# Exit:  0 = no unauthorized task-status writers found
#        1 = one or more unauthorized task-status writers found

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
scan_root="${HARNESS_INTEGRITY_SCAN_ROOT:-$HARNESS_DIR}"
PROSE_WRITE_ALLOWLIST="${HARNESS_INTEGRITY_TASK_STATUS_PROSE_ALLOWLIST:-}"

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

prose_write_allowlist_entries=""
prose_allowlist_invalid=0
while IFS= read -r entry; do
  [ -z "$entry" ] && continue

  IFS='|' read -r allowlist_path allowlist_line allowlist_reason allowlist_extra <<< "$entry"
  if [ -z "$allowlist_reason" ]; then
    echo "Invalid task-status prose allowlist entry (empty reason): $entry"
    prose_allowlist_invalid=1
    continue
  fi
  prose_write_allowlist_entries="${prose_write_allowlist_entries}${allowlist_path}|${allowlist_line}
"
done <<< "$PROSE_WRITE_ALLOWLIST"

prose_writer_audit_violations=""
prose_imperative_pattern='^[[:space:]]*([-*]|[0-9]+\.)?[[:space:]]*(\*\*)?(reset|set|mark|write|update|edit|change|flip|append|rewrite|overwrite)\b'
while IFS= read -r skill_file; do
  relative_skill_file="${skill_file#"${scan_root}/"}"
  line_number=0
  while IFS= read -r content || [ -n "$content" ]; do
    line_number=$((line_number + 1))
    if ! echo "$content" | grep -q 'task-status\.json'; then
      continue
    fi
    if ! echo "$content" | grep -qE 'completed|skipped'; then
      continue
    fi
    if ! echo "$content" | grep -qiE "$prose_imperative_pattern"; then
      continue
    fi

    prose_entry="${relative_skill_file}|${content}"
    if echo "$prose_write_allowlist_entries" | grep -qFx -- "$prose_entry"; then
      continue
    fi
    prose_writer_audit_violations="${prose_writer_audit_violations}${relative_skill_file}:${line_number}:${content}
"
  done < "$skill_file"
done < <(find "${scan_root}/skills" -path '*/SKILL.md' -type f 2>/dev/null | sort)

if [ -n "$writer_audit_violations" ]; then
  echo "$writer_audit_violations" | while IFS= read -r violation; do
    [ -z "$violation" ] && continue
    echo "Unauthorized task-status writer: ${violation}"
  done
fi

if [ -n "$prose_writer_audit_violations" ]; then
  echo "$prose_writer_audit_violations" | while IFS= read -r violation; do
    [ -z "$violation" ] && continue
    echo "Unauthorized task-status write instruction: ${violation}"
  done
fi

if [ -z "$writer_audit_violations" ] \
  && [ -z "$prose_writer_audit_violations" ] \
  && [ "$prose_allowlist_invalid" -eq 0 ]; then
  exit 0
fi

exit 1
