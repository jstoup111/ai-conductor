# Implementation Plan: Mid-loop `.pipeline` wipe / kickback crash fix (ai-conductor#549)

**Date:** 2026-07-11
**Design:** `.docs/decisions/adr-2026-07-11-pipeline-state-durability.md` (APPROVED, D1/D2/D3)
**Stories:** `.docs/stories/mid-loop-pipeline-wipe-549.md` (Stories 1–7)
**Conflict check:** Clean as of 2026-07-11 (`.docs/conflicts/mid-loop-pipeline-wipe-549.md` —
Story 4 test asserts state survival, NOT resume-target step)
**Complexity:** Medium (`.docs/complexity/mid-loop-pipeline-wipe-549.md`)

## Summary
Harden the conductor's `.pipeline` run-state against a mid-loop directory wipe: guard the
bookkeeping writes so they never crash (D1), reorder the crash handler so a wipe preserves
in-memory state (D1), make reads degrade (D1), fix the actual unscoped deleter (D2), make a
mid-run recreate loud (D3), and pin the finish→build kickback transition with a regression
test — all while leaving legitimate post-ship cleanup intact. 12 tasks, test-first.

## Technical Approach
- **One ensure-dir choke point.** Introduce a small private helper on `StepRunner`
  (`ensurePipelineDir()`) called before each `session-created`/`conduct-session-id` write
  (step-runners.ts:423, :498) and in `resetSession`. It `mkdir`s recursively; it does NOT
  swallow non-ENOENT errors (EACCES still surfaces). The mid-run-vs-first-provision
  distinction for the D3 WARNING is derived from whether the run has already progressed
  (e.g. `this.callCount > 0` / `sessionStartedInitialized` — verify at build time).
- **Crash-handler reorder.** In `conductor.ts:3211-3226`, move `mkdir('.pipeline',{recursive})`
  ahead of `writeState(this.stateFilePath, state)`. `HALT` stays the final write, preserving
  the terminal-marker guarantee; the `finally` sandbox teardown (/tmp) is untouched.
- **Deterministic-first ordering.** The defensive guards (Tasks 1–7) are independent of the
  root-cause hunt and land first. Task 8 (identify the actual deleter) gates the D2 scoped
  fix (Tasks 9–10) and the final regression pin (Task 11), because those need to name and
  neutralize the real deleter. Task 12 protects legitimate cleanup last.
- **Test framework:** vitest, run from `src/conductor` (never worktree root). Reproductions
  construct an isolated temp repo/`.pipeline`; deletions in test helpers are mkdtemp-anchored.

## Prerequisites
- `cd src/conductor && npm install` in this worktree (per-worktree deps).
- Run vitest from `src/conductor` (`rtk proxy npx vitest run <file>`), not the worktree root.

## Tasks

### Task 1: RED — marker write throws ENOENT when `.pipeline` root is gone mid-run
**Story:** Story 1 (happy path) · ADR D1
**Type:** negative-path (regression RED)
**Steps:**
1. Write a failing test: construct a `StepRunner` with a real temp `pipelineDir`, mark a
   successful step, delete the `.pipeline` dir, then invoke the marker-persist path and assert
   it currently THROWS ENOENT (documents the bug).
2. Verify RED.
3. (no impl in this task)
4. Commit: "test(conductor): red — marker persist crashes on missing .pipeline root"

**Files:** `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** none

### Task 2: GREEN — ensure `.pipeline` before marker write (both dispatch paths + resetSession)
**Story:** Story 1 (happy + EACCES negative) · ADR D1
**Type:** happy-path
**Steps:**
1. Extend the Task 1 test: after the fix, the persist returns `{success:true}` and both
   `session-created` + `conduct-session-id` exist; add a case asserting a non-ENOENT (EACCES)
   error is NOT swallowed as success.
2. Verify RED for the new success assertion.
3. Implement `ensurePipelineDir()` on `StepRunner` and call it before the writes at
   step-runners.ts:423 and :498 and in `resetSession` (:517-529); scope the tolerance to
   missing-dir, rethrow/log other errors.
4. Verify GREEN.
5. Commit: "fix(conductor): ensure .pipeline dir before session-marker writes (D1)"

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** 1

### Task 3: RED — crash handler drops conduct-state.json when `.pipeline` is absent
**Story:** Story 2 (happy path) · ADR D1 ordering
**Type:** negative-path (regression RED)
**Steps:**
1. Write a failing test: drive `Conductor.run()` to throw inside the loop with `.pipeline`
   removed; assert that TODAY only `HALT` is written and `conduct-state.json` is missing
   (pins the ordering bug).
2. Verify RED.
3. Commit: "test(conductor): red — crash handler loses state on .pipeline wipe"

**Files:** `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** none

