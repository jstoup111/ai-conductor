# Intake origin: trace-root-span-records-no-run-outcome-a-halted-ru

Source-Ref: jstoup111/ai-conductor#1978
Owner: jstoup111

## Desired outcome

- A step span closes when its step completes, in-progress steps excepted (holds today — pin it so
  it cannot regress).
- The feature/root span closes when the run reaches a terminal state — completed, halted, or
  terminated — on every path that reaches one.
- The trace records which terminal state the run reached, readable without opening child spans, so
  a halted run is distinguishable from a completed one in a trace listing.
- An in-progress dispatch remains distinguishable from both terminal states.
