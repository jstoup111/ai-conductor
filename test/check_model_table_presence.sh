#!/usr/bin/env bash
set -uo pipefail

# check_model_table_presence.sh — Ensures every shipped skill resolves to a
# model-table row, a documented row alias, or a reasoned no-row allowlist.
#
# Environment seams (for fixture trees):
#   HARNESS_INTEGRITY_SKILLS_DIR         — skills/ directory to inspect
#   HARNESS_INTEGRITY_ARCHITECTURE_FILE  — ARCHITECTURE.md table to inspect
#   HARNESS_INTEGRITY_MODEL_TABLE_ALLOWLIST — newline-separated skill|reason entries
#   HARNESS_INTEGRITY_MODEL_TABLE_ALIASES   — newline-separated skill|rows|reason entries
#
# Usage: bash test/check_model_table_presence.sh
# Exit:  0 = every skill has a model-table resolution
#        1 = an input is missing or a skill has no resolution

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

skills_dir="${HARNESS_INTEGRITY_SKILLS_DIR:-${HARNESS_DIR}/skills}"
architecture_file="${HARNESS_INTEGRITY_ARCHITECTURE_FILE:-${HARNESS_DIR}/ARCHITECTURE.md}"

# Entries use skill|rows|reason. The table has separate rows for the two TDD
# phases.
ROW_ALIASES=(
  'tdd|tdd-red,tdd-green|phase rows'
)

# engineer remains temporarily while its pending removal is completed.
SKILL_NO_ROW_ALLOWLIST=(
  'engineer|pending removal of the retired engineer skill'
  'coverage-binding|plan §7a coverage-judge policy with no engine step'
)

if [ "${HARNESS_INTEGRITY_MODEL_TABLE_ALLOWLIST+x}" = x ]; then
  IFS=$'\n' read -r -d '' -a SKILL_NO_ROW_ALLOWLIST \
    < <(printf '%s\0' "$HARNESS_INTEGRITY_MODEL_TABLE_ALLOWLIST") || true
fi

if [ "${HARNESS_INTEGRITY_MODEL_TABLE_ALIASES+x}" = x ]; then
  IFS=$'\n' read -r -d '' -a ROW_ALIASES \
    < <(printf '%s\0' "$HARNESS_INTEGRITY_MODEL_TABLE_ALIASES") || true
fi

if [ ! -d "$skills_dir" ]; then
  echo "Cannot inspect skills: missing directory $skills_dir"
  exit 1
fi

if [ ! -f "$architecture_file" ]; then
  echo "Cannot inspect model table: missing file $architecture_file"
  exit 1
fi

failed=0
for entry in "${SKILL_NO_ROW_ALLOWLIST[@]}"; do
  IFS='|' read -r allowlisted_skill allowlist_reason <<< "$entry"
  if [ -z "$allowlist_reason" ]; then
    echo "${allowlisted_skill} — allowlist entry has an empty reason"
    failed=1
  fi
  if [ ! -d "${skills_dir}/${allowlisted_skill}" ]; then
    echo "${allowlisted_skill} — stale allowlist entry: missing skills/${allowlisted_skill}/"
    failed=1
  fi
done

for entry in "${ROW_ALIASES[@]}"; do
  IFS='|' read -r alias_skill alias_rows alias_reason <<< "$entry"
  if [ -z "$alias_reason" ]; then
    echo "${alias_skill} — alias entry has an empty reason"
    failed=1
  fi
done

# A row name is its first table cell, with surrounding whitespace and a single
# trailing parenthetical annotation removed.
row_names=$(awk -F '|' '
  /^[[:space:]]*\|/ {
    name = $2
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
    sub(/[[:space:]]+\([^()]*\)$/, "", name)
    if (name != "") print name
  }
' "$architecture_file")

has_row() {
  local name=$1
  grep -Fxq "$name" <<< "$row_names"
}

alias_rows_for() {
  local skill=$1 entry alias_skill alias_rows alias_reason
  for entry in "${ROW_ALIASES[@]}"; do
    IFS='|' read -r alias_skill alias_rows alias_reason <<< "$entry"
    if [ "$alias_skill" = "$skill" ]; then
      printf '%s' "$alias_rows"
      return 0
    fi
  done
  return 1
}

allowlist_reason_for() {
  local skill=$1 entry allowlisted_skill reason
  for entry in "${SKILL_NO_ROW_ALLOWLIST[@]}"; do
    IFS='|' read -r allowlisted_skill reason <<< "$entry"
    if [ "$allowlisted_skill" = "$skill" ]; then
      printf '%s' "$reason"
      return 0
    fi
  done
  return 1
}

for skill_file in "$skills_dir"/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  skill_name=$(basename "$(dirname "$skill_file")")

  if has_row "$skill_name"; then
    continue
  fi

  if alias_rows=$(alias_rows_for "$skill_name"); then
    alias_ok=1
    IFS=',' read -r -a aliases <<< "$alias_rows"
    for alias in "${aliases[@]}"; do
      if ! has_row "$alias"; then
        alias_ok=0
        break
      fi
    done
    if [ "$alias_ok" -eq 1 ]; then
      continue
    fi
  fi

  if allowlist_reason=$(allowlist_reason_for "$skill_name"); then
    echo "${skill_name} — allowlisted: ${allowlist_reason}"
    continue
  fi

  echo "${skill_name} — not in ARCHITECTURE.md model selection table"
  failed=1
done

exit "$failed"
