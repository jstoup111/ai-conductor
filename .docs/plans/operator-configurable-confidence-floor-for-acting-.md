# Implementation Plan: Operator-configurable confidence floor for acting on build_review findings

**Date:** 2026-09-06
**Stories:** .docs/stories/operator-configurable-confidence-floor-for-acting-.md
**Conflict check:** Clean as of 2026-09-06

## Summary

Adds grader-reported confidence to build_review findings, an operator floor that suppresses sub-floor
findings before the gate fails, durable suppression history for the judge, and a mechanical
settled-recurrence predicate that skips the remediate dispatch for exact-id recurrence of a finalized
finding. 16 tasks.

## Technical Approach

Three mechanisms, each stopping a different spend, sequenced so each lands on settled types.

- **Contract (Tasks 1-4).** `BuildReviewFinding` gains optional integer `confidence`, range-checked
  in the existing `finding()` parser so an out-of-range value is malformed like any other bad field.
  The identity input in `build-review-finding-identity.ts` is deliberately untouched — a test pins
  that two findings differing only in confidence share an id. The contract stays `v3`: absent means
  blocking, so nothing old is mis-read, and no operator disposition is invalidated. The skill text
  states the field; its digest change discards cached results on its own.
- **Configuration (Tasks 5-6).** Per-rubric `min_confidence` joins the rubric policy key set and
  validator, following the bounded-integer shape `build_review.maxParallel` already uses in
  `config.ts`, and resolves into `ResolvedBuildReviewRubricPolicy`. A registry consumer declaration
  lands in the same change.
- **Suppression (Tasks 7-11).** `deriveEffectiveBuildReviewVerdict` gains a `suppressed` bucket
  beside `accepted` and `unresolved`; the verdict formula is unchanged, so a fully-suppressed lap is
  an effective PASS the conductor never routes into adjudication. On a mixed lap the coordinator is
  handed the suppressed ids and excludes them from sources, the way it already excludes
  operator-resolved ids — but as a separate input, never written to the disposition store.
  `build_review_outer_verdict` gains an additive `suppressedFindings` list; it currently does not
  render, so a daemon-log line is added for the non-empty case only.
- **Persistence (Tasks 12-13).** The case store gains a suppression-entry list keyed by finding id,
  written under the existing lease and never pruned. The adjudication context carries the entries
  in a history section distinct from current sources, so the source-complete validator demands no
  outcome for them.
- **Settlement (Tasks 14-16).** After the second operator-resolution read and before
  `dispatchSources` is frozen, the coordinator removes every live source whose exact id links to a
  finalized non-action case. Empty live set finalizes from durable state and emits
  `remediation_adjudication_completed` with the settled case ids; otherwise the dispatch proceeds
  with the reduced set. The predicate reads the store and never writes it.

Local pattern for Tasks 7 and 9: the operator-accepted path is the exemplar — a set of finding ids
computed once, threaded to the coordinator as an input, never re-derived from artifacts. Preserve
those traits for the suppressed set; the allowed variation is that suppression is engine authority
and must stay in its own set. Search hints: `acceptedFindingIds`, `operatorResolvedFindingIds`,
`allOperatorResolved`.

The operator has an open intake (#2388) for per-rubric run scheduling under the same
`build_review.rubrics.<id>.*` block; keep this key's shape consistent with its siblings.

## Prerequisites

- None. No migration, backfill, external account, or new dependency.

## Tasks

### Task 1: Parse an optional integer confidence on each finding
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the finding parser accepts confidence 0, 72 and 100 and returns each unchanged, accepts an absent confidence recording none, and treats 101, -1, 72.5 and a string as a malformed result.
2. Verify tests fail (RED).
3. Add optional integer confidence to the finding type and range-check it in the parser, reusing the existing invalid-field path for rejection.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): parse optional grader confidence on build_review findings".

**Done when:**
- The finding parser accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed finding.
- The finding parser accepts a finding with no confidence and records none.
- The finding parser treats 101, -1, 72.5, and a string confidence as a malformed result through the existing invalid-field path.
- No engine code path assigns, defaults, or adjusts a confidence value.

**Files likely touched:**
- `src/conductor/src/engine/build-review-domain.ts` — finding type and parser
- `src/conductor/test/engine/build-review-domain.test.ts` — accept and reject cases

**Dependencies:** none

