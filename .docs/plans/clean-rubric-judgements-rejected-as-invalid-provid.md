# Implementation Plan: Clean rubric judgements rejected as invalid-provider-result

**Date:** 2026-08-19
**Issue:** #1683
**Design:** [ADR](../decisions/adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md)
**Stories:** .docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md
**Conflict check:** Clean as of 2026-08-19 — `.docs/conflicts/2026-08-19-clean-rubric-judgements-rejected-as-invalid-provid.md`
**Architecture review:** [APPROVED WITH CONDITIONS](../decisions/architecture-review-2026-08-19-clean-rubric-judgements-rejected-as-invalid-provid.md)

## Summary

Twenty-two tasks across four seams that stop `build_review` discarding completed rubric judgements
and stop a rejection asserting a cause it never tested: a plan-task reference normalizer, an honest
rejection diagnosis bound to the projection, a drift guard over reference grammars, and an
engine-stamped judged-result envelope.

## Technical Approach

Four seams, in this order. The ordering is a dependency chain, not a preference.

**1. Normalize the plan-task reference (Tasks 1–4).** `parseBuildReviewCanonicalPlanTaskReference`
holds `anchor.planTask` to `CANONICAL_PLAN_TASK_REFERENCE`, built from `TASK_ID_PATTERN`
(`plan-task-parse.ts`) — no spaces, no colon. Graders emit `Task 7: <title>`. Normalization reduces
the titled form to the bare id **ahead of** the existing plan-task reference kind, so the resulting
identity is byte-identical to the bare form's and no new reference kind is introduced
(ADR D9). This lands first because seam 2's canonical-form diagnosis needs a settled answer to
"what is acceptable" before it can describe what is not.

**2. Make the rejection diagnosis honest (Tasks 5–12).** Two independent defects.
`describeBuildReviewJudgedResultRejection` ends with a fall-through that asserts a
`verdict`/`passed` contradiction whenever no enumerated check fired — a cause it never tested, and
the message the 2026-08-19 `completeness` halt reported against a payload carrying neither field.
Separately, `validateRubricOutput` passes the authoritative predicate the whole projection but
passes the diagnosis only `{lapId, snapshotDigest}`, so every reference-membership failure is
structurally undiagnosable and falls into that same fall-through. Both are repaired here, plus the
repair loop's missing byte-identical guard: a repair whose output equals the output it was repairing
is proof the instruction was unactionable, and settles without spending further step retries.

**3. Extend the drift guard (Tasks 13–14).** `test/check_build_review_rubric_skill_vocabularies.sh`
already pins closed vocabularies between the engine definition and the four rubric contracts. It is
extended to parser-enforced reference grammars. This lands **before** seam 4 so the guard is in
force while seam 4 rewrites those same contracts (architecture-review Condition 2).

**4. Stamp the envelope engine-side (Tasks 15–21).** The provider's judged-result payload narrows to
`findings`; `kind`, `rubric`, `contractVersion`, `lapId` and `snapshotDigest` are supplied from the
projection and the rubric registry. Provider-supplied envelope fields are ignored, never validated.

**Binding constraint from conflict-check (Conflict 4).** The `contractVersion` stamp is applied on
the **live dispatch path only**. The at-rest parse used for stored branch artifacts and cache
entries must continue to honour the version each record declares. No task may place the stamp in
code shared by both paths — doing so satisfies Story 3 while silently rewriting the version of every
record read from disk.

**Local pattern context.** The envelope stamp in seam 4 should follow the shape the cache-hit branch
in `coordinateBuildReviewRubrics` already uses. Traits to preserve: the artifact is written with the
*current* projection's `lapId` and `snapshotDigest` regardless of what the result body carried;
provenance is recorded explicitly rather than inferred; and the written artifact is re-validated
before the branch settles. Free to vary: where in the dispatch path the stamp is applied, and how
the narrowed wire payload is typed. Find the comparable code by searching
`build-review-coordinator.ts` for the cache-hit branch calling `writeArtifact` with a `cache-hit`
provenance, and resolve the traits against HEAD rather than against this description. Tasks 16 and
19 repeat the relevant subset in their own steps.

