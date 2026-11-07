# Intake origin: refused-over-scope-rework-can-t-start-while-a-rout

Source-Ref: jstoup111/ai-conductor#3597
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3597 digest=a748cdd15b69aa0f635776d3da031dfb6e4ec02fbcbea6ae543d170f98060697 >>>
## Desired outcome

- An operator refusal recorded while a routing round is open results in the refused rework actually being built, with no `cannot admit` planner fault.
- After `halt clear` on a halt whose decisions are all already recorded, the feature progresses rather than re-halting with a request to revise the same decision.
- When round admission is refused, the halt names the blocking round, its open host and its phase, and gives a recovery action that the operator can actually carry out.
- Features with no open round keep admitting a new audit round exactly as today.
<<< END INBOUND >>>
