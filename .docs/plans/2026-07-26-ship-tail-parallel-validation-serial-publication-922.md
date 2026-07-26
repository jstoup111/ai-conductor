# Implementation Plan: Parallel validation with serial, fenced publication (#922)

**Date:** 2026-07-26
**Design:** [ADR: Rebase the current validated branch before publication](../decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md)
**Stories:** [Parallel validation with serial, fenced publication](../stories/ship-tail-parallel-validation-serial-publication-922.md)
**Conflict check:** [Clean as of 2026-07-26](../conflicts/2026-07-26-ship-tail-rebase-prerequisite.md)

## Summary

Preserve the capped concurrent validation group, make native rebase wait for its joined tail, and
add a current-HEAD validation fence immediately before every finish dispatch. Seven focused tasks
cover normal, resume, already-done-rebase, explicit-finish, valid-skip, invalidation, and conflict
paths without introducing new persistent state or a second group implementation.

## Technical Approach

Keep the existing `VALIDATION_GROUP` and `validation_concurrency` fan-out/fan-in unchanged. Change
rebase's prerequisite from `manual_test` to `retro`; preserve the existing `finish → rebase` edge,
pre-loop re-kick rebase, and changed-rebase invalidation logic.

Before the existing self-host finish gates and before `finish` is marked `in_progress`, add one
engine-owned fence. It resolves `VALIDATION_GROUP` membership through `resolveGroupMembership`,
excluding only members skipped by the existing policies. It then recomputes objective completion
for every applicable member with `computeAndWriteVerdict` and the current completion context,
including manual-test FAIL-row classification. An applicable member is green only when its state is
`done` and its fresh objective result passes. On failure, mark only non-green applicable members
`stale`, persist state, emit their refreshed `gate_verdict` events plus one `kickback` from finish
to the earliest member, reset the loop index to that member, and continue without dispatching
finish. The normal group path then reruns multiple stale members concurrently while preserving
green siblings. No new event type, configuration, state field, verdict schema, or publisher is
needed.

## Prerequisites

- Approved `adr-2026-07-26-rebase-tail-current-branch-before-publication`.
- Existing conductor test dependencies installed in `src/conductor/`.

## Tasks

### Task 1: Write the publication-fence acceptance specification
**Story:** ST-922-1 — concurrent join and no-bypass criteria
**Type:** acceptance RED

**Steps:**
1. Add an acceptance fixture with `rebase:'done'`, `manual_test:'done'`, `prd_audit:'failed'`, and
   `architecture_review_as_built:'stale'`; seed current and stale evidence explicitly.
2. Assert both resume-shaped entry and explicit `fromStep:'finish'` produce no `step_started` event
   for finish, refresh the three validation verdicts, emit a finish-to-validation kickback, and
   dispatch the non-green members through the existing group under its concurrency cap.
3. Add the all-green current-HEAD counterpart asserting the parallel group joins and finish starts
   only after rebase and the fence.
4. Run the new file and confirm RED against the current finish path.

**Files:** src/conductor/test/acceptance/ship-tail-publication-fence-922.acceptance.test.ts
**Wired-into:** none (acceptance specification only)
**Dependencies:** none

### Task 2: Place native rebase after the validation join and retro
**Story:** ST-922-1 — joined ordering criterion
**Type:** happy-path

**Steps:**
1. Write failing registry/gate tests requiring rebase to wait while retro is pending and allowing
   it when retro is done or validly skipped.
2. Change `rebase.prerequisites` from `manual_test` to `retro`; update comments to state that the
   parallel validation join precedes the serial retro → rebase → finish tail.
3. Run the focused registry/gate tests and confirm GREEN.

**Files:** src/conductor/src/engine/steps.ts; src/conductor/test/engine/gates.test.ts; src/conductor/test/engine/steps.test.ts
**Wired-into:** src/conductor/src/engine/conductor.ts#Conductor.run, src/conductor/src/engine/gates.ts#checkGate
**Dependencies:** none

### Task 3: Implement the current-HEAD finish validation fence
**Story:** ST-922-1 — current-HEAD and stale/failed criteria
**Type:** safety boundary

**Steps:**
1. Add a private fence result/evaluation method on `Conductor` that uses `VALIDATION_GROUP`,
   `resolveGroupMembership`, `completionCtx`, `computeAndWriteVerdict`, and
   `readManualTestFailRows`; do not create a new satisfaction predicate or persisted token.
2. Require `done` state plus fresh objective satisfaction for each applicable member; treat stale,
   failed, pending, in-progress, invalid evidence, and manual-test FAIL rows as non-green.
3. Return the ordered non-green members and a bounded evidence reason; validly skipped members are
   absent from the result.
4. Unit-test all-green, mixed non-green, current artifact with stale state, manual-test FAIL rows,
   and every existing membership skip class.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor.test.ts
**Wired-into:** src/conductor/src/engine/gate-verdicts.ts#computeAndWriteVerdict; src/conductor/src/engine/conductor.ts#resolveGroupMembership
**Dependencies:** Task 1

