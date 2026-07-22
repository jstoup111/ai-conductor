#!/usr/bin/env bash
set -uo pipefail

# Reads a newline-delimited list of changed file paths from stdin and prints
# exactly one line: docs_only=true or docs_only=false.
#
# - Zero non-empty lines on stdin -> docs_only=false (undeterminable, fail safe)
# - Every non-empty line matches ^\.docs/ -> docs_only=true
# - Any non-empty line does NOT match ^\.docs/ -> docs_only=false

docs_only=false
saw_line=false

while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  if ! $saw_line; then
    saw_line=true
    docs_only=true
  fi
  if [[ ! "$line" =~ ^\.docs/ ]]; then
    docs_only=false
    break
  fi
done

if ! $saw_line; then
  docs_only=false
fi

echo "docs_only=${docs_only}"