**Concurrent work — read before editing the reason vocabulary.**
`review-infrastructure-failures-are-operator-unreco` is a merged, unbuilt spec whose Task 1 adds a
total branch-reason to closed-cause mapping over the same `BuildReviewInfrastructureFailureReason`
union, and whose D1 deletes the `startsWith` prefix match currently live in `step-runners.ts`. This
plan adds **no member** to that union and does not implement that mapping (ADR D8,
conflict-check Conflict 2). Task 18 must read the union's current shape at implementation time
rather than trust this plan's description of it.

## Prerequisites

- None external. Every seam exists in `src/conductor/src/engine/`, `skills/build-review-*/`, and
  `test/`.

## Tasks

### Task 1: Prove a titled plan-task reference and a bare id must yield one identity
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing test: a completeness finding whose `anchor.planTask` is `Task 7: The resolved
   channel and its source are confirmed in the output` canonicalizes to the same finding identity
   hash as the otherwise-identical finding whose `anchor.planTask` is `7`. Assert equality of the
   two canonical identity strings, and assert the expected hash against an independently
   precomputed literal so the assertion cannot be satisfied by a shared helper.
2. Verify test fails (RED) — the titled form currently produces no anchor at all.
3. Implement: nothing yet; this task lands the RED assertion only.
4. Verify the bare-id half of the assertion passes and the titled half fails.
5. Commit with message: "test(build-review): titled and bare plan-task references share one identity"

**Files:**
- `src/conductor/test/engine/build-review-finding-identity.test.ts` — the identity-equality assertion

**Dependencies:** none

### Task 2: Normalize a titled plan-task reference ahead of the existing reference kind
**Story:** 9
**Type:** happy-path

**Steps:**
1. Implement: in `build-review-domain.ts`, reduce a `Task <id>: <title>` value to `<id>` before it
   reaches `parseBuildReviewCanonicalPlanTaskReference`, using the shared `TASK_ID_PATTERN` grammar
   rather than a new ad hoc regex. Normalization runs ahead of the existing plan-task reference
   kind and produces a value that kind already accepts, so no new reference kind is introduced.
2. Verify Task 1's test passes (GREEN).
3. Verify the bare-id path is untouched: an already-canonical value normalizes to itself.
4. Commit with message: "fix(build-review): normalize titled plan-task references to their canonical id"

**Files:**
- `src/conductor/src/engine/build-review-domain.ts` — normalization ahead of the plan-task reference parse

**Dependencies:** Task 1

### Task 3: Reject an unrecoverable reference, and fail an absent id on membership
**Story:** 9
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) an `anchor.planTask` of free prose with no recoverable id — for example
   `the install channel resolution step` — is rejected rather than guessed at; (b) a value that
   normalizes cleanly to an id which is **absent** from the projection's plan tasks is rejected on
   membership, not accepted because normalization succeeded.
2. Verify tests fail (RED).
3. Implement: normalization returns undefined when no id is recoverable, and its output is passed
   through the existing membership check rather than bypassing it.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(build-review): normalization never guesses an id or bypasses membership"

**Files:**
- `src/conductor/src/engine/build-review-domain.ts` — undefined on unrecoverable input; membership preserved
- `src/conductor/test/engine/build-review-domain.test.ts` — both negative assertions

**Dependencies:** Task 2

### Task 4: Preserve the duplicate-identity rejection under normalization
**Story:** 9
**Type:** negative-path

**Steps:**
1. Write failing test: two findings whose `anchor.planTask` values differ only in title text but
   normalize to the same id canonicalize to one identity, and the whole result is therefore rejected
   as a duplicate — the rule `adr-2026-08-13-stable-build-review-finding-dispositions` §1
   establishes.