### Task 2: Keep confidence out of the finding identity
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests asserting two findings differing only in confidence share an id, a finding with and without confidence share an id, the canonical payload carries no confidence, a one-character anchor change yields a different id, and an operator disposition still binds after re-grading at a different confidence.
2. Verify tests fail (RED).
3. Confirm the identity input and canonical payload are unchanged; adjust only if the retype leaked.
4. Verify tests pass (GREEN).
5. Commit with message: "test(engine): confidence never enters build_review finding identity".

**Done when:**
- Two findings differing only in confidence share one identity id.
- The canonical identity payload contains no confidence field.
- A one-character anchor change yields a different id regardless of confidence.
- An operator disposition recorded against a finding continues to bind after the finding is re-graded at a different confidence.

**Files likely touched:**
- `src/conductor/test/engine/build-review-finding-identity.test.ts` — identity invariance
- `src/conductor/test/engine/build-review-effective.test.ts` — disposition rebinding

**Dependencies:** 1

### Task 3: State the confidence field in the grader contract
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting a result shaped exactly as the skill text's JSON example, including confidence, parses.
2. Verify test fails (RED).
3. Add the optional integer confidence field to the v3 result contract JSON and its bullet list, stating its meaning and that omitting it leaves the finding blocking.
4. Verify test passes (GREEN).
5. Commit with message: "skill(build-review-test-quality): request grader confidence per finding".

**Done when:**
- The rubric result contract in the grader's skill text states the optional integer field and its meaning.
- A result matching the skill text's JSON example parses with its confidence retained.

**Files likely touched:**
- `skills/build-review-test-quality/SKILL.md` — result contract
- `src/conductor/test/engine/build-review-domain.test.ts` — contract example parses

**Dependencies:** 1

### Task 4: Prove a pre-contract cached result is discarded on skill change
**Story:** 1
**Type:** verification

**Steps:**
1. Write a test asserting a cached rubric result keyed to the old skill digest is discarded with reason skill-digest-mismatch once the skill text changes.
2. Verify it passes against existing cache behavior.
3. No implementation change expected.
4. Record the verification.
5. Commit with an empty commit carrying the task trailer and an evidence trailer.

**Done when:**
- A cached rubric result produced under the previous skill digest is discarded on skill-digest mismatch and the grader re-runs.

**Files likely touched:**
- `src/conductor/test/engine/build-review-cache.test.ts` — digest mismatch case

**Verify-only:** yes

**Dependencies:** 3

### Task 5: Validate the per-rubric min_confidence key
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the key is accepted at 0, 70 and 100, resolves to 0 when absent, fails load naming its exact path and range for 101, -5, 70.5 and the string 70, and that a misspelled sibling fails with the existing unknown-key error.
2. Verify tests fail (RED).
3. Add the key to the rubric policy key set and validator as a bounded integer, following the maxParallel shape, and carry it into the resolved rubric policy with default 0.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(config): add build_review.rubrics.<id>.min_confidence".

**Done when:**
- The key is accepted at 0, 70 and 100 and the resolved rubric policy carries the configured integer.
- Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value.
- A misspelled sibling key still fails with the existing unknown-key error naming the rubric policy block.
- An absent key resolves to a floor of 0.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — key set entry and validator
- `src/conductor/src/engine/resolved-config.ts` — resolved policy field and default
- `src/conductor/test/engine/config.test.ts` — accept and reject cases

**Dependencies:** none

### Task 6: Declare the key's production consumer in the config-key registry
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Run the registry totality test and observe it fail for the new key.
2. Verify failure (RED).
3. Declare the key's consumer beside the existing rubric policy entries.
4. Verify the totality test passes (GREEN).
5. Commit with message: "chore(config): declare min_confidence consumer".

**Done when:**
- The key declares a resolvable production consumer in the config-key consumer registry.
- The registry totality test passes.

**Files likely touched:**
- `src/conductor/test/engine/config-consumer-registry.ts` — consumer declaration

**Dependencies:** 5

### Task 7: Add the suppressed bucket to the effective verdict reducer
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests asserting that with a floor of 70 a finding at 40 lands in a suppressed set and the verdict is PASS, findings at 70 and 95 are unresolved, a finding at 1 with no floor is unresolved, a finding with no confidence is unresolved, a mixed lap suppresses only the 40, and an uncovered infrastructure failure still fails the verdict.
2. Verify tests fail (RED).
3. Read the per-rubric floor into the reducer and add a suppressed bucket beside accepted and unresolved, leaving the verdict formula unchanged. Follow the accepted-set pattern: one set, computed once, threaded as an input.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): suppress sub-floor build_review findings at the effective verdict".

