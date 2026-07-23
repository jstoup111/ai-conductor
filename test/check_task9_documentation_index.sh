#!/usr/bin/env bash
# RED/GREEN check for Task 9: add "## Documentation" index to README.md
set -uo pipefail
fail=0

if ! grep -q "^## Documentation$" README.md; then
  echo "FAIL: README.md missing '## Documentation' section"
  fail=1
fi

targets=(
  "docs/choosing-a-conductor.md"
  "docs/getting-started.md"
  "docs/configuration.md"
  "docs/daemon-operations.md"
  "docs/observability.md"
  "docs/intake.md"
  "docs/architecture.md"
  "docs/runbooks"
  "src/conductor/README.md"
)

for t in "${targets[@]}"; do
  if [ ! -e "$t" ]; then
    echo "FAIL: link target $t does not exist on disk"
    fail=1
  fi
  if [ "$t" = "docs/runbooks" ]; then
    if ! grep -Eq '\(docs/runbooks/[^)]+\)|\(docs/runbooks/?\)' README.md; then
      echo "FAIL: README.md Documentation section missing link to $t"
      fail=1
    fi
  elif ! grep -Eq "\($t/?\)" README.md; then
    echo "FAIL: README.md Documentation section missing link to $t"
    fail=1
  fi
done

if [ $fail -eq 0 ]; then
  echo "PASS"
fi
exit $fail
