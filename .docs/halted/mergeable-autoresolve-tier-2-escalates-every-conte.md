# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-24T00:14:30.430Z
Slug: mergeable-autoresolve-tier-2-escalates-every-conte
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-mergeable-autoresolve-tier-2-escalates-every-conte
Head SHA: ec4101a3e6b1a993ccdeb6265b1f7f2f6abe77bd
Halted at: 2026-09-24T00:11:47.630Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 3 negative: Given a rebased branch missing a feature commit the verdict did not declare, when the guard runs, then it fails naming the missing subject and the pull request is escalated at the acceptance-guards stage.
Task ids: 18
Done when checks: `runAcceptanceGuards` called with `declaredSuperseded` omitted returns results identical to the pre-change guard for an undeclared missing commit that upstream superseded, asserted by the legacy-mode test reusing the existing supersededByBase fixture. | `runAcceptanceGuards` called with `declaredSuperseded: []` returns a `featureCommitsPreserved` failure naming the subject for that same fixture, asserted by the judgement-mode empty-declarations test. | `resolveConflictingPr` passes an array to `runAcceptanceGuards` on every sweep resolution, including one whose verdict declares nothing, asserted by a spy on the guard call in the sweep integration test, while the finish-time rebase step passes no `declaredSuperseded` argument, asserted by the finish-time boundary test.
Missing assertion: No cited check requires that the pull request is escalated specifically at the acceptance-guards stage after the undeclared missing commit failure.
```
