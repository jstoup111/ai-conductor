# Implementation Plan: Boundary-aware operator parking

**Date:** 2026-07-29
**Design:** `.docs/specs/2026-07-29-boundary-aware-operator-parking.md`
**Stories:** `.docs/stories/park-in-flight-features-at-step-boundaries-after-p.md`
**Architecture:** `.docs/decisions/adr-2026-07-29-operator-park-scheduling-unit-boundary.md`
**Conflict check:** Clean as of 2026-07-29 after one operator-resolved contradiction
**Status:** Approved

## Summary

Add one daemon-only park predicate at the conductor's shared pre-scheduling-unit boundary, return
an explicit intentional-stop result through the daemon call chain, and teach the pool and reporting
layers to treat that result as parked rather than failed. Sixteen small TDD tasks cover serial,
configured-group, SHIP-group, deterministic BUILD-group, race, resume, and interactive behavior.

## Technical Approach

- Extend `ConductorOptions` with an optional async boundary predicate and feature slug. Keep the
  option absent for every interactive caller. `Conductor.run()` returns a narrow
  `OperatorParkedTermination | undefined`; existing non-park returns do not need mass conversion.
- Track the last naturally settled scheduling unit as either `{ kind: 'step', name }` or
  `{ kind: 'group', name }`. Consult the predicate only after skip traversal and immediately before
  a pending serial/configured/built-in unit dispatches. Never poll inside a running unit.
- Emit one provider-neutral `operator_park_boundary` event and return the same immutable boundary
  identity. Do not write a PARKED/HALT worktree marker.
- Inject the predicate in `runConductorInWorktree` from `isOperatorParked(mainProjectRoot, slug)`;
  propagate the typed result through `RealDepsConfig` and `FeatureRunnerDeps`.
- Let `makeRunFeature` short-circuit on the typed result before `readOutcome`, engineer narration,
  shipment, failure escalation, or teardown. Return a fourth `FeatureStatus`, `parked`.
- Let the daemon pool retain the worktree and remember the slug as parked without installing a
  HALT-clear watcher. Durable repo-root park state remains dispatch authority; persisted lifecycle
  state remains resume authority.

## Prerequisites

- Rebase the implementation branch onto the sibling deterministic BUILD verification group before
  Task 8. If that group has not landed, coordinate implementation order rather than adding a second
  executor or weakening its explicit acceptance coverage.
- Preserve the approved concurrent-group core and its settle-all, single-writer join.
- Use injected predicates, runners, clocks, and temporary directories only. Ordinary tests must not
  launch a daemon, LLM, GitHub, network call, or timeout-ended conductor.

## Plan amendment — 2026-07-31 (operator-approved)

Core operator-park behavior remains in scope and may complete independently.
Deterministic BUILD-group integration is deferred until the sibling capability is
complete on the integration base. This feature must not register, reorder, or
locally emulate that sibling group while the prerequisite is absent.

### Verify-Claims Ledger — plan amendment — 2026-07-31

#### Claims

- [verified] this branch retains the sibling BUILD-group registration after its
  native executor was reverted; its acceptance suite has four failing cases.
- [verified] the former prose-only prerequisite did not prevent partial local
  integration.

#### Assumptions

- [load-bearing, confirmed] Core operator-park behavior may proceed without
  deterministic BUILD-group integration, while that integration must wait for
  a complete sibling capability.
  - Impact if wrong: the amended task dependency and feature scope are wrong.
  - Confirmed by: operator approval, 2026-07-31 ("yes").

**Verdict: CLEAR.**

## Tasks

### Task 1: Define the typed scheduling-boundary contract

**Story:** Stories 1-4 and 10 — shared scheduling-unit identity and intentional stop
**Type:** infrastructure

**Steps:**
1. Write a failing type/runtime unit test for step, group, and pre-first-unit parked results.
2. Verify the focused test fails (RED).
3. Add `SchedulingUnitRef`, `OperatorParkedTermination`, and the optional daemon boundary options.
4. Verify the focused test passes (GREEN).
5. Commit with message: `define operator park boundary result`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`
**Dependencies:** none

### Task 2: Register the provider-neutral boundary event

**Story:** Story 10 happy and negative paths — distinct serial/group/pre-first reporting
**Type:** infrastructure

**Steps:**
1. Write failing event-union and sink-totality tests for `operator_park_boundary`.
2. Verify the focused tests fail (RED).
3. Add the event shape and declare it rendered and persisted, but not a completion authority.
4. Verify the focused tests pass (GREEN).
5. Commit with message: `register operator park boundary event`.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/test/engine/event-sinks.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`, `src/conductor/src/daemon-cli.ts#renderDaemonEvent`
**Dependencies:** Task 1

### Task 3: Stop before the first or next serial unit

