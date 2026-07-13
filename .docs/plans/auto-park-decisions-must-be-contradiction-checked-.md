# Implementation plan — Contradiction-check auto-park against completion evidence

**Date:** 2026-07-13 · **Tier:** S · **Track:** technical · **Intake:** jstoup111/ai-conductor#612
**Stories:** .docs/stories/auto-park-decisions-must-be-contradiction-checked-.md (Accepted, Stories 1-3)

Add a deterministic contradiction guard at the daemon auto-park decision point so
a build whose own run evidence shows completed work (`summary.json`
`tasks_completed > 0`, non-empty task-evidence stamps, or `resolvedTasksAfter >
0`) is never parked with the immediate reason `empty/missing plan`. On
contradiction the guard strips the immediate reason (the durable no-evidence
counter semantics are preserved unchanged), emits a loud
`auto_park_contradiction` event, and the run re-enters the existing retry/stall
path. A genuinely empty/missing plan (all signals zero) parks exactly as today.

Root cause (verified): `conductor.ts:2196-2200` derives `emptyPlan` from the gate
reason string alone; `daemon-auto-park.ts:48-50` treats an explicit reason as
immediately terminal. On 2026-07-13 the false `no tasks in plan` signal (#578
parser bug, fix in flight) parked `2026-07-12-rtk-hook-preservation` despite its
`summary.json` recording 5/5 completed tasks. Complementary to #578 (this guard
makes the decision point safe against ANY false empty-plan signal) and sibling to
#569 (remediation-bypass class; full routing generalization stays in #569's scope).

## Summary

All paths under `src/conductor/`. Test-first (RED → GREEN); run tests from
`src/conductor` (`npm install` per worktree; vitest config lives there). One new
helper + guard call in `daemon-auto-park.ts`, one call-site change in
`conductor.ts:2193-2225`, one additive event union member in `types/events.ts`
(pattern: `auto_park` at `:205-210`) with log rendering. No config, CLI, hook,
or schema surface.

## Tasks