2. Verify test fails (RED).
3. Implement: confirm normalization runs before canonicalization so colliding titles collapse, and
   adjust ordering if it does not.
4. Verify test passes (GREEN).
5. Commit with message: "test(build-review): title-differing plan-task findings still collide"

**Files:**
- `src/conductor/test/engine/build-review-finding-identity.test.ts` — the collision assertion
- `src/conductor/src/engine/build-review-domain.ts` — normalization ordering, if it must move

**Dependencies:** Task 2

### Task 5: Prove the recorded halt payload is diagnosed with a fabricated cause
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: replay the 2026-08-19 `completeness` payload — a conformant v3 envelope
   carrying neither `verdict` nor `passed`, whose `anchor.planTask` is non-canonical — through
   `describeBuildReviewJudgedResultRejection` and assert the returned prose contains neither the
   word `verdict` nor `passed`.
2. Verify test fails (RED) — the current fall-through asserts exactly that contradiction.
3. Implement: nothing yet; RED assertion only.
4. Verify the failure message shows the fabricated cause being produced.
5. Commit with message: "test(build-review): rejection diagnosis must not fabricate a verdict contradiction"

**Files:**
- `src/conductor/test/engine/build-review-domain.test.ts` — the replayed-payload assertion

**Dependencies:** none

### Task 6: Report an unexplained rejection as unexplained
**Story:** 6
**Type:** happy-path

**Steps:**
1. Implement: replace the fall-through in `describeBuildReviewJudgedResultRejection` that asserts a
   `verdict`/`passed` contradiction with one that states the result did not satisfy the judged
   contract and that no enumerated check explains why. The genuine contradiction becomes a tested
   condition evaluated against the payload, not a default.
2. Verify Task 5's test passes (GREEN).
3. Verify the returned prose still respects the existing problem cap and bounded-value rules.
4. Commit with message: "fix(build-review): an unexplained rejection reports itself as unexplained"

**Files:**
- `src/conductor/src/engine/build-review-domain.ts` — tested fall-through replacing the asserted cause

**Dependencies:** Task 5

### Task 7: Net every pre-existing enumerated cause against silent loss
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write tests: one assertion per rejection cause the diagnosis enumerated before this change,
   each constructing a payload that triggers exactly that cause and asserting its specific message
   is produced. Include the genuine `verdict`/`passed` contradiction — a payload whose supplied
   `verdict` really does contradict its findings must still be named, so the honest case is not lost
   with the fabricated one. This discharges architecture-review Condition 1.
2. Verify the tests pass against the Task 6 implementation (they are a regression net, so GREEN is
   expected immediately; a RED here means Task 6 dropped a cause).
3. Implement: restore any cause the net proves was dropped.
4. Verify all assertions pass.
5. Commit with message: "test(build-review): pin every enumerated rejection cause"

**Files:**
- `src/conductor/test/engine/build-review-domain.test.ts` — per-cause assertions
- `src/conductor/src/engine/build-review-domain.ts` — restoration of any dropped cause

**Dependencies:** Task 6

### Task 8: Prove reference-scoped rejections cannot be diagnosed today
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests: for each reference-membership failure class — an `anchor.path` absent from
   the projection's changed paths, an `anchor.planTask` absent from its plan tasks, a completeness
   `missingSurface` not owned by the cited task, and a content-region hash absent from the
   projection — assert the diagnosis names the offending field specifically rather than returning
   the generic contract message.
2. Verify tests fail (RED) — the diagnosis receives no reference context, so none of these is
   reachable.
3. Implement: nothing yet; RED assertions only.
4. Verify each failure shows the generic message being returned.
5. Commit with message: "test(build-review): reference-scoped rejections must be nameable"

**Files:**
- `src/conductor/test/engine/build-review-domain.test.ts` — one assertion per membership class

**Dependencies:** Task 6

