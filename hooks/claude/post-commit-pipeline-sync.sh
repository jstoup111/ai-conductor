#!/bin/bash
# After a git commit, update .pipeline/task-status.json if pipeline is active.
# Marks the current in_progress task as completed.
set -e

PIPELINE_STATE=".pipeline/task-status.json"

# Only run if pipeline is active
if [ ! -f "$PIPELINE_STATE" ]; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('command', ''))
" 2>/dev/null || echo "")

# Only trigger on git commit commands
if ! echo "$COMMAND" | grep -qE 'git\s+commit'; then
  exit 0
fi

# Find and complete the first in_progress task
python3 << 'PYEOF'
import json, os

path = ".pipeline/task-status.json"
if not os.path.exists(path):
    exit(0)

with open(path) as f:
    state = json.load(f)

updated = False
for task_id in sorted(state.keys(), key=lambda x: int(x.split("-")[-1]) if x.split("-")[-1].isdigit() else 0):
    task = state[task_id]
    if isinstance(task, dict) and task.get("status") == "in_progress":
        task["status"] = "completed"
        updated = True
        print(f"Pipeline: marked {task_id} as completed")
        break

if updated:
    with open(path, "w") as f:
        json.dump(state, f, indent=2)
PYEOF

exit 0