### Task 1: Tolerant completion-signal reader
**Story:** Story 1 (summary.json signal; corrupt summary tolerated)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-auto-park.test.ts`
   (create beside `conductor-auth-park.test.ts` conventions): a new exported
   `readCompletionSignals(projectRoot)` returns `{ summaryTasksCompleted }`
   parsed from `.pipeline/summary.json`; cases: valid summary with
   `tasks_completed: 5` → 5; missing file → 0; corrupt JSON → 0 (no throw);
   `tasks_completed` absent/non-numeric → 0.
2. Verify RED.
3. Implement `readCompletionSignals` in
   `src/conductor/src/engine/daemon-auto-park.ts` (tolerant read mirroring the
   sidecar-read tolerance in `task-evidence.ts:71-116`; session-authored input,
   fail-closed to 0).
4. Verify GREEN.
5. Commit: "feat(daemon): tolerant completion-signal reader for auto-park guard (#612)"

**Files:**
- src/conductor/src/engine/daemon-auto-park.ts
- src/conductor/test/engine/daemon-auto-park.test.ts

**Dependencies:** none

### Task 2: Contradiction guard primitive
**Story:** Story 1 (refusal on any non-zero signal; genuine empty plan still parks)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing tests: a new exported
   `detectParkContradiction(projectRoot, { resolvedTasks, evidenceStampCount })`
   returns a non-null contradiction descriptor
   `{ summaryTasksCompleted, evidenceStamps, resolvedTasks }` when ANY signal
   is > 0, and `null` when all are zero. Cases: only summary > 0; only stamps
   > 0; only resolvedTasks > 0; all zero → null.
2. Verify RED.
3. Implement in `daemon-auto-park.ts`, composing `readCompletionSignals` from
   Task 1. Pure decision — no marker writes, no events.
4. Verify GREEN.
5. Commit: "feat(daemon): detect empty-plan park contradiction from completion evidence (#612)"

**Files:**
- src/conductor/src/engine/daemon-auto-park.ts
- src/conductor/test/engine/daemon-auto-park.test.ts

**Dependencies:** Task 1

### Task 3: `auto_park_contradiction` event type + log rendering
**Story:** Story 2 (loud refusal naming verdict + evidence)
**Type:** happy-path

**Steps:**
1. Write failing test asserting the event union accepts
   `{ type: 'auto_park_contradiction', slug, verdict: 'empty/missing plan',
   evidence: { summaryTasksCompleted, evidenceStamps, resolvedTasks } }` and
   that the daemon event log rendering produces a human-readable line
   containing `auto_park_contradiction`, the slug, the refused verdict, and the
   non-zero evidence counts (locate the renderer that formats `auto_park` lines
   and extend the same seam).
2. Verify RED.
3. Implement: additive member in `src/conductor/src/types/events.ts` (beside
   `auto_park`, `:205-210`) + rendering at the same sink that renders
   `auto_park`.
4. Verify GREEN.
5. Commit: "feat(daemon): auto_park_contradiction event + loud log line (#612)"

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/test/engine/daemon-auto-park.test.ts (or the renderer's own test file, matching where `auto_park` rendering is tested)

**Dependencies:** Task 2

### Task 4: Wire the guard at the conductor decision point
**Story:** Story 1 (refusal path), Story 3 (counter park + interactive mode unchanged)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing integration tests beside the existing auto-park coverage in
   `src/conductor/test/engine/conductor-auth-park.test.ts` seams: with a
   daemon-mode build gate miss whose reason matches the empty-plan grammar and
   a seeded `.pipeline/summary.json` (`tasks_completed > 0`), `checkAndAutoPark`
   is invoked WITHOUT `reason` (no `empty/missing plan` park marker; the
   `auto_park_contradiction` event is emitted); with all signals zero the park
   fires with reason `empty/missing plan` exactly as today and NO contradiction
   event is emitted; a refused feature whose durable `noEvidenceAttempts`
   reaches the threshold still parks with the counter reason (Story 3).
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts:2193-2225`: after
   deriving `emptyPlan`, call `detectParkContradiction(this.projectRoot,
   { resolvedTasks: resolvedTasksAfter, evidenceStampCount:
   this.taskEvidence?.evidenceStamps.size ?? 0 })`; when `emptyPlan` and the
   descriptor is non-null, emit `auto_park_contradiction`, and call
   `checkAndAutoPark` WITHOUT the `reason` option (counter semantics preserved,
   `daemon-auto-park.ts:51-55`); keep the reason when no contradiction. The
   `parkResult.parked` handling and HALT text are unchanged.
4. Verify GREEN. Also run the untouched neighboring suites
   (`conductor-auth-park.test.ts`, `park-marker*.test.ts`) to confirm no
   regression; verify exit codes directly, never through a pipe.
5. Commit: "fix(daemon): refuse empty-plan auto-park that contradicts completion evidence (#612)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-auth-park.test.ts

**Dependencies:** Task 3

### Task 5: CHANGELOG + docs
**Story:** all (release gate)
**Type:** happy-path

**Steps:**
1. Add a `## [Unreleased]` → `### Fixed` entry in `CHANGELOG.md`: auto-park
   decisions are contradiction-checked against completion evidence; a build
   with completed-task evidence is never parked as `empty/missing plan` (#612).
2. Reflect the new guard in `src/conductor/README.md` where auto-park behavior
   is documented (internal engine behavior — no consumer-facing CLI/hook/schema
   change, so no Migration block).
3. Run `test/test_harness_integrity.sh` from the repo root; verify green.
4. Commit: "docs: changelog + auto-park contradiction guard notes (#612)"

**Files:**
- CHANGELOG.md
- src/conductor/README.md

**Dependencies:** Task 4

## Task Dependency Graph

- Task 1 → Task 2 → Task 3 → Task 4 → Task 5

## Non-goals

- Fixing `parsePlanTaskPaths`'s `### T0 — Title` rejection (that is #578, in flight).
- Generalizing remediation routing for all bail paths (#569's scope).
- Any change to the `no completion evidence after N attempts` counter park,
  re-kick, or interactive stall-REPL behavior.
