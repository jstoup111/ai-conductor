# Track: build_review testQuality rubric prompt embeds every changed test declaration's source bytes (#2582)

Track: technical

Scope boundary: Approach C without a projection-version advance. In scope: (1) stop projecting
`BuildReviewPinnedScopeEvidence.content` so test-scope evidence travels by reference — path, side,
region, start/end lines, and `contentHash` — matching the contract the diff already uses and the
`build-review-test-quality` skill already documents; (2) add a projection-size guard rail so an
oversized rubric projection fails with its own named, non-retried cause instead of three laps of
`invalid-provider-result` charged to the shared mechanical-fault allowance. Out of scope: advancing
`projectionVersion` v3→v4 (operator-confirmed 2026-09-17 — cache correctness is already carried by
the `projectionDigest` comparison and the `engineIdentity.engineStamp` cache-key member, both
verified in `build-review-cache.ts:207,213`), any change to the rubric's judgement semantics, and
any widening of the test-quality scope-selection rules.

Engine-internal defect in `build_review` input projection and rubric dispatch
(`src/conductor/src/engine/build-review-inputs.ts`, `build-review-projections.ts`,
`step-runners.ts`). No user-facing capability and no product requirements — acceptance criteria
live directly in the stories.
