# Implementation Plan: build_review testQuality evidence travels by reference with a projection-size guard (#2582)

**Date:** 2026-09-18
**Design:** .docs/architecture/build-review-testquality-rubric-prompt-embeds-full.md
**Architecture review:** .docs/decisions/architecture-review-2026-09-18-build-review-testquality-rubric-prompt-embeds-full.md
**Stories:** .docs/stories/build-review-testquality-rubric-prompt-embeds-full.md
**Conflict check:** Clean as of 2026-09-18

## Summary

Stop projecting the bytes of every pinned test-scope evidence region (the only unbounded term in the testQuality projection), instruct the rubric session to re-read regions at the pinned refs and verify them against `contentHash`, and add a projection-size guard whose deterministic `projection-oversized` cause is charged once and halts for a human instead of burning the shared mechanical-fault allowance. Eleven tasks across the build_review input, projection, coordinator, domain, step-runner, config, event, and skill surfaces.

## Technical Approach

- **Record shape (Tasks 1-2).** `BuildReviewPinnedScopeEvidence` loses `content`; `pinScopeEvidence` hashes the sliced region and discards the bytes. Nothing else in the engine reads the bytes (verified: coordinator, aggregate, cache, domain, scope-identity have no reference), so the projection pass-through simply carries the smaller record. `contentHash` is computed over the same bytes as before, which is what keeps candidate matching, anchors, occurrence, and the digest semantics intact (Task 3). The projection stays at `v3`: cache lookups already miss on `projectionDigest` and `engineIdentity.engineStamp` (Task 4). Search hints: `pinScopeEvidence`, `testScopeEvidence`, `buildReviewCandidateScopeResolutionContext`, `resolveBuildReviewCacheLookup`.
- **Grader contract (Tasks 5-6).** The prompt built in `dispatchBuildReviewRubric` already describes the diff by reference and tells the session to use `git show`/`git diff` at `mergeBase`/`headSha`; one more paragraph extends that to evidence regions by side, with the hash check. The skill text says the same in its input-projection section. Provider-agnostic by construction: bytes and `git`, no provider or model names. The skill digest is already a cache-key component, so the text change invalidates cached judgements on its own.
- **Guard (Tasks 7-8).** `BuildReviewRubricConfig.max_projection_bytes` (validated positive integer, shipped default measured against the 724-fixture projection) is read by the coordinator at the seam that already checks `projection-rubric-mismatch`, before any provider dispatch. The bound is inclusive and measured as UTF-8 bytes of the canonical serialization. `projection-oversized` is added to both closed reason unions and the `satisfies`-checked total mapping in `build-review-domain.ts` (adr-2026-08-18 D2.1). Pattern to follow: the existing `infrastructure(branch.rubric, reason, detail)` helper and the `projection-rubric-mismatch` branch; allowed variation: where the byte measurement helper lives.
- **Deterministic lane (Tasks 9-10).** In `runBuildReview`'s `infrastructureFailure` branch, `projection-oversized` bypasses `bumpMechanicalFaultsInLedger`, publishes the aggregate once, and returns the existing `needs-human` halt shape naming rubric, measured bytes, and bound (adr-2026-08-18 D3.1/D5). Every other reason keeps today's bump-and-re-run path; Task 10 proves both directions through the step entry point, which is the integration-owning proof for this change.
- **Spine (Task 11).** The occurrence rides `build_review_rubric_infrastructure_failure` with additive optional `measuredBytes`/`limitBytes`; `build_review_rubric_prompt` keeps `promptBytes` for admitted dispatches. No new event type, ledger, or sidecar (adr-2026-08-18 D10.1).
- **Sequencing.** Tasks 1 and 7 and 6 are independent roots; 2-5 hang off 1; 8 off 7; 9 off 8; 10 off 9; 11 off 8. BUILD can fan out 1, 6, 7 concurrently.

## Prerequisites

- Companion PR #2584 narrows two pre-existing story criteria to retriable faults; it is a corpus consistency fix and does not block BUILD of this plan.

## Tasks

### Task 1: Pinned test-scope evidence carries identity and hash, never bytes
**Story:** Story 1 — a pinned record carries source, region, lines and a sha256 contentHash over the region and has no content property; absent base sides and same-offset files behave as today.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-inputs.test.ts`: (a) a pinned record's own keys are exactly `id, source, region, startLine, endLine, contentHash`; (b) `contentHash` for a fixed 360-character region equals the literal `sha256:` value the current implementation produces (record it in the test before changing production); (c) an added helper with no base-side blob yields no base record and an intact head record; (d) two files with declarations at identical offsets yield two records with distinct `id`/`source.fileName`; (e) a `// @ts-expect-error` fixture literal carrying `content` fails to compile.
2. Verify RED: (a) and (e) fail because `content` is present.
3. Implement: remove `content` from `BuildReviewPinnedScopeEvidence` in `src/conductor/src/engine/build-review-inputs.ts`; in `pinScopeEvidence` compute the hash from the sliced region and return the record without the bytes. Replace the existing `entry.content.includes(...)` and `content: expect.stringContaining(...)` assertions in the same test file with `contentHash` assertions computed from the fixture text.
4. Verify GREEN, then commit: "build_review: pin test-scope evidence by identity and hash, not bytes".