**Story:** Story 1 HP/NP; Story 4 serial HP; Story 7 first-boundary HP
**Type:** happy-path

**Steps:**
1. Write bounded failing conductor tests for pre-first-unit parking and park-after-one-serial-step.
2. Verify tests fail and terminate by explicit assertions, never runner timeout (RED).
3. Add the shared pre-unit check and update the last-settled step only after normal persistence.
4. Verify the active invocation settles once and the pending runner receives zero calls (GREEN).
5. Commit with message: `honor parks at serial step boundaries`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`
**Dependencies:** Tasks 1, 2

### Task 4: Fail toward parked on boundary-read races and errors

**Story:** Story 7 all criteria; Story 4 skipped-entry NP
**Story:** Story 4 — skipped entries must not bypass the pending-unit block
**Type:** negative-path

**Steps:**
1. Write failing tests for false→true boundary races, non-ENOENT read failure, and skipped entries
   preceding a pending unit.
2. Verify the next pending runner is currently reached (RED).
3. Make active or indeterminate reads return the typed stop without dispatching pending work.
4. Verify the current unit still drains when the marker appears just after its dispatch (GREEN).
5. Commit with message: `fail operator park boundaries closed`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`
**Wired-into:** `same as Task 3`
**Dependencies:** Task 3

### Task 5: Preserve serial status and genuine failure authority

**Story:** Story 3 serial HP/NP; Story 5 genuine-failure HP/NP
**Type:** negative-path

**Steps:**
1. Write failing tests for successful status persistence, genuine failure diagnostics, and a
   rejected persistence write.
2. Verify tests expose any park-induced rewrite or clean-stop claim over incomplete state (RED).
3. Order last-settled tracking after durable state writes and leave existing failure returns intact.
4. Verify no settled step remains `in_progress` and persistence failure remains the authority (GREEN).
5. Commit with message: `preserve natural status before parking`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`
**Wired-into:** `same as Task 3`
**Dependencies:** Task 4

### Task 6: Stop only after a configured parallel group joins

**Story:** Story 2 all criteria; Story 3 group HP/NP; Story 4 group HP
**Type:** happy-path

**Steps:**
1. Write a failing configured-group test whose members settle in controlled, different orders.
2. Verify parking currently allows the later unit to dispatch (RED).
3. Mark the group as last-settled only after `runParallelGroupViaCore` finishes its ordinary join.
4. Verify all member/group statuses are durable before the stop event and later dispatch is zero
   (GREEN).
5. Commit with message: `park after configured group join`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`, `src/conductor/test/engine/when-parallel.test.ts`
**Wired-into:** `same as Task 3`
**Dependencies:** Task 5

### Task 7: Stop only after the built-in SHIP group joins

**Story:** Story 2; Stories 3-4 and Story 8 SHIP-group criterion
**Type:** happy-path

**Steps:**
1. Write a failing auto-mode SHIP validation fixture with two started members and one later unit.
2. Verify the fixture fails at the boundary assertion (RED).
3. Record the built-in group identity after its single-writer join, without changing member
   cancellation, skip, retry, kickback, or failure classification.
4. Verify every started member settles and no later unit dispatches (GREEN).
5. Commit with message: `park after ship validation join`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`, `src/conductor/test/integration/gate-loop.test.ts`
**Wired-into:** `same as Task 3`
**Dependencies:** Tasks 5, 6

### Task 8: Prove core serial, configured, and SHIP groups inherit the gate

**Story:** Story 8 core criteria and bypass rejection, excluding deferred deterministic BUILD integration
**Type:** negative-path

**Steps:**
1. Write failing boundary and inventory tests for every currently supported
   serial, configured, and built-in SHIP dispatch entry.
2. Verify an unguarded currently-supported entry makes the tests fail (RED).
3. Route each existing entry through the same pre-unit gate and remove any
   group-specific park branch.
4. Verify serial, configured, SHIP, zero/one-member, and inventory cases pass
   (GREEN), without registering or emulating the sibling BUILD group.
5. Commit with message: `cover current park scheduling boundaries`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`
**Wired-into:** `same as Task 3`
**Dependencies:** Tasks 6, 7

### Task 8.1: Integrate the landed deterministic BUILD group

**Story:** Story 8 deferred deterministic BUILD criterion
**Type:** negative-path

**Steps:**
1. Verify the integration base provides the sibling BUILD group and its native
   suite-verifier execution path; stop with a recorded prerequisite result when
   either is absent.
2. Write a failing BUILD-group boundary test and a mechanical inventory test
   covering the landed group.
3. Route the landed group through the same pre-unit gate without changing its
   topology, registration, or native execution path.
