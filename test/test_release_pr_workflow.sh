#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
METADATA_WORKFLOW="$ROOT_DIR/.github/workflows/release-metadata.yml"
WORKFLOW="$ROOT_DIR/.github/workflows/release-pr.yml"
PUBLISHER_WORKFLOW="$ROOT_DIR/.github/workflows/release.yml"
TEMPLATE="$ROOT_DIR/.github/pull_request_template.md"

grep -q 'types: \[opened, reopened, synchronize, edited\]' "$METADATA_WORKFLOW"
grep -q 'actions/github-script@v9' "$METADATA_WORKFLOW"
grep -q 'runReleaseMetadataCheckAction' "$METADATA_WORKFLOW"
# The bot-generated release PR has an audit body rather than implementation PR
# disposition metadata, so validation applies only to implementation branches.
rg -U -q "github\.event\.pull_request\.head\.ref != 'automation/release-pr'" "$METADATA_WORKFLOW"
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
grep -q 'permission-checks: write' "$WORKFLOW"
if awk '/^    permissions:$/ {capture=1; next} capture && /^    steps:$/ {exit} capture {print}' "$WORKFLOW" | rg -q '^      (contents|pull-requests|checks): write$'; then
  exit 1
fi
grep -q 'group: release-pr-maintenance' "$WORKFLOW"
grep -q 'cancel-in-progress: false' "$WORKFLOW"
grep -q 'github-token: \${{ steps.app-token.outputs.token }}' "$WORKFLOW"
grep -q 'persist-credentials: false' "$WORKFLOW"
grep -q 'RELEASE_PR_APP_TOKEN: \${{ steps.app-token.outputs.token }}' "$WORKFLOW"
grep -q 'runReleasePrAction' "$WORKFLOW"
# The github-script bridge must compose the complete exported action contract;
# passing only Actions globals crashes before release-PR maintenance can begin.
rg -U -q '(?s)runReleasePrAction\(\{.*git,.*github:.*config:.*generatedFiles:.*title:.*body[,:]' "$WORKFLOW"
if rg -U -q 'runReleasePrAction\(\{\s*github\s*,\s*context\s*,\s*core\s*\}\)' "$WORKFLOW"; then
  exit 1
fi

# Candidate readiness must cross the workflow/action boundary as an exact-head
# check. The branch readers must resolve the remote branch rather than the
# detached implementation-merge checkout.
grep -Fq "readBranchHead: async () => (await gitOutput(['ls-remote', 'origin', \`refs/heads/\${branch}\`])).split(/\\s+/)[0]," "$WORKFLOW"
grep -Fq "['fetch', 'origin', \`refs/heads/\${branch}:refs/remotes/origin/\${branch}\`]" "$WORKFLOW"
grep -Fq "\`refs/remotes/origin/\${branch}:\${path}\`" "$WORKFLOW"

# Inspect the exact GitHub adapter and action input blocks, rather than finding
# disconnected check-related text elsewhere in the workflow.
release_github_adapter="$(awk '/const releaseGithub = \{/{capture=1} capture {print} capture && /^            \};$/ {exit}' "$WORKFLOW")"
grep -Fq 'publishReleaseReadiness: async ({ pullRequestNumber, head, conclusion, summary }) => {' <<<"$release_github_adapter"
grep -Fq 'await github.rest.checks.create({' <<<"$release_github_adapter"
grep -Fq "name: 'release-candidate-audit'," <<<"$release_github_adapter"
grep -Fq 'head_sha: head,' <<<"$release_github_adapter"
release_action_input="$(awk '/await runReleasePrAction\(\{/{capture=1} capture {print} capture && /^            \}\);$/ {exit}' "$WORKFLOW")"
grep -Fq 'github: releaseGithub,' <<<"$release_action_input"
grep -Fq 'audit: candidates.candidates.map(({ number, mergeSha, disposition }) => ({ number, mergeSha, disposition })),' <<<"$release_action_input"

# The publisher adapter must read that named check from the merged PR's exact
# head, leaving head equality to the typed publisher action rather than trusting
# workflow event state.
rg -U -q 'checks\.listForRef\(\{ owner, repo, ref: pull\.data\.head\.sha' "$PUBLISHER_WORKFLOW"
rg -U -q "check\.name === 'release-candidate-audit'" "$PUBLISHER_WORKFLOW"

# Publication is separate from maintenance: its action proves the main commit
# came from this exact App-owned release branch before mutating a tag/release.
grep -q 'runReleasePublisherAction' "$PUBLISHER_WORKFLOW"
grep -q "branch: 'automation/release-pr'" "$PUBLISHER_WORKFLOW"
grep -q "appLogin: '\${{ steps.app-token.outputs.app-slug }}\[bot\]'" "$PUBLISHER_WORKFLOW"
if rg -q 'release-unreleased-state\.sh|Rewrite CHANGELOG and bump VERSION|git push origin main|gh release create' "$PUBLISHER_WORKFLOW"; then
  exit 1
fi
