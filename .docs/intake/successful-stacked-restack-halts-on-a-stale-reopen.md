# Intake origin: successful-stacked-restack-halts-on-a-stale-reopen

Source-Ref: jstoup111/ai-conductor#3469
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3469 digest=e5631111ecbbea1c200cd0082ebcadf1974673ba084c2f376f37eec24eb1d474 >>>
## Desired outcome

- After a rebase or restack that re-pends gates, the loop goes on to the re-pended gate without halting.
- A reopen whose target state already holds on disk is not treated as a conflict.
- A real concurrent conflict (disk holds a different, non-target value) still fails closed.
<<< END INBOUND >>>