### Task 9: Bind the diagnosis to the projection's reference context
**Story:** 7
**Type:** happy-path

**Steps:**
1. Implement: widen `describeBuildReviewJudgedResultRejection` to accept the same
   finding-reference context the authoritative predicate receives, and change `validateRubricOutput`
   in `step-runners.ts` to pass the projection rather than only its lap and snapshot values. Add the
   per-class membership diagnoses the new context makes possible.
2. Verify Task 8's tests pass (GREEN).
3. Verify the existing guard that catches a throwing diagnosis is retained, so a diagnosis fault
   still cannot become a thrown provider error.
4. Commit with message: "fix(build-review): the rejection diagnosis sees what the check saw"

**Files:**
- `src/conductor/src/engine/build-review-domain.ts` — reference-context parameter and membership diagnoses
- `src/conductor/src/engine/step-runners.ts` — pass the projection to the diagnosis

**Dependencies:** Task 8

### Task 10: Distinguish absent, wrong-type and non-canonical anchor values
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests: an anchor field that is absent is reported as absent; one that is present
   but not a string is reported as a type failure; one that is a non-empty string failing its
   canonical grammar is reported as a form failure naming the required form; and an extremely long
   value is quoted in bounded form. Use free prose with no recoverable task id for the
   non-canonical case — the `Task N: <title>` form is Task 2's accepted case and must not reject
   here.
2. Verify tests fail (RED) — the current check tests presence only.
3. Implement: split the anchor field check into the three outcomes and bound the quoted value.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(build-review): name the anchor failure and the form it must take"

**Files:**
- `src/conductor/src/engine/build-review-domain.ts` — three-way anchor field diagnosis with bounded quoting
- `src/conductor/test/engine/build-review-domain.test.ts` — the four assertions

**Dependencies:** Task 9

### Task 11: A byte-identical repair settles without consuming step retries
**Story:** 11
**Type:** negative-path

**Steps:**
1. Write failing test: a rubric dispatch whose repair turn returns output byte-identical to the
   output it was asked to repair settles as an infrastructure failure immediately, and the step
   retry budget that exists today is not consumed. Replay the three recorded 2026-08-19 pairs.
   This concerns the existing step retry counter — the one that reported `retries exhausted` after
   three attempts — and not the mechanical allowance owned by
   `review-infrastructure-failures-are-operator-unreco`.
2. Verify test fails (RED).
3. Implement: in `dispatchBuildReviewRubric`, compare the repair turn's output to the exact output
   passed into it and settle without further retries when they are equal.
4. Verify test passes (GREEN).
5. Commit with message: "fix(build-review): an unactionable repair does not drain the retry budget"

**Files:**
- `src/conductor/src/engine/step-runners.ts` — byte-identical comparison in the repair loop
- `src/conductor/test/engine/step-runners.test.ts` — the replayed repair pairs

**Dependencies:** Task 9

### Task 12: A repair diagnosis always describes the payload it rejected
**Story:** 11
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a repair turn whose output differs but still fails validation settles
   carrying the **repaired** payload's own diagnosis, not the pre-repair one; (b) a repair
   invocation that returns no output at all preserves the existing failure path and records the
   initial diagnosis.
2. Verify tests fail or pass as the current code dictates (RED where behavior is wrong).
3. Implement: ensure the recorded detail is always derived from the last payload validated.
4. Verify tests pass (GREEN).
5. Commit with message: "test(build-review): the recorded diagnosis describes the payload rejected"

**Files:**
- `src/conductor/src/engine/step-runners.ts` — diagnosis selection in the repair loop
- `src/conductor/test/engine/step-runners.test.ts` — both assertions

**Dependencies:** Task 11

### Task 13: Prove the drift guard misses an unstated reference grammar
**Story:** 12
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture reproducing the #1696 shape — an engine-enforced reference grammar
   with no corresponding statement in the affected rubric contract — is not caught by
   `check_build_review_rubric_skill_vocabularies.sh` today.
