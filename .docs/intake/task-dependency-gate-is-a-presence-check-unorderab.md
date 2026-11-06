# Intake origin: task-dependency-gate-is-a-presence-check-unorderab

Source-Ref: jstoup111/ai-conductor#1393
Owner: jstoup111

## Desired outcome

- A plan whose task dependencies cannot be ordered is rejected at the gate, and the rejection names the specific task ids participating in the unorderable set.
- A task depending on an id that does not exist in the plan is rejected, and the rejection names both the citing task and the missing id.
- Declaring the dependency section is no longer sufficient on its own to satisfy the gate — the declared graph must actually resolve.
- The rejection is visible at authoring time, not first encountered inside a running BUILD step.
- Negative path: every plan whose graph does resolve continues to pass unchanged, and no currently-mergeable plan starts failing for a reason unrelated to its dependency structure.
- Negative path: a plan that declares its graph in a form the parser cannot read is not silently treated as valid, and equally is not spuriously failed — the ambiguity is surfaced rather than guessed either way.
