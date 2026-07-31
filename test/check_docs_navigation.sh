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

if [ ! -f "$CONFIG_PATH" ]; then
  printf '%s: remote_theme requires site configuration\n' "$CONFIG_DISPLAY_PATH" >&2
  exit 1
fi

if ! grep -Fxq "remote_theme: $EXPECTED_REMOTE_THEME" "$CONFIG_PATH"; then
  printf '%s: remote_theme must equal %s\n' "$CONFIG_DISPLAY_PATH" "$EXPECTED_REMOTE_THEME" >&2
  exit 1
fi