2. Verify the fixture passes the guard when it should fail (RED).
3. Implement: nothing yet; fixture and assertion only.
4. Verify the guard exits zero on a fixture it should reject.
5. Commit with message: "test(harness): pin the unstated-grammar gap in the rubric drift guard"

**Files:**
- `test/check_build_review_rubric_skill_vocabularies.sh` — fixture wiring for the failing case

**Dependencies:** none

### Task 14: Extend the drift guard to reference grammars, both directions, fail-closed
**Story:** 12
**Type:** happy-path

**Steps:**
1. Implement: extract the engine's reference grammars alongside the closed vocabularies, compare
   each against the four rubric contracts, and fail naming the rubric, the field and the unstated
   grammar. Fail in the stale direction too, so a contract cannot state a grammar the engine no
   longer enforces. Fail closed with a diagnostic when the engine source is unreadable or a grammar
   block cannot be extracted, rather than passing on an empty comparison.
2. Verify Task 13's fixture is now rejected (GREEN).
3. Verify the guard is reached through the full integrity suite, not only when run directly.
4. Commit with message: "feat(harness): pin rubric reference grammars against contract drift"

**Files:**
- `test/check_build_review_rubric_skill_vocabularies.sh` — reference-grammar extraction and comparison

**Dependencies:** Task 13

### Task 15: Prove a findings-only payload is rejected today
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a provider payload of exactly `{"findings": []}` settles as a judged PASS
   whose `kind`, `rubric`, `contractVersion`, `lapId` and `snapshotDigest` equal the engine-held
   values. Add a second assertion for a payload carrying one well-formed finding and no envelope
   fields.
2. Verify tests fail (RED) — the current predicate requires all five envelope fields.
3. Implement: nothing yet; RED assertions only.
4. Verify the rejection is the identity/envelope requirement and not something else.
5. Commit with message: "test(build-review): a findings-only judged payload must settle"

**Files:**
- `src/conductor/test/engine/build-review-coordinator.test.ts` — both settlement assertions

**Dependencies:** Task 14

### Task 16: Narrow the wire parse and stamp the envelope on the dispatch path only
**Story:** 1
**Type:** happy-path

**Steps:**
1. Implement: extract `findings` from the provider candidate and construct the judged result from
   engine-held values — `kind` literal, `rubric` from the branch's registry descriptor, and
   `contractVersion` from `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION`. Lap and snapshot identity
   are Task 16.1's half of this seam.
2. **Binding constraint:** apply the stamp on the live dispatch path only. The at-rest parse used
   for stored branch artifacts and cache entries must keep honouring the version and identity each
   record declares. Do not place the stamp in code shared by both paths.
3. Follow the cache-hit branch's shape in `coordinateBuildReviewRubrics`: write the artifact with
   the current projection's identity regardless of what the result body carried, record provenance
   explicitly, and re-validate the written artifact before the branch settles. Locate it by
   searching that file for the cache-hit `writeArtifact` call and resolve those traits against HEAD.
4. Verify Task 15's tests pass (GREEN).
5. Commit with message: "feat(build-review): the engine stamps the judged-result envelope"

**Files:**
- `src/conductor/src/engine/build-review-coordinator.ts` — envelope stamp; identity checks removed
- `src/conductor/src/engine/step-runners.ts` — findings extraction on the dispatch path

**Dependencies:** Task 15

### Task 16.1: Bind lap and snapshot identity from the projection
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: a dispatched rubric whose provider payload omits `lapId` and
   `snapshotDigest` entirely settles as judged, carrying the projection's own lap and snapshot
   identity — the `reporting_app` 2026-08-16 shape. Add a second assertion that two rubrics
   dispatched concurrently on one lap both persist that lap's identity.
