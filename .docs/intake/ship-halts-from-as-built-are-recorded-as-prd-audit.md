# Intake origin: ship-halts-from-as-built-are-recorded-as-prd-audit

Source-Ref: jstoup111/ai-conductor#3287
Owner: jstoup111

## Desired outcome

- A halt raised by any member of a validation group is attributed to that member step in halt records and in `feature_dispatch_ended` events.
- Counting halts by step on the event spine gives the same totals as reading the halt text.
- When several group members fail together, each failing member can be identified from the spine.
- A halt that genuinely originates in prd_audit is still attributed to prd_audit.
