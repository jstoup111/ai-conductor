# Implementation Plan: Build progress marker increments per completed task (#757)

**Date:** 2026-07-21
**Track:** technical (no PRD)
**Complexity:** S
**Stories:** .docs/stories/build-progress-marker-stays-0-n-for-the-whole-buil.md
**Conflict check:** N/A (Small tier — skipped)

## Summary

Make the daemon's live `▶ build X/N` counter reflect real progress during a build
session by computing `resolved` from git-derived evidence (the same source the build
gate re-derives from) instead of from `.pipeline/task-status.json`'s stored
completed/skipped status. 13 tasks, display/observability-only, read-only w.r.t. disk.

## Technical Approach

**Root cause.** `readSnapshot()` and `BuildProgressWatcher.tick()`
(`src/conductor/src/engine/build-progress-watcher.ts`) compute
`resolved = tasks.filter(t => t.status==='completed' || t.status==='skipped').length`
from `.pipeline/task-status.json`. That file is only reconciled at the build-gate
boundary (`conductor.ts:3216-3253`), so `resolved` stays frozen mid-session and only
jumps at the boundary. The daemon-cli render line (`daemon-cli.ts:1712-1723`) is
faithful and needs no change.

**Fix (approach B).** Derive the live `resolved` count from git, reusing
`deriveCompletion(projectRoot, planPath)` (`autoheal.ts:902`) — the exact function the
gate uses (`conductor.ts:3231`). Its result maps `taskId -> { completed, status }`;
count entries where `completed === true || status === 'skipped'`, clamped to `total`.

**Read-only guarantee (load-bearing).** `deriveCompletion` calls `evidence.write()`
(`autoheal.ts:880`), persisting the task-evidence sidecar. Calling it raw from the
poll hot path would be a mid-session write racing the gate's own reconciliation.
Task 1 adds an explicit read-only mode that skips `evidence.write()`, so the watcher's
derivation touches no disk state. task-status.json remains solely owned/reconciled by
the conductor's gate — its boundary correctness contract is unchanged.

**Plan-path plumbing.** The watcher needs the active plan path to derive. The conductor
knows it (`getActivePlanPath()`) at the watcher construction site (`conductor.ts:2825`);
Task 2 threads it in via a new optional `planPath` on `BuildProgressWatcherOptions`.

**Hot-path contract.** `readSnapshot`'s documented invariant — "callers on the polling
hot path must never see readSnapshot throw" — is preserved: when the plan path is
absent or derivation throws, the code falls back to the existing task-status.json count
and never propagates. A shared `computeResolved()` helper backs both `readSnapshot` and
`tick` so the two paths cannot drift.

## Prerequisites

- None. `deriveCompletion` already exists and is exercised by the gate.

## Tasks

### Task 1: Add read-only mode to `deriveCompletion`
**Story:** Story 2 / Story 3 (no-write, no-race guarantee)
**Type:** infrastructure

**Steps:**
1. Write failing test: `deriveCompletion(projectRoot, planPath, undefined, undefined, undefined, { readOnly: true })` does NOT modify `.pipeline/task-evidence.json` (assert content+mtime unchanged) while still returning the derived result map.
2. Verify test fails (RED).
3. Implement: add a 6th optional param `opts?: { readOnly?: boolean }` to `deriveCompletion`; thread it to `deriveCompletionInternal` and skip the `await evidence.write()` at line ~880 when `readOnly` is true. Existing callers (no 6th arg) are unaffected.
4. Verify test passes (GREEN).
5. Commit: "feat(autoheal): read-only mode for deriveCompletion (no sidecar write)"

**Files likely touched:**
- src/conductor/src/engine/autoheal.ts — new `readOnly` option; guard `evidence.write()`

**Wired-into:** src/conductor/src/engine/build-progress-watcher.ts#computeResolved (call site added in Task 3)
**Dependencies:** none

### Task 2: Thread active plan path into the watcher
**Story:** Story 1 (watcher needs the plan to derive)
**Type:** infrastructure

**Steps:**
1. Write failing test: constructing `BuildProgressWatcher` with `{ planPath: '/x/plan.md', ... }` retains it (exposed via a readonly field or observable through a derivation call in later tasks).
2. Verify test fails (RED).
3. Implement: add optional `planPath?: string` to `BuildProgressWatcherOptions` and store it on the instance. At the conductor construction site (`conductor.ts:2825`), resolve `await this.getActivePlanPath()` just before construction and pass it (absolute-joined to `projectRoot`, or `undefined` when null).
4. Verify test passes (GREEN).
5. Commit: "feat(build-progress): thread active plan path into the watcher"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — `planPath` option + field
- src/conductor/src/engine/conductor.ts — pass `planPath` at construction (~line 2825)

**Wired-into:** src/conductor/src/engine/conductor.ts (BuildProgressWatcher construction, ~line 2825)
**Dependencies:** none

