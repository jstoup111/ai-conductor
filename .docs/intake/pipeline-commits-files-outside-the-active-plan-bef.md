# Intake origin: pipeline-commits-files-outside-the-active-plan-bef

Source-Ref: jstoup111/ai-conductor#1227
Owner: jstoup111

## Desired outcome

- A BUILD task cannot be recorded complete when its commit changes files or behavior outside the active plan task without an explicit, reviewable scope disposition.
- An out-of-scope edit is rejected at the task/commit boundary with the task id and offending paths, before later tasks or SHIP run.
- Legitimate collateral edits required by the planned behavior can proceed when the plan already names them or records an explicit scope update.
- A regression test reproduces PR #1074’s config-only plan followed by finish/finalizer edits and observes deterministic rejection.
