# Intake origin: build-step-completes-with-every-plan-task-still-pe

Source-Ref: jstoup111/ai-conductor#2014
Owner: jstoup111

## Desired outcome

- A build step that finishes while any task is still `pending` does not report success, and the pipeline does not advance to the next step on that basis.
- When a build ends with incomplete tasks, the reason names them by id and title, so an operator reading daemon output sees which tasks were skipped without opening `task-status.json`.
- A build resumed after a rewind executes the plan tasks that are `pending`, including tasks whose text changed while the feature was halted; completing an appended remediation task alone does not satisfy the step.
- A build that legitimately has nothing left to do — every task already complete — still completes cleanly, with no false stall.