**Done when:**
- The effective verdict reducer produces a suppressed set distinct from the accepted and unresolved sets, and only the unresolved set blocks.
- A finding below its rubric's floor is suppressed; at or above it, or with no confidence, it is unresolved.
- A lap mixing a sub-floor and an above-floor finding suppresses only the sub-floor one and fails on the other.
- An uncovered infrastructure failure still fails the effective verdict when every content finding is suppressed.

**Files likely touched:**
- `src/conductor/src/engine/build-review-aggregate.ts` — suppressed bucket
- `src/conductor/src/engine/build-review-effective.ts` — floor input
- `src/conductor/test/engine/build-review-effective.test.ts` — bucket cases

**Dependencies:** 1, 5

### Task 8: Pass a fully suppressed lap through the conductor gate
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing integration test asserting a lap whose every finding is suppressed records build_review done with no remediate dispatch and no kickback charged.
2. Verify test fails (RED).
3. Thread the resolved floor into the conductor's effective-verdict call so the existing PASS branch is reached.
4. Verify test passes (GREEN).
5. Commit with message: "feat(conductor): a fully suppressed build_review lap passes without adjudication".

**Done when:**
- A lap whose every finding is suppressed passes the build_review gate with no remediate dispatch and no kickback charged.
- The conductor never enters the adjudication branch for that lap.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — floor threaded into the effective-verdict call
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — fully suppressed lap

**Dependencies:** 7

### Task 9: Exclude suppressed findings from adjudication sources
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a mixed lap dispatches the judge with only the unresolved finding as a current source, and that the operator disposition store is byte-identical before and after the lap.
2. Verify tests fail (RED).
3. Pass the suppressed ids to the coordinator as their own input and subtract them from sources alongside, but separately from, operator-resolved ids. Search hints: operatorResolvedFindingIds, allOperatorResolved.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): keep suppressed findings out of adjudication sources".

**Done when:**
- On a mixed lap the adjudication sources exclude suppressed findings.
- The operator disposition store is unchanged by a suppressed lap.
- Suppressed ids reach the coordinator as an input distinct from operator-resolved ids.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — suppressed input
- `src/conductor/src/engine/conductor.ts` — pass suppressed ids
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — source exclusion and disposition store invariance

**Dependencies:** 7

### Task 10: Record suppressed findings on the outer verdict event
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the outer verdict event carries a suppressed-findings list with id, rubric, confidence and floor, two suppressions yield two entries, an empty lap yields none, no kickback event is attributable to a suppression, and the entries are stamped at derivation time.
2. Verify tests fail (RED).
3. Add an additive optional suppressedFindings field to the existing outer verdict member and populate it at the existing emit site.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): record suppressed findings on build_review_outer_verdict".

**Done when:**
- The outer verdict event carries an additive suppressed-findings list with finding id, rubric, confidence, and floor for every suppressed finding.
- A lap that suppresses nothing carries an absent or empty list.
- A suppression is never emitted or rendered as a kickback event.
- Entries are stamped when the effective verdict is derived, not reconstructed from stored state.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — additive field
- `src/conductor/src/engine/conductor.ts` — populate at emit
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — event assertions

**Dependencies:** 7

### Task 11: Render suppressed findings in the daemon log
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the daemon log projection emits one line per suppressed finding naming the finding, its confidence and the floor, and emits nothing for an outer verdict with no suppressions.
2. Verify test fails (RED).
3. Add a render projection for the outer verdict member that fires only when the suppressed list is non-empty, leaving the member's other rendering unchanged.
4. Verify test passes (GREEN).
5. Commit with message: "feat(daemon-log): render suppressed build_review findings".

**Done when:**
- The daemon log projection of that event renders one line per suppressed finding.
- An outer verdict with no suppressions renders no suppression line.

**Files likely touched:**
- `src/conductor/src/engine/event-sinks.ts` — render declaration
- `src/conductor/src/ui/dashboard-text.ts` — projection
- `src/conductor/test/engine/event-sinks.test.ts` — render case

