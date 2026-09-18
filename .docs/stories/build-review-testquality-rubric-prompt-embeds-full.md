**Status:** Accepted

# build_review testQuality evidence travels by reference with a projection-size guard (#2582)

## Context

`build_review`'s testQuality rubric projection inlines the full source bytes of every changed test declaration region (`BuildReviewPinnedScopeEvidence.content`). On a 155-file diff that field alone reached ~1.3 MB, the provider returned an unusable result on every lap, each lap was charged to the shared three-fault mechanical allowance, and the feature halted `needs-human` with no actionable diagnostic. Evidence identity (`contentHash`, region, lines) is all the engine ever reads; the bytes exist only as prompt payload. Governing decisions: adr-2026-08-13 D2.1, adr-2026-08-18 D2.1/D3.1/D10.1, adr-2026-09-06 D6.1. Technical track, Medium tier; scope boundary in `.docs/track/build-review-testquality-rubric-prompt-embeds-full.md` (no projection-version advance).

## Story 1: Test-scope evidence records carry identity, not bytes

As the build_review coordinator, I want each pinned test-scope evidence record to carry only the region's identity so that the rubric projection stays bounded by the number of evidence regions, not by their source size.

### Acceptance Criteria

#### Happy Path
- Given a frozen snapshot whose changed test file has one bound changed declaration spanning characters 120-480, when scope assembly pins its evidence, then the record carries `source.fileName`, `source.side`, `region.start` 120, `region.end` 480, `startLine`, `endLine`, and a `contentHash` of `sha256:` over exactly those 360 characters, and has no `content` property.
- Given the same snapshot, when the testQuality projection is derived, then `testScope.evidence` serializes each record without a `content` key and the serialized projection for a 98-test-file diff is bounded by the count of deduplicated regions rather than their bytes.
- Given a base-side region for a modified declaration, when evidence is pinned, then `contentHash` is computed over the region read at `mergeBase`, identical to the hash the previous implementation produced for the same bytes.

#### Negative Paths
- Given a region whose base-side file is absent at `mergeBase` (an added helper), when evidence is pinned, then no record is fabricated for the base side and the head-side record still carries its full identity, unchanged from today.
- Given two files with declarations at identical character offsets, when evidence is pinned, then each record's `id` and `source.fileName` keep them distinct and no record is merged or dropped by the removal of `content`.
- Given a fixture that constructs an evidence record with a `content` property, when it is passed to projection derivation, then the type no longer admits the property and the compile fails, so no producer can silently reintroduce inlined bytes.

### Done When
- [ ] `BuildReviewPinnedScopeEvidence` in `src/conductor/src/engine/build-review-inputs.ts` has no `content` member and `pinScopeEvidence` hashes the region and discards the bytes.
- [ ] A unit test asserts a pinned record's exact key set is `id, source, region, startLine, endLine, contentHash`.
- [ ] A unit test asserts `contentHash` for a fixed region equals the pre-change value recorded in the test.
- [ ] The existing assertions on `content` in `build-review-inputs.test.ts` and `build-review-projections.test.ts` are replaced by `contentHash`-based assertions.

## Story 2: Evidence identity, candidate matching, and cache invalidation are unchanged at projection v3

As the build_review coordinator, I want the by-reference projection to keep every identity semantic the engine relies on so that candidate resolution, finding anchors, and cached judgements behave exactly as before while old cache entries miss closed without a projection-version advance.

### Acceptance Criteria

#### Happy Path
- Given a projection with one fallback candidate whose source region matches a pinned evidence record, when `buildReviewCandidateScopeResolutionContext` runs, then the candidate's `sourceRegion` carries the record's `path`, `startLine`, `endLine`, and `contentHash` exactly as it did with inlined bytes.
- Given a judged result whose finding anchor cites a content-region `{path, contentHash, display, occurrence}` from the projection, when the result is validated, then the anchor resolves identically to the pre-change behavior and `occurrence` is derived from the analyzer's declaration ordinal, never from evidence bytes.
- Given a cache entry written by the previous engine for the same snapshot, when the new engine looks it up, then the lookup misses (on `projection-digest-mismatch` or `engine-version-mismatch`) and `projectionVersion` remains `v3` on both the lookup and the new entry.
- Given two snapshots that differ only in one evidence region's bytes, when projections are derived, then their `projectionDigest` values differ because `contentHash` differs.

