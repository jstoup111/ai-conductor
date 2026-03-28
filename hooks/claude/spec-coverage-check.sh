#!/bin/bash
# After editing a file in app/, check if a corresponding spec file exists.
# Warns Claude if coverage is missing — doesn't block.
set -e

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || echo "")

# Only check files under app/
if [[ "$FILE_PATH" != */app/* ]]; then
  exit 0
fi

# Skip application_record, application_controller, etc.
BASENAME=$(basename "$FILE_PATH" .rb)
if [[ "$BASENAME" == application_* ]]; then
  exit 0
fi

# Determine expected spec path
SPEC_PATH=""
if [[ "$FILE_PATH" == */app/models/* ]]; then
  SPEC_PATH="spec/models/${BASENAME}_spec.rb"
elif [[ "$FILE_PATH" == */app/controllers/* ]]; then
  SPEC_PATH="spec/requests/${BASENAME//_controller/}_spec.rb"
elif [[ "$FILE_PATH" == */app/services/* ]]; then
  # Preserve nested path: app/services/foo/bar.rb → spec/services/foo/bar_spec.rb
  RELATIVE=$(echo "$FILE_PATH" | sed 's|.*/app/services/||')
  SPEC_PATH="spec/services/${RELATIVE%.rb}_spec.rb"
elif [[ "$FILE_PATH" == */app/jobs/* ]]; then
  SPEC_PATH="spec/jobs/${BASENAME}_spec.rb"
fi

if [ -z "$SPEC_PATH" ]; then
  exit 0
fi

if [ ! -f "$SPEC_PATH" ]; then
  echo "SPEC MISSING: ${FILE_PATH} has no corresponding spec at ${SPEC_PATH}. Every app/ file must have a spec."
fi

exit 0
