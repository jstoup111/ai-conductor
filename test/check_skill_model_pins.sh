#!/usr/bin/env bash
set -uo pipefail

# check_skill_model_pins.sh — Ensures SKILL.md `model:` pins agree with the
# engine's expected models in both directions.
#
# Environment seams (for fixture trees):
#   HARNESS_INTEGRITY_TEST_PINS_JSON   — JSON normally emitted by
#                                       bin/generate-model-table --pins
#   HARNESS_INTEGRITY_TEST_SKILLS_DIR  — skills/ directory to inspect
#
# Usage: bash test/check_skill_model_pins.sh
# Exit:  0 = every pin and expected model agrees
#        1 = malformed input, missing skill, unmapped pin, or disagreement

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -n "${HARNESS_INTEGRITY_TEST_PINS_JSON:-}" ]; then
  pins_json=$HARNESS_INTEGRITY_TEST_PINS_JSON
  pins_exit=0
else
  pins_json=$("${HARNESS_DIR}/bin/generate-model-table" --pins 2>/dev/null)
  pins_exit=$?
fi
pin_skills_dir="${HARNESS_INTEGRITY_TEST_SKILLS_DIR:-${HARNESS_DIR}/skills}"

if [ "$pins_exit" -ne 0 ] || ! printf '%s\n' "$pins_json" | jq -e . >/dev/null 2>&1; then
  echo "bin/generate-model-table --pins produced parseable JSON"
  exit 1
fi

if [ ! -d "$pin_skills_dir" ]; then
  echo "Cannot inspect skill pins: missing directory $pin_skills_dir"
  exit 1
fi

failed=0

# This is the existing pin-to-engine comparison: every explicit pin must map
# to an entry and, unless exempt, agree with its expected model.
for skill_file in "${pin_skills_dir}"/*/SKILL.md; do
  [ -f "$skill_file" ] || continue
  skill_name=$(basename "$(dirname "$skill_file")")

  frontmatter=$(sed -n '2,/^---$/p' "$skill_file" | head -n -1)
  pinned=$({ printf '%s\n' "$frontmatter" | grep -E '^model:' || true; } | head -1 | sed -E 's/^model:[[:space:]]*//' | tr -d '[:space:]')

  if [ -z "$pinned" ]; then
    continue
  fi

  entry=$(printf '%s\n' "$pins_json" | jq -c --arg s "$skill_name" '.[$s] // empty')

  if [ -z "$entry" ]; then
    echo "${skill_name} — pinned '${pinned}' but not present in --pins output (unmapped)"
    failed=1
    continue
  fi

  is_exempt=$(printf '%s\n' "$entry" | jq -r '.exempt // false')
  if [ "$is_exempt" = "true" ]; then
    echo "${skill_name} — exempt from pin check"
    continue
  fi

  expected=$(printf '%s\n' "$entry" | jq -r '.expected // empty')
  if [ "$pinned" = "$expected" ]; then
    echo "${skill_name} — pin '${pinned}' agrees with expected '${expected}'"
  else
    echo "${skill_name} — pin/expected disagreement: pinned='${pinned}' expected='${expected}'"
    failed=1
  fi
done

# The reverse comparison prevents a non-exempt engine expectation from silently
# losing its SKILL.md pin or its SKILL.md file altogether.
while IFS= read -r pin_entry; do
  skill_name=$(printf '%s\n' "$pin_entry" | jq -r '.key')
  entry=$(printf '%s\n' "$pin_entry" | jq -c '.value')
  is_exempt=$(printf '%s\n' "$entry" | jq -r '.exempt // false')
  [ "$is_exempt" = "true" ] && continue

  expected=$(printf '%s\n' "$entry" | jq -r '.expected // empty')
  skill_file="${pin_skills_dir}/${skill_name}/SKILL.md"
  if [ ! -f "$skill_file" ]; then
    echo "${skill_name} — expected '${expected}' but missing skills/${skill_name}/SKILL.md"
    failed=1
    continue
  fi

  frontmatter=$(sed -n '2,/^---$/p' "$skill_file" | head -n -1)
  pinned=$({ printf '%s\n' "$frontmatter" | grep -E '^model:' || true; } | head -1 | sed -E 's/^model:[[:space:]]*//' | tr -d '[:space:]')
  if [ "$pinned" = "$expected" ]; then
    continue
  fi

  if [ -z "$pinned" ]; then
    echo "${skill_name} — expected '${expected}' but SKILL.md has no model: pin"
  else
    echo "${skill_name} — pin/expected disagreement: pinned='${pinned}' expected='${expected}'"
  fi
  failed=1
done < <(printf '%s\n' "$pins_json" | jq -c 'to_entries[]')

exit "$failed"