#### Negative Paths
- Given a projection whose evidence record omits `contentHash`, when a candidate is matched against it, then the candidate context is not produced for that record and validation rejects a result that cites it, exactly as today for an evidence record with a malformed identity.
- Given a candidate that cites a region from a file the projection does not list, when the result is validated, then it is rejected as an out-of-scope anchor, unchanged from today.
- Given a cache entry declaring `projectionVersion: "v4"`, when it is parsed, then it is rejected as an invalid entry, proving the accepted version set is unchanged.

### Done When
- [ ] A test asserts `buildReviewCandidateScopeResolutionContext` output for a fixed projection is byte-identical before and after removing `content`.
- [ ] A test asserts the projection digest changes when only a region's `contentHash` changes.
- [ ] A test asserts a pre-change cache entry for the same snapshot misses on the new engine with `projectionVersion` still `v3`.
- [ ] `parseBuildReviewCacheEntry` accepted version set is unchanged.

## Story 3: The rubric session re-reads cited regions and verifies them against the supplied hash

As the testQuality rubric session, I want the projection to tell me where each evidence region lives and what its hash is so that I read the bytes myself through the same pinned `git` seam I already use for the diff and judge only content that matches the projection.

### Acceptance Criteria

#### Happy Path
- Given an admitted projection, when the rubric prompt is rendered, then it states that `testScope.evidence` records are references to be read at the pinned refs with `git show «mergeBase»:«path»` for `side: base` and `git show «headSha»:«path»` for `side: head` using `startLine`/`endLine`, never from the mutable working tree, and that the read region must hash to the supplied `contentHash`.
- Given `skills/build-review-test-quality/SKILL.md`, when it is loaded, then its input-projection section names evidence records as identity-only references and names the hash the session verifies against.
- Given the skill text changes, when the next lap looks up the cache, then the `skillDigest` component of the engine identity differs and the lookup misses.

#### Negative Paths
- Given a region whose bytes at HEAD do not hash to the supplied `contentHash`, when the session prepares to judge it, then the skill instructs it to report the mismatch as an infrastructure-shaped concern and not to judge the region, never to substitute its own read as authoritative.
- Given the session cannot read a cited path at the pinned ref, when it judges, then it records the region as unreadable evidence rather than inventing an assertion for it.
- Given the rubric prompt, when it is rendered for any provider, then it names `git` and the projection fields only and contains no provider-specific path, environment variable, or model name.

### Done When
- [ ] `skills/build-review-test-quality/SKILL.md` input-projection section describes evidence records as identity-only references with the re-read seam and the hash check.
- [ ] The rubric prompt in `dispatchBuildReviewRubric` names the evidence re-read seam alongside the existing diff re-read instruction.
- [ ] `test/test_provider_skill_contracts.sh` passes on the changed skill text.

## Story 4: An oversized projection is refused before dispatch with a named cause

As the build_review coordinator, I want to measure each rubric projection against a configurable byte bound so that a projection the provider cannot judge is refused with a named cause before any provider is launched.

### Acceptance Criteria

#### Happy Path
- Given `build_review.rubrics.testQuality.max_projection_bytes` is unset, when the coordinator derives a projection, then the shipped default bound applies and a projection under it is dispatched unchanged.
- Given a bound of 1,048,576 bytes and a serialized projection of 1,346,093 bytes, when the coordinator reaches the projection check, then the branch settles as an infrastructure failure with reason `projection-oversized`, `detail` naming `measured=1346093` and `limit=1048576`, and no provider dispatch is attempted.
- Given a serialized projection exactly at the bound, when the check runs, then the projection is admitted (the bound is inclusive).
- Given a valid config, when `max_projection_bytes` is loaded, then it is a positive integer byte count on `BuildReviewRubricConfig` with no provider- or model-specific alternative.

#### Negative Paths
- Given `max_projection_bytes: 0` or a negative or non-integer value, when config is loaded, then loading fails with a message naming the key and the accepted range, and no lap runs with an unbounded projection.
- Given a projection that is oversized, when the coordinator settles the branch, then `dispatchModel` is not called, proven by a counting fake dispatcher.
- Given the guard measures the projection, when it computes size, then it measures UTF-8 bytes of the canonical serialization, so a projection with multi-byte characters is not admitted on a character count that understates its bytes.

