# Intake origin: stacked-repair-restack-conflict-above-the-repaired

Source-Ref: jstoup111/ai-conductor#3421
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3421 digest=c810e5e3733f4470f7e35d472a3e3818ae03620bd17069869c505c9d15b4071e >>>
## Desired outcome

- When a feature-repair restack halts on a conflict in a child above the repaired child, an operator can resolve that conflict on the named child's branch, clear the halt, and have the next dispatch accept the resolution (the restack applies and does not replay the resolved commits again).
- After an operator-resolved restack applies, the same post-restack guarantees as an engine-resolved one hold: the routed round completes, and the resolved child and every child above it are re-validated before the leaf gates re-run.
- An operator resolution that does not actually contain the repaired child's new tip, or that drops commits from the child's original range, is refused with a HALT naming what is missing. It is never silently adopted.
- The halt text and runbook describe a recovery procedure that, followed literally, gets the feature moving again.
- An aborted restack never discards an operator's hand resolution from the child branch without saying where it went.
- Stacked features whose repair restacks resolve automatically behave exactly as today.
<<< END INBOUND >>>
