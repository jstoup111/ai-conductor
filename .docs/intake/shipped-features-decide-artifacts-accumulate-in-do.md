# Intake origin: shipped-features-decide-artifacts-accumulate-in-do

Source-Ref: jstoup111/ai-conductor#2963
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2963 digest=e06abc2ec0b00d652b7bdf1697814085c42cb37c5f017a02d8c81a6022f688ac >>>
## Desired outcome

- After a feature's shipped record lands on main, its prunable artifacts (by the policy above) are eventually removed from main without anyone pruning by hand.
- Stories, ADRs, architecture docs, shipped records and intake markers are never removed by this cleanup.
- No in-flight or halted feature halts, or needs a reseal, because of a cleanup removal.
- Cleanup changes reach main through a reviewable PR, never a direct push.
- Each cleanup reports which paths it removed and which it deferred, and why (for example, still covered by a live seal).
- After cleanup, shipped-record repair still works for features whose artifacts were pruned, or reports a specific, actionable error instead of a generic failure.
<<< END INBOUND >>>
