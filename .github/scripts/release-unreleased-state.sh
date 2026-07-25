#!/usr/bin/env bash
set -euo pipefail

changelog_path=${1:-CHANGELOG.md}

if [ ! -f "$changelog_path" ]; then
  echo "CHANGELOG.md missing" >&2
  exit 1
fi

if ! grep -Fxq '## [Unreleased]' "$changelog_path"; then
  echo "CHANGELOG.md missing ## [Unreleased] header" >&2
  exit 1
fi

if awk '
  $0 == "## [Unreleased]" { in_unreleased=1; next }
  in_unreleased && /^## / { exit }
  in_unreleased {
    line=$0
    gsub(/^[[:space:]]+/, "", line)
    gsub(/[[:space:]]+$/, "", line)
    if (line != "" && line !~ /^###[[:space:]]/) {
      substantive=1
      exit
    }
  }
  END { exit substantive ? 0 : 1 }
' "$changelog_path"; then
  echo "release_pending=true"
else
  echo "release_pending=false"
fi
