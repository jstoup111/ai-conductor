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
assert_contains "transition audit remains visibly unapproved" \
  "**Status:** proposed — not approved and not consumed" "$audit"
assert_contains "transition audit exposes the operator approval record" \
  "## Operator approval record" "$audit"
assert_contains "transition audit refuses silent uncertainty" \
  "every item as unresolved" "$audit"
assert_contains "transition audit records legacy entry count" \
  "| Legacy \`[Unreleased]\` bullet entries | 552 | unresolved |" "$audit"
assert_contains "transition audit records the post-tag commit range" \
  "v0.99.17..a8efea389854322808abf56af41923ef468f76a1" "$audit"
assert_contains "transition audit records post-tag reference count" \
  "| Distinct \`#NNN\` references found in those commit subjects/bodies | 877 | unresolved |" "$audit"

legacy_entry_count=$(awk '
  /^## \[Unreleased\]/{ in_unreleased = 1; next }
  in_unreleased && /^## \[/{ exit }
  in_unreleased && /^- /{ count += 1 }
  END { print count + 0 }
' "$CHANGELOG")
if [ "$legacy_entry_count" -ne 552 ]; then
  printf 'FAIL transition audit legacy count drift (expected 552, got %s)\n' "$legacy_entry_count"
  exit 1
fi

audit_legacy_hash=$(printf '%s\n' "$audit" | sed -n 's/.*bullet-list SHA-256 `\([0-9a-f]*\)`.*/\1/p')
actual_legacy_hash=$(awk '
  /^## \[Unreleased\]/{ in_unreleased = 1; next }
  in_unreleased && /^## \[/{ exit }
  in_unreleased { print }
' "$CHANGELOG" | awk '/^- /{ print NR ":" $0 }' | sha256sum | awk '{ print $1 }')
if [ "$audit_legacy_hash" != "$actual_legacy_hash" ]; then
  printf 'FAIL transition audit legacy inventory hash drift\n'
  exit 1
fi

renderer="$HARNESS_DIR/src/conductor/src/engine/release-renderer.ts"
category_render_line=$(rg -n "for \(const category of categoryOrder\)" "$renderer" | cut -d: -f1)
migration_render_line=$(rg -n "const migrations =" "$renderer" | cut -d: -f1)
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
