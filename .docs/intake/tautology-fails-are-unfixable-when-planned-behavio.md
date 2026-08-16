# Intake origin: tautology-fails-are-unfixable-when-planned-behavio

Source-Ref: jstoup111/ai-conductor#1579
Owner: jstoup111

## Desired outcome

- A build lap whose changed tests document already-existing behavior that a plan task requested can converge to PASS without the maker inventing unrelated behavioral assertions and without operator intervention.
- A genuinely tautological test — one asserting a test-local helper, or passing pre-diff for reasons unconnected to any engine-recorded evidence — still FAILs Tautology (negative path).
- The same no-gap Tautology finding does not recur verbatim across consecutive review laps: the maker's first post-finding lap has a sanctioned, gate-accepted way to resolve it.
- The exemption decision is auditable per test from engine-recorded evidence, not from grader free judgement.
