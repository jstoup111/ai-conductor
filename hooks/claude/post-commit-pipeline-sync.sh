#!/bin/bash
# After a git commit, update .pipeline/task-status.json if pipeline is active.
# Completes the first pending/in_progress task and starts the next one.
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

python3 << 'PYEOF'
import json, os

path = ".pipeline/task-status.json"
if not os.path.exists(path):
    exit(0)

with open(path) as f:
    state = json.load(f)

def task_sort_key(task_id):
    parts = task_id.split("-")
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return 0

sorted_ids = sorted(state.keys(), key=task_sort_key)

# Find the first task that needs completing (in_progress first, then pending)
completed_id = None
for task_id in sorted_ids:
    task = state[task_id]
    if isinstance(task, dict) and task.get("status") == "in_progress":
        task["status"] = "completed"
        completed_id = task_id
        break

# If nothing was in_progress, complete the first pending task
if completed_id is None:
    for task_id in sorted_ids:
        task = state[task_id]
        if isinstance(task, dict) and task.get("status") == "pending":
            task["status"] = "completed"
            completed_id = task_id
            break

if completed_id is None:
    exit(0)

# Mark the next pending task as in_progress
next_started = None
for task_id in sorted_ids:
    task = state[task_id]
    if isinstance(task, dict) and task.get("status") == "pending":
        task["status"] = "in_progress"
        next_started = task_id
        break

# Count progress
total = len(sorted_ids)
done = sum(1 for t in state.values() if isinstance(t, dict) and t.get("status") == "completed")

with open(path, "w") as f:
    json.dump(state, f, indent=2)

msg = f"Pipeline: {completed_id} → completed ({done}/{total})"
if next_started:
    msg += f", {next_started} → in_progress"
print(msg)
PYEOF

exit 0
