# Implementation Plan: Halt events reach the persisted spine (#1477)

**Date:** 2026-08-11
**Design:** `.docs/architecture/loop-halt-never-reaches-events-jsonl-so-a-halt-is-.md`
**Architecture review:** `.docs/decisions/review-2026-08-11-halt-events-reach-the-persisted-spine.md`
**Stories:** `.docs/stories/loop-halt-never-reaches-events-jsonl-so-a-halt-is-.md`
**Conflict check:** Clean as of 2026-08-11

## Summary

Make a halt reconstructable from `.pipeline/events.jsonl` alone, in eleven short TDD tasks.
Three halt-class events start persisting, `loop_halt` learns which step it happened in from a
single conductor-owned emit path, the audit translator stops hardcoding `build`, and a failed
halt-marker write becomes an occurrence on the same bus instead of a swallowed exception. Two
consumers whose halt-counting branches have never executed are revived and covered.

## Technical Approach

- Flip the sink declarations for `loop_halt` and `rebase_conflict_halt` in `EVENT_SINKS`. This
  is the entire routing change: `EventPersister.start()` derives its subscriptions from
  `persistedEventTypes()`, which is computed from that table. No persister edit is needed.
- Add an optional `step` to the `loop_halt` and `rebase_conflict_halt` variants of the
  `ConductorEvent` union. `StepName` is already imported and used in that file
  (`rebase_gate_invalidated.gate`).
- Introduce one private `Conductor.emitLoopHalt(reason, prUrl?)` and route every existing
  `loop_halt` emission through it. It resolves the step with the existing exported
  `resolveLastStep(state, breadcrumb)` helper, whose preference order already covers halts
  raised outside the step loop (the silent-exit backstop). No emit site passes a step, so no
  emit site — present or future — can omit it.
- Replace `audit-trail.ts`'s hardcoded `step: 'build'` with the event's own step, falling back
  to `'build'` when the field is absent so historical records still translate.
- Change `writeHaltMarker` from `Promise<void>` to a result-returning call that still never
  throws, and give it an optional `ConductorEventEmitter` so it can emit a new
  `halt_marker_write_failed` variant. Thread the emitter in from the three call sites that
  already hold one; the remaining four report through the returned result.