2. Verify tests fail (RED) — the identity equality checks reject the omitted-identity payload.
3. Implement: stamp `lapId` and `snapshotDigest` from the projection and remove the two identity
   equality checks from `validateBuildReviewDispatchedResult`. Follow the cache-hit branch's shape
   in `coordinateBuildReviewRubrics`: write the artifact with the current projection's identity
   regardless of what the result body carried, record provenance explicitly, and re-validate the
   written artifact before the branch settles. Locate it by searching that file for the cache-hit
   `writeArtifact` call and resolve those traits against HEAD.
4. Verify tests pass (GREEN), and verify no code path compares a provider-supplied `lapId` or
   `snapshotDigest` against a projection value.
5. Commit with message: "feat(build-review): stamp lap and snapshot identity from the projection"

**Files:**
- `src/conductor/src/engine/build-review-coordinator.ts` — identity stamp; equality checks removed
- `src/conductor/test/engine/build-review-coordinator.test.ts` — omitted-identity and concurrency assertions

**Dependencies:** Task 16

### Task 17: Drifted provider envelopes settle as judged
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests, one per recorded drift shape: a payload using `status` as the discriminator;
   one using `type`; one omitting `lapId` and `snapshotDigest` entirely; one naming a different
   rubric; one declaring `contractVersion: "v1"`; and one carrying extra unrecognized top-level
   keys. Each must settle as judged under the engine's own envelope, with the v1 case parsed under
   v3 anchor rules.
2. Verify tests fail where the pre-change code rejected them (RED).
3. Implement: discard every top-level key other than `findings` at the wire boundary.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(build-review): provider envelope fields are ignored, never validated"

**Files:**
- `src/conductor/src/engine/step-runners.ts` — discard non-`findings` top-level keys
- `src/conductor/test/engine/build-review-coordinator.test.ts` — one assertion per drift shape

**Dependencies:** Task 16

### Task 18: A malformed finding still rejects the whole result, and the reason vocabulary is unchanged
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: a payload with no parseable JSON object settles as an infrastructure failure
   whose **diagnostic detail** states that no JSON object was found; a `findings` value that is not
   an array is rejected naming `findings` and the array form; and one malformed finding among
   several well-formed ones rejects the whole result naming the offending index — no partial
   acceptance and no fabricated empty findings array.
2. Verify tests fail (RED) where behavior differs.
3. Implement: carry the failed requirement in the diagnostic detail. **Add no member to the closed
   `BuildReviewInfrastructureFailureReason` union** — that mapping belongs to
   `review-infrastructure-failures-are-operator-unreco`. Read the union's current shape at HEAD
   rather than trusting this plan's description of it.
4. Verify tests pass (GREEN), and assert the union's member count is unchanged.
5. Commit with message: "fix(build-review): the failed requirement travels in the diagnostic detail"

**Files:**
- `src/conductor/src/engine/step-runners.ts` — detail carrying the failed requirement
- `src/conductor/test/engine/build-review-coordinator.test.ts` — the three assertions plus the union pin

**Dependencies:** Task 17

### Task 19: The engine asserts its own rubric invariant at settlement
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: a branch whose projection's rubric does not equal the branch's own rubric
   settles as an infrastructure failure naming the invariant violation and writes no artifact under
   either rubric; and four rubrics dispatched concurrently each write their own artifact with no
   cross-contamination.
2. Verify tests fail (RED).
3. Implement: assert the branch rubric equals the projection rubric at settlement in
   `coordinateBuildReviewRubrics`. Both operands are engine-held; this is never a validation of
   provider output. Follow the cache-hit branch's settlement shape so the failure resolves the same
   way other infrastructure branches do.
4. Verify tests pass (GREEN), and confirm the happy path adds no event or diagnostic.
5. Commit with message: "feat(build-review): assert the branch rubric invariant at settlement"

**Files:**
- `src/conductor/src/engine/build-review-coordinator.ts` — the settlement invariant
- `src/conductor/test/engine/build-review-coordinator.test.ts` — mismatch and concurrency assertions