**Done when:**
- `BuildReviewPinnedScopeEvidence` in build-review-inputs.ts declares no `content` member and a `@ts-expect-error` literal with `content` is rejected by the type checker in the inputs test
- `pinScopeEvidence` returns records whose own keys are exactly `id, source, region, startLine, endLine, contentHash`, as asserted by the key-set test
- `contentHash` for the fixed-region fixture equals the pre-change literal recorded in the test, proving the hash is computed over the same bytes as before
- an added helper with no base blob yields no base-side record while its head record keeps its full identity, and two same-offset files yield two distinct records, as asserted by the absent-base and same-offset tests

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts`
- `src/conductor/test/engine/build-review-inputs.test.ts`

**Dependencies:** none

### Task 2: The testQuality projection serializes evidence without a content key
**Story:** Story 1 — the sealed projection's testScope.evidence has no content key and its serialized size is bounded by region count.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-projections.test.ts`: (a) `JSON.stringify(projection.testScope.evidence)` contains no `"content"` key; (b) a fixture with 98 evidence regions of 12 KB each serializes the whole projection under 64 KB. Replace the existing `content: helperContent` fixture and the `toMatchObject([{ id, content }])` assertion with `contentHash`-based equivalents.
2. Verify RED: (a) fails on the current pass-through projection.
3. Implement: no production change is expected in `src/conductor/src/engine/build-review-projections.ts` beyond type alignment; the pass-through now carries the Task 1 record. Keep the `scopedSource({ helperContent })` digest-sensitivity test by asserting the digest differs when the fixture's region bytes (and hence `contentHash`) differ.
4. Verify GREEN, then commit: "build_review: project evidence references only".

**Done when:**
- `deriveBuildReviewRubricProjections` output has no `content` key anywhere under `testScope.evidence`, as asserted by the serialized-key test
- a 98-region fixture at 12 KB per region serializes the full testQuality projection under 64 KB, as asserted by the bounded-size test
- the digest-sensitivity test still passes by varying the fixture's region bytes so `contentHash` differs

**Files likely touched:**
- `src/conductor/src/engine/build-review-projections.ts`
- `src/conductor/test/engine/build-review-projections.test.ts`

**Dependencies:** Task 1

### Task 3: Candidate matching, anchors, occurrence and digest are unchanged under the by-reference record
**Story:** Story 2 — candidate context and anchor validation are byte-identical to the pre-change output; occurrence derives from the declaration ordinal; the digest changes when contentHash changes.
**Type:** happy-path

**Steps:**
1. Write tests in `src/conductor/test/engine/build-review-coordinator.test.ts`: (a) `buildReviewCandidateScopeResolutionContext` over a fixed projection deep-equals a golden object captured from the current engine before Task 1 lands (store the golden inline); (b) a judged result citing a content-region anchor with `occurrence: 1` validates and the anchor's `occurrence` equals the analyzer ordinal on the target; (c) an evidence record without `contentHash` produces no candidate and a result citing it is rejected; (d) a result citing a path the projection does not list is rejected as out-of-scope; (e) two projections differing only in one region's `contentHash` have different `projectionDigest`.
2. Verify: all five pass on the current engine except that the golden must be captured first; then re-run after Task 1 to prove identity is unchanged.
3. No production change. Commit with an `Evidence: satisfied-by <sha>` trailer if no code changes, otherwise commit the tests: "build_review: prove candidate identity is independent of evidence bytes".

**Done when:**
- `buildReviewCandidateScopeResolutionContext` for the fixed projection deep-equals the pre-change golden object, as asserted by the golden-context test
- `validateBuildReviewDispatchedResult` accepts the ordinal-anchored finding and rejects both the hash-less-evidence citation and the unlisted-path citation, as asserted by the three anchor tests
- `projectionDigest` differs between two projections that differ only in one region's `contentHash`, as asserted by the digest test

**Files likely touched:**
- `src/conductor/test/engine/build-review-coordinator.test.ts`
- `src/conductor/test/engine/build-review-projections.test.ts`

**Verify-only:** yes

**Dependencies:** Task 1

### Task 4: Old cache entries miss closed with projectionVersion still v3
**Story:** Story 2 — a pre-change cache entry misses on digest or engine identity, the accepted version set is unchanged, and a v4 entry is rejected.
**Type:** happy-path

**Steps:**
1. Write tests in `src/conductor/test/engine/build-review-cache.test.ts`: (a) an entry whose `projectionDigest` was computed over a record with `content` misses with reason `projection-digest-mismatch` against the new digest of the same snapshot; (b) the same entry with a different `engineStamp` misses with `engine-version-mismatch`; (c) a new entry written by the engine carries `projectionVersion: "v3"`; (d) a candidate entry with `projectionVersion: "v4"` is rejected by `parseBuildReviewCacheEntry`.
2. Verify: all pass without production change.
3. Commit with an `Evidence: satisfied-by <sha>` trailer or the tests: "build_review: prove cache misses closed without a projection-version advance".

**Done when:**
- `resolveBuildReviewCacheLookup` returns `projection-digest-mismatch` for a pre-change entry and `engine-version-mismatch` when the engine stamp differs, as asserted by the two miss tests
- a freshly written cache entry carries `projectionVersion: "v3"` and `parseBuildReviewCacheEntry` rejects a `v4` candidate, as asserted by the version tests

**Files likely touched:**
- `src/conductor/test/engine/build-review-cache.test.ts`

**Verify-only:** yes

**Dependencies:** Task 1

### Task 5: The rubric prompt names the evidence re-read seam and the hash to verify
**Story:** Story 3 — the rendered prompt tells the session to read evidence regions at the pinned refs with git show and to verify each against contentHash, using no provider-specific names.
**Type:** happy-path

**Steps:**
1. Write failing tests for `dispatchBuildReviewRubric` in a new `src/conductor/test/engine/build-review-dispatch-prompt.test.ts` using a capturing fake provider: (a) the prompt contains the phrases `git show <mergeBase>:<path>`, `git show <headSha>:<path>`, `startLine`, `endLine`, and `contentHash` in one evidence-instruction paragraph; (a2) the same paragraph states that a hash-mismatched or unreadable region is not judged and names `indeterminate` and `missingEvidenceReason`; (b) the prompt contains no `~/.claude`, `CLAUDE_`, `CODEX_`, `claude-`, `gpt-`, or `opus`/`sonnet` token.
2. Verify RED: (a) fails because the current prompt only describes the diff by reference.
3. Implement: extend the prompt array in `dispatchBuildReviewRubric` (`src/conductor/src/engine/step-runners.ts`) with one paragraph stating that `testScope.evidence` records are references to be read at the pinned refs by side and verified against `contentHash`, never from the mutable working tree, and that a region failing the hash check or unreadable at the pinned ref is not judged and its fallback candidate is returned `indeterminate` with a `missingEvidenceReason`.
4. Verify GREEN, then commit: "build_review: instruct the rubric session to re-read evidence at pinned refs".