### Task 3: `computeResolved` helper derives from git in `readSnapshot`
**Story:** Story 1 (happy path — live increment)
**Type:** happy-path

**Steps:**
1. Write failing test: git fixture where K of N plan tasks are git-derived complete but `task-status.json` still shows 0 completed; `readSnapshot(projectRoot, planPath)` returns `resolved === K`, `total === N`.
2. Verify test fails (RED).
3. Implement: add a shared `computeResolved({ projectRoot, planPath, tasks, total })` that, when `planPath` is set, calls `deriveCompletion(projectRoot, planPath, …, { readOnly: true })` and counts `completed || status==='skipped'`; wire `readSnapshot` to use it (falling back to the task-status count when `planPath` is absent). Pass `planPath` as a new optional arg to `readSnapshot`.
4. Verify test passes (GREEN).
5. Commit: "feat(build-progress): derive live resolved from git in readSnapshot"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — `computeResolved` helper; `readSnapshot` uses it

**Wired-into:** src/conductor/src/engine/build-progress-watcher.ts#readSnapshot
**Dependencies:** Task 1

### Task 4: Skipped counts as resolved; clamp `resolved <= total`
**Story:** Story 1 (skipped-as-resolved; overcount clamp)
**Type:** happy-path

**Steps:**
1. Write failing tests: (a) a plan task derived `status==='skipped'` is counted in `resolved`; (b) when derivation yields more completed than `total`, `resolved` is clamped to `total` (`resolved <= total` always).
2. Verify tests fail (RED).
3. Implement: include `status==='skipped'` in the count; wrap the count in `Math.min(count, total)` inside `computeResolved`.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-progress): count skipped as resolved; clamp to total"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — count + clamp in `computeResolved`

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 5: `tick()` emits git-derived resolved (change-driven)
**Story:** Story 1 (emission advances mid-session)
**Type:** happy-path

**Steps:**
1. Write failing test: drive `BuildProgressWatcher` (with `planPath`) against a git fixture that gains a completed task between two ticks; assert the emitted `build_progress.resolved` advances (e.g. 0 → 1) via the change-driven path, with no gate reconciliation of task-status.json.
2. Verify test fails (RED).
3. Implement: replace `tick()`'s inline `resolved` computation with the shared `computeResolved` (using `this.planPath`). `total` stays `tasks.length`.
4. Verify test passes (GREEN).
5. Commit: "feat(build-progress): tick emits git-derived resolved"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — `tick()` uses `computeResolved`

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 6: Fallback when plan path is unresolvable (no throw)
**Story:** Story 2 (graceful degradation — missing plan)
**Type:** negative-path

**Steps:**
1. Write failing test: `readSnapshot`/`tick` with `planPath` undefined (or a non-existent file) does NOT throw and returns the `task-status.json` completed/skipped count (previous behavior); tick still completes/emits.
2. Verify test fails (RED).
3. Implement: in `computeResolved`, when `planPath` is falsy, return the task-status count directly (no derivation attempt).
4. Verify test passes (GREEN).
5. Commit: "fix(build-progress): fall back to task-status count when plan unresolvable"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — falsy-planPath branch

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 7: Swallow derivation errors on the hot path
**Story:** Story 2 (graceful degradation — derivation throws)
**Type:** negative-path

**Steps:**
1. Write failing test: stub/force `deriveCompletion` to throw; assert `readSnapshot` does not throw and returns the task-status fallback, and that `tick()` swallows it, emits the fallback (or skips per no-data rules), and the watcher keeps polling (no unhandled rejection).
2. Verify test fails (RED).
3. Implement: wrap the `deriveCompletion` call in `computeResolved` in try/catch; on throw, return the task-status count. Preserve the `readSnapshot` "never throws on the hot path" contract.
4. Verify test passes (GREEN).
5. Commit: "fix(build-progress): swallow git-derivation errors, fall back to task-status"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — try/catch around derivation

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 8: Preserve "no data" skip when both sources unavailable
**Story:** Story 2 (missing task-status AND no derivation → skip, no bogus 0/0)
**Type:** negative-path

**Steps:**
1. Write failing test: `.pipeline/task-status.json` missing/corrupt and derivation unavailable → `tick()` skips emission (no `0/0` event) and does not throw (existing no-data behavior preserved).
2. Verify test fails (RED).
3. Implement: keep `tick()`'s existing early-return on missing/corrupt task-status.json ahead of derivation so the no-data contract is unchanged.
4. Verify test passes (GREEN).
5. Commit: "test(build-progress): preserve no-data skip with derivation unavailable"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — ordering of no-data guard vs derivation

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 9: Live count agrees with the gate; full plan → `total`
**Story:** Story 3 (no drift; N/N at completion)
**Type:** negative-path

