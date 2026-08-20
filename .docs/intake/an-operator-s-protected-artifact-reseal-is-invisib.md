# Intake origin: an-operator-s-protected-artifact-reseal-is-invisib

Source-Ref: jstoup111/ai-conductor#1502
Owner: jstoup111

## Desired outcome

- After an operator reseals a protected artifact, a subsequent `build_review` on an unchanged diff does not fail Scope on the resealed paths' hunks.
- The grader treats a reseal as evidence, not a blanket exemption, consistent with how the prompt already frames its other two operator/engine channels ("engine-recorded gate instructions", "engine-accepted scope widenings" — `build-review-prompt.ts:103-119`): unmatched work outside the resealed paths still fails Scope.
- The reseal's operator rationale is visible to the grader, so a reseal whose stated reason does not justify the amendment can still be failed.
- A reseal of paths A and B does not license an unrelated post-BUILD edit to path C.
- Re-running the affected feature reaches BUILD and attempts its remediation tasks, rather than halting a fourth time on the same finding.
- Regression coverage: a feature whose diff amends a resealed DECIDE artifact passes Scope, and the same diff without the reseal still fails it.
