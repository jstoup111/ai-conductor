# Implementation Plan: Successful stacked restack halts on a stale reopen of the gate it re-pended

**Date:** 2026-10-28
**Design:** none (technical track, Tier S; track at `.docs/track/successful-stacked-restack-halts-on-a-stale-reopen.md`)
**Stories:** .docs/stories/successful-stacked-restack-halts-on-a-stale-reopen.md
**Conflict check:** Not required at Tier S

## Summary

Stop a stacked feature from halting on a compare-and-swap conflict after engine code in the same
process has already re-pended a gate on disk. The conduct-state batch path honors the
mutation port's idempotent rule, and the conductor adopts durable values it has not changed
locally at the three engine-writer boundaries. Covers all three call sites recorded on #3469 and
the same-shape #3394. 5 tasks, single PR.

## Root cause (verified)

- **Batch path skips rule 2.** `adr-2026-08-01-conduct-state-mutation-port` resolves a mutation
  whose current value already equals the requested value as idempotent success. The single-field
  `apply` in `src/conductor/src/engine/filesystem-conduct-state-store.ts` does this through
  `evaluateConductStateMutation`. `applyBatch` first refuses any mutation whose current value
  differs from `expected`, so rule 2 is never reached for a batch.
  `commitStateChanges` and `saveConductorStepStatus` in `conductor.ts` always write through
  `applyBatch`.
- **The conductor's view goes stale after in-process engine writers.** `run()` loads `state` and
  `persistedStateSnapshot` before the resume stack preflight, and nothing reloads the feature-wide
  fields afterwards. `activateChildRegionState` refreshes only BUILD-region fields and
  `last_step`. The writers that run inside the process and write through their own stores are:
  - `applyRestackTransition` (`restack/restack-transition.ts`), which re-pends invalidated gates
    and is reached from `runRestack` in the rebase step, the resume preflight's journal recovery
    and feature repair, and the routed region exit (`routing/routed-exit.ts`);
  - `restageLeafGates` (`routing/routed-exit.ts`), which re-pends `prd_audit`,
    `architecture_review_as_built`, `manual_test` and every post-`build_review` gate, including
    `rebase`;
  - `recordRebaseStepCompletion` (`rebase.ts`), which saves `rebase` with a fresh read.
