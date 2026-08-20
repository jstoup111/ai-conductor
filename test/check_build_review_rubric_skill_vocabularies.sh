#!/usr/bin/env bash
set -euo pipefail

# Keep the provider-facing closed vocabularies in the four rubric SKILL.md
# contracts equal to the engine's single source of truth. Each comparison is
# set equality: the unified diff exposes both an undocumented engine member
# and a documented member no longer accepted at the trust boundary.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
failures=0

extract_current_engine_vocabulary() {
  local domain_file=$1
  local rubric=$2
  awk -v rubric="$rubric" '
    /^export const BUILD_REVIEW_FINDING_VOCABULARIES = Object\.freeze\(\{$/ { in_vocabularies = 1; next }
    in_vocabularies && $0 ~ "^  " rubric ": Object\\.freeze\\(\\{" { in_rubric = 1; next }
    in_rubric && /^  \}\),$/ { exit }
    in_rubric { print }
  ' "$domain_file" \
    | grep -oE "'[^']+'" \
    | sed "s/^'//; s/'$//" \
    | sort -u
}

check_vocabulary_drift() {
  local domain_file=$1
  local harness_dir=$2
  local rubric skill_file engine_vocabulary documented_vocabulary

  for rubric in tautology scope rootCause completeness; do
    skill_file="$harness_dir/skills/build-review-${rubric//rootCause/root-cause}/SKILL.md"
    if [ ! -f "$domain_file" ] || [ ! -f "$skill_file" ]; then
      echo "missing vocabulary source for ${rubric}: ${domain_file} or ${skill_file}" >&2
      return 1
    fi

    engine_vocabulary=$(extract_current_engine_vocabulary "$domain_file" "$rubric")
    documented_vocabulary=$(extract_documented_vocabulary "$skill_file")
    if [ -z "$engine_vocabulary" ] || [ -z "$documented_vocabulary" ]; then
      echo "could not extract closed vocabulary for ${rubric}" >&2
      return 1
    fi

    if ! diff -u <(printf '%s\n' "$engine_vocabulary") <(printf '%s\n' "$documented_vocabulary"); then
      echo "build-review ${rubric} vocabulary drift: update the engine and SKILL.md together" >&2
      return 1
    fi
  done
}

extract_documented_vocabulary() {
  local skill_file=$1
  sed -n '/^\*\*Closed vocabulary:\*\*/,/^$/p' "$skill_file" \
    | grep -oE '`[^`]+`' \
    | tr -d '`' \
    | sort -u
}

fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
fixture_domain="$fixture_dir/src/conductor/src/engine/build-review-domain.ts"
fixture_harness="$fixture_dir/harness"
mkdir -p "$(dirname "$fixture_domain")" "$fixture_harness/skills"

# #1696 fixture: a parser-enforced plan-task grammar has no matching statement
# in the completeness rubric contract. The current guard compares only closed
# vocabularies, so it incorrectly accepts this fixture. Task 14 turns that
# expected-zero result into a rejection.
cat >"$fixture_domain" <<'EOF'
export const BUILD_REVIEW_FINDING_VOCABULARIES = Object.freeze({
  tautology: Object.freeze({
    concernKinds: Object.freeze(['assertion-insensitive-to-production']),
  }),
  scope: Object.freeze({
    concernKinds: Object.freeze(['out-of-plan-change']),
  }),
  rootCause: Object.freeze({
    concernKinds: Object.freeze(['root-cause-unaddressed']),
  }),
  completeness: Object.freeze({
    concernKinds: Object.freeze(['missing-deliverable']),
  }),
});

const CANONICAL_PLAN_TASK_REFERENCE = /^Task [1-9][0-9]*$/;
EOF

for rubric in tautology scope root-cause completeness; do
  mkdir -p "$fixture_harness/skills/build-review-$rubric"
done

printf '%s\n' '**Closed vocabulary:** `assertion-insensitive-to-production`' \
  >"$fixture_harness/skills/build-review-tautology/SKILL.md"
printf '%s\n' '**Closed vocabulary:** `out-of-plan-change`' \
  >"$fixture_harness/skills/build-review-scope/SKILL.md"
printf '%s\n' '**Closed vocabulary:** `root-cause-unaddressed`' \
  >"$fixture_harness/skills/build-review-root-cause/SKILL.md"
printf '%s\n' '**Closed vocabulary:** `missing-deliverable`' \
  >"$fixture_harness/skills/build-review-completeness/SKILL.md"

if ! grep -q 'CANONICAL_PLAN_TASK_REFERENCE' "$fixture_domain" \
    || grep -q 'Task \[1-9\]' "$fixture_harness/skills/build-review-completeness/SKILL.md"; then
  echo 'rubric reference-grammar fixture is malformed' >&2
  failures=1
elif check_vocabulary_drift "$fixture_domain" "$fixture_harness"; then
  echo 'known gap: vocabulary guard accepts an unstated plan-task reference grammar fixture'
else
  echo 'rubric vocabulary guard unexpectedly rejected the unstated-grammar fixture' >&2
  failures=1
fi

if ! check_vocabulary_drift "$HARNESS_DIR/src/conductor/src/engine/build-review-domain.ts" "$HARNESS_DIR"; then
  failures=1
fi

exit "$failures"
