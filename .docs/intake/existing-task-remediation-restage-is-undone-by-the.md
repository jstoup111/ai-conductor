# Intake origin: existing-task-remediation-restage-is-undone-by-the

Source-Ref: jstoup111/ai-conductor#2196
Owner: jstoup111

## Desired outcome

- After an existing-task remediation restages a bound task, the next build dispatch treats that task as open work: the round dispatches a build instead of halting `derived-already-complete`.
- A restaged task returns to resolved/complete through new work (a new commit or fresh evidence), not through pre-restage history alone.
- The #859 false-stall fix is preserved: a fresh build whose rows were never flipped but whose tasks are all trailer-evidenced still routes forward to build_review without stalling.
- The #647 D1 no-op guard still fires when a remediation round genuinely stages nothing new.
