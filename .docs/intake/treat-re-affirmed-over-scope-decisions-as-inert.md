# Intake origin: treat-re-affirmed-over-scope-decisions-as-inert

Source-Ref: jstoup111/ai-conductor#2681
Owner: jstoup111

## Desired outcome
- Re-affirming a prior over-scope decision (same authority) does not halt the feature; the prior decision stays in force.
- An operator decision the engine cannot apply is reported as an invalid or unchanged decision, naming the entry — not as a persistence or lease failure.
- The over-scope HALT tells the operator how to keep a prior decision unchanged.
