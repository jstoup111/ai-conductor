# Implementation Plan: Operator-configurable confidence floor for acting on build_review findings

**Date:** 2026-09-06
**Stories:** .docs/stories/operator-configurable-confidence-floor-for-acting-.md
**Conflict check:** Clean as of 2026-09-06

## Summary

Replaces the adjudicator's `high | medium | low` confidence enum with an engine-validated integer
0-100, and adds an operator floor that demotes a sub-floor `act` case to a filed `defer` before the
case is reconciled. 18 tasks.

## Technical Approach

The floor is bookkeeping applied to an LLM judgement, not a replacement for it: the provider supplies
the number and the engine only compares it. Six production surfaces change, and the ordering between
them is the design's load-bearing decision.

- **Contract and state (Tasks 1-3).** `remediation-case-artifact.ts` retypes `confidence` and
  range-validates it, keeping the existing `invalid-case-confidence` rejection reason so the failure
  vocabulary is unchanged. `remediation-case-store.ts` applies the identical check on the durable
  record, and `build-review-adjudication-context.ts` carries the retyped value. `STORE_VERSION` stays
  at `v1`: the adjudicator is enabled-gated and has produced no durable state, verified by finding
  zero remediation case stores across every worktree on 2026-09-06, so there is nothing to migrate
  and a bump would only cost an in-flight feature a fail-closed halt.
- **Configuration (Tasks 4-5).** `act_min_confidence` joins `enabled` in the `build_review.adjudication`
  key set and validator, following the bounded-integer validation shape `build_review.maxParallel`
  already uses in the same file. It resolves through the same path that already serves
  `build_review.adjudication.enabled`. A consumer declaration lands in the same change, because the
  config-key consumer registry's totality test fails any key that declares none.
- **The floor itself (Tasks 6-7, 13).** The comparison runs at judgement admission, before
  `reconcileRemediationCases`. It cannot run at the effect-dispatch block, which reads effect kinds
  the reconciler has already persisted and guards on them; a late rewrite would desync the proposed
  case from its stored record and trip those guards. Applying it before reconciliation is also what
  makes a demoted case's effect id stable across laps, which the deferral's exact-marker dedup
  depends on. When the tracker dependencies are absent the floor does not apply at all, because a
  deferral that cannot file stays reserved and routes the lap to a halt.
- **Effects and budget (Tasks 8-12).** A demoted case takes the existing deferral effect unchanged;
  the engine synthesizes only its body text. The demotion path bypasses the kickback gate outright
  rather than calling it for a zero charge, so neither `count` nor `cumulative` moves.
- **Evidence (Tasks 16-17).** The demotion reason rides an additive optional field on an existing
  remediation event member rather than a new member, which avoids the sink-declaration and
  audit-mapping obligations a new member would carry. It is additionally rendered into the per-lap
  adjudication trace.
- **Fixture migration (Task 18).** Roughly 57 confidence literals across ten test files move from
  enum strings to integers. Mechanical, but it is the bulk of the diff and is sequenced last so it
  migrates against settled types.

The operator has an open intake (#2388) for per-rubric run scheduling, which will add keys under the
same `build_review.*` block; keep this key's naming and validation shape consistent with the existing
siblings so the two read coherently.

## Prerequisites

- None. No migration, backfill, external account, or new dependency.

## Tasks

### Task 1: Range-validate integer confidence in the remediation artifact reader
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the reader accepts confidence 0, 72 and 100 and returns each unchanged, and rejects 101, -1, 72.5 and the string high with reason invalid-case-confidence.
2. Verify tests fail (RED).
3. Replace the confidence enum type with an integer, and replace the oneOf check in parseCaseRow with an integer range check that keeps the existing invalid-case-confidence reason.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): range-validate integer adjudicator confidence".

**Done when:**
- The reader accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed case.
- The reader returns reason invalid-case-confidence for 101, for -1, for 72.5, and for a string confidence.
- A case omitting confidence entirely is rejected by the existing exact-key check.
- No engine code path assigns, defaults, or adjusts a confidence value.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-artifact.ts` — confidence type and range validation
- `src/conductor/test/engine/remediation-case-artifact.test.ts` — accept and reject cases

**Dependencies:** none

### Task 2: Apply the identical range check to the durable case store
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting the store round-trips an integer confidence and rejects an out-of-range or non-integer persisted confidence as malformed state.
2. Verify test fails (RED).
3. Retype the stored confidence and replace its oneOf check with the same integer range check.
4. Verify test passes (GREEN).
5. Commit with message: "feat(engine): range-validate confidence on the durable case store".

**Done when:**
- The durable case store parses an integer confidence 0 through 100 and round-trips it unchanged.
- The durable case store rejects a persisted case whose confidence is out of range or non-integer as malformed state.
- STORE_VERSION is unchanged at v1.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-store.ts` — stored confidence type and validation
- `src/conductor/test/engine/remediation-case-store.test.ts` — round-trip and malformed cases

