# Intake origin: record-task-done-completion-without-a-current-task

Source-Ref: jstoup111/ai-conductor#2809
Owner: jstoup111

## Desired outcome
- `conduct task done <id>` with no current-task stamp either records the task's completion or exits non-zero with a message naming the supported way to record it; it never exits 0 while leaving the task open.
- A task that is already complete still closes idempotently with exit 0 (negative path).
- A different task's stamp is still never cleared (unchanged behavior).
