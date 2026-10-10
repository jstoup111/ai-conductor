# Intake origin: unretryable-input-routing-never-fires-outside-thre

Source-Ref: jstoup111/ai-conductor#2418
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2418 digest=85ae0e78517ce56fef1db822a399c0cd4adedde59764be16bfe3649e19b28fa2 >>>
## Desired outcome

- A step outside the three verdict steps whose runner declares its inputs unretryable routes on its first attempt rather than spending its retry budget.
- `build` continues to spend its own retry and progress accounting, unrouted.
- The completion-gate-miss seam's scope is unchanged: it still applies to exactly the three verdict steps.
- `retry_routing.enabled: false` still restores unconditional retry everywhere, unchanged.
- The seam's step scope is recorded in exactly one authoritative place, so a reader cannot find a scope in the code that the approved decision does not state.
<<< END INBOUND >>>