### Task 4: GREEN — reorder crash handler mkdir before writeState
**Story:** Story 2 (happy + dir-present regression) · ADR D1 ordering
**Type:** happy-path
**Steps:**
1. Extend the test: after the fix both `conduct-state.json` (matching in-memory state) AND
   `HALT` exist; add a regression case asserting the dir-present crash path still writes
   state + HALT with the same `conductor error: <msg>` reason.
2. Verify RED for the survival assertion.
3. Implement: in `conductor.ts:3211-3226`, move `mkdir('.pipeline',{recursive})` before
   `writeState`; keep `HALT` as the final write; leave the `finally` sandbox teardown intact.
4. Verify GREEN.
5. Commit: "fix(conductor): mkdir .pipeline before state flush in crash handler (D1)"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** 3

### Task 5: `.pipeline` read sites are existence-guarded (audit + fill gaps)
**Story:** Story 3 (happy + absent-dir + empty-file negatives) · ADR D1 reads
**Type:** infrastructure
**Steps:**
1. Write a test enumerating the bookkeeping read sites (step-runners.ts:353,:547 lazy-init;
   `SessionManager` marker/session reads; the finish-choice/completion read) asserting each
   returns its default when the file is absent, when the whole `.pipeline` dir is absent, and
   when the file is empty/corrupt.
2. Verify RED for any site that currently throws.
3. Implement: convert any bare `readFile`/`open` at a check site to `access`/`fileExists`-guarded
   reads returning the documented default (most are already guarded — fix only the gaps).
4. Verify GREEN.
5. Commit: "fix(conductor): existence-guard all .pipeline bookkeeping reads (D1)"

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/execution/session.ts`, `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** none

### Task 6: RED — no WARNING is emitted on a mid-run `.pipeline` recreate
**Story:** Story 6 (happy path) · ADR D3
**Type:** negative-path (regression RED)
**Steps:**
1. Write a failing test: trigger the Task 2 ensure-dir on a mid-run wipe (run already
   progressed) and assert a greppable `WARNING: .pipeline root was missing mid-run …` is
   emitted (fails pre-impl).
2. Verify RED.
3. Commit: "test(conductor): red — mid-run .pipeline recreate is silent"

**Files:** `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** 2

### Task 7: GREEN — loud WARNING on mid-run recreate, silent on first-provision/post-ship
**Story:** Story 6 (happy + first-provision/post-ship negatives) · ADR D3
**Type:** happy-path
**Steps:**
1. Extend the test: WARNING emitted exactly once on mid-run recreate; NO WARNING on
   first-provision (run start) or when no further write runs after a post-ship teardown; a
   fail-closed gate still blocks when state is truly absent after recreate.
2. Verify RED for the scoping assertions.
3. Implement: in `ensurePipelineDir()`, when the dir was absent AND the run has already
   progressed (mid-run signal — verify the exact predicate at build), log the stable greppable
   WARNING via the runner's logger; do not warn on first-provision.
4. Verify GREEN.
5. Commit: "fix(conductor): loud WARNING on mid-run .pipeline recreate (D3)"

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** 6

### Task 8: Identify the actual `.pipeline` deleter (root-cause discovery)
**Story:** Story 4 (root cause) · Story 5 (target) · issue outcome #1
**Type:** infrastructure (discovery)
**Steps:**
1. Reproduce the finish→build kickback `.pipeline` wipe in an isolated temp repo (drive
   finish-fail → kickback → build re-entry); bisect which actor removes the root under
   host-load conditions. Prime suspect: the `mutation-gate-probe` test/helper cleanup.
2. Record the deleter with `file:line` evidence in the test file header and confirm/adjust
   the ADR's known-unknown resolution.
3. Write a minimal RED that reproduces the deletion via the identified actor.
4. Commit: "test(conductor): red — pin the actual .pipeline deleter (<actor> file:line)"

**Files:** `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** none

### Task 9: RED — deleter cleanup can resolve to a live worktree `.pipeline`
**Story:** Story 5 (happy + relative-path/shared-root negatives) · ADR D2
**Type:** negative-path (regression RED)
**Steps:**
1. Write a failing test placing a sentinel file in a real (temp) worktree `.pipeline`, then
   run the identified deleter's cleanup under a shifted/relative cwd; assert the sentinel is
   currently destroyed (pins the unscoped delete).
