# Implementation Plan: Roll back a failed rewind fully, including never-run steps

**Date:** 2026-09-06
**Stories:** .docs/stories/roll-back-a-failed-rewind-fully-including-never-ru.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved operator-rewind contract, which fixes the demotion set, the stale target status, and the acquire-mutate-clear-verdicts-clear-halt order. Only the failure path changes.

## Summary

Three bounded tasks deliver #2181 inside one engine module: the rollback restores step fields that were absent before the rewind, gate-verdict clearing becomes reversible so a halt-clear failure restores it, and the command reports the failure that stopped the rewind before any rollback failure. Automatic recovery, new flags, and any change to a successful rewind's demotion set are outside this slice.

## Technical Approach

The rewind's demoted set is the target step plus every later non-skipped step, which for a feature halted part-way through its pipeline includes steps that have no key in the state document at all. Those keys are written as `stale` by the rewind, and the rollback then refuses them because it insists every original value be defined. The repair is to express an absent original as a deletion rather than a refusal. Partition the demoted set by whether its original value was defined: defined originals stay ordinary compare-and-set mutations with `expected: 'stale'`, absent originals become field deletions with the same expected value, and the `last_step` restoration stays an ordinary mutation. When there is nothing to delete, keep submitting the existing atomic batch unchanged, so the common case keeps its current shape and its current test. When there is something to delete, submit one privileged correction carrying both the deletions and the mutations, which the local store applies atomically under the same lease and whose deletion guard already accepts a field that is equal to the expected value or already absent. The correction operation is optional on the store port, so a store that does not offer it must fail by naming the fields it cannot restore rather than throwing an opaque error; the existing state-module helper that returns a typed refusal for the same missing capability is the shape to follow.

Gate-verdict clearing is currently an unconditional removal that runs before the halt clear, so a halt-clear failure has already destroyed evidence that the rollback cannot recreate. Make the removal reversible using the stage-then-delete shape the same module already uses for the halt markers: rename each demoted step's verdict file aside, clear the halt, then delete the staged copies; on any failure rename the staged copies back and rethrow the original error. A demoted step usually has no verdict file at all, so a missing source must be skipped rather than treated as a failure — the current removal tolerates absence and the staged form must too. Staging preserves the approved clearing order as observed from outside: a demoted step's verdict is already unreadable before the halt clear runs, exactly as today, and only becomes readable again if the whole operation is abandoned. The staged names must not be readable as verdicts while parked, which the existing verdict reader guarantees by ignoring any entry that does not end in the verdict suffix.

The command boundary currently reports a rollback failure before the failure that caused the rollback, which buries the cause. Report the original failure first, attempt the rollback, and report a rollback failure afterwards under its own prefix so the two are distinguishable. The exit code and the success path are unchanged.

Follow the existing test file's local pattern: a small hand-written store class implements the port and records what it receives for unit-level assertions, and command-boundary cases that need real persistence build a temporary project directory with the real default store and real clearing, injecting only the failure. New cases need a store class that also implements the optional correction operation, and one that deliberately does not. Search the existing rewind test file for its recording and applying store classes and the temporary-directory marker cases to find the shape. Keep every case at the command boundary or below; do not run a full conductor.

## Preconditions and claim ledger

