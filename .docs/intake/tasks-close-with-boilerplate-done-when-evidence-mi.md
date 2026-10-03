# Intake origin: tasks-close-with-boilerplate-done-when-evidence-mi

Source-Ref: jstoup111/ai-conductor#2758
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2758 digest=ec838282aeaf82a8afd0c8a5cb414e49139dbfa976f559cc19cd21350e5001a0 >>>
## Desired outcome

- A plan task whose Done-when names a test cannot be closed while that test is absent from the feature diff. The refusal names the check and the missing test.
- A Done-when closed with generic evidence that references no test is refused at close time, not discovered at prd_audit.
- Recorded close evidence is machine-checked (distinguishable from agent-reported text in task-status/evidence).
- Negative path: a Done-when check that names no test (e.g. a config or docs assertion) still closes on appropriate evidence without a spurious refusal.
- On a feature built after the change, prd_audit "no test covers criterion" FIXABLE rows drop materially relative to today's baseline.
<<< END INBOUND >>>
