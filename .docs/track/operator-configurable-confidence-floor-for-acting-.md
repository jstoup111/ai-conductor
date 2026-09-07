# Track: Operator-configurable confidence floor for acting on build_review findings

Track: technical

Scope boundary: Revised by the operator on 2026-09-06 from the placement filed in
jstoup111/ai-conductor#2383. Confidence is reported by the build_review rubric graders per finding
(optional integer 0-100), not by the remediate adjudicator, and the operator floor is applied at the
effective-verdict reducer — before build_review fails and before remediate is dispatched. Plus a
mechanical settled-recurrence fast-path so a finding already bound to a finalized deferred, rejected,
or merged case does not re-dispatch remediate on exact-id recurrence. Both are delivered with an
operator-visible record of every suppression and every skipped dispatch. Excluded: any change to the
adjudicator's existing `confidence` enum, per-priority floors, and rubric run-scheduling (#2388).

Why the placement moved: with confidence on the adjudicator's case record, the floor could only
decide what to do with a finding build_review had already failed on. The rubric would re-emit it,
build_review would raw-FAIL, and remediate would re-dispatch on every lap — saving the BUILD lap but
paying a provider session per lap for a finding the floor was about to drop. Verified: the
coordinator's only pre-dispatch skip is operator authority
(`src/conductor/src/engine/build-review-adjudication-coordinator.ts`, `allOperatorResolved`); prior
cases are passed into the judge as context, never used to skip it. Placing confidence on the finding
lets the engine filter a hunch before anything downstream spends on it.

Chosen approach: grader-supplied confidence, engine-applied floor. The floor is bookkeeping on the
grader's judgement — the engine never derives the number — applied as a third bucket beside
operator-accepted and unresolved in `deriveEffectiveBuildReviewVerdict`, so suppression never
becomes operator authority. Confidence is optional in the finding schema and absent means blocking,
which keeps the change fail-safe (a grader that omits it can only cost, never drop) and avoids a
contract-version bump that would invalidate every stored operator disposition. Editing the skill
text invalidates the rubric cache on its own via the existing skill-digest check.

Design constraints carried into stories:
- Confidence never enters the finding identity hash, so a re-graded finding at a different
  confidence keeps its id and its operator dispositions.
- A lap whose every finding is suppressed is an effective PASS and never enters adjudication; a
  mixed lap sends only the surviving findings to the judge.
- The fast-path is exact-id only. A drifted finding id still dispatches the judge, because
  equivalence under drift is the judgement the adjudicator exists for.

Technical track: no user-facing product capability. The change is a grader contract field, an
operator config key, a reducer bucket, and a dispatch predicate; acceptance criteria live in stories.
