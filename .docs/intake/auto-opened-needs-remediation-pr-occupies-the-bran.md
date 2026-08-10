# Intake origin: auto-opened-needs-remediation-pr-occupies-the-bran

Source-Ref: jstoup111/ai-conductor#1415
Owner: jstoup111

## Desired outcome

- A build retried after a HALT can complete its retained-PR step on a branch that already carries an auto-opened remediation PR — either by adopting that PR or by having a slot it can still use.
- The remediation placeholder never leaves a branch in a state where the only recorded PR is one the retry refuses to use.
- Whichever PR ends up carrying the implementation is not left with recovery paths disabled: a branch that has resumed successfully is eligible for CI-fix dispatch and the mergeable sweep again.
- An operator can tell from the PR itself whether it is a live implementation PR or a remediation placeholder awaiting a human, with no ambiguity between the two.
- Clearing a HALT and letting the daemon re-dispatch is sufficient to resume a build whose only remaining blocker was the placeholder — no hand-editing of PR titles, bodies, or labels.
