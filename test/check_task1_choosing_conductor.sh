#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
if [ ! -f docs/choosing-a-conductor.md ]; then
  echo "FAIL: docs/choosing-a-conductor.md does not exist"
  fail=1
else
  grep -q "^## Choosing a Conductor" docs/choosing-a-conductor.md || { echo "FAIL: missing Choosing a Conductor heading"; fail=1; }
  grep -q "^### Command syntax and unknown-command guard" docs/choosing-a-conductor.md || { echo "FAIL: missing Command syntax heading"; fail=1; }
  grep -q "Reads \`src/conductor/.tool-versions\` via asdf" docs/choosing-a-conductor.md || { echo "FAIL: missing table content"; fail=1; }
fi

if grep -q "^## Choosing a Conductor" README.md; then
  echo "FAIL: README.md still contains Choosing a Conductor section"
  fail=1
fi
if grep -q "^### Command syntax and unknown-command guard" README.md; then
  echo "FAIL: README.md still contains Command syntax subsection"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
