#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKFLOW="$HARNESS_DIR/.github/workflows/release.yml"
TRANSITION_AUDIT="$HARNESS_DIR/.github/release-transition-audit.md"
CHANGELOG="$HARNESS_DIR/CHANGELOG.md"

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

audit=$(<"$TRANSITION_AUDIT")
assert_contains "transition audit is recorded as consumed" \
  "**Status:** consumed — operator-approved and applied" "$audit"
assert_contains "transition audit exposes the operator approval record" \
  "## Operator approval record" "$audit"
assert_contains "transition audit resolves every inventory row" \
  "No item remains unresolved." "$audit"
assert_absent "transition audit leaves no unresolved disposition" \
  "| unresolved |" "$audit"
assert_contains "transition audit refuses a second transition" \
  "no further transition request will be honored" "$audit"

# The bot-owned maintainer refuses to render while [Unreleased] still carries
# legacy prose (`renderReleaseCandidate` throws on a non-empty pending section),
# so the transition is only complete once that section holds no entries.
pending_entry_count=$(awk '
  /^## \[Unreleased\]/{ in_unreleased = 1; next }
  in_unreleased && /^## /{ exit }
  in_unreleased && /^- /{ count += 1 }
  END { print count + 0 }
' "$CHANGELOG")
if [ "$pending_entry_count" -ne 0 ]; then
  printf 'FAIL [Unreleased] must stay empty — implementation branches never write it (got %s entries)\n' \
    "$pending_entry_count"
  exit 1
fi

if ! grep -qE '^## \[0\.99\.20\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$' "$CHANGELOG"; then
  printf 'FAIL consumed transition must publish its curated ## [0.99.20] section\n'
  exit 1
fi

# Exactly one pending section: the duplicate [Unreleased] headings that the
# transition retitled must never reappear.
unreleased_heading_count=$(grep -c '^## \[Unreleased\]$' "$CHANGELOG")
if [ "$unreleased_heading_count" -ne 1 ]; then
  printf 'FAIL CHANGELOG must carry exactly one [Unreleased] heading (got %s)\n' \
    "$unreleased_heading_count"
  exit 1
fi

renderer="$HARNESS_DIR/src/conductor/src/engine/release-renderer.ts"
category_render_line=$(grep -n "for (const category of categoryOrder)" "$renderer" | cut -d: -f1)
migration_render_line=$(grep -n "const migrations =" "$renderer" | cut -d: -f1)
if [ -z "$category_render_line" ] || [ -z "$migration_render_line" ] || [ "$category_render_line" -ge "$migration_render_line" ]; then
  printf 'FAIL release renderer must render migration blocks after release-note categories\n'
  exit 1
fi

printf '\nResults: %s/%s passed\n' "$PASS" "$TOTAL"
if [ "$FAIL" -gt 0 ]; then
  printf '%s assertion(s) failed.\n' "$FAIL"
  exit 1
fi

printf 'All release publisher workflow tests passed.\n'
