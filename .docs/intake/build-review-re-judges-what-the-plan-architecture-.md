# Intake origin: build-review-re-judges-what-the-plan-architecture-

Source-Ref: jstoup111/ai-conductor#1805
Owner: jstoup111

## Desired outcome

- A feature whose implementation matches its approved plan reaches SHIP without an operator resolving a disagreement between two gates.
- No gate can direct BUILD to implement a mechanism the approved plan does not authorize; where the plan is judged insufficient, that is reported as a plan/design gap and routed to the phase that owns the design, or filed, and never as work BUILD must perform off-plan.
- The same question is not asked twice by two gates against two artifacts — a delivered-outcomes check has exactly one owner, and so does a mechanism-soundness check.
- Correctness defects found only after the code exists (the `a-gate-halt` lap-2 class above) are still caught, by whichever gate retains that authority.
- The number of plan tasks a feature accumulates is bounded by its authored plan plus explicitly accepted additions, not by how many review laps it survives.
