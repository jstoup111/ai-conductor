# Intake origin: coherence-rows-assert-story-task-coverage-that-not

Source-Ref: jstoup111/ai-conductor#1799
Owner: jstoup111

## Desired outcome

- A coherence row claiming a story criterion is covered by a named task is accepted only when that task actually carries it; a row whose claim the plan text does not support is rejected at DECIDE, naming the criterion and the task it was attributed to.
- Every accepted story criterion is owned by at least one task before the plan is approved, and an unowned criterion is reported at DECIDE rather than at `acceptance_specs`.
- A completion criterion that can be invalidated by state outside the feature's own diff — a count or census of a corpus that keeps growing — is rejected when the plan is authored.
- A plan whose criteria are all owned and all diff-local still passes with no new ceremony, and a legitimately deferred criterion can still be recorded as a deliberate disposition rather than silently dropped.
- When a later step does find an unowned criterion, its halt names the plan-time check that should have caught it.