**Dependencies:** 1

### Task 3: Carry the retyped confidence through the adjudication context
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write a failing typecheck-backed test asserting the context exposes an integer confidence.
2. Verify test fails (RED).
3. Retype the confidence field on the adjudication context.
4. Verify test passes (GREEN) and the project typechecks.
5. Commit with message: "refactor(engine): carry integer confidence through adjudication context".

**Done when:**
- The adjudication context declares confidence as an integer and the project typechecks.
- No enum-valued confidence type remains exported from the engine.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-context.ts` — confidence type
- `src/conductor/test/engine/build-review-adjudication-context.test.ts` — context shape

**Dependencies:** 1

### Task 4: Validate the act_min_confidence config key
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the key is accepted at 0, 70 and 100, resolves to 0 when absent, and fails config load naming its exact path and range for 101, -5, 70.5 and the string 70, while a misspelled sibling still fails with the existing unknown-key error.
2. Verify tests fail (RED).
3. Add the key to the build_review.adjudication key set and validate it as a bounded integer, following the shape build_review.maxParallel already uses in the same file.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(config): add build_review.adjudication.act_min_confidence".

**Done when:**
- The key is accepted at 0, 70 and 100 and resolves to the configured integer.
- Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value.
- A misspelled sibling key still fails with the existing unknown-key error naming the block.
- An absent key resolves to a floor of 0.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — key set entry and validator
- `src/conductor/src/engine/resolved-config.ts` — resolved floor field
- `src/conductor/test/engine/config.test.ts` — accept and reject cases

**Dependencies:** none

### Task 5: Declare the key's production consumer in the config-key registry
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Run the registry totality test and observe it fail for the newly added key.
2. Verify failure (RED).
3. Declare the key's production consumer beside the existing adjudication entries.
4. Verify the totality test passes (GREEN).
5. Commit with message: "chore(config): declare act_min_confidence consumer".

**Done when:**
- The key declares a resolvable production consumer in the config-key consumer registry.
- The registry totality test passes.

**Files likely touched:**
- `src/conductor/test/engine/config-consumer-registry.ts` — consumer declaration

**Dependencies:** 4

### Task 6: Demote a sub-floor action at judgement admission
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests asserting that with a tracker resolvable and a floor of 70, an act case of confidence 40 is admitted as a defer case with a deferral effect, while confidence 70 and 95 are admitted unchanged, and that with no floor configured confidence 1 is admitted unchanged.
2. Verify tests fail (RED).
3. Apply the floor comparison at judgement admission, before reconcileRemediationCases, rewriting a sub-floor act case into a defer case carrying a deferral effect.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): demote sub-floor build_review actions to deferrals".

**Done when:**
- With a tracker resolvable and a floor of 70, an act case of confidence 40 is admitted as a defer case carrying a deferral effect and publishes no work order.
- An act case whose confidence equals the floor, and one above it, are admitted unchanged as act cases.
- With the floor absent, an act case of confidence 1 is admitted unchanged.
- No action effect is ever reserved for a demoted case, and a lap demoting one of two act cases still admits the other as an action.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — floor comparison at admission
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — demotion cases

**Dependencies:** 1, 4

### Task 7: Prove the floor narrows and never promotes
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a sub-floor defer case and a sub-floor reject case are admitted unchanged, and an above-floor defer case is never converted into an act case.
2. Verify tests fail (RED).
3. Constrain the demotion so it reads only act cases and can only produce defer.
4. Verify tests pass (GREEN).
5. Commit with message: "test(engine): confirm the confidence floor only narrows".

**Done when:**
- A defer case below the floor and a reject case below the floor are admitted identical to their input.
- A defer case above the floor is never converted into an act case.
- No code path raises a case disposition toward act.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — narrowing constraint
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — defer and reject cases

**Dependencies:** 6

### Task 8: Synthesize the demoted case's deferral body
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a demoted case's filed body carries the case reference, the judgement rationale, the reported confidence, the applied floor, and the existing four intake sections.
2. Verify test fails (RED).
3. Synthesize the deferral title, body and exclusion rationale from the case, filing through the existing deferral effect and intake adapter.
4. Verify test passes (GREEN).
5. Commit with message: "feat(engine): synthesize deferral content for demoted findings".

**Done when:**
- A demoted case's deferral body contains its case reference, the judgement rationale, the reported confidence, and the applied floor.
- The body carries the existing Observed, Impact, Desired outcome and Hypotheses sections.
- Filing goes through the existing intake adapter, with no new filing path introduced.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — synthesized deferral content
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — body content

**Dependencies:** 6

### Task 9: File a demoted finding exactly once across laps
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests asserting two consecutive laps demoting the same case produce the same effect id and reuse the existing issue by exact marker including when closed, and that two distinct demoted cases file two issues with distinct markers.
2. Verify tests fail (RED).
3. Ensure the demotion is deterministic from confidence and floor alone and runs before reconciliation, so the case binds to the same effect id each lap.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(engine): keep demoted deferral effect ids stable across laps".

**Done when:**
- Two consecutive laps demoting the same case at the same floor produce an identical effect id.
- The second lap reuses the existing issue by exact marker and files no duplicate, including when that issue has been closed.
- Three consecutive demoting laps leave exactly one issue for the case.
- Two distinct demoted cases on one lap file two issues with distinct markers.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — deterministic demotion before reconciliation
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — cross-lap dedup

**Dependencies:** 8

### Task 10: Record a failed deferral filing rather than passing around it
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test asserting a demoted case whose filing fails leaves its effect recorded failed and the lap does not report a pass.
2. Verify test fails (RED).
3. Route a failed demoted filing through the existing failed-effect path.
4. Verify test passes (GREEN).
5. Commit with message: "fix(engine): record failed demoted deferral filings".

**Done when:**
- A demoted case whose issue filing fails has its effect recorded as failed.
- A lap containing a failed demoted filing does not report a clean pass.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — failed-effect routing
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — filing failure

**Dependencies:** 8

### Task 11: Bypass the kickback gate for demoted cases
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests asserting a lap whose only act case is demoted leaves count unchanged, does not increment cumulative, does not invoke the kickback gate for that case, and does not advance a feature toward its cumulative cap, while a mixed lap charges exactly one kickback.
2. Verify tests fail (RED).
3. Skip the kickback gate entirely on the demotion path rather than calling it with a zero charge.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): demoted findings consume no kickback budget".

**Done when:**
- A lap whose only act case is demoted leaves count unchanged and does not invoke the kickback gate for that case.
- The demotion does not increment cumulative; any reset observed on a passing lap comes from the existing pass-convergence rule.
- A lap mixing a demoted case and a surviving act case charges exactly one kickback.
- A feature one kickback below its cumulative cap is not advanced toward the cap by a demotion and does not halt.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — kickback gate bypass
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — ledger assertions

**Dependencies:** 6

### Task 12: Publish no BUILD work and emit no kickback for a demoted case
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a demoted case publishes no BUILD work order, does not re-dispatch BUILD, and contributes no kickback event to the lap's event stream.
2. Verify tests fail (RED).
3. Ensure the demotion path reaches neither the work-order publisher nor the kickback emitter.
4. Verify tests pass (GREEN).
5. Commit with message: "test(engine): demoted findings dispatch no BUILD work".

**Done when:**
- No BUILD work order is published for a demoted case and BUILD is not re-dispatched for it.
- The lap's event stream contains no kickback event attributable to a demoted case.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — work-order and emitter paths
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — work order and event assertions

**Dependencies:** 11

### Task 13: Make the floor inert when a deferral cannot be filed
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests asserting that with tracker dependencies absent a sub-floor act case keeps its act disposition and work order, reserves no deferral effect, takes the same route it would with the floor unset, and is demoted on a later lap once a tracker resolves.
2. Verify tests fail (RED).
3. Guard the floor comparison on the presence of the deferral dependencies, so it does not apply when a deferral could not finalize.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(engine): keep the confidence floor inert without a tracker".

**Done when:**
- With tracker dependencies absent, a sub-floor act case keeps its act disposition and publishes its work order.
- With tracker dependencies absent, no deferral effect is reserved for a sub-floor case, so nothing is left reserved across laps.
- With tracker dependencies absent, the lap route is identical with the floor set and with it unset, and the lap does not halt on an unfinished deferral.
- Inertness is recomputed each lap, so the same case is demoted on a later lap once a tracker resolves.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — dependency guard on the floor
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — absent-tracker cases

**Dependencies:** 6

### Task 14: Pass a lap whose every action was demoted
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing integration test asserting that a lap whose every act case is demoted, whose deferrals finalize and whose rubrics are healthy reaches a pass verdict without re-entering BUILD or halting, including a lap with three sub-floor cases.
2. Verify test fails (RED).
3. Confirm the demoted cases carry finalized deferral effects so the existing reducer reaches its pass branch, adjusting the admission path if any demoted case still presents as build-eligible.
4. Verify test passes (GREEN).
5. Commit with message: "test(engine): a fully demoted build_review lap passes".

**Done when:**
- A lap whose every act case was demoted, whose deferrals all finalized and whose rubrics are healthy reaches a pass verdict through the conductor's build_review gate.
- That lap neither re-enters BUILD nor halts.
- A lap with three sub-floor act cases files three deferrals and still passes.

**Files likely touched:**
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — fully demoted lap
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — admission adjustment if required

**Dependencies:** 9, 13

### Task 15: Preserve the existing blockers on a demoted lap
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a lap with an unfinalized deferral halts, a lap with an uncovered infrastructure failure follows the mechanical lane, and a lap retaining one act case routes to BUILD.
2. Verify tests fail (RED).
3. Confirm the demotion changes none of these routes.
4. Verify tests pass (GREEN).
5. Commit with message: "test(engine): demotion preserves existing build_review blockers".

**Done when:**
- A lap with an unfinalized deferral halts rather than passing.
- A lap with a remaining uncovered infrastructure failure follows the mechanical lane rather than passing.
- A lap retaining at least one act case routes to BUILD rather than passing.

**Files likely touched:**
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — blocker routes

**Dependencies:** 14

### Task 16: Stamp the demotion reason on the event spine
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests asserting each demotion emits its reason with the reported confidence and applied floor, a lap demoting nothing emits no reason, the reason is stamped at demotion time, and no kickback event carries it.
2. Verify tests fail (RED).
3. Add an additive optional demotion field to an existing remediation event member and emit it through the coordinator's existing emit callback.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): record build_review demotions on the event spine".

**Done when:**
- Each demotion emits its reason on the persisted event spine, carrying the reported confidence and the applied floor.
- A lap that demotes nothing emits no demotion reason on any event.
- The demotion reason is stamped at demotion time rather than derived afterwards from stored case state.
- The demotion is never emitted as a kickback event, and any new event member introduced instead declares its sink and its audit-trail mapping.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — additive demotion field
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — emission
- `src/conductor/test/engine/build-review-adjudication-coordinator.test.ts` — event assertions

**Dependencies:** 6

### Task 17: Render demotions into the per-lap adjudication trace
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the rendered trace carries one line per demoted case naming the case, its confidence and the floor, that two demotions render two lines, and that those lines appear in halt evidence.
2. Verify tests fail (RED).
3. Extend the adjudication trace renderer to include demoted cases.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(engine): render demoted findings in the adjudication trace".

**Done when:**
- The rendered adjudication trace contains one line per demoted case naming the case, its confidence, and the applied floor.
- A lap demoting two cases renders two distinct lines.
- The demotion lines appear in the halt evidence when the lap halts for an unrelated reason.

**Files likely touched:**
- `src/conductor/src/engine/build-review-adjudication.ts` — trace rendering
- `src/conductor/test/engine/build-review-adjudication.test.ts` — trace assertions

**Dependencies:** 16

### Task 18: Migrate the confidence fixtures across the affected test files
**Story:** 1
**Type:** refactor

**Steps:**
1. Run the engine test suite and observe the remaining enum-literal confidence fixtures fail to typecheck.
2. Verify failure (RED).
3. Replace every enum-valued confidence literal in the affected test files with a representative integer, preserving each test's original intent.
4. Verify the suite passes (GREEN).
5. Commit with message: "test(engine): migrate confidence fixtures to integers".

**Done when:**
- No enum-valued confidence literal remains in any engine test file or fixture.
- The engine test suite passes.

**Files likely touched:**
- `src/conductor/test/engine/remediation-case-effects.test.ts` — confidence fixtures
- `src/conductor/test/engine/remediation-case-reconciler.test.ts` — confidence fixtures
- `src/conductor/test/engine/remediation-case-validator.test.ts` — confidence fixtures
- `src/conductor/test/engine/build-review-adjudication.test.ts` — confidence fixtures
- `src/conductor/test/integration/remediation-case-recovery.integration.test.ts` — confidence fixtures

**Dependencies:** 1, 2, 3

## Task Dependency Graph

```text
1 ──┬── 2 ──┐
    ├── 3 ──┼── 18
    └───────┘