- Verified: `src/conductor/src/engine/rewind.ts:268-271` filters the demoted set only on a status that is not `skipped`, so a step with no recorded status is included and written `stale`.
- Verified: `src/conductor/src/engine/rewind.ts:157-159` throws `Cannot restore absent rewind field` for the first demoted step whose original value is undefined, before any rollback mutation is submitted.
- Verified: `src/conductor/src/engine/rewind.ts:140-143` removes every demoted step's verdict file and only then clears the halt markers, so a halt-clear failure leaves those verdicts destroyed.
- Verified: `src/conductor/src/engine/rewind.ts:216-226` prints the rollback failure first and the original failure second, and returns 1 in both cases.
- Verified: `src/conductor/src/engine/rewind.ts:68-131` stages both halt markers by rename before removing them and renames them back when the operation fails, which is the in-file precedent for reversible clearing.
- Verified: `src/conductor/src/types/state.ts:113-128` defines the field-deletion and privileged-correction shapes, and `src/conductor/src/engine/conduct-state-store.ts:28` exposes the correction operation as optional on the port.
- Verified: `src/conductor/src/engine/filesystem-conduct-state-store.ts:223-258` applies deletions and mutations atomically under the lease, and its deletion guard accepts a field whose current value equals the expected value or is already absent.
- Verified: `src/conductor/src/engine/state.ts:154-164` returns a typed persistence refusal when the resolved store offers no correction operation, which is the precedent for the unsupported-store message.
- Verified: `src/conductor/src/engine/gate-verdicts.ts:51` names the verdicts directory and its reader ignores any entry that does not end in the verdict suffix, so a staged name cannot be read as a verdict.
- Verified: `src/conductor/test/engine/rewind.test.ts:61-68` gives every step a recorded status, which is why the existing rollback case never reaches the absent-original path.
- Assumption, recorded as the operator's delegated decision on 2026-09-06: restoring absent fields is preferred over narrowing the demotion set, because narrowing would change what a successful rewind demotes and that is fixed by the approved operator-rewind decision record. Not load-bearing beyond this slice; no amendment to that record is required.
- Scope check: consumer-facing engine and command behavior; no new skill; provider-agnostic. Event spine: no channel is added, the success event is unchanged, and a fully rolled-back failure leaves no durable state change to report.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Restore absent step fields instead of refusing the rollback
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/rewind.ts, src/conductor/test/engine/rewind.test.ts
**Dependencies:** none

**Steps:**
1. Write failing command-boundary tests over a state whose recorded position is part-way through the pipeline and whose later steps have no key at all, with derived-record clearing injected to fail. Use the existing test file's applying store class extended to implement the optional correction operation against its in-memory object, and add a second store class that deliberately omits it. Assert the previously absent keys are absent again, the previously recorded statuses are back, and the unsupported-store case reports the field names.
2. Run the new cases and confirm they fail on the current refusal (RED).
3. Partition the demoted set in the rollback by whether the original value is defined. Keep the existing atomic batch, unchanged, when nothing needs deleting. Otherwise submit one privileged correction carrying the deletions, the defined-original mutations, and the last-step restoration together, and refuse by naming the unrestorable fields when the store offers no correction operation. Convert a returned store failure into the same error shape the existing batch path uses.
4. Run the file's tests and confirm GREEN, including the existing all-recorded rollback case, which must still submit exactly one batch.
5. Run the repository's typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A command-boundary test with an injected clearing failure over a part-way state ends with every step key that was absent before the rewind absent in the persisted state document, and every previously recorded status equal to its pre-rewind value.
2. A command-boundary test with a store that omits the correction operation reports a message naming each field it could not restore, and the command returns 1.
3. The existing rollback case whose state records every step still passes unchanged and still submits a single atomic batch rather than a correction.

### Task 2: Make gate-verdict clearing reversible
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/rewind.ts, src/conductor/test/engine/rewind.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing command-boundary tests in a temporary project directory using the real default store and the real clearing routine, with verdict files written for two demoted steps and a halt-clear failure injected the way the existing marker cases inject one. Assert both verdict files are readable again with their original bytes, and add a success case asserting the verdicts directory ends with no entry for any demoted step.
2. Run the new cases and confirm the restoration assertion fails (RED).
3. Rename each demoted step's verdict file to a staged name before clearing the halt, skipping a source that does not exist; delete the staged copies only after the halt clear succeeds; on any failure rename every staged copy back to its original name before rethrowing the original error, and report any restoration failure alongside it rather than replacing it.
4. Run the file's tests and confirm GREEN, including the existing marker-restoration cases.
5. Run the repository's typecheck target that covers test files, then commit the focused change.

**Done when:**
1. After an injected halt-clear failure, each demoted step's verdict file is readable at its original path with byte-identical contents, and no staged name remains in the verdicts directory.
2. After a successful rewind over the same fixture, the verdicts directory holds no entry for any demoted step and no staged name.
3. A demoted step with no verdict file causes no failure on either the success path or the injected-failure path.

