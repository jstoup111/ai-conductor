#!/usr/bin/env bash
# Verifies README.md is a condensed front-door: exact top-level heading set,
# Quick Start links to docs/getting-started.md, and no relocated Configuration
# section body remains.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
README="$REPO_ROOT/README.md"
FAIL=0

fail() {
  echo "FAIL: $1"
  FAIL=1
}

if [[ ! -f "$README" ]]; then
  echo "FAIL: README.md not found"
  exit 1
fi

# Current front-door heading set (Task 9 added "## Documentation").
expected=(
  "## Requirements"
  "## Install"
  "## How the Pieces Fit Together"
  "## Quick Start"
  "## Documentation"
  "## Key Design Principles"
)

mapfile -t actual < <(grep -E '^## ' "$README")

if [[ "${#actual[@]}" -ne "${#expected[@]}" ]]; then
  fail "expected ${#expected[@]} top-level headings, found ${#actual[@]}: ${actual[*]}"
else
  for i in "${!expected[@]}"; do
    if [[ "${actual[$i]}" != "${expected[$i]}" ]]; then
      fail "heading mismatch at position $i: expected '${expected[$i]}', got '${actual[$i]}'"
    fi
  done
fi

if ! grep -q '## Quick Start' "$README"; then
  fail "missing ## Quick Start heading"
fi

quick_start_body="$(awk '/^## Quick Start/{flag=1; next} /^## /{flag=0} flag' "$README")"

if ! grep -q 'docs/getting-started.md' <<<"$quick_start_body"; then
  fail "Quick Start section does not link to docs/getting-started.md"
fi

quick_start_lines="$(wc -l <<<"$quick_start_body")"
if [[ "$quick_start_lines" -gt 40 ]]; then
  fail "Quick Start section is not minimal ($quick_start_lines lines, expected <= 40)"
fi

if grep -q '^## Configuration' "$README"; then
  fail "Configuration heading should not remain as a top-level heading"
fi

if [[ "$FAIL" -eq 0 ]]; then
  echo "PASS: README.md is a condensed front-door"
  exit 0
else
  exit 1
fi
