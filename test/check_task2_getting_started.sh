#!/usr/bin/env bash
# RED/GREEN check for Task 2: relocate getting-started depth to docs/getting-started.md
set -uo pipefail
fail=0

if [ ! -f docs/getting-started.md ]; then
  echo "FAIL: docs/getting-started.md does not exist"
  fail=1
else
  grep -q "^## What Your Project Gets" docs/getting-started.md || { echo "FAIL: missing 'What Your Project Gets' in docs/getting-started.md"; fail=1; }
  grep -q "^## Adding Tech-Context for New Stacks" docs/getting-started.md || { echo "FAIL: missing 'Adding Tech-Context for New Stacks' in docs/getting-started.md"; fail=1; }
  grep -q "npm install && npm run build" docs/getting-started.md || { echo "FAIL: missing fuller install detail in docs/getting-started.md"; fail=1; }
fi

if grep -q "^## What Your Project Gets" README.md; then
  echo "FAIL: README.md still has 'What Your Project Gets' section"
  fail=1
fi

if grep -q "^## Adding Tech-Context for New Stacks" README.md; then
  echo "FAIL: README.md still has 'Adding Tech-Context for New Stacks' section"
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "PASS"
fi
exit $fail
