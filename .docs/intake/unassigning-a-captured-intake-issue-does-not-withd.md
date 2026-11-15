# Intake origin: unassigning-a-captured-intake-issue-does-not-withd

Source-Ref: jstoup111/ai-conductor#3540
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3540 digest=3912c7e1d3126f716b76127e505325a69c63b7a723306d349236505698085046 >>>
## Desired outcome

- `compose claim` never returns a GitHub issue that is not currently assigned to the machine owner. That includes stale-claim recovery and requeued entries.
- An issue skipped because it is unassigned is not deleted from tracking for good. If the operator reassigns it to themselves, a later claim returns it again with no manual ledger edit.
- An issue that is still assigned to the machine owner is claimed exactly as it is today.
- When claim skips an issue for being unassigned, the operator can see which issue was skipped and why.
- If the assignee lookup fails (gh error or network), claim doesn't drop the issue silently. The outcome is reported, matching how requeue already treats an unknown liveness state.
<<< END INBOUND >>>
