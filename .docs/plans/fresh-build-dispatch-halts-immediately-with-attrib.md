# Implementation Plan: Seed task-status.json before the pre-dispatch attribution guard

**Date:** 2026-07-20
**Track:** technical (Small tier)
**Stories:** .docs/stories/fresh-build-dispatch-halts-immediately-with-attrib.md
**Complexity:** .docs/complexity/fresh-build-dispatch-halts-immediately-with-attrib.md (Tier: S)
**Source:** jstoup111/ai-conductor#692
**Conflict check:** N/A (Small tier — skipped)

## Summary

Fix the deterministic false-halt in #692: on a fresh/daemon build dispatch, the #676 pre-dispatch
attribution-machinery guard (`checkAttributionMachineryIntact`, `conductor.ts:584`) trips because
`.pipeline/task-status.json` is not yet seeded — it is only seeded lazily by the post-dispatch build
completion predicate (`artifacts.ts:927`). Seed it from the committed plan *before* the guard runs,
keeping the guard's real protection intact. 7 tasks.

## Technical Approach

The bug is purely an **ordering** asymmetry. At worktree setup, `writeSessionHooks()`
(`worktree-prepare.ts:70`) seeds `.pipeline/session-hooks/*`, and the `.pipeline/current-task` stamp
path is lazily writable — two of the three machinery pieces the guard checks. But
`.pipeline/task-status.json` is only seeded by `seedTaskStatus` inside the post-dispatch completion
predicate. The pre-dispatch guard therefore sees it missing on the first attempt and HALTs before any
work (0 commits, survives a clean retry — exactly #692).

Design (Approach A — seed-then-check at the seam):

1. **New exported helper** in `conductor.ts` (thin, unit-testable), e.g.
   `seedAndCheckAttributionMachinery(projectRoot, featureDesc)`:
   - Resolve the plan via `resolveFeaturePlanPath(projectRoot, featureDesc)` — the same resolver the
     completion predicate already uses; it explicitly handles the daemon-preseeded case by reading
     the committed `.docs/plans/` artifact (`artifacts.ts:233`, "daemon-preseeded runs never execute
     the plan step").
   - If a plan resolves, call `seedTaskStatus(projectRoot, planPath)` (idempotent — merges existing
     rows, never resets completed/in-progress; `task-seed.ts:112`). On a seed-write throw, return a
     **distinct seed-failure diagnostic** (not the "task-status.json is missing" wording).
   - Call `checkAttributionMachineryIntact(projectRoot, { planResolvable })` and return its result.
2. **Extend the guard signature** `checkAttributionMachineryIntact(projectRoot, opts?: { planResolvable?: boolean })`:
   when `task-status.json` is missing AND `planResolvable === false`, return a distinct
   **"plan unresolvable — cannot seed task-status.json"** message pointing the operator at the
   missing/ambiguous plan; otherwise the existing wording (defensive — after a successful seed the
   file exists so this branch is not reached). The session-hooks and stamp-path branches are
   unchanged.
3. **Wire** the helper into the seam at `conductor.ts:2764`, replacing the direct
   `checkAttributionMachineryIntact(this.projectRoot)` call, gated on the unchanged
   `step.name === 'build' && isEnforcementConfigured(this.config)`. `state.feature_desc` is in scope
   at that seam (already used at `conductor.ts:2747`).

Scope guarantee: everything stays behind `isEnforcementConfigured` + `step.name === 'build'`, so
enforcement-off and non-build steps are byte-for-byte unchanged; the post-dispatch completion-predicate
seed remains as-is (this only adds a pre-dispatch seed on the guarded path).

## Prerequisites

- None. All primitives already exist and are imported in `conductor.ts`: `resolveFeaturePlanPath`
  (line 82), `isEnforcementConfigured` (line 50), `seedTaskStatus` (line 175).

## Tasks

### Task 1: Extend guard with planResolvable + distinct plan-unresolvable diagnostic
**Story:** "Unresolvable plan surfaces a distinct diagnostic" — negative paths.
**Type:** negative-path

**Steps:**
1. Write failing test: in `attribution-conductor-wiring.test.ts`, call the guard (export it for test if not already reachable) against a temp dir where `.pipeline/` exists, session-hooks present, stamp path writable, `task-status.json` ABSENT, with `{ planResolvable: false }`; assert the returned string references an unresolvable/ambiguous **plan** and does NOT contain "task-status.json is missing".
2. Verify test fails (RED).
3. Implement: add `opts?: { planResolvable?: boolean }` to `checkAttributionMachineryIntact`; in the task-status.json-missing branch, when `opts?.planResolvable === false` return the distinct plan-unresolvable message.
4. Verify test passes (GREEN).
5. Commit: "fix(attribution): distinct plan-unresolvable diagnostic in pre-dispatch guard"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — guard signature + branch
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — new test

**Wired-into:** `src/conductor/src/engine/conductor.ts#seedAndCheckAttributionMachinery` (call site added in Task 5)
**Dependencies:** none

### Task 2: Add exported seed-then-check helper (happy path)
**Story:** "Fresh dispatch seeds task-status.json and proceeds" — happy path.
**Type:** happy-path

**Steps:**
1. Write failing test: temp dir with `.pipeline/` present, all session-hooks present, stamp path writable, a single resolvable plan under `.docs/plans/`, `task-status.json` ABSENT; call `seedAndCheckAttributionMachinery(projectRoot, featureDesc)`; assert it returns `null` (intact) AND `.pipeline/task-status.json` now exists with one row per plan task.
2. Verify test fails (RED) — helper does not exist yet.
3. Implement: add exported `seedAndCheckAttributionMachinery(projectRoot, featureDesc)` that resolves the plan, seeds when resolvable, then calls the guard with `{ planResolvable }`.
4. Verify test passes (GREEN).
5. Commit: "feat(attribution): seed task-status.json before pre-dispatch guard"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — new exported helper
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — new test

**Wired-into:** `src/conductor/src/engine/conductor.ts#run` (the build-step seam, wired in Task 5)
**Dependencies:** Task 1

### Task 3: Seed-write failure returns a distinct diagnostic
**Story:** "Fresh dispatch..." — negative path (seed itself fails).
**Type:** negative-path

**Steps:**
1. Write failing test: force `seedTaskStatus` to throw (e.g. make `.pipeline/` unwritable or inject a plan path that makes the seed write fail); assert `seedAndCheckAttributionMachinery` returns a string naming the **seed-write failure**, distinct from the "task-status.json is missing" wording, and does not return `null`.
2. Verify test fails (RED).
3. Implement: wrap the `seedTaskStatus` call in try/catch; on throw return the distinct seed-failure diagnostic.
4. Verify test passes (GREEN).
5. Commit: "fix(attribution): surface seed-write failure distinctly at pre-dispatch seam"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — try/catch in helper
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — new test

**Wired-into:** same as Task 2
**Dependencies:** Task 2

### Task 4: Resumed build preserves existing progress (idempotency regression)
**Story:** "Fresh dispatch..." — negative path (resumed build with prior progress).
**Type:** negative-path

**Steps:**
1. Write failing test: pre-write `.pipeline/task-status.json` with a `completed` row (and matching evidence sidecar so H8 does not demote it) plus the machinery intact; call `seedAndCheckAttributionMachinery`; assert the completed row is still `completed` afterward (no reset-to-pending) and the guard returns `null`.
2. Verify test fails or passes (RED/confirm) — `seedTaskStatus` already merges; this locks the behavior at the new seam so a future refactor cannot regress it.
3. Implement: no new logic if the merge holds; otherwise ensure the helper does not overwrite. Keep the test as the regression lock.
4. Verify test passes (GREEN).
5. Commit: "test(attribution): lock resumed-build progress preservation at pre-dispatch seed"

**Files likely touched:**
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — new test
- `src/conductor/src/engine/conductor.ts` — only if a guard against overwrite is needed

**Wired-into:** none (no new production surface)
**Dependencies:** Task 2

### Task 5: Wire the helper into the build-step pre-dispatch seam
**Story:** "Fresh dispatch..." — happy path (end-to-end at the seam).
**Type:** infrastructure

**Steps:**
1. Write failing test: exercise the conductor build-step path (or an assertion that the seam calls the helper) with enforcement configured, a fresh worktree (plan present, task-status.json absent); assert no HALT marker referencing "task-status.json is missing" is written on attempt 1 and the dispatch proceeds.
2. Verify test fails (RED).
3. Implement: at `conductor.ts:2764`, replace `? await checkAttributionMachineryIntact(this.projectRoot)` with `? await seedAndCheckAttributionMachinery(this.projectRoot, state.feature_desc)`, keeping the same `step.name === 'build' && isEnforcementConfigured(this.config)` gate.
4. Verify test passes (GREEN).
5. Commit: "feat(attribution): wire seed-then-check into build pre-dispatch seam (#692)"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — seam call site (line ~2764)
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — seam test

**Wired-into:** `src/conductor/src/engine/conductor.ts#run` (build-step retry loop, line ~2764)
**Dependencies:** Task 2, Task 3

### Task 6: Genuine-brokenness + enforcement-off regressions
**Story:** "Genuinely broken machinery still HALTs" (all paths) + "Unresolvable plan..." enforcement-off scoping.
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) missing a session-hook script → helper still returns the session-hooks HALT diagnostic; (b) unwritable stamp path → still returns the stamp-path diagnostic; (c) no `.pipeline/` dir → returns `null` (benign), no false HALT; (d) enforcement NOT configured → seam does not invoke the helper (no new pre-dispatch seed side effect).
2. Verify tests fail where behavior is missing (RED).
3. Implement: ensure the helper delegates the session-hooks/stamp/no-.pipeline branches unchanged to `checkAttributionMachineryIntact`; confirm the seam gate leaves enforcement-off untouched.
4. Verify tests pass (GREEN).
5. Commit: "test(attribution): guard real-brokenness + enforcement-off scoping at pre-dispatch seam"

**Files likely touched:**
- `src/conductor/test/engine/attribution-conductor-wiring.test.ts` — new tests
- `src/conductor/src/engine/conductor.ts` — only if a branch needs adjustment

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5

### Task 7: Changelog + harness integrity
**Story:** Release gate (harness repo policy).
**Type:** infrastructure

**Steps:**
1. Add a `## [Unreleased]` → `### Fixed` entry in `CHANGELOG.md` describing the #692 fix (fresh build dispatch no longer false-halts on unseeded task-status.json). PATCH — no migration block (no `bin/conduct` CLI, hook wiring, skill symlink, or settings.json schema change; internal engine only).
2. Run `test/test_harness_integrity.sh` and the conductor test suite; verify green.
3. Verify no docs reference the old behavior as intended.
4. Commit: "docs(changelog): record #692 pre-dispatch seed fix [Unreleased]"

**Files likely touched:**
- `CHANGELOG.md` — Unreleased/Fixed entry

**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 ─┐
        ├─▶ Task 2 ─┬─▶ Task 3 ─┐
        │           └─▶ Task 4  ├─▶ Task 5 ─▶ Task 6 ─▶ Task 7
        (guard sig)  (helper)   (seed-fail)  (wire seam)
```

- Task 1 (guard signature) and Task 2 (helper) are the foundation; Task 2 depends on Task 1's new option.
- Task 3 and Task 4 both build on Task 2.
- Task 5 (wire seam) depends on Task 2 + Task 3.
- Task 6 (brokenness/scoping regressions) depends on Task 5.
- Task 7 (changelog/integrity) is last.

## Integration Points

- After Task 5: the fresh-dispatch false-halt is closed end-to-end at the build seam — a fresh
  enforcement-configured dispatch with a committed plan seeds task-status.json and proceeds.
- After Task 6: the guard's real protection (broken machinery HALTs) and enforcement-off scoping are
  proven intact.

## Verification

- [ ] All happy path criteria covered (Task 2, Task 5)
- [ ] All negative path criteria covered (Task 1, 3, 4, 6)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task touching new production surface carries a `**Wired-into:**` line
- [ ] Changelog entry added (Task 7)