4. Verify deterministic BUILD and full inventory cases pass (GREEN).
5. Commit with message: `cover landed build group park boundary`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`, `src/conductor/test/engine/steps.test.ts`
**Wired-into:** `same as Task 3`
**Dependencies:** Task 8; verified sibling deterministic BUILD-verification prerequisite

### Task 9: Lock interactive behavior to its existing baseline

**Story:** Story 9 all criteria
**Type:** negative-path

**Steps:**
1. Write a failing/characterization pair comparing interactive dispatch and checkpoint sequences
   with and without a repo-root park marker.
2. Verify the test would fail if the daemon predicate were made global (RED guard).
3. Keep the boundary option absent from interactive conductor construction.
4. Verify both interactive sequences are identical and no new result is required (GREEN).
5. Commit with message: `preserve interactive conduct parking behavior`.

**Files:** `src/conductor/test/engine/operator-park-boundary.test.ts`, `src/conductor/test/engine/conductor.test.ts`
**Wired-into:** `none (no new production surface)`
**Dependencies:** Tasks 3, 8

### Task 10: Inject the main-root park predicate and propagate the result

**Story:** Stories 4, 7, and 9 — daemon-only authority and typed propagation
**Type:** infrastructure

**Steps:**
1. Write failing wiring tests proving the predicate receives main root plus slug and the worktree
   wrapper returns the conductor result.
2. Verify current `Promise<void>` contracts reject the expectation (RED).
3. Extend `RealDepsConfig`/`FeatureRunnerDeps`, inject `isOperatorParked(projectRoot, item.slug)`,
   and propagate the typed value unchanged.
4. Verify worktree root is never used as park authority and read anomalies fail toward parked
   (GREEN).
5. Commit with message: `wire daemon operator park boundary`.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-boundary-park-wiring.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runConductorInWorktree`, `src/conductor/src/engine/daemon-deps.ts#makeFeatureRunnerDeps`, `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`
**Dependencies:** Tasks 4, 9

### Task 11: Return an intentional stop from the existing pre-rebase park check

**Story:** Story 7 first-boundary HP; Story 5 fast-unpark NP
**Type:** negative-path

**Steps:**
1. Write a failing test for a park after feature selection but before rebase/conductor dispatch.
2. Verify the current bare return later becomes a missing-marker error (RED).
3. Return the same `OperatorParkedTermination` from the pre-rebase check and preserve its value.
4. Remove the marker immediately after that decision and verify classification stays parked
   (GREEN).
5. Commit with message: `type pre-rebase operator park stop`.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/daemon-boundary-park-wiring.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `same as Task 10`
**Dependencies:** Task 10

### Task 12: Classify a boundary stop before reading terminal markers

**Story:** Story 5 intentional-stop HP and fast-unpark NP
**Type:** happy-path

**Steps:**
1. Write a failing `makeRunFeature` test returning the typed park with no DONE/HALT markers.
2. Verify current code calls `readOutcome` and reports error (RED).
3. Short-circuit to `{ status: 'parked' }`, keep the worktree, and skip outcome reading, engineer
   narration, shipment, processed ledger, escalation, and completion cleanup.
4. Verify all forbidden side-effect spies remain at zero and feature scope still stops (GREEN).
5. Commit with message: `classify boundary stop as parked`.

**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`
**Dependencies:** Tasks 10, 11

### Task 13: Add parked as a normal daemon-pool outcome

**Story:** Story 5 intentional-stop HP; Story 4 later-tick NP
**Type:** happy-path

**Steps:**
1. Write failing pool tests for collecting a parked result while sibling work continues.
2. Verify parked is currently rendered/handled as non-done failure (RED).
3. Extend `FeatureStatus`, retain the slug/worktree, omit machine-HALT watcher and halt callbacks,
   and render an intentional parked collection line.
4. Verify no failure color/reason, watcher, HALT callback, or processed side effect occurs (GREEN).
5. Commit with message: `handle parked feature outcomes in daemon pool`.

**Files:** `src/conductor/src/engine/daemon.ts`, `src/conductor/test/engine/daemon.test.ts`
**Wired-into:** `src/conductor/src/engine/daemon.ts#runDaemon`, `src/conductor/src/engine/daemon.ts#collectOne`
**Dependencies:** Task 12

### Task 14: Resume from durable status after unpark or restart

**Story:** Story 6 all criteria; Story 4 persistent-park NP
**Type:** negative-path

**Steps:**
1. Write failing pool/acceptance fixtures for same-process unpark and simulated daemon restart.
2. Verify settled success is currently repeated or parked cannot become eligible (RED).
3. Reuse the existing durable marker eligibility path and state-based resume without clearing or
   manufacturing lifecycle statuses.
4. Verify successful units do not repeat and failure/stale/skipped/remediation states keep their
   existing selection rules (GREEN).
5. Commit with message: `resume boundary parked features from state`.

