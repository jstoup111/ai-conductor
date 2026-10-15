#!/usr/bin/env bash
set -uo pipefail

# check_model_table_presence.sh — Ensures every shipped skill resolves to a
# model-table row, a documented row alias, or a reasoned no-row allowlist.
#
# Environment seams (for fixture trees):
#   HARNESS_INTEGRITY_SKILLS_DIR         — skills/ directory to inspect
#   HARNESS_INTEGRITY_ARCHITECTURE_FILE  — ARCHITECTURE.md table to inspect
#
# Usage: bash test/check_model_table_presence.sh
# Exit:  0 = every skill has a model-table resolution
#        1 = an input is missing or a skill has no resolution

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

skills_dir="${HARNESS_INTEGRITY_SKILLS_DIR:-${HARNESS_DIR}/skills}"
architecture_file="${HARNESS_INTEGRITY_ARCHITECTURE_FILE:-${HARNESS_DIR}/ARCHITECTURE.md}"

# Entries use skill|rows|reason. The table has separate rows for the two TDD
# phases, while coverage_binding is an engine gate whose table spelling uses
# an underscore.
ROW_ALIASES=(
  'tdd|tdd-red,tdd-green|phase rows'
  'coverage-binding|coverage_binding|engine-step row spelling'
)

# engineer remains temporarily while its pending removal is completed.
SKILL_NO_ROW_ALLOWLIST=(
  'engineer|pending removal of the retired engineer skill'
)

if [ ! -d "$skills_dir" ]; then
  echo "Cannot inspect skills: missing directory $skills_dir"
  exit 1
fi

if [ ! -f "$architecture_file" ]; then
  echo "Cannot inspect model table: missing file $architecture_file"
  exit 1
fi

# A row name is its first table cell, with surrounding whitespace and a single
# trailing parenthetical annotation removed. This makes the engine-gate row
# `coverage_binding (engine gate)` resolve as `coverage_binding`.
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

failed=0
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
