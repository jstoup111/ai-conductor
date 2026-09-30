# Halt record

Status: halted
Slug: record-task-done-completion-without-a-current-task
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-record-task-done-completion-without-a-current-task
Head SHA: 99d077d837f6b5cbeb2a3fcbde21ed1a036a50c4
Halted at: 2026-09-30T18:26:28.006Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 2 negative: Given the current-task stamp names a different task, when `conduct task done` runs for this task, then it exits non-zero naming both ids, the stamp file is unchanged, and task-status.json is unchanged.
Task ids: 1
Done when checks: The stampless full-evidence runTaskDone test observes exit 0 and a task-status row reading completed with one doneWhen record per declared check. | The stampless missing-evidence runTaskDone test observes exit 1, stderr naming the missing check, and a byte-identical task-status.json. | The stampless plan-gap runTaskDone test observes exit 1, HALT.class reading plan-gap, and the task row not reading completed. | The stampless no-Done-when-block test and the completed-row and skipped-row re-close tests each observe exit 0 with a byte-identical task-status.json. | The existing mismatch-guard tests still observe exit 1 naming both ids with the sibling stamp and task-status.json unchanged.
Missing assertion: The cited check requires exit 1 naming both ids and unchanged task-status.json, but does not explicitly require the stamp file to remain unchanged.
```
