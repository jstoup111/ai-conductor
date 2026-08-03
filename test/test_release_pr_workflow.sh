#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
METADATA_WORKFLOW="$ROOT_DIR/.github/workflows/release-metadata.yml"
WORKFLOW="$ROOT_DIR/.github/workflows/release-pr.yml"
TEMPLATE="$ROOT_DIR/.github/pull_request_template.md"

grep -q 'types: \[opened, reopened, synchronize, edited\]' "$METADATA_WORKFLOW"
grep -q 'actions/github-script@v9' "$METADATA_WORKFLOW"
grep -q 'runReleaseMetadataCheckAction' "$METADATA_WORKFLOW"
grep -q '^Release-Disposition: no-note$' "$TEMPLATE"
grep -q 'Release-Category:' "$TEMPLATE"
grep -q 'Release-Semver:' "$TEMPLATE"
grep -q 'Release-Note:' "$TEMPLATE"
if rg -q 'copy the entry into CHANGELOG\.md|edit `CHANGELOG\.md`|edit `VERSION`' "$TEMPLATE"; then
  exit 1
fi

# Release PR maintenance is App-authenticated and only runs for merged
# implementation PRs.  It must serialize all generated-branch mutations.
grep -q 'types: \[closed\]' "$WORKFLOW"
rg -U -q "if:\s*>-?\n\s*github\.event\.pull_request\.merged == true" "$WORKFLOW"
rg -U -q "github\.event\.pull_request\.head\.ref != 'automation/release-pr'" "$WORKFLOW"
grep -q 'actions/create-github-app-token@v2' "$WORKFLOW"
grep -q 'app-id: \${{ secrets.RELEASE_PR_APP_ID }}' "$WORKFLOW"
grep -q 'private-key: \${{ secrets.RELEASE_PR_APP_PRIVATE_KEY }}' "$WORKFLOW"
grep -q 'permission-contents: write' "$WORKFLOW"
grep -q 'permission-pull-requests: write' "$WORKFLOW"
grep -q 'group: release-pr-maintenance' "$WORKFLOW"
grep -q 'cancel-in-progress: false' "$WORKFLOW"
grep -q 'github-token: \${{ steps.app-token.outputs.token }}' "$WORKFLOW"
grep -q 'runReleasePrAction' "$WORKFLOW"

# Publication is separate from maintenance: its action proves the main commit
# came from this exact App-owned release branch before mutating a tag/release.
PUBLISHER_WORKFLOW="$ROOT_DIR/.github/workflows/release.yml"
grep -q 'runReleasePublisherAction' "$PUBLISHER_WORKFLOW"
grep -q "branch: 'automation/release-pr'" "$PUBLISHER_WORKFLOW"
grep -q "appLogin: '\${{ steps.app-token.outputs.app-slug }}\[bot\]'" "$PUBLISHER_WORKFLOW"
if rg -q 'release-unreleased-state\.sh|Rewrite CHANGELOG and bump VERSION|git push origin main|gh release create' "$PUBLISHER_WORKFLOW"; then
  exit 1
fi
