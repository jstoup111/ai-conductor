#!/usr/bin/env bash
set -euo pipefail

# test_dependabot_npm_coverage.sh — every npm root is watched by Dependabot (#3344).
#
# The repository's dependency-vulnerability check is report-only via Dependabot.
# A tracked package-lock.json whose directory is missing from the npm entry in
# .github/dependabot.yml would silently go unwatched, so this fails on drift.
#
# Usage: ./test/test_dependabot_npm_coverage.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$HARNESS_DIR/.github/dependabot.yml"

PASS=0
FAIL=0

check() {
  if [ "$2" -eq 0 ]; then
    echo "  PASS $1"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $1"
    FAIL=$((FAIL + 1))
  fi
}

if [ -f "$CONFIG" ] && grep -Eq '^[[:space:]]*-[[:space:]]*package-ecosystem:[[:space:]]*"?npm"?' "$CONFIG"; then
  check ".github/dependabot.yml declares the npm ecosystem" 0
else
  check ".github/dependabot.yml declares the npm ecosystem" 1
fi

while IFS= read -r lockfile; do
  dir="/$(dirname "$lockfile")"
  [ "$dir" = "/." ] && dir="/"
  if [ -f "$CONFIG" ] && grep -Eq "^[[:space:]]*-[[:space:]]*\"?${dir}\"?[[:space:]]*$" "$CONFIG"; then
    check "Dependabot watches $dir" 0
  else
    check "Dependabot watches $dir" 1
  fi
done < <(git -C "$HARNESS_DIR" ls-files '*package-lock.json')

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
