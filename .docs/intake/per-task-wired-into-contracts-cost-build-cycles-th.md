# Intake origin: per-task-wired-into-contracts-cost-build-cycles-th

Source-Ref: jstoup111/ai-conductor#1496
Owner: jstoup111

## Desired outcome

- A plan can be authored and landed without declaring per-task wiring contracts, and no
- BUILD still fails when the feature diff adds an exported symbol that nothing outside its
- A wiring failure at BUILD names the unreachable symbol and what was searched; it never
- Code that is intentionally shipped unwired (scaffolding a later feature consumes) has one
- The SHIP as-built reachability sweep continues to block on an unreachable rung, unchanged.
