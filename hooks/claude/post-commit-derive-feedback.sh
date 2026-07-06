#!/bin/bash
# Fast-feedback derive on commit: warns on non-evidencing commits.
# Advisory only; never blocks commits or writes task-status.
#
# Invokes the ENGINE derive path (`conduct-ts derive-feedback --sha <sha>`)
# instead of a bare bash regex, so fast feedback agrees with the same
# engine-owned evidence grammar the build gate uses (H9: task ids are
# [A-Za-z0-9._-]+, not numeric-only — `rem-fr10-1` is a valid id and must
# not warn).
#
# If the engine binary is missing, broken, or errors for any reason, this
# hook falls back to a lightweight bash-only check covering the same two
# forms the engine checks: a `Task: <id>` trailer (H9 grammar), and a
# path-fallback (does the commit touch a file path referenced under a
# `### Task <id>` header in a plan file?).
#
# Advisory output (the "warning: ..." lines) is written to STDOUT — this is
# fast feedback for a human at the terminal, not a hard error the shell
# should treat as diagnostic noise. Anomalies about the engine path itself
# (unavailable/broken) go to stderr, since those are operational notices,
# not part of the Task-trailer feedback contract.
#
# Acceptance criteria:
# 1. Commit with no Task: trailer and no path-fallback match → warn (stdout) with commit sha + expected form
# 2. Evidencing commit (valid Task: trailer, ANY H9 id — numeric or not) → no stdout output
# 3. Engine binary missing / derive throws → exit 0, commit unaffected, anomaly logged (stderr)
# 4. Never writes task-status itself
# 5. Always exits 0 (non-fatal)
set -e

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$HOOK_DIR/../.." && pwd)"

# H9 task id grammar — kept in sync with TASK_ID_PATTERN in
# src/conductor/src/engine/autoheal.ts. Used only by the bash fallback path;
# the engine path is authoritative when available.
TASK_ID_PATTERN='[A-Za-z0-9._-]+'

warn() {
  echo "warning: commit $commit lacks Task: trailer"
  echo "  Expected: Task: <id> (e.g., Task: <id>)"
  echo "  See: https://github.com/jamesstoup/james-stoup-agents for more info"
}

# Get the current commit SHA
commit=$(git rev-parse HEAD 2>/dev/null || echo "")
if [ -z "$commit" ]; then
  # No commits yet (initial commit), nothing to check
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# Best-effort plan path discovery for the path-fallback check: prefer a
# plan under .docs/plans matching a slug derivable from the current branch
# name, else fall back to the most recently modified plan (best-effort,
# advisory-only — a wrong guess here only weakens the fallback check, it
# never produces a false hard error).
plan_path=""
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ -n "$branch" ] && [ -f "$repo_root/.docs/plans/${branch#*/}.md" ]; then
  plan_path="$repo_root/.docs/plans/${branch#*/}.md"
elif [ -d "$repo_root/.docs/plans" ]; then
  plan_path=$(ls -t "$repo_root/.docs/plans"/*.md 2>/dev/null | head -1 || echo "")
fi

# ── Try the engine derive path first ──────────────────────────────────────
engine_bin="${AI_CONDUCTOR_ENGINE_BIN:-$HARNESS_DIR/bin/conduct-ts}"

engine_output=""
engine_ok=0
if [ -x "$engine_bin" ] || command -v "$engine_bin" >/dev/null 2>&1; then
  set +e
  if [ -n "$plan_path" ]; then
    engine_output=$(cd "$repo_root" && timeout 5s "$engine_bin" derive-feedback --sha "$commit" --plan "$plan_path" 2>/dev/null)
  else
    engine_output=$(cd "$repo_root" && timeout 5s "$engine_bin" derive-feedback --sha "$commit" 2>/dev/null)
  fi
  engine_exit=$?
  set -e
  # Exit 0 or 1 with well-formed JSON means the engine answered; anything
  # else (crash, spawn failure, malformed output) is treated as "engine
  # unavailable" and we degrade to the bash fallback below.
  if { [ "$engine_exit" -eq 0 ] || [ "$engine_exit" -eq 1 ]; } && echo "$engine_output" | grep -q '"evidenced"'; then
    engine_ok=1
  else
    echo "notice: engine derive path unavailable for fast-feedback (exit $engine_exit); falling back to local check" >&2
  fi
fi

if [ "$engine_ok" -eq 1 ]; then
  if echo "$engine_output" | grep -q '"evidenced":true'; then
    # Evidenced — silent, per advisory contract.
    exit 0
  fi
  warn
  exit 0
fi

# ── Bash fallback: same two forms, computed locally ───────────────────────
commit_msg=$(git log -1 --format=%B "$commit" 2>/dev/null || echo "")
if echo "$commit_msg" | grep -qE "^Task: ${TASK_ID_PATTERN}\$"; then
  # Valid Task trailer found (H9 grammar) — commit is evidenced
  exit 0
fi

# Path-fallback: does this commit touch a file referenced under a
# `### Task <id>` header in the discovered plan file? Best-effort only.
if [ -n "$plan_path" ] && [ -f "$plan_path" ]; then
  changed_files=$(git diff-tree --no-commit-id --name-only -r "$commit" 2>/dev/null || echo "")
  if [ -n "$changed_files" ]; then
    plan_paths=$(grep -oE '`[^`]+`' "$plan_path" 2>/dev/null | tr -d '`' || echo "")
    for f in $changed_files; do
      if echo "$plan_paths" | grep -qxF "$f"; then
        # Path overlap with a task's declared files — treat as evidenced.
        exit 0
      fi
    done
  fi
fi

# No Task: trailer and no path-fallback match — warn the user.
warn
exit 0
