#!/bin/bash
# After editing a structural file, warn if architecture diagrams may need updating.
# Non-blocking — always exits 0.
set -e

INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || echo "")

# Only check structural files that affect architecture
STRUCTURAL=false
case "$FILE_PATH" in
  */app/models/*)       STRUCTURAL=true ;;
  */app/controllers/*)  STRUCTURAL=true ;;
  */app/services/*)     STRUCTURAL=true ;;
  */app/jobs/*)         STRUCTURAL=true ;;
  */config/routes.rb)   STRUCTURAL=true ;;
  */db/migrate/*)       STRUCTURAL=true ;;
  */docker-compose*)    STRUCTURAL=true ;;
  */Procfile*)          STRUCTURAL=true ;;
  # Non-Rails equivalents
  */src/controllers/*)  STRUCTURAL=true ;;
  */src/services/*)     STRUCTURAL=true ;;
  */src/models/*)       STRUCTURAL=true ;;
esac

if [ "$STRUCTURAL" = "false" ]; then
  exit 0
fi

# Only warn if diagrams have been bootstrapped
if [ ! -d ".docs/architecture" ]; then
  exit 0
fi

echo "DIAGRAM UPDATE: Structural file changed ($(basename "$FILE_PATH")) — architecture diagrams in .docs/architecture/ may need updating."

exit 0