### Task 3: Report the failure that stopped the rewind first
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/rewind.ts, src/conductor/test/engine/rewind.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing command-boundary tests capturing the ordered reported messages for three cases: clearing fails and the rollback succeeds, clearing fails and the rollback also fails because the store offers no correction operation, and the rewind succeeds. Assert the ordering, the single message in the rollback-succeeds case, the distinguishing prefix in the rollback-fails case, and no rollback text at all on success.
2. Run the new cases and confirm the ordering assertion fails (RED).
3. Report the original failure before attempting the rollback, and report a rollback failure after it under its own prefix. Leave the exit code and the success output unchanged.
4. Run the file's tests and confirm GREEN, including the existing case that asserts the halt-restoration failure text is reported.
5. Run the repository's typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The captured message order for a failed clear places the clearing failure text before any rollback text.
2. A failed clear whose rollback succeeds produces exactly one reported failure message, and the command returns 1.
3. A failed clear whose rollback also fails produces two messages, the second carrying a prefix that identifies it as the rollback failure.
4. A successful rewind reports the rewound target and no rollback text, and returns 0.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose recorded position is part-way through its pipeline and whose later steps have no recorded status, when a rewind to an earlier step succeeds, then the target and every later non-skipped step is recorded stale, the gates directory holds no entry for any demoted step, and both halt markers are gone. | 2 | "After a successful rewind over the same fixture, the verdicts directory holds no entry for any demoted step and no staged name." | diff-local |
| Story 1 negative: Given that same feature, when clearing the derived records fails after the demotion is applied, then every step that had no recorded status before the rewind has no recorded status after it, and every step that had one is back to its earlier value. | 1 | "A command-boundary test with an injected clearing failure over a part-way state ends with every step key that was absent before the rewind absent in the persisted state document, and every previously recorded status equal to its pre-rewind value." | diff-local |
| Story 1 negative: Given that same feature, when clearing the derived records fails after the demotion is applied, then each gate verdict the rewind removed for a demoted step is readable again with its original contents. | 2 | "After an injected halt-clear failure, each demoted step's verdict file is readable at its original path with byte-identical contents, and no staged name remains in the verdicts directory." | diff-local |
| Story 1 negative: Given a state store that offers no explicit field-deletion authority and a rewind that demoted steps with no recorded status, when clearing the derived records fails, then the command names the fields it could not restore and exits non-zero. | 1 | "A command-boundary test with a store that omits the correction operation reports a message naming each field it could not restore, and the command returns 1." | diff-local |
| Story 2 happy: Given a rewind that succeeds, when the command exits, then it reports the rewound target and emits no rollback diagnostic at all. | 3 | "A successful rewind reports the rewound target and no rollback text, and returns 0." | diff-local |
| Story 2 negative: Given a rewind whose derived-record clearing fails and whose rollback then succeeds, when the command exits, then the only reported failure is the original clearing failure and the exit code is 1. | 3 | "A failed clear whose rollback succeeds produces exactly one reported failure message, and the command returns 1." | diff-local |
| Story 2 negative: Given a rewind whose derived-record clearing fails and whose rollback also fails, when the command exits, then the original clearing failure is reported before the rollback failure and the rollback failure is labelled as one. | 3 | "A failed clear whose rollback also fails produces two messages, the second carrying a prefix that identifies it as the rollback failure." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures; no criterion depends on a commit outside this feature's diff. Task 3 owns the integration proof through the production entry point: the operator command boundary is the only caller of the rollback and of the clearing routine, so its cases drive the real dispatch function with the real default store and the real clearing routine in a temporary project directory, injecting only the halt-clear failure. Task 1's absent-field cases and Task 2's staged-restoration cases share that same boundary rather than reaching the private helpers, because neither helper is exported. Task 1's unsupported-store case is unit-scoped through an injected store class that omits the optional correction operation. No third-party service, provider, or network call is involved, and no aggregate or end-to-end case is added. No terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