**Done when:**
- the rendered testQuality prompt contains the evidence re-read instruction naming `git show` at `mergeBase` for base regions and at `headSha` for head regions with `startLine`/`endLine` and `contentHash`, as asserted by the prompt-capture test
- the rendered prompt contains no provider-specific path, environment variable, or model name token from the closed list in the test, as asserted by the provider-agnostic test
- the rendered testQuality prompt states that a hash-mismatched or unreadable region is not judged and that its fallback candidate is returned `indeterminate` with a `missingEvidenceReason`, as asserted by the unverifiable-region prompt test

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/build-review-dispatch-prompt.test.ts`

**Dependencies:** Task 1

### Task 6: The skill contract describes evidence as identity-only references with a hash check
**Story:** Story 3 — a foreign-hash anchor is rejected and an unreadable region's indeterminate disposition is accepted by result validation; the skill digest miss is proven; SKILL.md documents the reference contract.
**Type:** happy-path

**Steps:**
1. Write tests: in `src/conductor/test/engine/build-review-cache.test.ts`, two lookups whose `engineIdentity.skillDigest` differ by one byte of skill text miss with `skill-digest-mismatch`; in `src/conductor/test/engine/build-review-coordinator.test.ts`, (a) a result whose finding anchor carries a `contentHash` absent from every projected evidence record and candidate is rejected by `validateBuildReviewDispatchedResult`, (b) a result returning a fallback candidate `indeterminate` with `missingEvidenceReason: "unreadable at pinned ref"` and no finding for that region is accepted with the reason on the scope resolution, (c) the same entry with an empty reason is rejected.
2. Verify RED only if the assertion is new; otherwise it passes and proves the existing mechanism.
3. Implement: edit the input-projection section of `skills/build-review-test-quality/SKILL.md` to state that each `testScope.evidence` record is an identity-only reference (`source`, `region`, `startLine`, `endLine`, `contentHash`), that the session reads the region at the pinned ref for its side and verifies the bytes hash to `contentHash`, that a hash-mismatched or unreadable region is not judged, that its fallback candidate is returned `indeterminate` with a `missingEvidenceReason`, and that the session's own read is never substituted as authoritative (a finding anchored to a non-projected hash is rejected by the engine).
4. Run `test/test_provider_skill_contracts.sh` and commit: "build-review-test-quality: evidence records are references to re-read and verify".

**Done when:**
- `skills/build-review-test-quality/SKILL.md` input-projection section describes evidence records as identity-only references and names the pinned-ref re-read and the `contentHash` verification
- `validateBuildReviewDispatchedResult` rejects a finding whose anchor `contentHash` matches no projected evidence record or candidate, as asserted by the foreign-hash test
- `validateBuildReviewDispatchedResult` accepts an `indeterminate` candidate whose `missingEvidenceReason` names an unreadable pinned path and rejects the same entry with an empty reason, as asserted by the unreadable-evidence tests
- `resolveBuildReviewCacheLookup` misses with `skill-digest-mismatch` when the skill digest differs, as asserted by the skill-digest test
- `test/test_provider_skill_contracts.sh` exits zero on the edited skill text

**Files likely touched:**
- `skills/build-review-test-quality/SKILL.md`
- `src/conductor/test/engine/build-review-cache.test.ts`
- `src/conductor/test/engine/build-review-coordinator.test.ts`

**Dependencies:** none

### Task 7: A provider-agnostic byte bound on the rubric config with a measured default
**Story:** Story 4 — max_projection_bytes is a validated positive integer on BuildReviewRubricConfig with a shipped default; invalid values fail config loading by name.
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts` (or the existing rubric-config test file): (a) an unset key resolves to the exported default constant; (b) `0`, `-1`, `1.5`, and `"1MB"` each fail loading with a message containing `max_projection_bytes` and the accepted range; (c) `1048576` loads as the number.
2. Measure: serialize the `testquality-admits-724` fixture projection in `build-review-projections.test.ts` after Task 2 and record its byte size in a comment beside the default constant; set the default to at least four times that size and no less than 262144.
3. Implement: add `max_projection_bytes?: number` to `BuildReviewRubricConfig` in `src/conductor/src/types/config.ts`, validate in `src/conductor/src/engine/config.ts`, and resolve the default in `src/conductor/src/engine/resolved-config.ts`.
4. Verify GREEN, then commit: "build_review: add max_projection_bytes rubric bound".

**Done when:**
- `BuildReviewRubricConfig` carries `max_projection_bytes` and the resolved config yields the exported default constant when the key is unset, as asserted by the default test
- config loading rejects `0`, negative, non-integer, and string values with a message naming `max_projection_bytes` and the accepted range, as asserted by the four invalid-value tests
- the default constant's comment records the serialized byte size of the 724-fixture projection and the default is at least four times that size
- no config, type, or prompt text expresses the bound as a model token count or names a provider

**Files likely touched:**
- `src/conductor/src/types/config.ts`
- `src/conductor/src/engine/config.ts`
- `src/conductor/src/engine/resolved-config.ts`
- `src/conductor/test/engine/config.test.ts`

**Dependencies:** none

