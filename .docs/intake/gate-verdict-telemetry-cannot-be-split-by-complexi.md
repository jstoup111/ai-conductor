# Intake origin: gate-verdict-telemetry-cannot-be-split-by-complexi

Source-Ref: jstoup111/ai-conductor#2790
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2790 digest=8b4a4c9e0ea33542edc9b19c465c983f9feb037f8fb86c3d67ddac034a8f2c73 >>>
## Desired outcome

- For each gating step, pass and reject counts can be read from exported telemetry split by complexity tier (S/M/L), with no log parsing.
- A gate result caused by infrastructure failure (grader never ran, session failed to start, rate limit) is distinguishable in that telemetry from a substantive rejection of the work.
- Existing gate-verdict dashboards and queries that ignore tier keep producing the same totals.
<<< END INBOUND >>>