### Task 4: Wire the fence before every finish dispatch
**Story:** ST-922-1 — normal, resume, and explicit-finish paths
**Type:** integration point

**Steps:**
1. Invoke the fence in the single run-loop finish branch after ordinary prerequisite checks but
   before self-host finish gates, `in_progress`, `step_started`, or the finish runner.
2. On non-green, mark only the returned members stale, persist once, emit refreshed `gate_verdict`
   events and one `kickback`, set the loop index to the earliest member, and continue.
3. Keep `fromStep`'s resume-clamp exemption unchanged; update the #532 regression so it proves the
   start target is honored while the finish fence still prevents publication.
4. Run Task 1's acceptance file and the existing #532/resume tests; confirm GREEN without a
   finish-dispatch side effect on blocked cases.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/acceptance/ship-tail-publication-fence-922.acceptance.test.ts; src/conductor/test/engine/conductor.test.ts
**Wired-into:** src/conductor/src/engine/conductor.ts#Conductor.run finish pre-dispatch branch
**Dependencies:** Tasks 2, 3

### Task 5: Prove selective parallel rerun and valid skips
**Story:** ST-922-1 — concurrent rerun and valid-skip criteria
**Type:** acceptance paths

**Steps:**
1. Assert two non-green applicable members become stale and rerun through the existing concurrent
   group while a green sibling is not redispatched.
2. Cover one member skipped by tier/track/config and show the fence evaluates only applicable
   members; cover skipped retro still allowing rebase.
3. Assert event ordering: parallel validation completion, rebase, fresh fence verdicts, then finish.

**Files:** src/conductor/test/acceptance/ship-tail-publication-fence-922.acceptance.test.ts; src/conductor/test/engine/gates.test.ts
**Wired-into:** existing Conductor.run validation-group path
**Dependencies:** Task 4

### Task 6: Preserve changed-rebase and conflict safety
**Story:** ST-922-1 — rebase negative paths
**Type:** negative-path

**Steps:**
1. Strengthen the changed-rebase integration fixture to prove invalidated validation reruns before
   the finish fence can pass.
2. Strengthen the conflict-HALT fixture to prove finish is absent and no publication result is
   recorded.
3. Preserve the pre-loop re-kick rebase and existing invalidation/evidence-translation mechanics.

**Files:** src/conductor/test/integration/rebase-loop.test.ts
**Wired-into:** existing Conductor.run rebase-invalidation and conflict-HALT paths
**Dependencies:** Task 4

### Task 7: Update affected finish fixtures and verify the boundary
**Story:** ST-922-1 — cross-suite regression
**Type:** regression

**Steps:**
1. Update existing tests that explicitly start at finish to seed valid current-HEAD validation
   evidence when they are testing behavior beyond the new fence; retain blocked fixtures where the
   fence itself is under test.
2. Run the scoped acceptance, conductor, selector/gate, merged-PR guard, durability, and rebase-loop
   suites; then run typecheck and the full conductor test suite.
3. Render the updated architecture diagram and run the documentation link/diagram checks.

**Files:** src/conductor/test/engine/conductor.test.ts; src/conductor/test/engine/merged-pr-guard-kickback.test.ts; src/conductor/test/acceptance/pipeline-durability.test.ts; .docs/architecture/sequences/parallel-validation-phase-fan-out-manual-test-prd-.md
**Wired-into:** none (fixture and verification task)
**Dependencies:** Tasks 5, 6

## Task Dependency Graph

```text
Task 1 ─────→ Task 3 ─┐
Task 2 ───────────────┴→ Task 4 ┬→ Task 5 ─┐
                                └→ Task 6 ─┴→ Task 7
```

## Integration Points

- After Task 2: the parallel validation join feeds the serial retro → rebase → finish tail.
- After Task 4: every finish entry path crosses the current-HEAD validation fence.
- After Task 5: a fence redirect retains capped fan-out for multiple non-green members.

## Coverage Mapping

| Story criterion | Tasks |
|---|---|
| Validation remains concurrent and joins | 1, 5 |
| Rebase waits for joined validation and retro | 2, 5 |
| Current-HEAD fence precedes every finish dispatch | 1, 3, 4 |
| Explicit `--from finish` cannot bypass publication safety | 1, 4 |
| Valid skips are excluded; stale/failed applicable members block | 3, 5 |
| Multiple non-green members rerun concurrently | 1, 5 |
| Changed rebase revalidates before finish | 6 |
| Rebase conflict suppresses finish publication | 6 |

## Verification

- [ ] All happy-path criteria are covered by Tasks 1–5.
- [ ] All negative-path criteria are covered by Tasks 1, 3–6.
- [ ] Dependencies are explicit and acyclic.
- [ ] Scoped acceptance, gate, registry, resume, finish, and rebase-loop tests pass.
- [ ] Typecheck, full conductor tests, and diagram checks pass.
