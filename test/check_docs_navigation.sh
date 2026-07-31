#!/usr/bin/env bash
set -uo pipefail

# Offline contract checker for the documentation site's navigation source.
# Each invocation validates the tree rooted at its sole argument, so fixture
# tests never need the repository checkout or any network access.

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <repository-root>\n' "${0##*/}" >&2
  exit 2
fi

ROOT=$1
CONFIG_PATH="$ROOT/docs/_config.yml"
CONFIG_DISPLAY_PATH='docs/_config.yml'
EXPECTED_REMOTE_THEME='just-the-docs/just-the-docs@v0.12.0'
LANDING_PATH="$ROOT/docs/index.md"
LANDING_DISPLAY_PATH='docs/index.md'

if [ ! -f "$CONFIG_PATH" ]; then
  printf '%s: remote_theme requires site configuration\n' "$CONFIG_DISPLAY_PATH" >&2
  exit 1
fi

if ! grep -Fxq "remote_theme: $EXPECTED_REMOTE_THEME" "$CONFIG_PATH"; then
  printf '%s: remote_theme must equal %s\n' "$CONFIG_DISPLAY_PATH" "$EXPECTED_REMOTE_THEME" >&2
  exit 1
fi

if [ ! -f "$LANDING_PATH" ]; then
  printf '%s: required landing page is missing\n' "$LANDING_DISPLAY_PATH" >&2
  exit 1
fi

require_landing_destination() {
  local label=$1
  local target=$2
  local destination=$3
  local destination_path="$ROOT/docs/$destination"

  if ! grep -Fxq -- "- [$label]($target)" "$LANDING_PATH"; then
    printf '%s: %s must link to %s\n' \
      "$LANDING_DISPLAY_PATH" "$label" "docs/$destination" >&2
    return 1
  fi

  if [ ! -f "$destination_path" ]; then
    printf '%s: required landing destination is missing\n' "docs/$destination" >&2
    return 1
  fi
}

require_landing_destination 'Quickstart' 'quickstart.md' 'quickstart.md' || exit 1
require_landing_destination 'Guides' 'guides/' 'guides/index.md' || exit 1
require_landing_destination 'Reference' 'reference/' 'reference/index.md' || exit 1
require_landing_destination 'Explanation' 'explanation/' 'explanation/index.md' || exit 1
require_landing_destination 'Runbooks' 'runbooks/' 'runbooks/index.md' || exit 1
require_landing_destination 'Contributing' 'contributing/' 'contributing/index.md' || exit 1