### Done When
- [ ] `BuildReviewRubricConfig` carries `max_projection_bytes` with a shipped default and loader validation.
- [ ] `BuildReviewCoordinatorFailureReason` includes `projection-oversized` and `mapBuildReviewCoordinatorFailureReason` maps it to the same-named `BuildReviewInfrastructureFailureReason` member; the compile fails if either side is omitted.
- [ ] A coordinator test proves a fake dispatcher is never invoked for an oversized projection and that `detail` carries the measured and permitted bytes.
- [ ] The default bound is recorded with the serialized size measured from a recent green testQuality lap.

## Story 5: A deterministic oversize is charged once and routed to a human, never retried

As the build_review step, I want a `projection-oversized` failure to publish its aggregate once and halt for a human so that the same frozen inputs are never re-dispatched to burn the shared mechanical-fault allowance.

### Acceptance Criteria

#### Happy Path
- Given a lap whose testQuality branch settled `projection-oversized`, when the step joins results, then it writes the aggregate carrying that infrastructure result, does not increment the mechanical-fault counter, and returns a `needs-human` halt whose text names the rubric, the measured bytes, and the bound.
- Given that halt, when the operator records a reduced-coverage decision through the existing attributed mechanism, then the effective verdict renders the reduced-coverage evidence on the aggregate as it does for any other mechanical cause.
- Given a lap with a transient infrastructure failure such as `provider-error`, when the step joins results, then it increments the mechanical-fault counter and re-runs while allowance remains, unchanged from today.

#### Negative Paths
- Given a `projection-oversized` lap, when the conductor evaluates whether to re-dispatch build_review, then no second lap is dispatched for the same snapshot, proven by a lap counter that stays at one.
- Given a `projection-oversized` lap, when the kickback ledger is read afterward, then its mechanical-fault count equals its value before the lap.
- Given a mixed lap in which one rubric returned a judged finding and another settled `projection-oversized`, when the step joins results, then the judged finding is preserved on the aggregate and the lap still halts `needs-human` rather than routing the finding as ordinary semantic rework.
- Given a `projection-oversized` result whose `detail` is missing the measured or permitted bytes, when the aggregate is parsed, then the result is still a valid infrastructure result and the halt text falls back to naming the reason without numbers, so a malformed detail never turns a deterministic halt into a retry.

### Done When
- [ ] `runBuildReview` in `step-runners.ts` routes `projection-oversized` past `bumpMechanicalFaultsInLedger` and publishes the aggregate once.
- [ ] A test proves the mechanical-fault counter is unchanged and no second dispatch occurs on a `projection-oversized` lap.
- [ ] A test proves `provider-error` still increments the counter and re-runs while allowance remains.
- [ ] The `needs-human` halt text contains the rubric id, measured bytes, and bound.

## Story 6: The oversize is observable on the existing event spine

As an operator reading `.pipeline/events.jsonl` or the daemon UI, I want an oversized projection to appear as an occurrence on the existing infrastructure-failure event so that every spine consumer sees it without a new channel.

### Acceptance Criteria

#### Happy Path
- Given a `projection-oversized` branch, when the coordinator settles it, then a `build_review_rubric_infrastructure_failure` event is emitted with `reason: "projection-oversized"` and additive fields `measuredBytes` and `limitBytes`.
- Given an admitted dispatch, when the rubric prompt is rendered, then `build_review_rubric_prompt` is emitted with `promptBytes` exactly as today.
- Given the event sink registry, when the event union changes, then the exhaustiveness check accepts the additive optional fields without a new event type.

#### Negative Paths
- Given a `projection-oversized` branch, when events are inspected, then no new event type, sidecar file, or ledger was written for it.
- Given an existing consumer that reads `build_review_rubric_infrastructure_failure` without knowing the new fields, when it parses the event, then it still parses, because the fields are optional.
- Given an admitted dispatch, when events are inspected, then no `build_review_rubric_infrastructure_failure` event carries `measuredBytes`, so the fields are present only on an oversize.

### Done When
- [ ] `build_review_rubric_infrastructure_failure` in `src/conductor/src/types/events.ts` gains optional `measuredBytes` and `limitBytes`.
- [ ] A test asserts the event is emitted with both fields on an oversized lap and without them otherwise.
- [ ] The event-sink exhaustiveness test passes with no new event type.