**Dependencies:** Task 16

### Task 20: The contract version holds at v3 and stored records are untouched
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: a rubric cache entry written before this change is served as a hit with no
   fresh dispatch; a persisted `v1` and a persisted `v2` record each parse at rest under the version
   they declare; a settled branch persists a full envelope carrying `contractVersion: "v3"`; and
   cache identity is unchanged, with `lapId` and `snapshotDigest` still excluded from the projection
   digest.
2. Verify tests fail where the stamp leaked into the at-rest path (RED), which is the failure this
   task exists to prevent.
3. Implement: confirm `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION` is unchanged and that no stamp
   is applied in code shared with the at-rest parse. Move the stamp if the test proves it leaked.
4. Verify tests pass (GREEN).
5. Commit with message: "test(build-review): the envelope stamp never reaches the at-rest parse"

**Files:**
- `src/conductor/test/engine/build-review-cache.test.ts` — cache-hit and identity assertions
- `src/conductor/test/engine/build-review-artifacts.test.ts` — at-rest v1/v2 parse assertions
- `src/conductor/src/engine/build-review-coordinator.ts` — stamp placement correction if required

**Dependencies:** Task 16

### Task 21: The rubric contracts and the rendered template state the grammars and drop the echo
**Story:** 10
**Type:** happy-path

**Steps:**
1. Implement: update all four `skills/build-review-*/SKILL.md` result contracts so every anchor
   field the parser holds to a canonical grammar states that grammar, and so the declared payload is
   `findings`. Update `renderBuildReviewJudgedResultShape` to render a findings-only template with
   no `lapId` or `snapshotDigest` placeholder, and remove the echo instruction from both the
   dispatch prompt and the repair prompt.
2. Verify the Task 14 drift guard passes against the updated contracts (GREEN), and that it would
   fail if one contract were left stating the old shape.
3. Verify no assembled prompt contains an echo instruction.
4. Commit with message: "feat(build-review): rubric contracts declare a findings-only payload"

**Files:**
- `skills/build-review-tautology/SKILL.md` — findings-only payload and stated grammars
- `skills/build-review-scope/SKILL.md` — findings-only payload and stated grammars
- `skills/build-review-root-cause/SKILL.md` — findings-only payload and stated grammars
- `skills/build-review-completeness/SKILL.md` — findings-only payload and stated grammars
- `src/conductor/src/engine/build-review-domain.ts` — findings-only rendered template
- `src/conductor/src/engine/step-runners.ts` — echo instruction removed from both prompts
- `src/conductor/test/engine/build-review-prompt.test.ts` — no-echo assertions

**Dependencies:** Task 14, Task 18

## Task Dependency Graph

```
Seam B (plan-task normalization)
  1 ──▶ 2 ──┬──▶ 3
            └──▶ 4

Seam A (diagnosis integrity)
  5 ──▶ 6 ──┬──▶ 7
            └──▶ 8 ──▶ 9 ──┬──▶ 10
                           └──▶ 11 ──▶ 12

Seam D (drift guard)
  13 ──▶ 14

Seam C (engine-stamped envelope) — gated on 14 per architecture-review Condition 2
  14 ──▶ 15 ──▶ 16 ──┬──▶ 16.1
                     ├──▶ 17 ──▶ 18 ──┐
                     ├──▶ 19          ├──▶ 21
                     └──▶ 20          │
  14 ─────────────────────────────────┘
```

Seams B, A and D are mutually independent and may proceed in parallel. Seam C depends on Seam D
only, through Task 14.

## Integration Points

- **After Task 4** — the plan-task reference normalizer is complete and can be exercised end to end
  against a real projection.
- **After Task 12** — the diagnosis path is honest and bound to the projection; a rejected rubric
  now produces a repair instruction that can act on the actual failure.
