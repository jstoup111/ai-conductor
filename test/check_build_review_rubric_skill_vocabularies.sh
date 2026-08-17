#!/usr/bin/env bash
set -euo pipefail

# Keep the provider-facing closed vocabularies in the four rubric SKILL.md
# contracts equal to the engine's single source of truth. Each comparison is
# set equality: the unified diff exposes both an undocumented engine member
# and a documented member no longer accepted at the trust boundary.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOMAIN_FILE="$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts"

failures=0

extract_engine_vocabulary() {
  local rubric=$1
  awk "/^  ${rubric}: Object\.freeze\\(\{/,/^  \}\),$/" "$DOMAIN_FILE" \
    | grep -oE "'[^']+'" \
    | sed "s/^'//; s/'$//" \
    | sort -u
}

extract_documented_vocabulary() {
  local skill_file=$1
  sed -n '/^\*\*Closed vocabulary:\*\*/,/^$/p' "$skill_file" \
    | grep -oE '`[^`]+`' \
    | tr -d '`' \
    | sort -u
}

for rubric in tautology scope rootCause completeness; do
  skill_file="$HARNESS_DIR/skills/build-review-${rubric//rootCause/root-cause}/SKILL.md"
  if [ ! -f "$DOMAIN_FILE" ] || [ ! -f "$skill_file" ]; then
    echo "missing vocabulary source for ${rubric}: ${DOMAIN_FILE} or ${skill_file}" >&2
    failures=1
    continue
  fi

  engine_vocabulary=$(extract_engine_vocabulary "$rubric")
  documented_vocabulary=$(extract_documented_vocabulary "$skill_file")
  if [ -z "$engine_vocabulary" ] || [ -z "$documented_vocabulary" ]; then
    echo "could not extract closed vocabulary for ${rubric}" >&2
    failures=1
    continue
  fi

  if ! diff -u <(printf '%s\n' "$engine_vocabulary") <(printf '%s\n' "$documented_vocabulary"); then
    echo "build-review ${rubric} vocabulary drift: update the engine and SKILL.md together" >&2
    failures=1
  fi
done

exit "$failures"