4 ── 5
1,4 ── 6 ──┬── 7
           ├── 8 ──┬── 9 ──┐
           │       └── 10  │
           ├── 11 ── 12    │
           ├── 13 ─────────┴── 14 ── 15
           └── 16 ── 17
```

## Integration Points

- After Task 6: a sub-floor action is observably demoted through the coordinator.
- After Task 9: the deferral files exactly once across repeated laps.
- After Task 14: the full operator-visible outcome is exercised through the conductor's build_review
  gate — the cross-boundary integration proof for this feature.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an adjudication result whose case carries `"confidence": 72`, when the engine reads the remediation artifact, then the case is accepted and its confidence is retained as the integer 72. | 1 | The reader accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed case. | diff-local |
| Story 1 happy: Given an adjudication result whose case carries `"confidence": 0`, when the engine reads the remediation artifact, then the case is accepted, because 0 is a valid confidence and not an absent value. | 1 | The reader accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed case. | diff-local |
| Story 1 happy: Given an adjudication result whose case carries `"confidence": 100`, when the engine reads the remediation artifact, then the case is accepted. | 1 | The reader accepts an integer confidence of 0, 72, and 100 and returns each unchanged on the parsed case. | diff-local |
| Story 1 negative: Given a case carrying `"confidence": 101`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence` and no case is stamped. | 1 | The reader returns reason invalid-case-confidence for 101, for -1, for 72.5, and for a string confidence. | diff-local |
| Story 1 negative: Given a case carrying `"confidence": -1`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence`. | 1 | The reader returns reason invalid-case-confidence for 101, for -1, for 72.5, and for a string confidence. | diff-local |
| Story 1 negative: Given a case carrying `"confidence": 72.5`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence`, because confidence must be an integer. | 1 | The reader returns reason invalid-case-confidence for 101, for -1, for 72.5, and for a string confidence. | diff-local |
| Story 1 negative: Given a case carrying `"confidence": "high"`, when the engine reads the remediation artifact, then the whole adjudication is rejected with reason `invalid-case-confidence`, because the enum form is no longer accepted. | 1 | The reader returns reason invalid-case-confidence for 101, for -1, for 72.5, and for a string confidence. | diff-local |
| Story 1 negative: Given a case omitting `confidence` entirely, when the engine reads the remediation artifact, then the whole adjudication is rejected, because the key set is exact. | 1 | A case omitting confidence entirely is rejected by the existing exact-key check. | diff-local |
| Story 1 negative: Given a durable case store record whose persisted confidence is out of range, when the store is read, then the read fails closed as malformed state rather than admitting the record. | 2 | The durable case store rejects a persisted case whose confidence is out of range or non-integer as malformed state. | diff-local |
| Story 2 happy: Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns an `act` case with confidence 40, when the lap is adjudicated, then that case is recorded as a `defer` case and no BUILD work order is published for it. | 6 | With a tracker resolvable and a floor of 70, an act case of confidence 40 is admitted as a defer case carrying a deferral effect and publishes no work order. | diff-local |
| Story 2 happy: Given `act_min_confidence` is 70 and an adjudication returns an `act` case with confidence 70, when the lap is adjudicated, then the case remains an `act` case, because the floor is a minimum and not an exclusive bound. | 6 | An act case whose confidence equals the floor, and one above it, are admitted unchanged as act cases. | diff-local |
| Story 2 happy: Given `act_min_confidence` is 70 and an adjudication returns an `act` case with confidence 95, when the lap is adjudicated, then the case remains an `act` case and publishes its BUILD work order as today. | 6 | An act case whose confidence equals the floor, and one above it, are admitted unchanged as act cases. | diff-local |
| Story 2 happy: Given `act_min_confidence` is left unset and an adjudication returns an `act` case with confidence 1, when the lap is adjudicated, then the case remains an `act` case, because the default floor of 0 never demotes. | 6 | With the floor absent, an act case of confidence 1 is admitted unchanged. | diff-local |
| Story 2 happy: Given a tracker repository is resolvable and an adjudication returns both a sub-floor `act` case and an at-floor `act` case, when the lap is adjudicated, then only the sub-floor case is demoted and the other still publishes its work order. | 6 | No action effect is ever reserved for a demoted case, and a lap demoting one of two act cases still admits the other as an action. | diff-local |
| Story 2 negative: Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns a `defer` case with confidence 40, when the lap is adjudicated, then the case is unchanged, because the floor never alters a case that is already deferred. | 7 | A defer case below the floor and a reject case below the floor are admitted identical to their input. | diff-local |
| Story 2 negative: Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns a `reject` case with confidence 40, when the lap is adjudicated, then the case is unchanged, because the floor never alters a rejection. | 7 | A defer case below the floor and a reject case below the floor are admitted identical to their input. | diff-local |
| Story 2 negative: Given `act_min_confidence` is 90 and an adjudication returns a `defer` case with confidence 95, when the lap is adjudicated, then the case remains deferred, because the engine may narrow an action but may never promote a deferral into an action. | 7 | A defer case above the floor is never converted into an act case. | diff-local |
| Story 2 negative: Given a demoted case, when its stored record is read back, then its disposition is `defer` and its effect kind is `deferral`, with no residual action effect anywhere in the store. | 6 | No action effect is ever reserved for a demoted case, and a lap demoting one of two act cases still admits the other as an action. | diff-local |
| Story 2 negative: Given a tracker repository is resolvable, `act_min_confidence` is 70, and an adjudication returns an `act` case with confidence 40, when the demotion is applied, then it happens before case reconciliation, so no action effect is ever reserved and later contradicted. | 6 | No action effect is ever reserved for a demoted case, and a lap demoting one of two act cases still admits the other as an action. | diff-local |
| Story 3 happy: Given a sub-floor `act` case is demoted on a lap, when its deferral effect runs, then an intake issue is filed carrying the effect's hidden marker and a body with the existing Observed, Impact, Desired Outcomes and Hypotheses sections. | 8 | A demoted case's deferral body contains its case reference, the judgement rationale, the reported confidence, and the applied floor. | diff-local |
| Story 3 happy: Given a demoted case whose deferral body is synthesized by the engine, when the issue is filed, then the body states the case reference, the judgement's rationale, the reported confidence, and the floor that demoted it. | 8 | A demoted case's deferral body contains its case reference, the judgement rationale, the reported confidence, and the applied floor. | diff-local |
| Story 3 happy: Given a demoted case that was already filed on a previous lap, when the same case is demoted again on the next lap, then the existing issue is reused via its exact marker and no second issue is created. | 9 | The second lap reuses the existing issue by exact marker and files no duplicate, including when that issue has been closed. | diff-local |
| Story 3 negative: Given a demoted case filed on lap one, when lap two demotes the same case and the prior issue has since been closed, then the closed issue is reused and no duplicate is filed. | 9 | The second lap reuses the existing issue by exact marker and files no duplicate, including when that issue has been closed. | diff-local |
| Story 3 negative: Given a demoted case, when the same feature runs three consecutive laps that each demote it, then exactly one issue exists for it across all three laps. | 9 | Three consecutive demoting laps leave exactly one issue for the case. | diff-local |
| Story 3 negative: Given a demoted case whose issue filing fails, when the lap settles, then the effect is recorded as failed and the lap does not report a clean pass around an unfiled finding. | 10 | A demoted case whose issue filing fails has its effect recorded as failed. | diff-local |
| Story 3 negative: Given a demoted case, when its effect id is compared across two laps at the same floor and confidence, then the id is identical, because the demotion is deterministic and precedes reconciliation. | 9 | Two consecutive laps demoting the same case at the same floor produce an identical effect id. | diff-local |
| Story 3 negative: Given two distinct sub-floor cases demoted on the same lap, when their deferrals are filed, then two separate issues exist with distinct markers and neither dedups against the other. | 9 | Two distinct demoted cases on one lap file two issues with distinct markers. | diff-local |
| Story 4 happy: Given a lap whose only `act` case is demoted, when the lap settles, then the kickback ledger's `count` for `build_review` is unchanged from before the lap. | 11 | A lap whose only act case is demoted leaves count unchanged and does not invoke the kickback gate for that case. | diff-local |
| Story 4 happy: Given a lap whose only `act` case is demoted, when the lap settles, then the demotion itself does not increment the ledger's `cumulative` value; a subsequent pass may still reset it to 0, which is the existing convergence rule and not an effect of the demotion. | 11 | The demotion does not increment cumulative; any reset observed on a passing lap comes from the existing pass-convergence rule. | diff-local |
| Story 4 happy: Given a lap with one demoted case and one surviving `act` case, when the lap settles, then exactly one kickback is charged, for the surviving action only. | 11 | A lap mixing a demoted case and a surviving act case charges exactly one kickback. | diff-local |
| Story 4 negative: Given a lap whose only `act` case is demoted, when the lap settles, then the kickback gate is not invoked at all for the demoted case, rather than invoked for a zero charge. | 11 | A lap whose only act case is demoted leaves count unchanged and does not invoke the kickback gate for that case. | diff-local |
| Story 4 negative: Given a feature one kickback below its cumulative cap, when a lap demotes its only `act` case, then the demotion does not advance it toward the cap and it does not halt on budget exhaustion. | 11 | A feature one kickback below its cumulative cap is not advanced toward the cap by a demotion and does not halt. | diff-local |
| Story 4 negative: Given a lap whose only `act` case is demoted, when the lap settles, then no BUILD work order is published and BUILD is not re-dispatched. | 12 | No BUILD work order is published for a demoted case and BUILD is not re-dispatched for it. | diff-local |
| Story 4 negative: Given a demoted case, when the event stream for the lap is read, then it contains no `kickback` event attributable to that case. | 12 | The lap's event stream contains no kickback event attributable to a demoted case. | diff-local |
| Story 5 happy: Given no tracker repository can be resolved and `act_min_confidence` is 70, when an adjudication returns an `act` case with confidence 40, then the case remains an `act` case and publishes its BUILD work order as though no floor were set. | 13 | With tracker dependencies absent, a sub-floor act case keeps its act disposition and publishes its work order. | diff-local |
| Story 5 happy: Given a tracker repository is resolvable and `act_min_confidence` is 70, when an adjudication returns an `act` case with confidence 40, then the case is demoted, confirming the inert behavior is conditional and not permanent. | 13 | Inertness is recomputed each lap, so the same case is demoted on a later lap once a tracker resolves. | diff-local |
| Story 5 negative: Given no tracker repository can be resolved, when a lap adjudicates a sub-floor `act` case, then the lap does not halt on an unfinished deferral effect. | 13 | With tracker dependencies absent, the lap route is identical with the floor set and with it unset, and the lap does not halt on an unfinished deferral. | diff-local |
| Story 5 negative: Given no tracker repository can be resolved, when a lap adjudicates a sub-floor `act` case, then no deferral effect is reserved for it, so nothing is left in a reserved state across laps. | 13 | With tracker dependencies absent, no deferral effect is reserved for a sub-floor case, so nothing is left reserved across laps. | diff-local |
| Story 5 negative: Given no tracker repository can be resolved, when a lap adjudicates a sub-floor `act` case, then the lap's route is identical to the route it would take with the floor unset. | 13 | With tracker dependencies absent, the lap route is identical with the floor set and with it unset, and the lap does not halt on an unfinished deferral. | diff-local |
| Story 5 negative: Given the tracker becomes resolvable on a later lap, when the same sub-floor case is adjudicated again, then it is demoted on that lap, because inertness is evaluated per lap and not cached. | 13 | Inertness is recomputed each lap, so the same case is demoted on a later lap once a tracker resolves. | diff-local |
| Story 6 happy: Given a lap whose every `act` case is demoted and whose rubrics are otherwise healthy, when the lap settles, then build_review passes and the step is recorded done. | 14 | A lap whose every act case was demoted, whose deferrals all finalized and whose rubrics are healthy reaches a pass verdict through the conductor's build_review gate. | diff-local |
| Story 6 happy: Given a lap whose every `act` case is demoted, when the lap settles, then BUILD is not re-entered. | 14 | That lap neither re-enters BUILD nor halts. | diff-local |
| Story 6 happy: Given a lap with three `act` cases all below the floor, when the lap settles, then all three are filed as deferrals and the lap still passes. | 14 | A lap with three sub-floor act cases files three deferrals and still passes. | diff-local |
| Story 6 negative: Given a lap whose every `act` case is demoted, when the lap settles, then it does not halt with a route of `halt`, and specifically not on an unfinished-effect reason. | 14 | That lap neither re-enters BUILD nor halts. | diff-local |
| Story 6 negative: Given a lap whose every `act` case is demoted but one deferral effect has not finalized, when the lap settles, then the lap halts rather than passing, because an unfinished effect still blocks a pass. | 15 | A lap with an unfinalized deferral halts rather than passing. | diff-local |
| Story 6 negative: Given a lap whose every `act` case is demoted while an uncovered infrastructure failure remains, when the lap settles, then the lap follows the existing mechanical lane rather than passing, because content demotion does not clear an infrastructure blocker. | 15 | A lap with a remaining uncovered infrastructure failure follows the mechanical lane rather than passing. | diff-local |
| Story 6 negative: Given a lap with one demoted case and one surviving `act` case, when the lap settles, then the lap routes to BUILD rather than passing. | 15 | A lap retaining at least one act case routes to BUILD rather than passing. | diff-local |
| Story 7 happy: Given a case is demoted, when the lap's event stream is read, then it contains a remediation event carrying the demotion reason, including the reported confidence and the applied floor. | 16 | Each demotion emits its reason on the persisted event spine, carrying the reported confidence and the applied floor. | diff-local |
| Story 7 happy: Given a case is demoted, when the lap's adjudication trace is rendered, then it contains a line naming the case, its confidence, and the floor that demoted it. | 17 | The rendered adjudication trace contains one line per demoted case naming the case, its confidence, and the applied floor. | diff-local |
| Story 7 happy: Given a lap demotes two cases, when the trace is rendered, then both appear as separate lines. | 17 | A lap demoting two cases renders two distinct lines. | diff-local |
| Story 7 negative: Given a case is demoted, when the event stream is read, then the demotion is not emitted as a `kickback` event, because no kickback was charged. | 16 | The demotion is never emitted as a kickback event, and any new event member introduced instead declares its sink and its audit-trail mapping. | diff-local |
| Story 7 negative: Given a lap that demotes nothing, when its event stream is read, then no demotion reason appears on any event. | 16 | A lap that demotes nothing emits no demotion reason on any event. | diff-local |
| Story 7 negative: Given a case is demoted, when the demotion record is inspected, then it is stamped at the time of demotion rather than reconstructed later from stored case state. | 16 | The demotion reason is stamped at demotion time rather than derived afterwards from stored case state. | diff-local |
| Story 7 negative: Given a demoted case, when the lap subsequently halts for an unrelated reason, then the demotion line still appears in the halt evidence. | 17 | The demotion lines appear in the halt evidence when the lap halts for an unrelated reason. | diff-local |
| Story 7 negative: Given the demotion record rides an existing event member, when a new event member is introduced instead, then that member declares its sink and appears in the audit-trail mapping, so event completeness is preserved. | 16 | The demotion is never emitted as a kickback event, and any new event member introduced instead declares its sink and its audit-trail mapping. | diff-local |
| Story 8 happy: Given a project config setting `build_review.adjudication.act_min_confidence` to 70, when config loads, then it is accepted and the resolved value is 70. | 4 | The key is accepted at 0, 70 and 100 and resolves to the configured integer. | diff-local |
| Story 8 happy: Given a project config that omits the key, when config loads, then the resolved value is 0 and no warning is produced. | 4 | An absent key resolves to a floor of 0. | diff-local |
| Story 8 happy: Given a project config setting the key to 0, when config loads, then it is accepted and the floor never demotes. | 4 | The key is accepted at 0, 70 and 100 and resolves to the configured integer. | diff-local |
| Story 8 happy: Given a project config setting the key to 100, when config loads, then it is accepted. | 4 | The key is accepted at 0, 70 and 100 and resolves to the configured integer. | diff-local |
| Story 8 negative: Given a config setting the key to 101, when config loads, then loading fails with a validation error naming the exact `build_review.adjudication.act_min_confidence` path and its permitted range. | 4 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting the key to -5, when config loads, then loading fails with a validation error naming the exact path. | 4 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting the key to 70.5, when config loads, then loading fails with a validation error, because the value must be an integer. | 4 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting the key to the string "70", when config loads, then loading fails with a validation error, because the value must be an integer and is not coerced. | 4 | Config load fails with an error naming the exact key path and the permitted range 0 to 100 for 101, for -5, for 70.5, and for a string value. | diff-local |
| Story 8 negative: Given a config setting a misspelled `act_min_confidance`, when config loads, then loading fails with the existing unknown-key error naming the `build_review.adjudication` block. | 4 | A misspelled sibling key still fails with the existing unknown-key error naming the block. | diff-local |
| Story 8 negative: Given the config-key consumer registry, when its totality test runs, then `build_review.adjudication.act_min_confidence` declares a resolvable production consumer and the test passes. | 5 | The key declares a resolvable production consumer in the config-key consumer registry. | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | D1 separates infrastructure-only laps from mixed laps. The confidence floor acts only on content cases already admitted to the post-join judgement and never reclassifies a lap, so the mixed-lap rule is untouched by this feature. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | D2 keeps one remediate dispatch owning the semantic fan-in. This feature adds no step, skill, provider member, or second adjudicator; the floor is applied to that single dispatch's output. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-14, task-15 | A lap retaining at least one act case routes to BUILD rather than passing. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | task | task-6, task-11, task-13, task-16 | With a tracker resolvable and a floor of 70, an act case of confidence 40 is admitted as a defer case carrying a deferral effect and publishes no work order. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