2. Verify RED.
3. Commit: "test(conductor): red — probe cleanup deletes live .pipeline under host load"

**Files:** `src/conductor/test/acceptance/pipeline-durability.test.ts` (plus the deleter's own test file if separate)
**Dependencies:** 8

### Task 10: GREEN — scope the deleter to an mkdtemp path (D2)
**Story:** Story 5 (happy + shared-root refusal) · ADR D2
**Type:** happy-path
**Steps:**
1. Extend the test: the sentinel in the live worktree `.pipeline` SURVIVES a full probe run;
   a cleanup helper handed a path equal to / parent of a live `.pipeline` root refuses/no-ops.
2. Verify RED for survival.
3. Implement: anchor the deleter's cleanup to its `mkdtemp`-created absolute path; reject a
   relative/derived path that can resolve to a repo `.pipeline`; add the shared-root guard.
4. Verify GREEN.
5. Commit: "fix(conductor): scope mutation-gate-probe cleanup to mkdtemp path (D2)"

**Files:** (the deleter identified in Task 8, e.g.) `src/conductor/test/acceptance/mutation-gate-probe.test.ts`, `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** 9

### Task 11: Regression pin — finish→build kickback preserves run-state, no crash
**Story:** Story 4 (happy + pre-fix reproduction) · issue outcome #1
**Type:** negative-path
**Steps:**
1. Write the end-to-end regression: finish-fail → kickback → build re-entry; assert
   `conduct-state.json`, `task-status.json`, `task-evidence.json`, `gates/*` all SURVIVE and
   the build re-entry does not crash on a missing marker. Per the conflict note, assert
   STATE-FILE SURVIVAL, not a specific resume-target step (decouple from #532/#543).
2. Confirm the test is RED on the pre-fix tree (with guards + D2 reverted) and GREEN with the
   full fix (Tasks 2, 4, 5, 7, 10) in place.
3. Commit: "test(conductor): regression — finish→build kickback preserves .pipeline state"

**Files:** `src/conductor/test/acceptance/pipeline-durability.test.ts`
**Dependencies:** 2, 4, 5, 7, 10

### Task 12: Regression — legitimate post-ship cleanup still clears what it should
**Story:** Story 7 (happy + keep=true/over-reach negatives) · issue outcome #4
**Type:** negative-path
**Steps:**
1. Write/extend tests asserting: `teardownWorktree` still removes the whole worktree on
   `done`+`!keep` and preserves it on `keep=true`; the daemon-cli pre-run sweep still removes
   exactly the 2 session markers and does NOT touch other `.pipeline` state.
2. Verify GREEN (guards must not have regressed these) — RED only if a guard over-reached.
3. Commit: "test(conductor): regression — post-ship cleanup + pre-run sweep intact (D2 neg)"

**Files:** `src/conductor/test/acceptance/pipeline-durability.test.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/src/daemon-cli.ts`
**Dependencies:** 2, 10

## Task Dependency Graph
```
Defensive guards (independent lanes):
  1 → 2 → 6 → 7          (D1 write-ensure → D3 loud recreate)
  3 → 4                  (D1 crash-handler reorder)
  5                      (D1 guarded reads)

Root-cause + D2 lane:
  8 → 9 → 10             (identify deleter → RED → scoped fix)

Convergence:
  2,4,5,7,10 → 11        (finish→build kickback regression pin)
  2,10 → 12              (legitimate cleanup preserved)
```
Acyclic. Lanes {1,2,6,7}, {3,4}, {5}, {8,9,10} run in parallel; 11 and 12 converge last.

## Integration Points
- After Task 2: a mid-run wipe no longer crashes the marker write (core crash closed).
- After Task 4: a dir-wipe crash preserves `conduct-state.json` from memory.
- After Task 10: the actual deleter can no longer touch a live `.pipeline` (root bug closed).
- After Task 11: the full finish→build transition is pinned end-to-end.

## Verification
- [ ] Story 1 → Tasks 1,2 · Story 2 → Tasks 3,4 · Story 3 → Task 5 · Story 4 → Tasks 8,11 ·
      Story 5 → Tasks 9,10 · Story 6 → Tasks 6,7 · Story 7 → Task 12 (every criterion covered)
- [ ] All negative paths are explicit tasks (1,3,6,9 RED; 11,12 regressions)
- [ ] No task exceeds ~5 minutes
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] Task 4 preserves the HALT terminal-marker guarantee; sandbox teardown untouched
- [ ] Task 11 asserts state survival, NOT resume-target step (conflict note honored)