### Task 8: The coordinator refuses an oversized projection with the closed cause projection-oversized
**Story:** Story 4 — a projection over the bound settles as an infrastructure failure with reason projection-oversized and measured/limit bytes in detail; the bound is inclusive and measured in UTF-8 bytes; no dispatch is attempted.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-coordinator.test.ts` and `build-review-domain.test.ts`: (a) a projection serializing to 1,346,093 bytes with bound 1,048,576 settles `projection-oversized` with `detail` matching `/measured=1346093 .*limit=1048576/`; (b) a counting fake `dispatchModel` is called zero times for that projection; (c) a projection exactly at the bound is dispatched once; (d) a projection whose canonical JSON is 100 characters of 3-byte UTF-8 (300 bytes) is refused at bound 250 and admitted at bound 300; (e) `mapBuildReviewCoordinatorFailureReason['projection-oversized'] === 'projection-oversized'`.
2. Verify RED: (a)-(e) fail because the reason does not exist.
3. Implement: add `projection-oversized` to `BuildReviewInfrastructureFailureReason` and to `mapBuildReviewCoordinatorFailureReason` in `src/conductor/src/engine/build-review-domain.ts` (the `satisfies Record<…>` keeps the mapping total); in `src/conductor/src/engine/build-review-coordinator.ts`, immediately after the existing `projection-rubric-mismatch` check, measure `Buffer.byteLength(canonical JSON, 'utf8')` against the rubric's resolved `max_projection_bytes` and settle `infrastructure(branch.rubric, 'projection-oversized', detail)` when measured exceeds the bound.
4. Verify GREEN, then commit: "build_review: refuse oversized projections before dispatch".

**Done when:**
- `BuildReviewInfrastructureFailureReason` and `BuildReviewCoordinatorFailureReason` both contain `projection-oversized` and the `satisfies` mapping fails to compile if either side is missing, as asserted by the domain mapping test
- the coordinator settles a 1,346,093-byte projection at bound 1,048,576 as `projection-oversized` with `detail` carrying `measured=1346093` and `limit=1048576`, as asserted by the oversize test
- the counting fake dispatcher records zero calls for the oversized projection and one call for a projection exactly at the bound, as asserted by the no-dispatch and inclusive-bound tests
- the guard measures UTF-8 bytes of the canonical serialization, refusing a 300-byte multi-byte projection at bound 250 and admitting it at 300, as asserted by the UTF-8 test

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts`
- `src/conductor/src/engine/build-review-coordinator.ts`
- `src/conductor/test/engine/build-review-coordinator.test.ts`
- `src/conductor/test/engine/build-review-domain.test.ts`

**Dependencies:** Task 7

### Task 9: A projection-oversized lap publishes once and halts needs-human through the build_review step
**Story:** Story 5 — through the step entry point, an oversized lap writes its aggregate, leaves the mechanical counter untouched, halts needs-human naming rubric, bytes and bound, renders a reduced-coverage record, and tolerates a malformed detail.
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/build-review-step.test.ts` that drive `runBuildReview` in `src/conductor/src/engine/step-runners.ts` with a fake coordinator returning `projection-oversized`: (a) `.pipeline/build-review.json` is written once for the lap with `coverage.testQuality: infrastructure-failure` and `reason: projection-oversized`; (b) `bumpMechanicalFaultsInLedger` is not invoked (spy) and the ledger's `mechanicalFaults` is unchanged; (c) the returned halt has class `needs-human` and its text contains `testQuality`, `1346093`, and `1048576`; (d) after a recorded reduced-coverage decision, `deriveEffectiveBuildReviewVerdict` renders `reducedCoverageEvidence` on the aggregate; (e) a `projection-oversized` result whose `detail` lacks the numbers still parses as an infrastructure result and the halt text names the reason without numbers.
2. Verify RED: (a)-(c) fail because the current join bumps the counter and returns `currentLapMechanicalFault`.
3. Implement: in the `infrastructureFailure` branch of `runBuildReview`, route `reason === 'projection-oversized'` past `bumpMechanicalFaultsInLedger`, write the aggregate, and return the existing `needs-human` halt shape with the rubric, measured bytes, and bound parsed from `detail` (falling back to the reason alone). Transient reasons keep the existing path.
4. Verify GREEN, then commit: "build_review: charge a deterministic oversize once and halt for a human".

**Done when:**
- `runBuildReview` writes `.pipeline/build-review.json` exactly once for a `projection-oversized` lap with the infrastructure result on it, as asserted by the single-write test through the step entry point
- `bumpMechanicalFaultsInLedger` is never called and the ledger's mechanical-fault count is unchanged on a `projection-oversized` lap, as asserted by the spy and ledger tests
- the step returns a `needs-human` halt whose text contains the rubric id, the measured bytes, and the bound, as asserted by the halt-text test
- `deriveEffectiveBuildReviewVerdict` renders `reducedCoverageEvidence` on the oversize aggregate after a reduced-coverage decision, as asserted by the reduced-coverage test
- a `projection-oversized` result with a number-less `detail` still parses as an infrastructure result and halts naming the reason alone, as asserted by the malformed-detail test

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/build-review-step.test.ts`

**Dependencies:** Task 8

### Task 10: Transient faults keep retrying and an oversize is never re-dispatched
**Story:** Story 5 negative paths — provider-error still bumps and re-runs; an oversize dispatches one lap only, leaves the ledger count unchanged, and a mixed lap preserves the judged finding while halting needs-human.
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/engine/build-review-step.test.ts`: (a) a `provider-error` lap increments `mechanicalFaults` by one and returns `currentLapMechanicalFault: true` while below the cap; (b) driving the conductor's build_review re-dispatch decision after a `projection-oversized` lap dispatches no second lap (lap counter stays 1); (c) the kickback ledger's mechanical-fault count before and after the oversize lap is equal; (d) a lap with one rubric judged with a finding and the testQuality branch `projection-oversized` publishes the aggregate with the finding and halts `needs-human` rather than returning a semantic kickback.
2. Verify RED for (b) and (d) on the pre-Task-9 join; (a) passes as a preservation check.
3. Implement only what (b)-(d) require inside the Task 9 routing; no new module.
4. Verify GREEN, then commit: "build_review: oversize halts once; transient faults still retry".

**Done when:**
- a `provider-error` lap below the cap increments `mechanicalFaults` by one and returns `currentLapMechanicalFault: true`, as asserted by the transient-retry test
- the build_review re-dispatch decision after a `projection-oversized` lap dispatches no second lap and the lap counter stays at one, as asserted by the no-second-lap test
- the kickback ledger's mechanical-fault count is equal before and after a `projection-oversized` lap, as asserted by the ledger-equality test
- a mixed lap with a judged finding and a `projection-oversized` branch publishes the finding on the aggregate and halts `needs-human` instead of routing a semantic kickback, as asserted by the mixed-lap test

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/build-review-step.test.ts`

