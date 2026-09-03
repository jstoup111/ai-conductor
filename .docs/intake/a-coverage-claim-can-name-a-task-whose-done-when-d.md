# Intake origin: a-coverage-claim-can-name-a-task-whose-done-when-d

Source-Ref: jstoup111/ai-conductor#2088
Owner: jstoup111

## Desired outcome

- A coverage claim binding a criterion to a task is rejected before BUILD when that task's
  `Done when` does not assert the criterion.
- The rejection names the criterion, the task it was bound to, and what that task's `Done when`
  actually requires, so the author can either fix the binding or add the missing task.
- A binding that genuinely holds still passes untouched — the check must not force a task per
  criterion, since one task legitimately covers several.
- The same guarantee applies whether the claim lives in a coherence artifact or in a plan's own
  coverage table; today only one of those two surfaces exists on any given spec.
- A criterion whose covering task is added later still reads as covered without a manual edit going
  stale, or the staleness is itself caught.
