#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKFLOW="$HARNESS_DIR/.github/workflows/release.yml"

PASS=0
FAIL=0
TOTAL=0

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

workflow=$(<"$WORKFLOW")
assert_contains "workflow handles only pushes to main" \
  "branches: [main]" "$workflow"
assert_contains "workflow uses the publisher action" \
  "runReleasePublisherAction" "$workflow"
assert_contains "workflow obtains a dedicated App token" \
  "actions/create-github-app-token@v2" "$workflow"
assert_contains "publisher receives the App token, not GITHUB_TOKEN" \
  "github-token: \${{ steps.app-token.outputs.token }}" "$workflow"
assert_contains "publisher is serialized for retry-safe publication" \
  "group: release-publisher" "$workflow"
assert_contains "publisher config names the designated release branch" \
  "branch: 'automation/release-pr'" "$workflow"
assert_contains "publisher config derives the bot identity from the App token" \
  "appLogin: '\${{ steps.app-token.outputs.app-slug }}[bot]'" "$workflow"
assert_contains "publisher reports an ignored event as an empty release set" \
  "result.state === 'ignored'" "$workflow"
assert_absent "legacy Unreleased classifier is no longer a release trigger" \
  "release-unreleased-state.sh" "$workflow"
assert_absent "workflow no longer rewrites CHANGELOG on main" \
  "Rewrite CHANGELOG and bump VERSION" "$workflow"
assert_absent "workflow no longer commits a release directly to main" \
  "git push origin main" "$workflow"
assert_absent "workflow no longer shells out through the legacy release CLI" \
  "gh release create" "$workflow"

printf '\nResults: %s/%s passed\n' "$PASS" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  printf '%s assertion(s) failed.\n' "$FAIL"
  exit 1
fi

printf 'All release publisher workflow tests passed.\n'
