# Intake origin: mergeable-autoresolve-tier-2-escalates-every-conte

Source-Ref: jstoup111/ai-conductor#2607
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2607 digest=f70a457a9e53324aa6eab588943fb5d2d384419dd111349f7ab12dd907ba9980 >>>
## Desired outcome

- A conflict where the resolver can state both sides' intent and a verifiable choice exists (the affected tests pass with it) is resolved and published without operator involvement; the PR returns to mergeable on its own.
- A conflict confined to test code, where both sides change the same lines for the same purpose, does not escalate.
- The resolution it chose, and why, is recorded on the PR so the operator can audit after the fact instead of deciding up front.
- Negative path: a conflict whose candidate resolutions all fail verification, or that spans production behavior both sides changed incompatibly, still escalates with today's diagnostic detail.
- Negative path: a resolution is never published unless the verification it ran is named and passed.
- An escalated PR that an operator or a later main makes conflict-free becomes eligible again without a human removing the label.
<<< END INBOUND >>>