**Files:** `src/conductor/src/engine/daemon.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon.test.ts`, `src/conductor/test/acceptance/operator-park-boundary.acceptance.test.ts`
**Wired-into:** `same as Task 13`
**Dependencies:** Task 13

### Task 15: Render and report the exact settled boundary

**Story:** Story 10 all criteria; Story 5 distinct-reporting NP
**Type:** happy-path

**Steps:**
1. Write failing daemon-render and report tests for serial, group, and pre-first-unit events.
2. Verify the new event is unhandled (RED).
3. Render feature-scoped operator-park lines and include the boundary in persisted report output
   without treating it as DONE, HALT, or generic error.
4. Verify sink inventory, daemon switch inventory, and report parsing stay exhaustive (GREEN).
5. Commit with message: `report operator park scheduling boundary`.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/report-renderer.ts`, `src/conductor/test/engine/daemon-render.test.ts`, `src/conductor/test/engine/report-renderer.test.ts`, `src/conductor/test/engine/event-sinks.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#renderDaemonEvent`, `src/conductor/src/engine/report-renderer.ts#renderReport`
**Dependencies:** Tasks 2, 10

### Task 16: Prove the core daemon boundary contract through one bounded acceptance seam

**Story:** Stories 1-10 — combined core observable contract, excluding deferred deterministic BUILD integration
**Type:** infrastructure

**Steps:**
1. Write the failing acceptance matrix using real internal conductor/runner/pool flow and injected
   step runners plus park reads; pre-resolve all unrelated lifecycle gates.
2. Verify failures identify uncovered serial, configured, SHIP, race, restart, or reporting
   behavior (RED).
3. Make only the smallest integration corrections needed; do not duplicate unit-level machinery.
4. Run the acceptance file, neighboring engine files, test-inclusive typecheck, and lint (GREEN).
5. Commit with message: `accept operator park step boundaries`.

**Files:** `src/conductor/test/acceptance/operator-park-boundary.acceptance.test.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`, `src/conductor/test/engine/daemon.test.ts`
**Wired-into:** `none (no new production surface)`
**Dependencies:** Tasks 5-15

### Task 16.1: Extend the acceptance contract for the landed BUILD group

**Story:** Story 8 deferred deterministic BUILD criterion
**Type:** negative-path

**Steps:**
1. After Task 8.1 verifies the sibling prerequisite, add the deterministic
   BUILD case to the bounded acceptance matrix.
2. Verify the case fails if the landed group bypasses the shared park gate.
3. Make the smallest integration correction without altering sibling group
   topology or execution ownership.
4. Verify the complete matrix passes (GREEN).
5. Commit with message: `accept landed build group park boundary`.

**Files:** `src/conductor/test/acceptance/operator-park-boundary.acceptance.test.ts`, `src/conductor/test/engine/operator-park-boundary.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 8.1, 16

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
                    └──────────→ 10 → 11 → 12 → 13 → 14
                         2 ─────────────────────────→ 15
5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 ───────────→ 16
8 → 8.1 → 16.1
16 ────────→ 16.1
```

External prerequisite: the sibling deterministic BUILD-verification capability
must be complete on the integration base before Task 8.1 or Task 16.1 begins.

## Integration Points

- After Task 8: every currently-supported serial/configured/SHIP scheduling unit shares one daemon pre-unit gate.
- After Task 12: conductor → worktree wrapper → feature runner preserves one typed intentional stop.
- After Task 14: daemon pool and resume behavior are complete without a HALT watcher or second marker.
- After Task 16: the core accepted product contract is proven across the minimum real internal path.
- After Task 16.1: the landed deterministic BUILD group is included in the acceptance contract.

## Coverage Check

| Story | Plan tasks |
|---|---|
| 1 | 3 |
| 2 | 6 |
| 3 | 5 |
| 4 | 4 |
| 5 | 12 |
| 6 | 14 |
| 7 | 4 |
| 8 | 8 |
| 9 | 9 |
| 10 | 2 |

## Verification

- [ ] Run focused tests after each RED/GREEN cycle from `src/conductor` with `npx vitest run <files>`.
- [ ] Run `npm run typecheck:test`; it covers both production and test TypeScript.
- [ ] Run `npm run lint`.
- [ ] Run the configured aggregate gate exactly: `cd src/conductor && npm test`.
- [ ] Run repository validation: `test/test_harness_integrity.sh`.
- [ ] Confirm no ordinary test invokes a real daemon, provider, GitHub, network, or package registry.
- [ ] Confirm every started promise is awaited and every temporary directory is removed after work settles.
- [ ] Confirm all 10 FRs and every happy/negative criterion map to the tasks above.
- [ ] Confirm all production surfaces have declared `Wired-into:` call sites and the graph is acyclic.

**Status:** Approved
