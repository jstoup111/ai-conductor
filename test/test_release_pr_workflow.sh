#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/release-metadata.yml"
TEMPLATE="$ROOT_DIR/.github/pull_request_template.md"

grep -q 'types: \[opened, reopened, synchronize, edited\]' "$WORKFLOW"
grep -q 'actions/github-script@v9' "$WORKFLOW"
grep -q 'runReleaseMetadataCheckAction' "$WORKFLOW"
grep -q '^Release-Disposition: no-note$' "$TEMPLATE"
grep -q 'Release-Category:' "$TEMPLATE"
grep -q 'Release-Semver:' "$TEMPLATE"
grep -q 'Release-Note:' "$TEMPLATE"
if rg -q 'copy the entry into CHANGELOG\.md|edit `CHANGELOG\.md`|edit `VERSION`' "$TEMPLATE"; then
  exit 1
fi
