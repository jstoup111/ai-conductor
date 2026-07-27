#!/bin/bash
# Lint edited files at BATCH BOUNDARIES, dispatching by file type.
#
# CADENCE. This hook is registered `PostToolUse` on `Edit|Write`, so the host
# invokes it after every single file write. Linting on that cadence is noise: it
# interrupts a multi-file change mid-flight and reports on a file that the very
# next edit is about to change again. So the hook does NOT lint per edit. It
# QUEUES the edited path and stays silent, and flushes the queue only at a batch
# boundary — matching this harness's existing rule that refactoring and review
# gates happen at batch boundaries, not per file.
#
# The registration is unchanged (`settings.json` hook wiring is a canonical
# breaking surface); the cadence is decided here, in the script.
#
# A boundary is either:
#   * the pipeline's task marker changing — `.pipeline/current-task` differs from
#     the value seen when the queue was opened, i.e. the task whose edits are
#     queued has ended; or
#   * outside a pipeline (interactive work, no task marker), the debounce window
#     elapsing — LINT_DEBOUNCE_SECONDS since the queue was opened, default 120.
#     Without this, interactive sessions would queue forever and never report.
#
# DISPATCH. `.ts`/`.tsx` -> eslint, `.sh` and bash-shebang files -> shellcheck,
# `.rb` -> standardrb. Each is best-effort: when the tool or its project context
# is missing, that type is skipped silently.
#
# ERRORS ONLY. shellcheck runs at `--severity=error`, matching test/lint_shell.sh
# and the CI gate, so this never nags about findings the enforced gates defer.
#
# This hook NEVER blocks — it always exits 0. The authoritative gates are CI and
# test/test_harness_integrity.sh; this is a feedback loop, not an enforcer.
#
# Previously this hook handled Ruby only, in a TypeScript-and-bash repo, and ran
# on every edit (#1028).
set -uo pipefail

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || echo "")

[ -n "$FILE_PATH" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HOOK_DIR}/../.." && pwd)"
CONDUCTOR_DIR="${REPO_ROOT}/src/conductor"

# Queue state lives OUTSIDE .pipeline/ on purpose: .pipeline/ is engine-owned
# state with a single-writer authority model, and a hook has no business adding
# files to it. Keyed by repo path so parallel worktrees never share a queue.
STATE_DIR="${TMPDIR:-/tmp}/ai-conductor-lint/$(echo "$REPO_ROOT" | md5sum | cut -d' ' -f1)"
QUEUE_FILE="${STATE_DIR}/queue"
TOKEN_FILE="${STATE_DIR}/boundary-token"
OPENED_FILE="${STATE_DIR}/opened-at"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# Queue this edit. Existence is checked at flush time, not now: a file written
# and then deleted before the boundary should simply drop out.
printf '%s\n' "$FILE_PATH" >> "$QUEUE_FILE" 2>/dev/null || exit 0

# The boundary token: the current pipeline task, or empty when not in a build.
current_token=""
if [ -f "${REPO_ROOT}/.pipeline/current-task" ]; then
  current_token=$(cat "${REPO_ROOT}/.pipeline/current-task" 2>/dev/null || echo "")
fi

now=$(date +%s)
if [ ! -f "$OPENED_FILE" ]; then
  printf '%s\n' "$now" > "$OPENED_FILE"
  printf '%s\n' "$current_token" > "$TOKEN_FILE"
  exit 0   # queue just opened — nothing to flush yet
fi

previous_token=$(cat "$TOKEN_FILE" 2>/dev/null || echo "")
opened_at=$(cat "$OPENED_FILE" 2>/dev/null || echo "$now")
debounce="${LINT_DEBOUNCE_SECONDS:-120}"

at_boundary=false
if [ -n "$current_token" ] && [ "$current_token" != "$previous_token" ]; then
  at_boundary=true                      # the task that owned these edits ended
elif [ -z "$current_token" ] && [ $((now - opened_at)) -ge "$debounce" ]; then
  at_boundary=true                      # interactive: debounce window elapsed
fi

if ! $at_boundary; then
  exit 0                                # mid-batch: stay silent
fi

# ── Flush ────────────────────────────────────────────────────────────────────
QUEUED=()
while IFS= read -r queued; do
  [ -n "$queued" ] && [ -f "$queued" ] && QUEUED+=("$queued")
done < <(sort -u "$QUEUE_FILE" 2>/dev/null)

: > "$QUEUE_FILE"
printf '%s\n' "$now" > "$OPENED_FILE"
printf '%s\n' "$current_token" > "$TOKEN_FILE"

[ "${#QUEUED[@]}" -gt 0 ] || exit 0

report() {
  local file=$1 output=$2
  [ -n "$output" ] || return 0
  echo "Lint violations in ${file}:"
  echo "$output" | head -10
}

is_shell_file() {
  case "$1" in
    *.sh|*.bash) return 0 ;;
  esac
  head -1 "$1" 2>/dev/null | grep -qE '^#!.*(bash|sh)'
}

# Collect TypeScript files and lint them in ONE eslint invocation — starting a
# type-aware program per file would cost seconds each.
TS_FILES=()
for file in "${QUEUED[@]}"; do
  case "$file" in
    *.ts|*.tsx)
      TS_FILES+=("$file")
      ;;
    *.rb)
      command -v bundle >/dev/null 2>&1 || continue
      output=$(bundle exec standardrb --no-fix "$file" 2>&1) || true
      report "$file" "$(echo "$output" | grep -E '^[^ ].*:' || true)"
      ;;
    *)
      if is_shell_file "$file" && command -v shellcheck >/dev/null 2>&1; then
        output=$(shellcheck --severity="${SHELLCHECK_SEVERITY:-error}" --format=gcc "$file" 2>&1) || true
        report "$file" "$output"
      fi
      ;;
  esac
done

if [ "${#TS_FILES[@]}" -gt 0 ] &&
   [ -d "${CONDUCTOR_DIR}/node_modules" ] &&
   [ -f "${CONDUCTOR_DIR}/eslint.config.mjs" ]; then
  # Default (stylish) formatter deliberately: ESLint 9 dropped `compact` and
  # `unix` from core, and asking for one exits 2 with an install hint instead of
  # linting — which would make this branch silently report nothing on every file.
  output=$(cd "$CONDUCTOR_DIR" && npx --no-install eslint "${TS_FILES[@]}" 2>/dev/null) || true
  findings=$(echo "$output" | grep -E '^([[:space:]]+[0-9]+:[0-9]+|/)' || true)
  if [ -n "$findings" ]; then
    echo "Lint violations (batch of ${#TS_FILES[@]} TypeScript file(s)):"
    echo "$findings" | head -20
  fi
fi

# Never block — only inform.
exit 0