**Dependencies:** 10

### Task 12: Persist suppression entries in the case store
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests asserting a suppressed finding leaves a store entry keyed by its id with rubric, summary, confidence, floor and last-seen lap; recurrence updates the entry in place; entries survive laps where the finding is absent and survive resolution of a related case; and no entry appears in the operator disposition store.
2. Verify tests fail (RED).
3. Add an optional suppression-entry list to the store state, parsed as empty when absent, and never pruned.
   - Write the entries through ONE seam, `persistBuildReviewSuppressions` in `build-review-suppression-history.ts`, invoked from the effective-verdict resolution path so it runs on every lap that suppressed anything — effective PASS as well as effective FAIL. The coordinator is NOT the sole writer: a fully suppressed lap is an effective PASS that never enters post-join judgement (ADR D4.4), so a coordinator-only write loses exactly the laps D4.6 governs.
   - Make the coordinator reuse that same seam under the existing lease instead of carrying its own write, so there is one writer and one store; the upsert is keyed by finding id, so running the seam and then the coordinator over one lap leaves exactly one row.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): persist suppressed build_review findings in the case store".

**Done when:**
- The case store persists one suppression entry per suppressed finding id, updated in place on recurrence and never pruned.
- A fully suppressed effective-PASS lap persists its entries even though it dispatches no remediate and never reaches the coordinator.
- The seam and the coordinator together leave exactly one row per finding id, with no duplicate from the second write.
- Resolved cases and suppression entries remain in the store across laps.
- A suppression entry never appears in the operator disposition store.
- An existing store with no suppression list parses with an empty list and STORE_VERSION stays at v1.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-store.ts` — suppression entries
- `src/conductor/src/engine/build-review-suppression-history.ts` — the single persistence seam
- `src/conductor/src/engine/step-runners.ts` — seam invoked before the pass/fail fork
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — reuses the seam under the existing lease
- `src/conductor/test/engine/build-review-suppression-history.test.ts` — projection and idempotent upsert
- `src/conductor/test/engine/step-runners.test.ts` — fully suppressed lap persistence
- `src/conductor/test/engine/remediation-case-store.test.ts` — persistence cases

**Dependencies:** 9

### Task 13: Carry suppression history into the adjudication context
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests asserting the context carries suppression entries in a history section distinct from current sources, and that a case-v1 result giving those entries no outcome still validates.
2. Verify tests fail (RED).
3. Add the history section to the context assembler and confirm the source-complete validator reads only current sources.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): show suppressed history to the build_review judge".

**Done when:**
- The adjudication context carries suppression entries in a history section distinct from current sources.
- A judgement that assigns no outcome to a suppression entry still validates.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-context.ts` — history section
- `src/conductor/test/engine/build-review-adjudication-context.test.ts` — section shape
- `src/conductor/test/engine/remediation-case-validator.test.ts` — no outcome demanded

**Dependencies:** 12

### Task 14: Skip the judge for exact-id recurrence of a finalized finding
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests asserting that a finding whose exact id links to an applied deferral case, a rejected case, or a merged source on a finalized case is removed from the live set; an empty live set finalizes without dispatch; and a lap with one settled and one new finding dispatches with the new finding only.
2. Verify tests fail (RED).
3. After the second operator-resolution read and before dispatchSources is frozen, read the store and remove live sources that bind by exact id to a finalized non-action case; finalize from durable state when the set empties.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): settle exact-id recurrence of finalized build_review findings without dispatch".

**Done when:**
- A finding whose exact id links to a finalized deferred, rejected, or merged case is removed from the live source set before dispatch.
- A lap whose live set is empty after settlement finalizes from durable state without dispatching the judge.
- A lap with one settled and one new finding dispatches the judge with the new finding as its only current source.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — settlement predicate
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — settlement cases

**Dependencies:** 9

### Task 15: Keep unsettled findings live
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a one-character anchor change, a reserved deferral effect, and an open unattempted action case each leave the finding live and take today's route; that the predicate performs no store write; and that an unreadable store still fails closed.
2. Verify tests fail (RED).
3. Constrain the predicate to exact ids and finalized non-action cases, and keep it read-only.
4. Verify tests pass (GREEN).
5. Commit with message: "test(engine): settlement admits only exact-id finalized findings".

