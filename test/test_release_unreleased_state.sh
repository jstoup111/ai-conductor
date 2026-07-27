#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLASSIFIER="$HARNESS_DIR/.github/scripts/release-unreleased-state.sh"
WORKFLOW="$HARNESS_DIR/.github/workflows/release.yml"

PASS=0
FAIL=0
TOTAL=0

assert_classifier_result() {
  local description=$1
  local expected_status=$2
  local expected_output=$3
  TOTAL=$((TOTAL + 1))
  if [ "$CLASSIFIER_STATUS" -eq "$expected_status" ] && [ "$CLASSIFIER_OUTPUT" = "$expected_output" ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (expected: exit %s, %s; got: exit %s, %s)\n' \
      "$description" "$expected_status" "$expected_output" "$CLASSIFIER_STATUS" "$CLASSIFIER_OUTPUT"
    FAIL=$((FAIL + 1))
  fi
}

assert_classifier_failure() {
  local description=$1
  local expected_message=$2
  TOTAL=$((TOTAL + 1))
  if [ "$CLASSIFIER_STATUS" -ne 0 ] && [ "$CLASSIFIER_OUTPUT" = "$expected_message" ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (expected: non-zero exit with %s; got: exit %s, %s)\n' \
      "$description" "$expected_message" "$CLASSIFIER_STATUS" "$CLASSIFIER_OUTPUT"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local description=$1
  local needle=$2
  local haystack=$3
  TOTAL=$((TOTAL + 1))
  if printf '%s\n' "$haystack" | grep -Fq -- "$needle"; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (missing: %s)\n' "$description" "$needle"
    FAIL=$((FAIL + 1))
  fi
}

assert_absent() {
  local description=$1
  local needle=$2
  local haystack=$3
  TOTAL=$((TOTAL + 1))
  if printf '%s\n' "$haystack" | grep -Fq -- "$needle"; then
    printf 'FAIL %s (unexpected: %s)\n' "$description" "$needle"
    FAIL=$((FAIL + 1))
  else
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  fi
}

assert_step_before() {
  local description=$1
  local first_step=$2
  local second_step=$3
  local first_line second_line
  first_line=$(grep -nFx -- "      - name: $first_step" "$WORKFLOW" | head -1 | cut -d: -f1)
  second_line=$(grep -nFx -- "      - name: $second_step" "$WORKFLOW" | head -1 | cut -d: -f1)
  TOTAL=$((TOTAL + 1))
  if [ -n "$first_line" ] && [ -n "$second_line" ] && [ "$first_line" -lt "$second_line" ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (first: %s, second: %s)\n' "$description" "${first_line:-missing}" "${second_line:-missing}"
    FAIL=$((FAIL + 1))
  fi
}

assert_step_field() {
  local description=$1
  local step_name=$2
  local field=$3
  local expected=$4
  local actual
  actual=$(step_block "$step_name" | awk -v prefix="        $field: " '
    index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }
  ')
  TOTAL=$((TOTAL + 1))
  if [ "$actual" = "$expected" ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (expected %s: %s, got: %s)\n' \
      "$description" "$field" "$expected" "${actual:-missing}"
    FAIL=$((FAIL + 1))
  fi
}

assert_step_run_command() {
  local description=$1
  local step_name=$2
  local expected=$3
  local actual
  actual=$(step_block "$step_name" | awk '
    $0 == "        run: |" { in_run=1; next }
    in_run && /^          [^[:space:]#]/ {
      sub(/^          /, "")
      print
      exit
    }
  ')
  TOTAL=$((TOTAL + 1))
  if [ "$actual" = "$expected" ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s (expected first run command: %s, got: %s)\n' \
      "$description" "$expected" "${actual:-missing}"
    FAIL=$((FAIL + 1))
  fi
}

step_block() {
  local step_name=$1
  awk -v target="      - name: $step_name" '
    $0 == target { found=1 }
    found && $0 != target && /^      - / { exit }
    found { print }
  ' "$WORKFLOW"
}

run_classifier() {
  CLASSIFIER_OUTPUT=$(bash "$CLASSIFIER" "$1" 2>&1)
  CLASSIFIER_STATUS=$?
}

fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT

printf '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Ship a notable feature.\n\n## [1.0.0] - 2026-01-01\n' \
  > "$fixture_dir/substantive.md"
run_classifier "$fixture_dir/substantive.md"
assert_classifier_result "substantive Unreleased content is release-pending" \
  "0" "release_pending=true"

printf '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n' \
  > "$fixture_dir/empty.md"
run_classifier "$fixture_dir/empty.md"
assert_classifier_result "empty Unreleased content is not release-pending" \
  "0" "release_pending=false"

printf '# Changelog\n\n## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n## [1.0.0] - 2026-01-01\n' \
  > "$fixture_dir/subheaders-only.md"
run_classifier "$fixture_dir/subheaders-only.md"
assert_classifier_result "subheader-only Unreleased content is not release-pending" \
  "0" "release_pending=false"

printf '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- Historical entry.\n' \
  > "$fixture_dir/missing-header.md"
run_classifier "$fixture_dir/missing-header.md"
assert_classifier_failure "missing Unreleased header fails closed" \
  "CHANGELOG.md missing ## [Unreleased] header"

run_classifier "$fixture_dir/missing-file.md"
assert_classifier_failure "missing changelog file fails closed" \
  "CHANGELOG.md missing"

workflow=$(<"$WORKFLOW")
classifier_invocation='bash .github/scripts/release-unreleased-state.sh >> "$GITHUB_OUTPUT"'
assert_step_field "classifier exposes release state through the expected step id" \
  "Classify pending release content" "id" "release_state"
assert_step_run_command "classifier step invokes the release-state script" \
  "Classify pending release content" "$classifier_invocation"
assert_step_before "classification precedes changelog and version mutation" \
  "Classify pending release content" "Rewrite CHANGELOG and bump VERSION"
assert_step_before "classification precedes commit, tag, and push" \
  "Classify pending release content" "Commit, tag, push"
assert_step_before "classification precedes GitHub Release creation" \
  "Classify pending release content" "Create GitHub Release"

mutation_guard="steps.release_state.outputs.release_pending == 'true' && steps.tag_check.outputs.skip == 'false'"
assert_step_field "rewrite and VERSION bump are guarded by pending content" \
  "Rewrite CHANGELOG and bump VERSION" "if" "$mutation_guard"
assert_step_field "commit, tag, and push are guarded by pending content" \
  "Commit, tag, push" "if" "$mutation_guard"
assert_step_field "GitHub Release creation is guarded by pending content" \
  "Create GitHub Release" "if" "$mutation_guard"
assert_absent "empty content no longer reaches the former hard-fail verification step" \
  "Verify [Unreleased] has content" "$workflow"

printf '\nResults: %s/%s passed\n' "$PASS" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  printf '%s assertion(s) failed.\n' "$FAIL"
  exit 1
fi

printf 'All release-unreleased-state tests passed.\n'
