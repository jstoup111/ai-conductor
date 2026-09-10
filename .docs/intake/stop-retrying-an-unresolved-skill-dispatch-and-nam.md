# Intake origin: stop-retrying-an-unresolved-skill-dispatch-and-nam

Source-Ref: jstoup111/ai-conductor#1631
Owner: jstoup111

## Desired outcome
- Before dispatching a step, the engine verifies the step's required skill exists in the worktree; a missing skill never reaches the provider.
- The resulting condition names the cause and remedy (stale base → rebase) rather than a generic dispatch failure — e.g. routed into the existing proactive-rebase machinery or parked with a rebase-needed reason.
- A skill genuinely missing from the repository (not staleness) still fails loudly.