**Done when:**
- A drifted id, a reserved or failed effect, and an open action case each leave the finding live.
- The predicate performs no write to the case store.
- An unreadable case store fails the lap closed exactly as before.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — predicate bounds
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — negative cases

**Dependencies:** 14

### Task 16: Record a skipped dispatch
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests asserting a skipped dispatch emits the completed-adjudication event with the settled case ids and an empty effect list, emits no started event, leaves the kickback ledger unchanged, renders each settled case in the trace, and shows a completed line in the daemon log.
2. Verify tests fail (RED).
3. Emit the existing completed event from the finalize-without-dispatch path.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): record skipped build_review adjudication dispatches".

**Done when:**
- A skipped dispatch emits the completed-adjudication event with settled case ids and an empty effect list.
- No started event is emitted for a skipped dispatch.
- The kickback ledger is unchanged by a skipped dispatch.
- The rendered trace lists each settled case with its finalized outcome, and the daemon log shows a completed adjudication line.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — emit on skip
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — event and ledger assertions

**Dependencies:** 14

## Task Dependency Graph

```text
1 ──┬── 2
    ├── 3 ── 4
    └──┐
5 ── 6 │
1,5 ── 7 ──┬── 8
           ├── 9 ──┬── 12 ── 13
           │       └── 14 ──┬── 15
           │                └── 16
           └── 10 ── 11
```

## Integration Points

- After Task 8: a fully suppressed lap observably passes the conductor's build_review gate — the
  cross-boundary integration proof for suppression.
- After Task 13: the judge observably receives suppression history.
- After Task 16: a settled recurrence observably finalizes without a provider session and is
  recorded on the spine — the integration proof for settlement.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a rubric result whose finding carries `"confidence": 72`, when the engine parses the result, then the finding is accepted and its confidence is retained as the integer 72. | 1 | The finding parser accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed finding. | diff-local |