**Steps:**
1. Write failing test: for a given git state, the `readSnapshot` git-derived `resolved` equals the count `applyDerivedCompletion` would reconcile into task-status.json; and a fully-complete plan yields `resolved === total`.
2. Verify test fails (RED).
3. Implement: covered by Tasks 3-4 reusing `deriveCompletion`; add only assertions if a gap surfaces (else the code is unchanged and the test locks the invariant).
4. Verify test passes (GREEN).
5. Commit: "test(build-progress): live count agrees with gate reconciliation"

**Files likely touched:**
- src/conductor/test/engine/build-progress-watcher.test.ts — invariant test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3, Task 4

### Task 10: `resolved` recomputed per tick, not latched
**Story:** Story 3 (recompute; can correct downward)
**Type:** negative-path

**Steps:**
1. Write failing test: two ticks where the git-derived count decreases between them → the second emitted `resolved` reflects the lower value (never latched to a high-water mark).
2. Verify test fails (RED).
3. Implement: ensure `computeResolved` is called fresh each tick and no min/max latch is retained across ticks (no persisted high-water field).
4. Verify test passes (GREEN).
5. Commit: "test(build-progress): resolved is recomputed per tick, not latched"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — confirm no latch
- src/conductor/test/engine/build-progress-watcher.test.ts — per-tick recompute test

**Wired-into:** same as Task 3
**Dependencies:** Task 3, Task 5

### Task 11: Read-only regression guard for the watcher
**Story:** Story 3 / #757 no-race constraint
**Type:** negative-path

**Steps:**
1. Write failing test: run `readSnapshot`/a watcher tick with `planPath` against a fixture and assert `.pipeline/task-evidence.json` AND `.pipeline/task-status.json` are byte-for-byte unchanged (mtime + content) after derivation.
2. Verify test fails (RED) — proving the guard catches a writing derivation.
3. Implement: ensured by Task 1's read-only mode; add the assertion test to lock it against future regressions.
4. Verify test passes (GREEN).
5. Commit: "test(build-progress): watcher derivation never writes disk state"

**Files likely touched:**
- src/conductor/test/engine/build-progress-watcher.test.ts — no-write assertion

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1, Task 3

### Task 12: CHANGELOG entry (release gate)
**Story:** repo release gate (harness)
**Type:** infrastructure

**Steps:**
1. Add a `### Fixed` bullet under `## [Unreleased]` in `CHANGELOG.md`: "Daemon build progress counter (`▶ build X/N`) now increments live from git-derived task completion during a session, instead of staying at `0/N` until the gate boundary (#757)."
2. Verify `test/test_harness_integrity.sh` no longer flags an empty `[Unreleased]`.
3. Commit: "docs(changelog): live build progress counter (#757)"

**Files likely touched:**
- CHANGELOG.md — Unreleased/Fixed entry

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 13: Run validation + conductor test suites
**Story:** repo validation gate
**Type:** infrastructure

**Steps:**
1. Run `test/test_harness_integrity.sh` — all checks pass.
2. Run the conductor test suite (`npm test` in `src/conductor`, or the repo's configured runner) — green, including the new build-progress tests.
3. Fix any failures surfaced, then re-run.
4. Complete via evidence trailer once both suites are green.

**Files likely touched:**
- none (verification only)

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8, Task 9, Task 10, Task 11, Task 12

## Task Dependency Graph

```
Task 1 (read-only mode) ─┬─► Task 3 (readSnapshot derive) ─┬─► Task 4 (skipped/clamp)
                         │                                 ├─► Task 5 (tick derive)
                         │                                 ├─► Task 6 (plan-unresolvable fallback)
                         │                                 ├─► Task 7 (swallow errors)
                         │                                 ├─► Task 8 (no-data skip)
                         │                                 ├─► Task 9 (agrees w/ gate)  [also needs 4]
                         │                                 ├─► Task 10 (per-tick recompute) [also needs 5]
                         └─────────────────────────────────┴─► Task 11 (no-write guard)  [needs 1+3]

Task 2 (thread plan path) ── independent ──► (enables live derivation end-to-end)
Task 12 (changelog) ── independent
Task 13 (validation) ── depends on ALL of Tasks 1-12
```

## Integration Points

- After Task 2 + Task 3: end-to-end live derivation is wired — a running build's
  watcher can read git-derived progress with the plan path supplied by the conductor.
- After Task 5: emitted `build_progress` events advance mid-session; the daemon-cli
  `▶ build X/N` line moves live (no render change needed).
- After Task 13: full suite green — ship-ready.

## Verification

- [ ] All happy-path criteria covered (Tasks 3, 4, 5)
- [ ] All negative-path criteria covered (Tasks 6, 7, 8, 9, 10, 11)
- [ ] No task exceeds ~5 minutes of work
- [ ] Dependencies explicit and acyclic
- [ ] Every new-surface task carries a `Wired-into:` line
- [ ] Read-only/no-race constraint locked by Task 11
- [ ] CHANGELOG updated (Task 12); no README/CLI change (no user-facing flags)

**Status:** Accepted
