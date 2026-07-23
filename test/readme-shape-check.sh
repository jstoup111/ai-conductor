#!/usr/bin/env bash
# Task 12: README length + heading-shape check.
# Asserts README.md stays within a 300-line front-door budget and that its
# top-level heading set is exactly the front-door set (no relocated
# section headings/bodies leaking back in as inline content).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
README="$REPO_ROOT/README.md"
FAIL=0
MAX_LINES=300

fail() {
  echo "FAIL: $1"
  FAIL=1
}

if [[ ! -f "$README" ]]; then
  echo "FAIL: README.md not found"
  exit 1
fi

line_count="$(wc -l < "$README")"
if [[ "$line_count" -gt "$MAX_LINES" ]]; then
  fail "README.md is $line_count lines, expected <= $MAX_LINES"
fi

# Front-door heading set (order-sensitive), current as of Task 9's
# Documentation index addition.
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

# Relocated section headings must not reappear as inline bodies in README.
relocated_headings=(
  "## Choosing a Conductor"
  "## Configuration"
  "## How It Works"
  "## TypeScript Conductor"
  "## Project Structure"
  "## What Your Project Gets"
  "## Adding Tech-Context for New Stacks"
  "## Daemon Operations"
  "## Observability"
  "## Intake"
  "## Architecture"
  "## Getting Started"
)

for heading in "${relocated_headings[@]}"; do
  if grep -qF "$heading" "$README"; then
    fail "relocated heading '$heading' still present in README.md"
  fi
done

if [[ "$FAIL" -eq 0 ]]; then
  echo "PASS: README.md is <= $MAX_LINES lines ($line_count) with the front-door heading shape"
  exit 0
else
  exit 1
fi