**Dependencies:** Task 9

### Task 11: The oversize rides the existing infrastructure-failure event with additive fields
**Story:** Story 6 — build_review_rubric_infrastructure_failure gains optional measuredBytes and limitBytes present only on an oversize; build_review_rubric_prompt is unchanged; no new event type.
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` and `build-review-coordinator.test.ts`: (a) settling `projection-oversized` emits `build_review_rubric_infrastructure_failure` with `reason: 'projection-oversized'`, `measuredBytes: 1346093`, `limitBytes: 1048576`; (b) an admitted dispatch emits `build_review_rubric_prompt` with `promptBytes` and no infrastructure-failure event carrying `measuredBytes`; (c) the `EVENT_SINKS` exhaustiveness test passes with no new member; (d) an event object without the two fields still satisfies the union type (compile-time `satisfies` fixture); (e) the events written for an oversize lap contain no type outside the existing union and no file other than `.pipeline/events.jsonl` is created.
2. Verify RED: (a) fails because the fields do not exist.
3. Implement: add `measuredBytes?: number; limitBytes?: number` to the `build_review_rubric_infrastructure_failure` member in `src/conductor/src/types/events.ts` and pass them from the coordinator's oversize settlement in `src/conductor/src/engine/build-review-coordinator.ts`.
4. Verify GREEN, then commit: "build_review: publish oversize bytes on the existing infrastructure-failure event".

**Done when:**
- `build_review_rubric_infrastructure_failure` in events.ts carries optional `measuredBytes` and `limitBytes`, and an oversize settlement emits both with the measured and permitted values, as asserted by the oversize-event test
- an admitted dispatch emits `build_review_rubric_prompt` with `promptBytes` and no infrastructure-failure event carrying `measuredBytes`, as asserted by the admitted-dispatch test
- the `EVENT_SINKS` exhaustiveness test passes without a new event member and a field-less event object still satisfies the union, as asserted by the exhaustiveness and compatibility tests
- an oversize lap writes only existing event types to `.pipeline/events.jsonl` and creates no other file, as asserted by the no-sidecar test

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/build-review-coordinator.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/engine/build-review-coordinator.test.ts`

**Dependencies:** Task 8

## Task Dependency Graph

```
Task 1 ──┬── Task 2
         ├── Task 3
         ├── Task 4
         └── Task 5
Task 6 (independent)
Task 7 ─── Task 8 ──┬── Task 9 ─── Task 10
                    └── Task 11
```

## Integration Points

