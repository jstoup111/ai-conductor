# Intake origin: rebase-reopens-completed-repair-tasks-against-stal

Source-Ref: jstoup111/ai-conductor#2462
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2462 digest=64d0daec5b1ca1e4764effc33f6d8ec2f9f85e61b0470b3fd6868f832b6dfa0f >>>
## Desired outcome

- After a supported rebase rewrites, drops, or absorbs a repair-boundary commit without losing the completed repair work, completed repair tasks remain complete and the daemon does not reopen them solely because the old SHA is absent from the new history.
- Post-repair task evidence remains bounded to commits after the equivalent rebased repair boundary.
- A missing, invalid, unmapped, or unreachable boundary still fails closed and cannot admit historical evidence from before the repair.
- Repeatedly resuming either reproduced feature after a successful rebase does not emit the same `repair boundary ... is not an ancestor of HEAD` retry.
<<< END INBOUND >>>
