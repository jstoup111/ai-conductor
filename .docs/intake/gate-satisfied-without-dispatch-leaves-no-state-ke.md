# Intake origin: gate-satisfied-without-dispatch-leaves-no-state-ke

Source-Ref: jstoup111/ai-conductor#1587
Owner: jstoup111

## Desired outcome

- A gate the loop deems satisfied leaves the same durable status a dispatched-and-completed step leaves; "satisfied silently" is not representable.
- FINISH's implementation-evidence predicate and the loop's gate-completion predicate cannot disagree about the same step: one source of truth, or the stricter one is used by both.
- A finish→build kickback whose remedy changes nothing observable twice in a row is detected as non-converging and halts with the specific unsatisfied predicate named, instead of cycling.
- Negative path: genuinely missing or stale review evidence still blocks FINISH.