- **After Task 14** — the drift guard is in force, so Seam C's contract rewrites are protected.
- **After Task 16.1** — the fresh-dispatch path binds identity exactly as the cache-hit path does.
- **After Task 21** — the full boundary is in place: a findings-only payload settles, a rejection
  names what failed, and the contracts state what the parser enforces.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No task names another feature's sealed artifact
- [ ] The `contractVersion` stamp is absent from the at-rest parse (Task 20 proves it)
- [ ] The closed infrastructure-reason vocabulary is unchanged (Task 18 pins it)
### Task rem-tautology-1: src/conductor/test/engine/build-review-rubric-skills.test.ts:70 — replace the heading-only assertion with assertions that pin the Tautology findings-only provider payload and engine-owned judged-envelope wording at skills/build-review-tautology/SKILL.md:74
### Task rem-tautology-2: src/conductor/test/engine/build-review-rubric-skills.test.ts:113 — replace the heading-only assertion with assertions that pin the Scope findings-only provider payload and engine-owned judged-envelope wording at skills/build-review-scope/SKILL.md:46
### Task rem-tautology-3: src/conductor/test/engine/build-review-rubric-skills.test.ts:146 — replace the heading-only assertion with assertions that pin the Root Cause findings-only provider payload and engine-owned judged-envelope wording at skills/build-review-root-cause/SKILL.md:40
### Task rem-tautology-4: src/conductor/test/engine/build-review-rubric-skills.test.ts:178 — replace the heading-only assertion with assertions that pin the Completeness findings-only provider payload and engine-owned judged-envelope wording at skills/build-review-completeness/SKILL.md:93
### Task rem-root-cause-1: src/conductor/src/engine/build-review-coordinator.ts:177 and src/conductor/src/engine/step-runners.ts:2028 — expose and reuse one engine-stamped v3 dispatch candidate for both authoritative validation and describeBuildReviewJudgedResultRejection, retaining the projection reference context instead of diagnosing the raw provider envelope
### Task rem-root-cause-2: src/conductor/test/engine/build-review-domain.test.ts:1 — extend the Task 9 diagnosis regressions to prove findings-only inputs do not fabricate missing kind, rubric, version, lap, or snapshot causes and that content-region failures are interpreted under v3 grammar
### Task rem-root-cause-3: test/check_build_review_rubric_skill_vocabularies.sh:29 — extend the Task 13 fixture so a parser-only reference-field or grammar change at src/conductor/src/engine/build-review-domain.ts:292 is rejected even when BUILD_REVIEW_FINDING_REFERENCE_BINDINGS and the skill contract remain unchanged
### Task rem-root-cause-4: test/check_build_review_rubric_skill_vocabularies.sh:81 — derive the guarded reference fields and grammars from parser-enforced source, compare them with all four skill contracts in both directions, and fail closed on unreadable or incomplete extraction instead of treating BUILD_REVIEW_FINDING_REFERENCE_BINDINGS as authoritative
### Task rem-completeness-1: src/conductor/test/engine/build-review-artifacts.test.ts:30 — add persisted v1 and v2 fixtures and assert each at-rest record parses under the contract version it declares
### Task rem-completeness-2: src/conductor/test/engine/build-review-cache.test.ts:1 — add a pre-change cache-entry hit assertion with no fresh dispatch and pin that lapId and snapshotDigest remain excluded from the projection digest
### Task rem-completeness-3: src/conductor/test/engine/build-review-coordinator.test.ts:640 — assert a live dispatched branch persists the complete engine-stamped envelope with contractVersion v3, guarding the Task 16/20 live-only stamp boundary
### Task rem-scope-2: src/conductor/test/engine/step-runners-copy-equivalence.test.ts:133 — retain the existing byte-identical-repair diagnostic assertion as an explicit repair-context widening required by src/conductor/src/engine/step-runners.ts:2004-2007; make no source edit, verify the focused test passes, and record commit 673756a7a as the satisfying evidence