- **The three recorded halts:**
  - The tail reopen after the rebase step's base-refresh restack (#3469 body, also #3394). The
    leaf child's overlay is active, the restack wrote `test_suite: pending` to the leaf child, and
    the reopen's `expected: done` batch was refused although disk already held the target.
  - The validation-group join (#3469 comment 1). The daemon log for
    `build-review-re-raises-already-decided-findings-ev` shows one executor running from the
    23:48:28Z resume to the 00:40:40Z halt, with resume-preflight restack kickbacks of
    `prd_audit` and `architecture_review_as_built` at 23:48:36Z. Those feature-wide fields were
    never re-read before the join wrote them.
  - The rebase status save after a resume-time routed leaf return (#3469 comment 2, verified by
    the filer). `restageLeafGates` wrote `rebase: pending` and the in-memory value stayed `stale`.

## Technical Approach

- **Batch evaluation (`filesystem-conduct-state-store.ts`).** `applyBatch`'s pre-check, run while
  holding the lease and against the same read, accepts a mutation when the field's current value
  equals either its `expected` value (rule 1, as today) or its `next` value (rule 2, idempotent).
  Any other mutation refuses the whole batch with today's
  `{ kind: 'conflict', message: 'Expected <field> to match before <intent>' }` for the first such
  field, and nothing is written. The existing second pass is unchanged: it still runs
  `evaluateConductStateMutation`, so an already-at-target mutation is written with its unchanged
  value in the same single persistence call, and domain-rule resolution still happens only for
  mutations whose `expected` matched.
  - Domain rules are deliberately not widened to mismatched expectations. Widening them would
    report a resolved regional field through `createRoutedConductStateStore`, which drops
    `resolvedFields` from regional results (`conduct-state-store.ts`). The conductor would then
    record a value the store kept from it. With only rule 2 added, the routed store already
    handles every result it can now receive, because an idempotent mutation is reported as
    `applied` with no resolved fields.
- **Durable adoption (`conductor.ts`).** Add one private
  `adoptDurableState(state: ConductState): Promise<void>`.
  - It reads the document the active store writes to: the overlay from
    `readConductStateOverlay(this.projectRoot, this.activeRegionChild)` when a child is active,
    otherwise `readState(this.stateFilePath)`.
  - For each field present in that document whose value differs from `state[field]`, it adopts
    the durable value into both `state` and `persistedStateSnapshot`, but only when the field is
    clean. A field is clean when `stateMutationValuesEqual(state[field], snapshot[field])` holds.
  - A dirty field (changed in memory, not yet saved) is left untouched in both, so its next
    persist still carries its original baseline and still conflicts against a different disk
    value.
  - It never deletes a field and never writes. An unreadable document or a missing file leaves
    `state` and the snapshot unchanged, and `restoreMissingStateFile` keeps owning recreation.
  - It is a no-op when `persistedStateSnapshot` is unset.
- **Call sites, one per engine-writer boundary.**
  1. **Resume preflight.** In `run()`, immediately after the resume `stackPreflight` returns a
     non-stopping result and before the navigate or child-activation branches.
  2. **Rebase step.** Rename the current `runRebaseStep` body to `runRebaseStepBody`. The new
     `runRebaseStep` awaits it, calls `adoptDurableState(state)`, and returns the body's result.
     This covers every exit of the stacked branch (preflight, `runRestack`, no-op and skip paths,
     `recordRebaseStepCompletion`) and the unstacked paths uniformly. A body that throws
     propagates unchanged and skips the adoption.
  3. **Child-region rebind.** At the start of `activateChildRegionState`, before it switches
     stores, overlays the new child's region fields and resets `persistedStateSnapshot`, call
     `adoptDurableState(state)`. Feature-wide fields re-pended by a routed-exit feature-repair
     restack are then adopted. The call must come first, because the reset at the end of the
     method makes every field look clean: adopting after it could replace a locally changed,
     unsaved feature field. The old child's region fields adopted here are overwritten by the new
     child's overlay in the same call. The method's closing whole-object
     `persistedStateSnapshot = { ...state }` reset becomes a targeted refresh: only the BUILD-region
     steps and `last_step` it just replaced are copied into (or deleted from) the snapshot, and
     every feature-wide snapshot entry is kept. Otherwise a feature field changed in memory but
     not saved would look clean after the rebind, the next `persistPendingStateChanges` would omit
     it, and a later adoption could replace it. `restoreWholeFeatureState` already reloads the
     whole document and is unchanged.
- **Why adoption cannot hide a real conflict.** Adoption only refreshes values the conductor has
  not changed. Every write the conductor computes afterwards uses the adopted value as its
  expectation, so a peer write that lands after the adoption is still refused by the store
  (Story 4).
- **Test patterns.**
  - Store tests extend the `createStatePath` / `writeState` / `persistenceWritesToDisk` cases in
    `src/conductor/test/engine/filesystem-conduct-state-store.test.ts` and the routed-store cases in
    `src/conductor/test/engine/conduct-state-overlay.test.ts`.
  - Conductor-baseline tests extend `src/conductor/test/engine/conductor-state-snapshot-batch.test.ts`.
    It casts `Conductor` to its internals (`initializeRunState`, `applyStateBatch`,
    `persistPendingStateChanges`); add `adoptDurableState`, `commitStateChanges`,
    `activateChildRegionState` and `persistedStateSnapshot` to that cast.
  - The rebase-step lifecycle test extends `src/conductor/test/engine/stacked-finish-rebase.test.ts`
    (real local Git, `stackedFixture`, `seedLeafRegionAtPreFinish`, `observe`). Today's
    `runStackedRebaseLifecycle` deliberately parks after `rebase` to avoid the tail; the new test
    must not park.
  - Resume tests inject `stackPreflight` the way `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`
    does (`new Conductor({ ..., stackPreflight })`). The stub writes the re-pends through
    `applyStateChanges` against the fixture's state file and returns `{ kind: 'clear' }`.
  - Validation-group tests follow `describe('single-writer join state + gate verdicts — all-green (Task 17)'`
    in `src/conductor/test/engine/conductor-groups-and-signals.test.ts`.

## Prerequisites

- None. #3479's stacked no-op rebase verdict is merged (#3488).
- Spec PR #3462 changes `StackPreflightResult`'s stopping arms. This plan consumes only the
  non-stopping arms, so the two compose in either merge order.

## Out of scope

- Routing restack and leaf-return writes through the conductor's store.
- A spine event for the routed leaf return.
- Any change to which gates a restack or leaf return re-pends.

## Tasks

### Task 1: A state batch accepts fields already at their target and stays atomic on conflict
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/filesystem-conduct-state-store.test.ts` and `src/conductor/test/engine/conduct-state-overlay.test.ts` for every Done-when check below.
2. Verify RED: the already-at-target batch is refused today with `Expected test_suite to match before reopen test_suite selected gate`.
3. Widen `applyBatch`'s pre-check to accept a field whose current value equals either the mutation's `expected` or its `next`, as in Technical Approach. Leave the second `evaluateConductStateMutation` pass, the conflict message and the single persistence call unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `filesystem-conduct-state-store.test.ts` asserts that on a document holding `test_suite: pending` and `last_step: build_review`, a batch of `test_suite` (expected `done`, next `pending`) and `last_step` (expected `build_review`, next `rebase`) resolves `{ kind: 'applied' }`, the persistence fake recorded exactly one write, and the file holds `test_suite: pending` and `last_step: rebase`.
- [test] `filesystem-conduct-state-store.test.ts` asserts that on a document holding `test_suite: stale`, a batch with intent `reopen test_suite selected gate` submitting `test_suite` (expected `done`, next `pending`) resolves `{ kind: 'conflict', message: 'Expected test_suite to match before reopen test_suite selected gate' }` and the file bytes are unchanged.
- [test] `filesystem-conduct-state-store.test.ts` asserts that a batch whose first mutation is already at its next value and whose second field holds neither its expected nor its next value resolves a conflict whose message names the second field, the persistence fake recorded no write, and the file bytes are unchanged.
- [test] `conduct-state-overlay.test.ts` seeds the #3394 layout (feature document without `test_suite`, children 1 and 2 with `test_suite: done`, child 3 with `test_suite: pending`) and asserts that `createRoutedConductStateStore(root, 3).applyBatch` of `test_suite` (expected `done`, next `pending`) succeeds while the feature, child 1 and child 2 documents are byte-identical to before.
- [test] `filesystem-conduct-state-store.test.ts` asserts that a batch submitting `plan` (expected `done`, next `stale`) against a document holding `plan: skipped` is still refused as a conflict with the file bytes unchanged, so domain-rule resolution is not reached for a mismatched expectation.

**Files likely touched:**
- `src/conductor/src/engine/filesystem-conduct-state-store.ts`
- `src/conductor/test/engine/filesystem-conduct-state-store.test.ts`
- `src/conductor/test/engine/conduct-state-overlay.test.ts`

**Dependencies:** none

### Task 2: The conductor adopts durable values of clean fields without writing
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-state-snapshot-batch.test.ts` for every Done-when check below.
2. Verify RED.
3. Add `adoptDurableState` to `conductor.ts` exactly as in Technical Approach: read the active document, adopt clean differing fields into `state` and `persistedStateSnapshot`, leave dirty fields untouched, never delete, never write, and do nothing when the read fails, the file is missing, or no snapshot exists.
4. Verify GREEN and commit.

**Done when:**
- [test] `conductor-state-snapshot-batch.test.ts` asserts that after loading `{ plan: 'done', prd_audit: 'done' }` and then writing `prd_audit: pending` to disk, `adoptDurableState` sets both the in-memory and snapshot `prd_audit` to `pending`, the state file bytes are identical before and after the call, and a following `commitStateChanges(state, 'join validation verification group', { prd_audit: 'done' })` persists `prd_audit: done`.
- [test] `conductor-state-snapshot-batch.test.ts` asserts that when in-memory `prd_audit` was changed to `stale` without saving and disk was changed to `pending`, `adoptDurableState` leaves in-memory `prd_audit` as `stale` and the snapshot's `prd_audit` as `done`, and the following `persistPendingStateChanges` rejects with an error containing `Expected prd_audit to match` while disk keeps `pending`.
- [test] `conductor-state-snapshot-batch.test.ts` asserts that when another writer sets `prd_audit: stale` on disk after `adoptDurableState` adopted `pending`, `commitStateChanges(state, 'join validation verification group', { prd_audit: 'done' })` rejects with `Expected prd_audit to match before join validation verification group` and disk holds `prd_audit: stale`.
- [test] `conductor-state-snapshot-batch.test.ts` asserts that with the state file deleted, `adoptDurableState` leaves every loaded in-memory field in place and creates no file, and the next `commitStateChanges` recreates the file holding every loaded field plus the committed change.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/conductor-state-snapshot-batch.test.ts`

**Dependencies:** none

### Task 3: The rebase step adopts what its restack re-pended, so the tail goes on to the re-pended gate
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stacked-finish-rebase.test.ts`. Add a lifecycle variant of `runStackedRebaseLifecycle` that resumes (`resume: true`) the two-child fixture with the leaf region seeded done through `seedLeafRegionAtPreFinish` and the default advanced. It must not park after `rebase`; stop at the park boundary after the next `step_started` instead. Add a no-op variant with the default unmoved, and assert every Done-when check below.
2. Verify RED: before the change, the resumed run emits `loop_halt` whose reason contains `Expected test_suite to match before reopen test_suite selected gate`.
3. Rename the body of `runRebaseStep` to `runRebaseStepBody`. The new `runRebaseStep` awaits the body, calls `adoptDurableState(state)`, and returns the body's result.
4. Verify GREEN and commit.

**Done when:**
- [test] `stacked-finish-rebase.test.ts` asserts that for the resumed two-child stack with an advanced default, the recorded events contain `step_completed` for `rebase` followed by `step_started` for `test_suite`, no `loop_halt` event was emitted, and `.pipeline/HALT` does not exist.
- [test] `stacked-finish-rebase.test.ts` asserts that for the same stack with the default unmoved, child 2's state still holds `test_suite: done` and `build_review: done`, no `step_started` for `test_suite` was emitted, and no `loop_halt` event was emitted.
- [test] `stacked-finish-rebase.test.ts` asserts that on the restacked fixture, after `runRebaseStepBody` returns, the bytes of `.pipeline/conduct-state.json` and of child 2's state file are identical before and after a following `adoptDurableState` call, so the adoption wrote nothing.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/stacked-finish-rebase.test.ts`

**Dependencies:** Task 2

### Task 4: The resume preflight's re-pends are adopted before the loop writes those gates
**Story:** Story 3, Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-gating.test.ts` with an injected `stackPreflight` stub that writes through `applyStateChanges` on the fixture state file and returns `{ kind: 'clear' }`, and in `src/conductor/test/engine/conductor-groups-and-signals.test.ts` following the Task 17 all-green join pattern. The fake step runner writes satisfied verdicts for the re-pended gates it dispatches, so the resumed loop reaches `rebase` and the join. For the peer-write case, the fake runner's `prd_audit` dispatch writes `prd_audit: stale` to the fixture state file through `applyStateChanges` before returning a satisfied verdict. Assert every Done-when check below.
2. Verify RED: the leaf-return case rejects with `Expected rebase to match before save rebase step status` and the restack case rejects with `Expected prd_audit to match before join`.
3. In `run()`, call `adoptDurableState(state)` immediately after the resume `stackPreflight` returns a non-stopping result and before the navigate and child-activation branches.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-gating.test.ts` asserts that a resumed run loaded with `rebase: stale`, whose stub preflight writes `pending` for `prd_audit`, `architecture_review_as_built`, `manual_test` and `rebase` (the leaf-return re-pends), persists `rebase: done` after its rebase step completes and emits no `loop_halt` whose reason contains `Expected rebase to match before save rebase step status`.
- [test] `conductor-groups-and-signals.test.ts` asserts that a resumed run loaded with `prd_audit: stale` and `architecture_review_as_built: stale`, whose stub preflight writes both as `pending` (the journaled-restack re-pends), reaches the validation-group join with both member verdicts satisfied, persists `prd_audit: done` and `architecture_review_as_built: done`, emits `parallel_completed`, and emits no `loop_halt` whose reason contains `Expected prd_audit to match before join`.
- [test] `stack-preflight-gating.test.ts` asserts that when the stub preflight writes nothing, `.pipeline/conduct-state.json` bytes are identical before and after the preflight and the adoption, and the first `step_started` event names the step the loaded state selects, asserted as a literal in the test.
- [test] `conductor-groups-and-signals.test.ts` asserts that when the `prd_audit` member writes `prd_audit: stale` to disk during its dispatch, the run emits a `loop_halt` whose reason contains `Expected prd_audit to match before join` and no `parallel_completed`, the persisted state still holds `prd_audit: stale`, and `architecture_review_as_built` is not persisted as `done`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`
- `src/conductor/test/engine/conductor-groups-and-signals.test.ts`

**Dependencies:** Tasks 1, 2

### Task 5: Rebinding to a child region adopts feature-wide values re-pended by a routed exit
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-state-snapshot-batch.test.ts`. Set up a root state with `prd_audit: done` and a child 2 state holding region steps. After loading, write `prd_audit: pending` to the feature document as a routed-exit feature-repair restack would. Then call `activateChildRegionState(state, 2)` and assert every Done-when check below.
2. Verify RED: before the change, the following commit rejects with `Expected prd_audit to match`.
3. At the start of `activateChildRegionState`, before the store switch and the region overlay, call `adoptDurableState(state)`. Replace the closing whole-object snapshot reset with a refresh of only the BUILD-region steps and `last_step` it replaced, keeping every feature-wide snapshot entry.
4. Verify GREEN and commit.

**Done when:**
- [test] `conductor-state-snapshot-batch.test.ts` asserts that after `activateChildRegionState(state, 2)`, in-memory `prd_audit` is `pending`, and a following `commitStateChanges(state, 'join validation verification group', { prd_audit: 'done' })` persists `prd_audit: done` in the feature document with no conflict.
- [test] `conductor-state-snapshot-batch.test.ts` asserts that the same rebind still sets every BUILD-region step from child 2's document, deletes a region step absent there, and leaves the feature document and child 2's document byte-identical, so the adoption wrote nothing.
- [test] `conductor-state-snapshot-batch.test.ts` asserts that when in-memory `architecture_review_as_built` was changed from `done` to `stale` without saving and the feature document holds `pending`, `activateChildRegionState(state, 2)` leaves in-memory `architecture_review_as_built` as `stale` and its snapshot entry as `done`, and a following `persistPendingStateChanges` rejects with an error containing `Expected architecture_review_as_built to match` while the feature document keeps `pending`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/conductor-state-snapshot-batch.test.ts`

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ─────────────┐
Task 2 ─┬─▶ Task 3  │
        ├─▶ Task 4 ◀┘
        └─▶ Task 5
```

Tasks 1 and 2 are independent roots. Task 3 depends on Task 2. Task 4 depends on Tasks 1 and 2,
because the leaf-return case's `rebase: done` save meets `recordRebaseStepCompletion`'s
already-`done` write. Task 5 depends on Task 2.

## Integration Points

- After Task 1: any engine batch whose field already holds its target succeeds. This alone clears
  the tail-reopen shape of #3469 and #3394.
- After Task 3: the rebase step's restack, preflight and completion writes are adopted before the
  tail selects.
- After Task 4: a resume-time leaf return or journaled restack no longer breaks the gate writes
  that follow it.
- After Task 5: a routed exit's feature-repair restack is adopted at the next child-region rebind.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a conduct-state document holding `test_suite: pending` and `last_step: build_review`, when one batch submits `test_suite` with expected `done` and next `pending` together with `last_step` with expected `build_review` and next `rebase`, then the batch reports success and the document holds `test_suite: pending` and `last_step: rebase` after exactly one persisted write. | 1 | "resolves `{ kind: 'applied' }`, the persistence fake recorded exactly one write, and the file holds `test_suite: pending` and `last_step: rebase`" | diff-local |
| Story 1 happy: Given the #3394 layout of a three-child stack (the feature document has no `test_suite`, children 1 and 2 hold `test_suite: done`, child 3 holds `test_suite: pending`), when a reopen of `test_suite` with expected `done` and next `pending` is applied through the store routed to child 3, then it succeeds and the feature document and the documents of children 1 and 2 are byte-identical to before. | 1 | "`createRoutedConductStateStore(root, 3).applyBatch` of `test_suite` (expected `done`, next `pending`) succeeds while the feature, child 1 and child 2 documents are byte-identical to before" | diff-local |
| Story 1 negative: Given a conduct-state document holding `test_suite: stale`, when a batch submits `test_suite` with expected `done` and next `pending`, then the batch is refused as a conflict whose message is `Expected test_suite to match before reopen test_suite selected gate` and the document is byte-identical to before. | 1 | "resolves `{ kind: 'conflict', message: 'Expected test_suite to match before reopen test_suite selected gate' }` and the file bytes are unchanged" | diff-local |
| Story 1 negative: Given a batch whose first mutation's field already holds its next value and whose second mutation's field holds neither its expected nor its next value, when the batch is applied, then nothing is written, the document is byte-identical to before, and the conflict message names the second field. | 1 | "resolves a conflict whose message names the second field, the persistence fake recorded no write, and the file bytes are unchanged" | diff-local |
| Story 2 happy: Given a daemon-mode two-child stacked feature resumed at its leaf with every BUILD region step done, whose rebase step base-refreshes onto a moved default branch and re-pends `test_suite` in the leaf child's state, when the rebase step completes, then the run's next dispatched step is `test_suite`, the events contain `step_completed` for `rebase` followed by `step_started` for `test_suite`, no `loop_halt` event is emitted and no `.pipeline/HALT` exists. | 3 | "the recorded events contain `step_completed` for `rebase` followed by `step_started` for `test_suite`, no `loop_halt` event was emitted, and `.pipeline/HALT` does not exist" | diff-local |
| Story 2 negative: Given the same stacked feature whose default branch has not moved, when the rebase step completes as a stacked no-op, then the leaf child's state still holds `test_suite: done` and `build_review: done`, `test_suite` is not dispatched, and no `loop_halt` event is emitted. | 3 | "child 2's state still holds `test_suite: done` and `build_review: done`, no `step_started` for `test_suite` was emitted, and no `loop_halt` event was emitted" | diff-local |
| Story 2 negative: Given the same restack, when the conductor adopts the re-pended state after the rebase step, then the adoption itself writes nothing: every conduct-state document is byte-identical immediately before and after it. | 3 | "the bytes of `.pipeline/conduct-state.json` and of child 2's state file are identical before and after a following `adoptDurableState` call" | diff-local |
| Story 3 happy: Given a routed stacked feature whose loaded state holds `rebase: stale` and whose resume stack preflight returns to the leaf and re-pends `prd_audit`, `architecture_review_as_built`, `manual_test` and `rebase` in the feature state, when the resumed run's rebase step succeeds and the conductor records it, then the feature state holds `rebase: done` and no error containing `Expected rebase to match before save rebase step status` is raised. | 4 | "persists `rebase: done` after its rebase step completes and emits no `loop_halt` whose reason contains `Expected rebase to match before save rebase step status`" | diff-local |
| Story 3 happy: Given a stacked feature whose loaded state holds a value other than `pending` for `prd_audit` and `architecture_review_as_built`, and whose resume stack preflight applies a journaled restack that re-pends both in the feature state, when the validation group later joins with both members satisfied, then the feature state holds `prd_audit: done` and `architecture_review_as_built: done` and no error containing `Expected prd_audit to match before join` is raised. | 4 | "persists `prd_audit: done` and `architecture_review_as_built: done`, emits `parallel_completed`, and emits no `loop_halt` whose reason contains `Expected prd_audit to match before join`" | diff-local |
| Story 3 happy: Given a routed host whose region exit runs a feature-repair restack that re-pends `prd_audit` in the feature state while the conductor's loaded value differs, when the conductor rebinds to the next child's BUILD region and later records `prd_audit`, then that write is persisted with no conflict. | 5 | "a following `commitStateChanges(state, 'join validation verification group', { prd_audit: 'done' })` persists `prd_audit: done` in the feature document with no conflict" | diff-local |
| Story 3 negative: Given a resume stack preflight that writes nothing to conduct state, when the conductor adopts durable state after it, then every conduct-state document is byte-identical before and after the adoption and the run selects the same first step as it does today. | 4 | "`.pipeline/conduct-state.json` bytes are identical before and after the preflight and the adoption, and the first `step_started` event names the step the loaded state selects" | diff-local |
| Story 3 negative: Given the feature's `.pipeline/conduct-state.json` is absent when the conductor adopts durable state, when the run continues, then no loaded field is dropped and the next conductor write recreates the file holding every field the conductor had loaded. | 2 | "`adoptDurableState` leaves every loaded in-memory field in place and creates no file, and the next `commitStateChanges` recreates the file holding every loaded field plus the committed change" | diff-local |
| Story 4 happy: Given a resumed stacked feature whose preflight adoption has completed, when another writer sets `prd_audit: stale` in the feature state while the validation group's members are running, then the join is refused, the run halts with an error containing `Expected prd_audit to match before join`, and the feature state still holds `prd_audit: stale`. | 4 | "the run emits a `loop_halt` whose reason contains `Expected prd_audit to match before join` and no `parallel_completed`, the persisted state still holds `prd_audit: stale`" | diff-local |
| Story 4 negative: Given a field the conductor has changed in memory but not yet saved, and a different value written to disk for that field by a restack during the same step, when the conductor adopts durable state and then persists its pending changes, then the in-memory value is not replaced by the disk value, the write is refused as a conflict naming that field, and the disk keeps the restack's value. | 2 | "`adoptDurableState` leaves in-memory `prd_audit` as `stale` and the snapshot's `prd_audit` as `done`, and the following `persistPendingStateChanges` rejects with an error containing `Expected prd_audit to match` while disk keeps `pending`" | diff-local |
| Story 4 negative: Given another writer changes a field after the conductor's adoption, when the conductor's next write to that field uses the adopted value as its expectation, then the write is refused as a conflict naming the field and the other writer's value stays on disk. | 2 | "rejects with `Expected prd_audit to match before join validation verification group` and disk holds `prd_audit: stale`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
