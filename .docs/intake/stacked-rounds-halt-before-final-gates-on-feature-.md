# Intake origin: stacked-rounds-halt-before-final-gates-on-feature-

Source-Ref: jstoup111/ai-conductor#3682
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3682 digest=8f09e971bf5e3f21aad5fba969abb572f98c7e6d325e5ff184949056c3b14e01 >>>
## Desired outcome

- When every child has passed test_suite and build_review in the current round, the whole-feature gates start without a HALT.
- If test_suite really does need to run at feature level, it runs. It isn't reported as an unsatisfied prerequisite that halts.
- Re-dispatching never lands in a BUILD with nothing left to do.
- Negative path: a child that hasn't passed its test_suite still blocks the whole-feature gates.
<<< END INBOUND >>>
