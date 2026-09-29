# Intake origin: grade-diffs-for-event-spine-bypasses-in-build-revi

Source-Ref: jstoup111/ai-conductor#2043
Owner: jstoup111

## Desired outcome

- A diff introducing a new observation/coordination channel outside the spine (and outside the three documented exceptions) fails build_review with a finding naming the channel.
- Legitimate spine extensions (new ConductorEvent variants) pass; findings route through the adjudicator (#2033).