| Story 1 happy: Given a rubric result whose finding carries `"confidence": 0`, when the engine parses the result, then the finding is accepted, because 0 is a valid confidence and not an absent value. | 1 | The finding parser accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed finding. | diff-local |
| Story 1 happy: Given a rubric result whose finding carries `"confidence": 100`, when the engine parses the result, then the finding is accepted. | 1 | The finding parser accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed finding. | diff-local |
| Story 1 happy: Given a rubric result whose finding omits `confidence`, when the engine parses the result, then the finding is accepted with no confidence recorded, because the field is optional. | 1 | The finding parser accepts a finding with no confidence and records none. | diff-local |
| Story 1 negative: Given a finding carrying `"confidence": 101`, when the engine parses the result, then the whole rubric result is malformed and is handled exactly as a result with any other invalid finding field. | 1 | The finding parser treats 101, -1, 72.5, and a string confidence as a malformed result through the existing invalid-field path. | diff-local |
| Story 1 negative: Given a finding carrying `"confidence": -1`, when the engine parses the result, then the whole rubric result is malformed. | 1 | The finding parser treats 101, -1, 72.5, and a string confidence as a malformed result through the existing invalid-field path. | diff-local |
| Story 1 negative: Given a finding carrying `"confidence": 72.5`, when the engine parses the result, then the whole rubric result is malformed, because confidence must be an integer. | 1 | The finding parser treats 101, -1, 72.5, and a string confidence as a malformed result through the existing invalid-field path. | diff-local |
| Story 1 negative: Given a finding carrying `"confidence": "high"`, when the engine parses the result, then the whole rubric result is malformed, because a string is not accepted. | 1 | The finding parser treats 101, -1, 72.5, and a string confidence as a malformed result through the existing invalid-field path. | diff-local |
| Story 1 negative: Given a cached rubric result produced before the contract stated confidence, when the skill text has since changed, then the cached result is discarded on skill-digest mismatch and the grader re-runs under the current contract. | 4 | A cached rubric result produced under the previous skill digest is discarded on skill-digest mismatch and the grader re-runs. | diff-local |
| Story 2 happy: Given two findings identical in rubric, contract version, concern kind and anchor but carrying confidence 30 and 90, when their identities are computed, then both produce the same finding id. | 2 | Two findings differing only in confidence share one identity id. | diff-local |
| Story 2 happy: Given a finding with confidence 30 and the same finding with no confidence, when their identities are computed, then both produce the same finding id. | 2 | Two findings differing only in confidence share one identity id. | diff-local |
| Story 2 negative: Given an operator disposition accepting a finding graded at confidence 90, when the next lap re-grades the same finding at confidence 40, then the disposition still binds and the finding is recorded as accepted. | 2 | An operator disposition recorded against a finding continues to bind after the finding is re-graded at a different confidence. | diff-local |
| Story 2 negative: Given the canonical identity payload for a finding, when it is inspected, then it contains no confidence field. | 2 | The canonical identity payload contains no confidence field. | diff-local |
| Story 2 negative: Given a finding whose anchor differs by one character from an accepted finding, when its identity is computed, then it produces a different id regardless of confidence, because confidence neither adds to nor substitutes for the anchor. | 2 | A one-character anchor change yields a different id regardless of confidence. | diff-local |
| Story 3 happy: Given `build_review.rubrics.testQuality.min_confidence` is 70 and a lap's only finding carries confidence 40, when the effective verdict is derived, then the finding is placed in the suppressed set, the unresolved set is empty, and the effective verdict is PASS. | 7 | A finding below its rubric's floor is suppressed; at or above it, or with no confidence, it is unresolved. | diff-local |
| Story 3 happy: Given the floor is 70 and a finding carries confidence 70, when the effective verdict is derived, then the finding is unresolved, because the floor is a minimum and not an exclusive bound. | 7 | A finding below its rubric's floor is suppressed; at or above it, or with no confidence, it is unresolved. | diff-local |
| Story 3 happy: Given the floor is 70 and a finding carries confidence 95, when the effective verdict is derived, then the finding is unresolved and the effective verdict is FAIL, as today. | 7 | A finding below its rubric's floor is suppressed; at or above it, or with no confidence, it is unresolved. | diff-local |
| Story 3 happy: Given the floor is unset and a finding carries confidence 1, when the effective verdict is derived, then the finding is unresolved, because the default floor of 0 never suppresses. | 7 | A finding below its rubric's floor is suppressed; at or above it, or with no confidence, it is unresolved. | diff-local |
| Story 3 happy: Given the floor is 70 and a lap has findings at confidence 40 and 90, when the effective verdict is derived, then only the 40 is suppressed and the verdict is FAIL on the 90. | 7 | A lap mixing a sub-floor and an above-floor finding suppresses only the sub-floor one and fails on the other. | diff-local |
| Story 3 negative: Given the floor is 70 and a finding omits confidence, when the effective verdict is derived, then the finding is unresolved, because an absent confidence is never suppressed. | 7 | A finding below its rubric's floor is suppressed; at or above it, or with no confidence, it is unresolved. | diff-local |
| Story 3 negative: Given a lap whose every finding is suppressed, when the conductor evaluates the build_review gate, then it records the step done without dispatching remediate and without charging a kickback. | 8 | A lap whose every finding is suppressed passes the build_review gate with no remediate dispatch and no kickback charged. | diff-local |
| Story 3 negative: Given a lap with one suppressed and one unresolved finding, when adjudication runs, then the judge's current sources contain only the unresolved finding. | 9 | On a mixed lap the adjudication sources exclude suppressed findings. | diff-local |
| Story 3 negative: Given a suppressed finding, when the operator disposition store is read after the lap, then it is byte-identical to its state before the lap, because suppression never becomes operator authority. | 9 | The operator disposition store is unchanged by a suppressed lap. | diff-local |
| Story 3 negative: Given a rubric with an uncovered infrastructure failure alongside a suppressed finding, when the effective verdict is derived, then the verdict is still FAIL on the infrastructure failure, because suppression clears content only. | 7 | An uncovered infrastructure failure still fails the effective verdict when every content finding is suppressed. | diff-local |
| Story 4 happy: Given a finding is suppressed on a lap, when the lap's outer verdict event is read, then it carries a suppressed-findings list naming the finding id, its rubric, its reported confidence, and the floor applied. | 10 | The outer verdict event carries an additive suppressed-findings list with finding id, rubric, confidence, and floor for every suppressed finding. | diff-local |
| Story 4 happy: Given two findings are suppressed on a lap, when the outer verdict event is read, then both appear as separate entries. | 10 | The outer verdict event carries an additive suppressed-findings list with finding id, rubric, confidence, and floor for every suppressed finding. | diff-local |
| Story 4 happy: Given a finding is suppressed, when the daemon log for the lap is read, then a line names the suppressed finding and its confidence against the floor. | 11 | The daemon log projection of that event renders one line per suppressed finding. | diff-local |
| Story 4 negative: Given a lap that suppresses nothing, when the outer verdict event is read, then its suppressed-findings list is absent or empty. | 10 | A lap that suppresses nothing carries an absent or empty list. | diff-local |
| Story 4 negative: Given a finding is suppressed, when the event stream is read, then no kickback event is attributable to it. | 10 | A suppression is never emitted or rendered as a kickback event. | diff-local |
| Story 4 negative: Given a suppressed finding, when its record is inspected, then it was stamped when the effective verdict was derived rather than reconstructed later from stored state. | 10 | Entries are stamped when the effective verdict is derived, not reconstructed from stored state. | diff-local |
| Story 5 happy: Given a finding is suppressed on lap one, when the case store is read after the lap, then it holds a suppression entry keyed by the finding's id carrying its rubric, summary, confidence, floor, and the lap last seen. | 12 | The case store persists one suppression entry per suppressed finding id, updated in place on recurrence and never pruned. | diff-local |
| Story 5 happy: Given a suppression entry exists and a later lap dispatches the judge, when the adjudication context is assembled, then the entry appears in a non-blocking history section separate from current sources. | 13 | The adjudication context carries suppression entries in a history section distinct from current sources. | diff-local |
| Story 5 happy: Given a suppressed finding recurs on a later lap, when the case store is read, then its entry's last-seen lap is updated and no second entry is created. | 12 | The case store persists one suppression entry per suppressed finding id, updated in place on recurrence and never pruned. | diff-local |
| Story 5 negative: Given a suppression entry exists, when the judge returns a case-v1 result that gives that entry no outcome, then the result is still valid, because suppression entries are not current sources and the source-complete validator does not demand an outcome for them. | 13 | A judgement that assigns no outcome to a suppression entry still validates. | diff-local |
| Story 5 negative: Given a suppressed finding stops recurring, when later laps run, then its entry remains in the store and is not pruned. | 12 | The case store persists one suppression entry per suppressed finding id, updated in place on recurrence and never pruned. | diff-local |
| Story 5 negative: Given a related case is resolved, when the store is read, then both the resolved case and every suppression entry remain present. | 12 | Resolved cases and suppression entries remain in the store across laps. | diff-local |
| Story 5 negative: Given a suppression entry, when the operator disposition store is read, then the entry does not appear there. | 12 | A suppression entry never appears in the operator disposition store. | diff-local |
| Story 6 happy: Given lap one deferred finding B and its deferral effect is applied, when lap two reports B with the identical content-anchored id, then the live source set is empty after operator resolution and settlement, and no remediate dispatch occurs. | 14 | A finding whose exact id links to a finalized deferred, rejected, or merged case is removed from the live source set before dispatch. | diff-local |
| Story 6 happy: Given lap one rejected finding C, when lap two reports C with the identical id, then no remediate dispatch occurs. | 14 | A finding whose exact id links to a finalized deferred, rejected, or merged case is removed from the live source set before dispatch. | diff-local |
| Story 6 happy: Given a finding was recorded with a merged source outcome on a finalized case, when it recurs with the identical id, then no remediate dispatch occurs. | 14 | A finding whose exact id links to a finalized deferred, rejected, or merged case is removed from the live source set before dispatch. | diff-local |
| Story 6 happy: Given lap two reports settled finding B and new finding D, when adjudication runs, then the judge is dispatched with D as its only current source. | 14 | A lap with one settled and one new finding dispatches the judge with the new finding as its only current source. | diff-local |
| Story 6 negative: Given lap one deferred finding B, when lap two reports B with an anchor that differs by one character, then B is a live source and the judge is dispatched, because only an exact id is settled. | 15 | A drifted id, a reserved or failed effect, and an open action case each leave the finding live. | diff-local |
| Story 6 negative: Given lap one deferred finding B but its deferral effect is still reserved, when lap two reports B, then B is not settled and the lap follows the existing unfinished-effect route. | 15 | A drifted id, a reserved or failed effect, and an open action case each leave the finding live. | diff-local |
| Story 6 negative: Given lap one produced an open action case for finding A that BUILD has not attempted, when lap two reports A, then A is not settled and the existing action route applies. | 15 | A drifted id, a reserved or failed effect, and an open action case each leave the finding live. | diff-local |
| Story 6 negative: Given the settlement predicate runs, when the case store is read afterwards, then no case was written, resolved, or pruned by the predicate. | 15 | The predicate performs no write to the case store. | diff-local |
| Story 6 negative: Given the case store is unreadable, when the settlement predicate would run, then the lap fails closed exactly as it does today for an unreadable store. | 15 | An unreadable case store fails the lap closed exactly as before. | diff-local |
| Story 7 happy: Given the settlement predicate empties the live set, when the lap finalizes, then a remediation adjudication completed event is emitted for the lap carrying the settled case ids and no new effect ids. | 16 | A skipped dispatch emits the completed-adjudication event with settled case ids and an empty effect list. | diff-local |
| Story 7 happy: Given a skipped dispatch, when the daemon log is read, then the lap shows a completed adjudication line rather than no adjudication line. | 16 | The rendered trace lists each settled case with its finalized outcome, and the daemon log shows a completed adjudication line. | diff-local |
| Story 7 negative: Given the settlement predicate empties the live set, when the event stream is read, then no adjudication started event was emitted for a dispatch that did not happen. | 16 | No started event is emitted for a skipped dispatch. | diff-local |
| Story 7 negative: Given the settlement predicate empties the live set, when the kickback ledger is read, then it is unchanged. | 16 | The kickback ledger is unchanged by a skipped dispatch. | diff-local |
| Story 7 negative: Given a skipped dispatch, when the trace for the lap is rendered, then each settled case appears with its finalized outcome. | 16 | The rendered trace lists each settled case with its finalized outcome, and the daemon log shows a completed adjudication line. | diff-local |
| Story 8 happy: Given a project config setting `build_review.rubrics.testQuality.min_confidence` to 70, when config loads, then it is accepted and the resolved rubric policy carries 70. | 5 | The key is accepted at 0, 70 and 100 and the resolved rubric policy carries the configured integer. | diff-local |
| Story 8 happy: Given a project config that omits the key, when config loads, then the resolved floor is 0 and no warning is produced. | 5 | An absent key resolves to a floor of 0. | diff-local |
| Story 8 happy: Given a project config setting the key to 0, when config loads, then it is accepted and nothing is ever suppressed. | 5 | The key is accepted at 0, 70 and 100 and the resolved rubric policy carries the configured integer. | diff-local |
| Story 8 happy: Given a project config setting the key to 100, when config loads, then it is accepted. | 5 | The key is accepted at 0, 70 and 100 and the resolved rubric policy carries the configured integer. | diff-local |
| Story 8 negative: Given a config setting the key to 101, when config loads, then loading fails with a validation error naming the exact `build_review.rubrics.testQuality.min_confidence` path and its permitted range. | 5 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting the key to -5, when config loads, then loading fails with a validation error naming the exact path. | 5 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting the key to 70.5, when config loads, then loading fails with a validation error, because the value must be an integer. | 5 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting the key to the string "70", when config loads, then loading fails with a validation error, because the value is not coerced. | 5 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting a misspelled `min_confidance`, when config loads, then loading fails with the existing unknown-key error naming the rubric policy block. | 5 | A misspelled sibling key still fails with the existing unknown-key error naming the rubric policy block. | diff-local |
| Story 8 negative: Given the config-key consumer registry, when its totality test runs, then `build_review.rubrics.min_confidence` declares a resolvable production consumer and the test passes. | 6 | The key declares a resolvable production consumer in the config-key consumer registry. | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | D1's lap classification is unchanged; D4 narrows the content-finding set before D1 reads it and D1's own rule imposes no implementation change here. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | One remediate dispatch still owns semantic fan-in; this feature adds no step, skill, provider member, or second adjudicator, and D5 only skips a dispatch that D2 would have made for an identical finalized outcome. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | no-change | none | Transition precedence after settlement is untouched; suppressed findings never become action cases and a settled lap finalizes on the existing pass branch. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | task | task-7, task-9, task-10, task-12 | The effective verdict reducer produces a suppressed set distinct from the accepted and unresolved sets, and only the unresolved set blocks. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-14, task-15, task-16 | A finding whose exact id links to a finalized deferred, rejected, or merged case is removed from the live source set before dispatch. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
