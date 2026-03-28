#!/bin/bash
# Run linter on edited Ruby files after Edit/Write.
# Feeds violations back to Claude so they're fixed immediately.
set -e

INPUT=$(cat)

# Extract the file path from tool input
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || echo "")

# Only lint Ruby files
if [[ "$FILE_PATH" != *.rb ]]; then
  exit 0
fi

# Only lint if file exists (Write creates new files)
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Only lint if standardrb is available
if ! command -v bundle &>/dev/null; then
  exit 0
fi

# Run standardrb on the specific file
OUTPUT=$(bundle exec standardrb --no-fix "$FILE_PATH" 2>&1) || true
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "Lint violations in ${FILE_PATH}:"
  echo "$OUTPUT" | grep -E "^[^ ].*:" | head -10
fi

# Don't block — just inform
exit 0
