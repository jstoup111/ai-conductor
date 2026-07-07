# Implementation Plan: Fix #400 — single-generation stale-engine respawn

**Date:** 2026-07-07
**Design:** `.docs/decisions/adr-2026-07-07-single-generation-stale-respawn.md` (APPROVED) +
`.docs/decisions/architecture-review-2026-07-07-fix-400-stale-engine-respawn.md`
**Stories:** `.docs/stories/fix-400-stale-engine-respawn-in-place-stacks-daemo.md` (Status: Accepted)
**Conflict check:** Clean as of 2026-07-07 (`.docs/conflicts/2026-07-07-fix-400-stale-engine-respawn.md`)
**Issue:** jstoup111/ai-conductor#400 (re-enables the #402-disabled flag)

## Summary

Hardens the stale-engine respawn to a single-generation handoff in 19 TDD tasks across four
modules: requester exits unconditionally on a fired trigger, the idle-boundary trigger becomes
one-shot, lock takeover tolerates a mid-exit predecessor, lock-losers terminate, and
`auto_restart_on_stale_engine` is re-enabled.

## Technical Approach

- **Requester (`daemon-cli.ts`, `createRestartRequester`)** — in the session-hosted branch,
  after `await deps.triggerSelfRestart()` returns without throwing: `lock.releaseSync()` then
  `process.exit(0)` (the injected `process`, already a parameter). All failure branches
  (relink throw, marker-write failure, trigger throw) keep their exact stay-alive semantics.
- **Return contract** — `RestartRequester` changes from `Promise<void>` to
  `Promise<{ fired: boolean }>`: `fired: true` when the trigger fired (session-hosted success;
  headless marker+exit path — unreachable in prod, observable under an injected process fake),
  `fired: false` on any aborted attempt. Note `daemon.ts:725` already documents "requestRestart
  exits the process" on the dispatch path — this makes the contract explicit and typed.