- Cover the revived consumers (`cost-rollup`'s `rollup.halts`, `report-renderer`'s
  `aggregateHalts` feeding `rates`' `haltRate`) with tests that drive a real halt, and pin the
  persisted-type set so the volume constraint is machine-enforced.
- Tests are focused unit and integration tests against the real emitter, persister and sink
  table. No third-party calls; no daemon run.

## Prerequisites

- Accepted stories and a clean conflict check are present.
- The ADR `adr-2026-08-11-halt-events-ride-the-persisted-spine` is APPROVED.
- No schema migration, external service, database, port, or fixture installation is required.

## Tasks

### Task 1: Persist the terminal halt

**Story:** Story 1 — the halt and its reason are recoverable from the persisted ledger.
**Type:** happy-path

**Steps:**
1. Write a failing test asserting `persistedEventTypes()` includes `loop_halt` and that a
   `loop_halt` emitted through a real `EventPersister` appears in the ledger file.
2. Verify the test fails because the sink declares `persist: false`.
3. Set `loop_halt` to `persist: true` in `EVENT_SINKS`, leaving `render` and `audit` unchanged.
4. Verify the focused tests pass.
5. Commit with message: `fix: persist loop_halt to the event spine`.

**Files:** `src/conductor/src/engine/event-sinks.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/engine/event-persister.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Persist and render the rebase-conflict halt

**Story:** Story 3 — a rebase-conflict halt is recoverable from the spine.
**Type:** happy-path

**Steps:**
1. Write a failing test asserting `rebase_conflict_halt` is in both `persistedEventTypes()`
   and `renderedEventTypes()`, and that its `reason` and `conflicts` survive into the ledger.
2. Verify the test fails — the event currently reaches no sink at all.
3. Set `rebase_conflict_halt` to `render: true, persist: true` in `EVENT_SINKS`.
4. Verify the focused tests pass.
5. Commit with message: `fix: route rebase_conflict_halt to the render and persist sinks`.

**Files:** `src/conductor/src/engine/event-sinks.ts`, `src/conductor/test/engine/event-sinks.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 3: Pin the persisted-type set against volume growth

**Story:** Story 6 — non-halt event volume does not measurably grow.
**Type:** negative-path

**Steps:**
1. Write a test pinning the exact persisted-type set, and a test asserting
   `loop_converged`, `build_review_base`, `pipeline_closeout`, `retry_decision`,
   `group_member_step`, `test_suite_verification` and the rebase-lifecycle events each still
   declare `persist: false`.
2. Verify the pin passes for the current set and fails when an unrelated type is flipped
   (assert the guard actually bites before relying on it).
3. Adjust the pinned set to admit exactly the halt-class additions from Tasks 1 and 2.
4. Verify the focused tests pass.
5. Commit with message: `test: pin the persisted event set so volume growth fails the suite`.

**Files:** `src/conductor/test/engine/event-sinks.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

### Task 4: Give the halt variants an optional step

**Story:** Story 2 — the recorded halt names the step that actually halted.
**Type:** happy-path

**Steps:**
1. Write a failing test constructing a `loop_halt` with a `step` and asserting the persisted
   record carries it through `EventPersister` unchanged.
2. Verify the test fails to typecheck because the variant has no `step` field.
3. Add an optional `step?: StepName` to the `loop_halt` and `rebase_conflict_halt` variants of
   the `ConductorEvent` union.
4. Verify the focused tests pass and the existing persister interval bookkeeping is
   undisturbed (a halt opens and closes no interval).
5. Commit with message: `feat: add an optional step to the halt event variants`.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/test/engine/event-persister.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`

**Dependencies:** Task 1

### Task 5: Stamp the step centrally on every halt

**Story:** Story 2 — every emission carries the step, and no emit site supplies it.
**Type:** happy-path

**Steps:**
1. Write a failing test driving a halt while the loop's last advanced step is `manual_test`,
   asserting the persisted record's `step` is `manual_test` rather than absent.
2. Verify the test fails because no emission stamps a step.
3. Add a private `emitLoopHalt(reason, prUrl?)` to `Conductor` that resolves the step via the
   existing `resolveLastStep(state, breadcrumb)` and emits `loop_halt`; route every existing
   `loop_halt` emission in the file through it so no `loop_halt` object literal remains
   outside it.
4. Verify the focused tests pass and the existing halt-reason assertions still hold.
5. Commit with message: `feat: stamp the halting step from one conductor-owned emit path`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`

**Dependencies:** Task 4

### Task 6: Attribute a halt raised outside the step loop

**Story:** Story 2 — the no-breadcrumb, settled-step and legacy-record negative paths.
**Type:** negative-path

**Steps:**
1. Write failing tests for three cases: a halt from the silent-exit backstop where no
   breadcrumb step was recorded, a halt raised after a step settled but before the next
   dispatched, and a halt where `state.last_step` is present.
2. Verify at least one case exposes a missing or wrong step while the existing backstop
   reason-matching assertions still pass.
3. Confirm `resolveLastStep`'s preference order covers each case, adjusting only the emit path
   where needed — do not add a step argument to any emit site.
4. Verify the focused tests pass.
5. Commit with message: `test: attribute halts raised outside the step loop`.

**Files:** same as Task 5

**Wired-into:** same as Task 5

**Dependencies:** Task 5

### Task 7: Stamp the rebase-conflict halt and stop hardcoding build in the audit record

**Story:** Story 2 — the ledger and the audit record agree on where a halt happened.
**Type:** happy-path

**Steps:**
1. Write failing tests asserting a `rebase_conflict_halt` records `step: 'rebase'`, and that a
   `loop_halt` carrying `step: 'manual_test'` audits as `manual_test` while one carrying no
   step still audits as `build`.
2. Verify the tests fail — the translator returns `step: 'build'` unconditionally.
3. Stamp `rebase` at the `rebase_conflict_halt` emission, and change the translator's
   `loop_halt` case to use the event's step with `'build'` as the absent-field fallback.
4. Verify the focused tests pass.
5. Commit with message: `fix: attribute a halt to the step it happened in`.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/audit-trail.ts`, `src/conductor/test/engine/audit-trail.test.ts`

**Wired-into:** `src/conductor/src/engine/rebase.ts#emitRebaseEvent`

**Dependencies:** Task 4

### Task 8: Make the halt marker's write outcome an occurrence

**Story:** Story 5 — a failed halt-marker write is visible.
**Type:** happy-path

**Steps:**
1. Write failing tests asserting `writeHaltMarker` reports failure in its return value when
   the write fails, reports success when it succeeds, and emits a
   `halt_marker_write_failed` record naming the marker path and the reason when an emitter is
   supplied.
2. Verify the tests fail — the function returns `void` and swallows every failure.
3. Add the `halt_marker_write_failed` variant to the union with its sink declaration and a
   terminal renderer case; change `writeHaltMarker` to return a result and accept an optional
   emitter, keeping it non-throwing.
4. Verify the focused tests pass.
5. Commit with message: `feat: surface a failed halt-marker write on the event spine`.

**Files:** `src/conductor/src/engine/halt-marker.ts`, `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/test/engine/halt-marker.test.ts`

**Wired-into:** `src/conductor/src/engine/halt-marker.ts#writeHaltMarker`

**Dependencies:** Task 3

### Task 9: Carry the new result contract to every halt-marker call site

**Story:** Story 5 — the never-throws, no-emitter, failed-emit and partial-failure paths.
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a failed write does not throw, that a call site with no
   emitter still reports failure through the result, that a failed emit does not restore the
   swallow, and that a `HALT.class` failure alongside a written `HALT` reports partial failure.
2. Verify at least one case exposes a discarded failure at a call site.
3. Update all six `writeHaltMarker` call sites to the new contract, threading the emitter from
   the three that already hold one and surfacing the result at the other four.
4. Verify the focused tests pass.
5. Commit with message: `fix: no halt-marker call site discards a write failure`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/src/engine/task-progress.ts`, `src/conductor/src/engine/self-host/gate-halt.ts`, `src/conductor/src/engine/provider-lifecycle.ts`, `src/conductor/src/engine/self-host/build-auth-preflight.ts`

**Wired-into:** `src/conductor/src/engine/halt-marker.ts#writeHaltMarker`

**Dependencies:** Task 8

### Task 10: Revive the halt counters

**Story:** Story 4 — halt counts over persisted events report real counts.
**Type:** happy-path

**Steps:**
1. Write failing tests driving real halts into a ledger and asserting `computeCostRollup`
   returns a non-zero `rollup.halts`, that `aggregateHalts` returns the matching entries, and
   that `computeSignalRates` yields a non-zero `haltRate`.
2. Verify the tests fail against any pre-existing assertion that these are zero after a halt,
   and correct that assertion with a note that the zero was the defect.
3. Confirm no consumer change is required beyond the corrected expectations — the branches
   already exist and simply never executed.
4. Add the no-halt, missing-reason and malformed-line negative cases, asserting the existing
   handling is unchanged.
5. Verify the focused tests pass.
6. Commit with message: `test: prove the halt counters report real counts`.

**Files:** `src/conductor/test/engine/cost-rollup.test.ts`, `src/conductor/test/engine/report-renderer.test.ts`, `src/conductor/test/engine/rates.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

### Task 11: Correct the documentation that states the defect as permanent

**Story:** Story 7 — the documented limitation is corrected.
**Type:** happy-path

**Steps:**
1. Rewrite the `--report` known-limitation note in
   `docs/runbooks/stalled-or-stuck-feature.md` so it no longer claims halts never reach
   `events.jsonl`, and correct the same sentence's already-false claim about `kickback`, which
   has persisted all along.
2. Update the `.pipeline/events.jsonl` event-coverage note in `docs/reference/artifacts.md`
   for the new sink set, including the new `halt_marker_write_failed` record.
3. Keep `.pipeline/HALT` documented as the park signal — the marker is durable state and is
   not replaced by the event.
4. Verify `test/test_harness_integrity.sh` passes.
5. Commit with message: `docs: halts are now recoverable from the event ledger`.

**Files:** `docs/runbooks/stalled-or-stuck-feature.md`, `docs/reference/artifacts.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ── Task 3 ── Task 8 ── Task 9
         └── Task 4 ──┬── Task 5 ──┬── Task 6
                      │            └── Task 10 ── Task 11
                      └── Task 7
```