- After Task 2: a real assembly + projection over the 724 fixture serializes without `content`; the byte size recorded here feeds Task 7's default.
- After Task 9: `runBuildReview` with a fake coordinator proves the oversize path end to end (aggregate once, no ledger bump, `needs-human` halt).
- After Task 11: the same lap shows the event with `measuredBytes`/`limitBytes` on `.pipeline/events.jsonl`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a frozen snapshot whose changed test file has one bound changed declaration spanning characters 120-480, when scope assembly pins its evidence, then the record carries `source.fileName`, `source.side`, `region.start` 120, `region.end` 480, `startLine`, `endLine`, and a `contentHash` of `sha256:` over exactly those 360 characters, and has no `content` property. | 1 | "`pinScopeEvidence` returns records whose own keys are exactly `id, source, region, startLine, endLine, contentHash`, as asserted by the key-set test" | diff-local |
| Story 1 happy: Given the same snapshot, when the testQuality projection is derived, then `testScope.evidence` serializes each record without a `content` key and the serialized projection for a 98-test-file diff is bounded by the count of deduplicated regions rather than their bytes. | 2 | "`deriveBuildReviewRubricProjections` output has no `content` key anywhere under `testScope.evidence`, as asserted by the serialized-key test" | diff-local |
| Story 1 happy: Given a base-side region for a modified declaration, when evidence is pinned, then `contentHash` is computed over the region read at `mergeBase`, identical to the hash the previous implementation produced for the same bytes. | 1 | "`contentHash` for the fixed-region fixture equals the pre-change literal recorded in the test, proving the hash is computed over the same bytes as before" | diff-local |
| Story 1 negative: Given a region whose base-side file is absent at `mergeBase` (an added helper), when evidence is pinned, then no record is fabricated for the base side and the head-side record still carries its full identity, unchanged from today. | 1 | "an added helper with no base blob yields no base-side record while its head record keeps its full identity, and two same-offset files yield two distinct records, as asserted by the absent-base and same-offset tests" | diff-local |
| Story 1 negative: Given two files with declarations at identical character offsets, when evidence is pinned, then each record's `id` and `source.fileName` keep them distinct and no record is merged or dropped by the removal of `content`. | 1 | "an added helper with no base blob yields no base-side record while its head record keeps its full identity, and two same-offset files yield two distinct records, as asserted by the absent-base and same-offset tests" | diff-local |
| Story 1 negative: Given a fixture that constructs an evidence record with a `content` property, when it is passed to projection derivation, then the type no longer admits the property and the compile fails, so no producer can silently reintroduce inlined bytes. | 1 | "`BuildReviewPinnedScopeEvidence` in build-review-inputs.ts declares no `content` member and a `@ts-expect-error` literal with `content` is rejected by the type checker in the inputs test" | diff-local |
| Story 2 happy: Given a projection with one fallback candidate whose source region matches a pinned evidence record, when `buildReviewCandidateScopeResolutionContext` runs, then the candidate's `sourceRegion` carries the record's `path`, `startLine`, `endLine`, and `contentHash` exactly as it did with inlined bytes. | 3 | "`buildReviewCandidateScopeResolutionContext` for the fixed projection deep-equals the pre-change golden object, as asserted by the golden-context test" | diff-local |
| Story 2 happy: Given a judged result whose finding anchor cites a content-region `{path, contentHash, display, occurrence}` from the projection, when the result is validated, then the anchor resolves identically to the pre-change behavior and `occurrence` is derived from the analyzer's declaration ordinal, never from evidence bytes. | 3 | "`validateBuildReviewDispatchedResult` accepts the ordinal-anchored finding and rejects both the hash-less-evidence citation and the unlisted-path citation, as asserted by the three anchor tests" | diff-local |
| Story 2 happy: Given a cache entry written by the previous engine for the same snapshot, when the new engine looks it up, then the lookup misses (on `projection-digest-mismatch` or `engine-version-mismatch`) and `projectionVersion` remains `v3` on both the lookup and the new entry. | 4 | "`resolveBuildReviewCacheLookup` returns `projection-digest-mismatch` for a pre-change entry and `engine-version-mismatch` when the engine stamp differs, as asserted by the two miss tests" | diff-local |
| Story 2 happy: Given two snapshots that differ only in one evidence region's bytes, when projections are derived, then their `projectionDigest` values differ because `contentHash` differs. | 3 | "`projectionDigest` differs between two projections that differ only in one region's `contentHash`, as asserted by the digest test" | diff-local |
| Story 2 negative: Given a projection whose evidence record omits `contentHash`, when a candidate is matched against it, then the candidate context is not produced for that record and validation rejects a result that cites it, exactly as today for an evidence record with a malformed identity. | 3 | "`validateBuildReviewDispatchedResult` accepts the ordinal-anchored finding and rejects both the hash-less-evidence citation and the unlisted-path citation, as asserted by the three anchor tests" | diff-local |
| Story 2 negative: Given a candidate that cites a region from a file the projection does not list, when the result is validated, then it is rejected as an out-of-scope anchor, unchanged from today. | 3 | "`validateBuildReviewDispatchedResult` accepts the ordinal-anchored finding and rejects both the hash-less-evidence citation and the unlisted-path citation, as asserted by the three anchor tests" | diff-local |
| Story 2 negative: Given a cache entry declaring `projectionVersion: "v4"`, when it is parsed, then it is rejected as an invalid entry, proving the accepted version set is unchanged. | 4 | "a freshly written cache entry carries `projectionVersion: "v3"` and `parseBuildReviewCacheEntry` rejects a `v4` candidate, as asserted by the version tests" | diff-local |
| Story 3 happy: Given an admitted projection, when the rubric prompt is rendered, then it states that `testScope.evidence` records are references to be read at the pinned refs with `git show «mergeBase»:«path»` for `side: base` and `git show «headSha»:«path»` for `side: head` using `startLine`/`endLine`, never from the mutable working tree, and that the read region must hash to the supplied `contentHash`. | 5 | "the rendered testQuality prompt contains the evidence re-read instruction naming `git show` at `mergeBase` for base regions and at `headSha` for head regions with `startLine`/`endLine` and `contentHash`, as asserted by the prompt-capture test" | diff-local |
| Story 3 happy: Given an admitted projection, when the rubric prompt is rendered, then it states that a region whose re-read bytes do not hash to the supplied `contentHash`, or that cannot be read at the pinned ref, must not be judged and that a fallback candidate for such a region is returned `indeterminate` with a `missingEvidenceReason`. | 5 | "the rendered testQuality prompt states that a hash-mismatched or unreadable region is not judged and that its fallback candidate is returned `indeterminate` with a `missingEvidenceReason`, as asserted by the unverifiable-region prompt test" | diff-local |
| Story 3 happy: Given the skill text changes, when the next lap looks up the cache, then the `skillDigest` component of the engine identity differs and the lookup misses. | 6 | "`resolveBuildReviewCacheLookup` misses with `skill-digest-mismatch` when the skill digest differs, as asserted by the skill-digest test" | diff-local |
| Story 3 negative: Given a judged result whose finding anchor cites a `contentHash` that no projected evidence record or candidate carries (the session's own re-read of a mismatched region), when the result is validated, then the result is rejected, so a session's substitute read is never authoritative. | 6 | "`validateBuildReviewDispatchedResult` rejects a finding whose anchor `contentHash` matches no projected evidence record or candidate, as asserted by the foreign-hash test" | diff-local |
| Story 3 negative: Given a judged result that returns a fallback candidate as `indeterminate` with a `missingEvidenceReason` naming an unreadable pinned path and raises no finding for that region, when the result is validated, then it is accepted with the reason carried on the scope resolution, and the same entry with an empty reason is rejected. | 6 | "`validateBuildReviewDispatchedResult` accepts an `indeterminate` candidate whose `missingEvidenceReason` names an unreadable pinned path and rejects the same entry with an empty reason, as asserted by the unreadable-evidence tests" | diff-local |
| Story 3 negative: Given the rubric prompt, when it is rendered for any provider, then it names `git` and the projection fields only and contains no provider-specific path, environment variable, or model name. | 5 | "the rendered prompt contains no provider-specific path, environment variable, or model name token from the closed list in the test, as asserted by the provider-agnostic test" | diff-local |
| Story 4 happy: Given `build_review.rubrics.testQuality.max_projection_bytes` is unset, when the coordinator derives a projection, then the shipped default bound applies and a projection under it is dispatched unchanged. | 7 | "`BuildReviewRubricConfig` carries `max_projection_bytes` and the resolved config yields the exported default constant when the key is unset, as asserted by the default test" | diff-local |
| Story 4 happy: Given a bound of 1,048,576 bytes and a serialized projection of 1,346,093 bytes, when the coordinator reaches the projection check, then the branch settles as an infrastructure failure with reason `projection-oversized`, `detail` naming `measured=1346093` and `limit=1048576`, and no provider dispatch is attempted. | 8 | "the coordinator settles a 1,346,093-byte projection at bound 1,048,576 as `projection-oversized` with `detail` carrying `measured=1346093` and `limit=1048576`, as asserted by the oversize test" | diff-local |
| Story 4 happy: Given a serialized projection exactly at the bound, when the check runs, then the projection is admitted (the bound is inclusive). | 8 | "the counting fake dispatcher records zero calls for the oversized projection and one call for a projection exactly at the bound, as asserted by the no-dispatch and inclusive-bound tests" | diff-local |
| Story 4 happy: Given a valid config, when `max_projection_bytes` is loaded, then it is a positive integer byte count on `BuildReviewRubricConfig` with no provider- or model-specific alternative. | 7 | "no config, type, or prompt text expresses the bound as a model token count or names a provider" | diff-local |
| Story 4 negative: Given `max_projection_bytes: 0` or a negative or non-integer value, when config is loaded, then loading fails with a message naming the key and the accepted range, and no lap runs with an unbounded projection. | 7 | "config loading rejects `0`, negative, non-integer, and string values with a message naming `max_projection_bytes` and the accepted range, as asserted by the four invalid-value tests" | diff-local |
| Story 4 negative: Given a projection that is oversized, when the coordinator settles the branch, then `dispatchModel` is not called, proven by a counting fake dispatcher. | 8 | "the counting fake dispatcher records zero calls for the oversized projection and one call for a projection exactly at the bound, as asserted by the no-dispatch and inclusive-bound tests" | diff-local |
| Story 4 negative: Given the guard measures the projection, when it computes size, then it measures UTF-8 bytes of the canonical serialization, so a projection with multi-byte characters is not admitted on a character count that understates its bytes. | 8 | "the guard measures UTF-8 bytes of the canonical serialization, refusing a 300-byte multi-byte projection at bound 250 and admitting it at 300, as asserted by the UTF-8 test" | diff-local |
| Story 5 happy: Given a lap whose testQuality branch settled `projection-oversized`, when the step joins results, then it writes the aggregate carrying that infrastructure result, does not increment the mechanical-fault counter, and returns a `needs-human` halt whose text names the rubric, the measured bytes, and the bound. | 9 | "`runBuildReview` writes `.pipeline/build-review.json` exactly once for a `projection-oversized` lap with the infrastructure result on it, as asserted by the single-write test through the step entry point" | diff-local |
| Story 5 happy: Given that halt, when the operator records a reduced-coverage decision through the existing attributed mechanism, then the effective verdict renders the reduced-coverage evidence on the aggregate as it does for any other mechanical cause. | 9 | "`deriveEffectiveBuildReviewVerdict` renders `reducedCoverageEvidence` on the oversize aggregate after a reduced-coverage decision, as asserted by the reduced-coverage test" | diff-local |
| Story 5 happy: Given a lap with a transient infrastructure failure such as `provider-error`, when the step joins results, then it increments the mechanical-fault counter and re-runs while allowance remains, unchanged from today. | 10 | "a `provider-error` lap below the cap increments `mechanicalFaults` by one and returns `currentLapMechanicalFault: true`, as asserted by the transient-retry test" | diff-local |
| Story 5 negative: Given a `projection-oversized` lap, when the conductor evaluates whether to re-dispatch build_review, then no second lap is dispatched for the same snapshot, proven by a lap counter that stays at one. | 10 | "the build_review re-dispatch decision after a `projection-oversized` lap dispatches no second lap and the lap counter stays at one, as asserted by the no-second-lap test" | diff-local |
| Story 5 negative: Given a `projection-oversized` lap, when the kickback ledger is read afterward, then its mechanical-fault count equals its value before the lap. | 10 | "the kickback ledger's mechanical-fault count is equal before and after a `projection-oversized` lap, as asserted by the ledger-equality test" | diff-local |
| Story 5 negative: Given a mixed lap in which one rubric returned a judged finding and another settled `projection-oversized`, when the step joins results, then the judged finding is preserved on the aggregate and the lap still halts `needs-human` rather than routing the finding as ordinary semantic rework. | 10 | "a mixed lap with a judged finding and a `projection-oversized` branch publishes the finding on the aggregate and halts `needs-human` instead of routing a semantic kickback, as asserted by the mixed-lap test" | diff-local |
| Story 5 negative: Given a `projection-oversized` result whose `detail` is missing the measured or permitted bytes, when the aggregate is parsed, then the result is still a valid infrastructure result and the halt text falls back to naming the reason without numbers, so a malformed detail never turns a deterministic halt into a retry. | 9 | "a `projection-oversized` result with a number-less `detail` still parses as an infrastructure result and halts naming the reason alone, as asserted by the malformed-detail test" | diff-local |
| Story 6 happy: Given a `projection-oversized` branch, when the coordinator settles it, then a `build_review_rubric_infrastructure_failure` event is emitted with `reason: "projection-oversized"` and additive fields `measuredBytes` and `limitBytes`. | 11 | "`build_review_rubric_infrastructure_failure` in events.ts carries optional `measuredBytes` and `limitBytes`, and an oversize settlement emits both with the measured and permitted values, as asserted by the oversize-event test" | diff-local |
| Story 6 happy: Given an admitted dispatch, when the rubric prompt is rendered, then `build_review_rubric_prompt` is emitted with `promptBytes` exactly as today. | 11 | "an admitted dispatch emits `build_review_rubric_prompt` with `promptBytes` and no infrastructure-failure event carrying `measuredBytes`, as asserted by the admitted-dispatch test" | diff-local |
| Story 6 happy: Given the event sink registry, when the event union changes, then the exhaustiveness check accepts the additive optional fields without a new event type. | 11 | "the `EVENT_SINKS` exhaustiveness test passes without a new event member and a field-less event object still satisfies the union, as asserted by the exhaustiveness and compatibility tests" | diff-local |
| Story 6 negative: Given a `projection-oversized` branch, when events are inspected, then no new event type, sidecar file, or ledger was written for it. | 11 | "an oversize lap writes only existing event types to `.pipeline/events.jsonl` and creates no other file, as asserted by the no-sidecar test" | diff-local |
| Story 6 negative: Given an existing consumer that reads `build_review_rubric_infrastructure_failure` without knowing the new fields, when it parses the event, then it still parses, because the fields are optional. | 11 | "the `EVENT_SINKS` exhaustiveness test passes without a new event member and a field-less event object still satisfies the union, as asserted by the exhaustiveness and compatibility tests" | diff-local |
| Story 6 negative: Given an admitted dispatch, when events are inspected, then no `build_review_rubric_infrastructure_failure` event carries `measuredBytes`, so the fields are present only on an oversize. | 11 | "an admitted dispatch emits `build_review_rubric_prompt` with `promptBytes` and no infrastructure-failure event carrying `measuredBytes`, as asserted by the admitted-dispatch test" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-13-engine-managed-build-review-rubric-branches#D2 | task | task-1, task-5 | `BuildReviewPinnedScopeEvidence` in build-review-inputs.ts declares no `content` member and a `@ts-expect-error` literal with `content` is rejected by the type checker in the inputs test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D1 | no-change | none | routing still reads `BuildReviewRubricResult.kind === 'infrastructure-failure'`; `projection-oversized` is carried as a reason inside that kind, never as detail text |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D2 | task | task-8 | `BuildReviewInfrastructureFailureReason` and `BuildReviewCoordinatorFailureReason` both contain `projection-oversized` and the `satisfies` mapping fails to compile if either side is missing, as asserted by the domain mapping test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D3 | task | task-9 | `runBuildReview` writes `.pipeline/build-review.json` exactly once for a `projection-oversized` lap with the infrastructure result on it, as asserted by the single-write test through the step entry point |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D4 | task | task-10 | a `provider-error` lap below the cap increments `mechanicalFaults` by one and returns `currentLapMechanicalFault: true`, as asserted by the transient-retry test |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D5 | task | task-9 | `runBuildReview` writes `.pipeline/build-review.json` exactly once for a `projection-oversized` lap with the infrastructure result on it, as asserted by the single-write test through the step entry point |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D6 | task | task-9 | `runBuildReview` writes `.pipeline/build-review.json` exactly once for a `projection-oversized` lap with the infrastructure result on it, as asserted by the single-write test through the step entry point |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D7 | no-change | none | identity stays `{rubric, closed reason}`; the new reason is one more closed member and no detail text enters identity |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D8 | no-change | none | a judged finding on a mixed lap still blocks and is preserved on the aggregate (Task 10 mixed-lap check); no substitution between decision kinds is introduced |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D9 | no-change | none | reduced coverage is still stamped on the aggregate by `deriveEffectiveBuildReviewVerdict` and read at the same places; no new stamping site |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D10 | task | task-11 | `build_review_rubric_infrastructure_failure` in events.ts carries optional `measuredBytes` and `limitBytes`, and an oversize settlement emits both with the measured and permitted values, as asserted by the oversize-event test |
| adr-2026-09-06-engine-owned-test-quality-scope#D1 | no-change | none | one frozen source authority is untouched; `pinScopeEvidence` still reads at `mergeBase`/`headSha` through the same memoized blob reader |
| adr-2026-09-06-engine-owned-test-quality-scope#D2 | no-change | none | the typed scope value, its states and separation from runner selectors are unchanged |
| adr-2026-09-06-engine-owned-test-quality-scope#D3 | no-change | none | parser boundary and dependency packaging are untouched |
| adr-2026-09-06-engine-owned-test-quality-scope#D4 | no-change | none | binding provenance and marker association are untouched |
| adr-2026-09-06-engine-owned-test-quality-scope#D5 | no-change | none | shared-change and plan-evidence discovery are untouched; only the record shape of the pinned references changes |
| adr-2026-09-06-engine-owned-test-quality-scope#D6 | task | task-1, task-2 | `BuildReviewPinnedScopeEvidence` in build-review-inputs.ts declares no `content` member and a `@ts-expect-error` literal with `content` is rejected by the type checker in the inputs test |
| adr-2026-09-06-engine-owned-test-quality-scope#D7 | no-change | none | `scope-incomplete` keeps its meaning and routing; the oversize uses its own closed reason (Task 8) rather than this one |
| adr-2026-09-06-engine-owned-test-quality-scope#D8 | task | task-4 | `resolveBuildReviewCacheLookup` returns `projection-digest-mismatch` for a pre-change entry and `engine-version-mismatch` when the engine stamp differs, as asserted by the two miss tests |
| adr-2026-09-06-engine-owned-test-quality-scope#D9 | task | task-11 | `build_review_rubric_infrastructure_failure` in events.ts carries optional `measuredBytes` and `limitBytes`, and an oversize settlement emits both with the measured and permitted values, as asserted by the oversize-event test |
| adr-2026-09-06-engine-owned-test-quality-scope#D10 | no-change | none | existing parser/binding fixtures and the 724-title case remain in place; Task 3 adds identity-stability coverage without changing them |
| adr-2026-09-06-engine-owned-test-quality-scope#D11 | task | task-7 | `BuildReviewRubricConfig` carries `max_projection_bytes` and the resolved config yields the exported default constant when the key is unset, as asserted by the default test |
| adr-2026-09-06-engine-owned-test-quality-scope#D12 | task | task-6 | `skills/build-review-test-quality/SKILL.md` input-projection section describes evidence records as identity-only references and names the pinned-ref re-read and the `contentHash` verification |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks on single lines
- [x] Dependencies are explicit and acyclic
- [x] No terminal catch-all validation task; Task 9 owns the step-entry integration proof