- **Idle-branch backstop (`daemon.ts` ~818-851)** — when `requestRestart` resolves
  `{ fired: true }` (a process fake didn't exit, or a future refactor regresses the exit),
  `break` with `stopReason: 'engine_restart'` mirroring the dispatch-boundary precedent
  (~726). `{ fired: false }` falls through to sleep/continue — retry-on-failure preserved.
- **Lock (`engine/daemon-lock.ts`, `holdLock`)** — new optional second param
  `{ takeoverWaitMs?, pollMs? }` with module-confined production defaults (10s / 250ms). On
  "occupied by a LIVE pid", poll `acquire` until the window elapses; return `null` only after
  the bound. Dead-pid reclaim, unowned-handle-on-error, and O_EXCL single-winner unchanged.
- **Loser exit (`daemon-cli.ts` `runDaemonMode` ~430)** — add an injectable exit seam
  (`opts.exitProcess ?? process.exit`) and call it with 0 in the `lock === null` branch
  instead of `return` (observed: bare return leaves a resident node process).
- **Sequencing** — requester first (the core defect), then the contract + backstop (typed
  ripple), then lock changes (independent), then e2e capstone, then config/docs last so the
  flag flips only alongside the proof.
- **Test infra** — every real-process/tmux test honors `AI_CONDUCTOR_NO_REAL_EXEC` /
  `cc-daemon-*` guards and asserts no leaked sessions in teardown.

## Prerequisites

- None beyond a built `src/conductor` (`npm install` in the worktree; run vitest via
  `rtk proxy npx vitest run`). No migrations, no new dependencies.

## Tasks

### Task 1: Flip the fired-trigger requester assertions (RED)
**Story:** TS-1 happy path; review condition 2
**Type:** happy-path
**Steps:**
1. In `daemon-cli-restart-requester.test.ts`, rewrite the session-hosted success assertions
   (~:309, ~:361): after `triggerSelfRestart` resolves, expect `lock.releaseSync()` called
   once AND injected `process.exit` called with `0` (replacing the "no lock release, no exit"
   pins). Do NOT touch trigger-failure / marker-failure / headless tests.
2. Verify the flipped tests fail (RED) against current code.
**Files likely touched:** `src/conductor/test/engine/daemon-cli-restart-requester.test.ts`
**Dependencies:** none

### Task 2: Implement unconditional exit on fired trigger (GREEN)
**Story:** TS-1 happy path
**Type:** happy-path
**Steps:**
1. In `createRestartRequester` session-hosted branch: after `await deps.triggerSelfRestart()`
   succeeds, call `lock.releaseSync()` then `process.exit(0)` (injected process param).
2. Verify Task 1 tests pass (GREEN).
**Files likely touched:** `src/conductor/src/daemon-cli.ts`
**Dependencies:** Task 1

### Task 3: Regression-pin the failure paths (no edits expected)
**Story:** TS-1 negative paths (trigger-throw stay-alive, marker-write-failure, headless)
**Type:** negative-path
**Steps:**
1. Run the full `daemon-cli-restart-requester.test.ts` suite; assert the untouched
   trigger-failure (alive, lock retained, no exit), marker-write-failure, and headless
   (marker → release → exit 0 ordering) tests are green with zero modifications.
2. If any failure-path test required an edit, STOP — that is a design regression
   (review condition 2), not a test to fix.
**Files likely touched:** none (verification gate)
**Dependencies:** Task 2

### Task 4: RestartRequester fired/failed return type (RED)
**Story:** TS-2 ("explicit discriminated value")
**Type:** infrastructure
**Steps:**
1. Add tests: requester resolves `{ fired: false }` on relink-throw and on trigger-throw;
   resolves `{ fired: true }` before exiting on session-hosted success (observable because
   the injected process fake's `exit` doesn't terminate the test process).
2. Verify RED (current type is `Promise<void>`).
**Files likely touched:** `src/conductor/test/engine/daemon-cli-restart-requester.test.ts`
**Dependencies:** Task 2

### Task 5: Implement the return contract across call sites (GREEN)
**Story:** TS-2
**Type:** infrastructure
**Steps:**
1. Change `RestartRequester` type to `Promise<{ fired: boolean }>`; return `{ fired: false }`
   from every abort branch, `{ fired: true }` after firing (headless: before `process.exit`).
2. Update `daemon.ts` deps type (~:244) and both call sites (~:651, ~:841) to consume the
   result; compile clean, no `any`.
3. Verify Task 4 tests pass (GREEN); full typecheck passes.
**Files likely touched:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/daemon.ts`
**Dependencies:** Task 4

### Task 6: Idle-branch one-shot backstop test (RED)
**Story:** TS-2 negative path ("future requester regression")
**Type:** negative-path
**Steps:**
1. Unit test (`daemon.test.ts` stale-engine block): permanently-stale checker + a
   `requestRestart` fake returning `{ fired: true }` WITHOUT exiting; drive ≥3 idle polls;
   assert exactly 1 `requestRestart` invocation and loop exit with
   `stopReason: 'engine_restart'`.
2. Verify RED (current loop falls through and re-fires).
**Files likely touched:** `src/conductor/test/engine/daemon.test.ts`
**Dependencies:** Task 5

### Task 7: Implement the idle-branch break (GREEN)
**Story:** TS-2 happy path
**Type:** happy-path
**Steps:**
1. In the idle stale branch (~818-851): capture `requestRestart`'s result; on
   `{ fired: true }` set `stopReason = 'engine_restart'` and `break` (mirror ~726).
2. Verify Task 6 passes (GREEN).
**Files likely touched:** `src/conductor/src/engine/daemon.ts`
**Dependencies:** Task 6

### Task 8: Retry-after-failure is preserved (RED then GREEN if needed)
**Story:** TS-2 negative path ("retry is not multi-fire")
**Type:** negative-path
**Steps:**
1. Unit test: `requestRestart` fake returning `{ fired: false }`; drive ≥2 idle polls; assert
   ≥2 invocations (later boundary retried) and NO `engine_restart` stop.
2. Expected GREEN after Task 7 (fall-through path); if RED, fix the break condition — only
   `fired: true` may break.
**Files likely touched:** `src/conductor/test/engine/daemon.test.ts`
**Dependencies:** Task 7

### Task 9: In-flight re-verify guard regression
**Story:** TS-2 negative path (task lands between verdict and request)
**Type:** negative-path
**Steps:**
1. Run the existing `daemon.test.ts` gate-chain + in-flight re-verify tests; assert green
   with zero modifications (guard untouched by Tasks 5-8).
**Files likely touched:** none (verification gate)
**Dependencies:** Task 8

### Task 10: holdLock bounded-wait happy path (RED)
**Story:** TS-3 happy path (live holder releases mid-wait)
**Type:** happy-path
**Steps:**
1. In `daemon-lock.test.ts`: create a pidfile owned by a live pid (this test process); on a
   timer shorter than the injected window, release it; call
   `holdLock(repo, { takeoverWaitMs: 500, pollMs: 25 })`; assert a valid handle is returned.
2. Verify RED (current holdLock returns null immediately on a live owner).
**Files likely touched:** `src/conductor/test/engine/daemon-lock.test.ts`
**Dependencies:** none (parallel to Tasks 1-9)

### Task 11: Implement bounded wait in holdLock (GREEN)
**Story:** TS-3
**Type:** happy-path
**Steps:**
1. Add optional `{ takeoverWaitMs?, pollMs? }` param (defaults 10_000 / 250, module-private
   constants); on live-owner occupancy, re-attempt `acquire` each poll until the window
   elapses; then return `null`. Dead-pid reclaim path unchanged (no wait).
2. Verify Task 10 passes (GREEN); existing live-owner→null test updated ONLY to pass a
   zero/small window explicitly if it asserts immediacy.
**Files likely touched:** `src/conductor/src/engine/daemon-lock.ts`,
`src/conductor/test/engine/daemon-lock.test.ts`
**Dependencies:** Task 10

### Task 12: holdLock negative paths — persistent holder + race (RED/GREEN)
**Story:** TS-3 negative paths
**Type:** negative-path
**Steps:**
1. Test: live holder never releases → `holdLock` resolves `null` after the injected window
   (assert elapsed ≥ window, no throw, no infinite wait).
2. Test: two concurrent `holdLock` calls racing a just-released pidfile → exactly one handle,
   one `null` (O_EXCL single-winner preserved through the poll loop).
3. Test: dead-pid pidfile → immediate reclaim with NO wait (existing test stays unmodified;
   add an elapsed-time assertion if absent).
**Files likely touched:** `src/conductor/test/engine/daemon-lock.test.ts`
**Dependencies:** Task 11

### Task 13: No public wait-constant leakage
**Story:** TS-3 negative path (module-confined constant)
**Type:** negative-path
**Steps:**
1. Assert (grep/typecheck) no export of the wait/poll defaults from `daemon-lock.ts` and no
   caller outside the module passes production values; `runDaemonMode` calls `holdLock`
   with no explicit window (defaults apply).
**Files likely touched:** none (verification gate)
**Dependencies:** Task 11

### Task 14: Lock-loser explicit exit (RED)
**Story:** TS-4 happy + negative paths
**Type:** negative-path
**Steps:**
1. Add an injectable exit seam to `DaemonModeOptions` (`exitProcess?: (code: number) => void`,
   default `process.exit`). Test: `runDaemonMode` with an occupied live lock and a fake seam
   → seam called with `0`, the "another daemon is already running" line logged, and the
   winner's pidfile byte-identical before/after.
2. Verify RED (current code returns without calling any exit).
**Files likely touched:** `src/conductor/test/engine/daemon-cli-*.test.ts` (new or existing
startup-init suite), `src/conductor/src/daemon-cli.ts` (type only)
**Dependencies:** none (parallel to lock tasks)

### Task 15: Implement loser exit (GREEN)
**Story:** TS-4
**Type:** negative-path
**Steps:**
1. In the `lock === null` branch: log (unchanged), then `exitProcess(0)` instead of `return`.
2. Verify Task 14 passes; assert exit code 0 semantics (a loser is normal, not a crash).
**Files likely touched:** `src/conductor/src/daemon-cli.ts`
**Dependencies:** Task 14

### Task 16: Real-process loser smoke (kill-switch-guarded)
**Story:** TS-4 Done-When (real-process smoke rule)
**Type:** negative-path
**Steps:**
1. Guarded real-binary test: start a real daemon owner, launch a second daemon process
   against the same repo, assert the second pid is dead within the bound + owner untouched;
   teardown proves no leaked processes/sessions.
**Files likely touched:** `src/conductor/test/engine/daemon-stale-respawn-e2e.test.ts` or a
sibling real-binary suite
**Dependencies:** Tasks 11, 15

### Task 17: E2E single-generation capstone (real tmux)
**Story:** e2e capstone happy path
**Type:** happy-path
**Steps:**
1. Extend `daemon-stale-respawn-e2e.test.ts`: supervised daemon → invalidate on-disk engine
   identity → idle boundary fires → assert steady-state `daemon --continuous` process count
   for the repo == 1, predecessor pid `ESRCH`, tmux session alive, `RESTART_PENDING`
   consumed, hyphen `RESTART-PENDING` untouched.
2. Verify RED against pre-fix behavior is not required (fix already in) — the assertion
   SHAPE is the deliverable (#393's suite lacked it).
**Files likely touched:** `src/conductor/test/engine/daemon-stale-respawn-e2e.test.ts`
**Dependencies:** Tasks 2, 7, 11, 15

### Task 18: E2E burst + residency negatives
**Story:** e2e capstone negative paths
**Type:** negative-path
**Steps:**
1. Sample process count repeatedly across the handoff window: assert it never exceeds 2 and
   settles at 1 (a stacked third generation fails).
2. Forced-loser scenario (predecessor artificially held): loser exits, count returns to 1,
   no resident loser pid.
3. Teardown: `tmux ls` identical before/after (no leaked `cc-daemon-*`).
**Files likely touched:** `src/conductor/test/engine/daemon-stale-respawn-e2e.test.ts`
**Dependencies:** Task 17

### Task 19: Re-enable the flag + docs + changelog
**Story:** TS-5
**Type:** infrastructure
**Steps:**
1. Flip `.ai-conductor/config.yml` `auto_restart_on_stale_engine` to `true` (this repo only);
   run `config.test.ts` unmodified (default-false / fail-closed contract untouched).
2. Update `src/conductor/README.md` restart-semantics section: fired trigger ⇒ predecessor
   exit, bounded takeover, loser exit (docs-track-features rule).
3. Add CHANGELOG `## [Unreleased]` → Fixed entry (#400: respawn stacked generations; flag
   re-enabled, reverting #402). VERSION stays 0.99.19 (frozen; no bump).
4. Run `test/test_harness_integrity.sh` — full suite green before commit.
**Files likely touched:** `.ai-conductor/config.yml`, `src/conductor/README.md`,
`CHANGELOG.md`
**Dependencies:** Tasks 17, 18 (flag flips only alongside the proof)

## Task Dependency Graph

```
1 → 2 → 3
    2 → 4 → 5 → 6 → 7 → 8 → 9
10 → 11 → 12
     11 → 13
14 → 15
11, 15 → 16
2, 7, 11, 15 → 17 → 18
17, 18 → 19
```
(Three independent streams — requester/loop [1-9], lock [10-13], loser [14-15] — converge at
the e2e capstone [16-18]; config/docs last [19].)

## Integration Points

- **After Task 7:** unit-level respawn flow is fully hardened (requester exit + one-shot
  loop); integration-testable with process fakes.
- **After Task 15:** all four code surfaces changed; real-process behavior testable.
- **After Task 18:** the #400 repro path (`merge → stale detection → pgrep count == 1`) is
  proven end-to-end; safe to flip the flag (Task 19).

## Verification

- [x] All happy path criteria covered: TS-1→T1-2, TS-2→T5/T7, TS-3→T10-11, TS-4→T14-15,
      TS-5→T19, e2e→T17
- [x] All negative path criteria covered: TS-1 failures→T3, TS-2 regression/retry/in-flight→
      T6/T8/T9, TS-3 persist/race/dead-pid/constant→T12-13, TS-4 pidfile-untouched/exit-0→
      T14-16, TS-5 default-contract→T19.1, e2e burst/loser→T18
- [x] No task exceeds ~5 minutes of focused work
- [x] Dependencies explicit and acyclic
