# Intake origin: rebase-invalidated-test-suite-proof-halts-build-re

Source-Ref: jstoup111/ai-conductor#1729
Owner: jstoup111

## Desired outcome

- A rebase that invalidates the aggregate suite proof results in the suite being re-run before `build_review` is dispatched — the run continues without operator action.
- `build_review` is never dispatched while its own prerequisite gate is unsatisfied.
- If a proof is stale for a reason the loop genuinely cannot resolve, the run stops with a message naming the step that must re-run — not three identical retries of a step that cannot fix it.
- A retry budget is not spent on a failure whose inputs cannot change between attempts.
- An operator can return a feature to a named earlier step through a supported command, without hand-editing `.pipeline/conduct-state.json` or gate files.
- A run whose suite proof is current after a rebase still proceeds straight to `build_review` (no gratuitous re-run).
