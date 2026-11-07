# Implementation Plan: A retryable HALT is cleared before the daemon re-dispatches it

**Date:** 2026-11-07
**Design:** [architecture review](../decisions/architecture-review-2026-11-07-mechanical-prerequisite-halt-loops-the-daemon-in-r.md) (technical track, no PRD)
**Stories:** .docs/stories/mechanical-prerequisite-halt-loops-the-daemon-in-r.md
**Conflict check:** Clean as of 2026-11-07 (.docs/conflicts/2026-11-07-mechanical-prerequisite-halt-loops-the-daemon-in-r.md)
**Source:** jstoup111/ai-conductor#3601

## Summary

The daemon's dispatch boundary takes over three jobs, in eleven tasks delivered as a single PR. It clears a retryable (`mechanical`/`legacy`) HALT before it re-runs a feature. It gives each distinct retryable HALT one prompt re-dispatch. It becomes the only writer of the progress baseline, at whole-feature scope. Together these stop the stacked-feature resume-and-refuse loop.

## Technical Approach

- **Where the logic lives.** All decision logic goes in the daemon core (`src/conductor/src/engine/daemon.ts`), behind three new optional `RunDaemonDeps` dependencies, following the existing optional-dependency pattern (`isHalted`, `readHaltClass`, `isProgressReKickEligible`, `watchHaltCleared`):
  - `clearRetryableHalt(slug)`: clears the HALT and records the clear.
  - `isFreshRetryableHalt(slug)`: true when the live HALT is `mechanical`/`legacy` and its body differs from `HALT.rekicked`, the body the dispatch boundary last cleared.
  - `stampDispatchBaseline(slug)`: stamps the whole-feature resolved count.
  An absent dependency keeps today's behavior.
- **The dispatch boundary.** In `dispatch`, after the existing `disposeWatcher(item.slug)` and before `runFeature`:
  1. For a resumed slug with a live HALT, read its disposition through `deps.readHaltClass`. A retained disposition (`isOperatorActionHalt`, or anything `resolveHaltRetention` retains) is never cleared and the executor is not started. A `mechanical`/`legacy` HALT is cleared through `clearRetryableHalt`, and one log line names the slug and the class. A throwing clear releases the claim, re-parks the slug, logs the failure, and does not start the executor.
  2. Call `stampDispatchBaseline`. A throwing stamp is logged and the dispatch continues.
  Because the watcher is disposed first, the clear's audit record is written once, by the clear dependency itself (ADR decision 5).
- **`pickEligible`.** The parked-and-still-halted branch gains a second admission beside the progress re-kick: `isFreshRetryableHalt`. Both admissions draw on the one per-run `progressReKickCounts` counter and `dispatch_ceiling` (default 20) in a single bounded wrapper. The ceiling therefore bounds prompt and progress re-dispatches together, and the existing ceiling log line fires once.
- **Production wiring (`src/conductor/src/daemon-cli.ts`, in the `runDaemon` deps object beside `...buildProgressReKickDeps(...)`).**
  - `clearRetryableHalt`: a new `clearRetryableHaltMarker(worktreePath)` in `src/conductor/src/engine/daemon-rekick.ts`, beside `clearMarker`. It reads `.pipeline/HALT` and writes that body to `.pipeline/HALT.rekicked`, then removes `HALT` and `HALT.class` and writes the `REKICK` sentinel. A missing HALT makes the whole clear a no-op: it writes no `HALT.rekicked`, no `REKICK`, and no `halt_cleared` record. It never touches `.pipeline/HALT.cleared`, which also carries the operator's prd_audit over-scope decision until prd_audit harvests it (`preparePrdWideningBeforeAudit`). After the marker clear comes the existing halt-clear append seam. `appendHaltClearedRecord` in `src/conductor/src/engine/daemon-deps.ts` is exported for this. It is called with `'rekick'` and the same `recordRemote` the watcher seam uses.
  - `isFreshRetryableHalt`: `readRawHaltClass`, then `resolveHaltRetention`, then a byte comparison of `.pipeline/HALT` with `.pipeline/HALT.rekicked`. A missing or unreadable `HALT.rekicked` counts as distinct. An unreadable `HALT` counts as not fresh.
  - `stampDispatchBaseline`: a new `stampDispatchBaseline(worktreePath)` in `src/conductor/src/engine/task-evidence.ts`. It skips an absent worktree. Otherwise it calls `createTaskEvidence` and `countResolvedTasks(worktreePath)` with no child scope, sets `lastResolvedCount`, and writes.
  The fresh-HALT and clear dependencies are wired whether or not `build_progress_halt.enabled` is set. `buildProgressReKickDeps` keeps its unscoped read, which now matches the stamp.
- **Conductor (`src/conductor/src/engine/conductor.ts`).** Every `freshEvidence.lastResolvedCount = …` stamp site and the T7 comments that justify them are deleted. The field keeps its type and its tolerant parse. Tests that pinned conductor stamps are retargeted to the dispatch-boundary stamp.
- **Unchanged.** Stack preflight (`engine/restack/stack-preflight.ts`), `resolveHaltRetention`, the base-advance and episode-end sweeps, and the operator park are untouched. Story 4 is verified against the existing preflight tests.

## Prerequisites

- None. No migration, config key, or schema change.

## Task Dependency Graph

```
Task 1 (dispatch clear) ──> Task 2 (clear negatives)
Task 1 ──> Task 3 (pickEligible fresh HALT)
Task 4 (baseline stamp fn) ──> Task 5 (dispatch stamp) ──> Task 6 (remove conductor stamps)
Tasks 1, 3, 4 ──> Task 8 (production wiring)
Tasks 1, 8 ──> Task 10 (#3601 dispatch integration)
Tasks 3, 5, 8 ──> Task 7 (identical/volatile loop bound) ──> Task 11 (refused/idle dispatches)
Task 9 (Story 4 verify-only): none
```

## Integration Points

- After Task 10, one real daemon re-dispatch clears the #3601 HALT, passes the real stack preflight, and runs `test_suite` first.
- After Task 11, the daemon loop is bounded end to end for identical repeats, volatile bodies, preflight refusals and idle dispatches.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary#D1 | task | task-1, task-2, task-8, task-10 | `.pipeline/HALT` and `.pipeline/HALT.class` are absent, `.pipeline/HALT.rekicked` is byte-identical to the HALT body written at setup |
| adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary#D2 | task | task-3, task-7 | is returned by `pickEligible` and dispatched exactly once |
| adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary#D3 | task | task-4, task-5, task-6, task-11 | `stampDispatchBaseline` is called exactly once per dispatch, after `clearRetryableHalt` and before the executor is invoked |
| adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary#D4 | task | task-9 | pass with no assertion changed in this feature's diff |
| adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary#D5 | task | task-8 | exactly one `halt_cleared` record with `cause` `rekick` |

## Tasks

### Task 1: The dispatch boundary clears a live retryable HALT before the executor runs
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon.test.ts` for every Done-when check below, driving `runDaemon` with an injected `featureExecution` executor. The executor snapshots the worktree's `.pipeline` files at the moment it is invoked.
2. Verify RED.
3. Implement: add optional `clearRetryableHalt?: (slug: string) => Promise<void>` to `RunDaemonDeps`. In `dispatch`, after `disposeWatcher(item.slug)`, when `isResume` and `deps.isHalted?.(slug)` is true, read `deps.readHaltClass`. For `mechanical`/`legacy`, await `deps.clearRetryableHalt(slug)` and log `re-kick <slug>: cleared <class> HALT before dispatch`. For any retained disposition (use `isOperatorActionHalt` plus `unclassified`), do not clear: release the claim, re-park the slug, and return without calling `runFeature`.
4. Verify GREEN; commit.

**Done when:**
- [test] With a parked slug whose `HALT.class` is `mechanical` and whose fake `clearRetryableHalt` copies the `HALT` body to `HALT.rekicked` and removes `HALT` and `HALT.class`, the executor observes, when invoked, no `.pipeline/HALT` or `.pipeline/HALT.class`, and a `HALT.rekicked` byte-identical to the prior HALT body.
- [test] The same holds for a `legacy` class, and for a slug whose deps report no durable child state (non-stacked); `clearRetryableHalt` is called exactly once per re-dispatch in each case.
- [test] For `needs-human`, an absent `HALT.class` sidecar, `unclassified`, `stack-tip-diverged` and an unrecognized class string, `dispatch` never calls `clearRetryableHalt`, never invokes the executor, and leaves `.pipeline/HALT` and `.pipeline/HALT.class` byte-identical.
- [test] A captured daemon log for a cleared `mechanical` HALT contains one line naming the slug and the class `mechanical`.

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — `RunDaemonDeps.clearRetryableHalt`; clear-before-execute branch in `dispatch`
- src/conductor/test/engine/daemon.test.ts — dispatch-boundary tests

**Dependencies:** none

### Task 2: A failed or raced clear is handled at the dispatch boundary
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: wrap the `clearRetryableHalt` call. On a throw, log `re-kick <slug>: HALT clear failed — <message>`, release the claim, re-park the slug, register its watcher again, and return without calling `runFeature`. An operator-parked slug never reaches `dispatch`, because `pickEligible` checks `isParked` first; keep that order and assert it.
4. Verify GREEN; commit.

**Done when:**
- [test] When `clearRetryableHalt` throws, the injected executor is never invoked, `claims.isParked(slug)` is true afterwards, and the captured daemon log has one line naming the slug and the thrown message.
- [test] When the HALT file is deleted by the test between `pickEligible` and the clear, and the production `clearRetryableHalt` runs, no error is raised, no `.pipeline/HALT.rekicked`, `.pipeline/REKICK` or `halt_cleared` audit-trail record is written by the clear, and the executor is invoked once.
- [test] A slug with an operator park marker and a live `mechanical` HALT is never passed to `clearRetryableHalt` and the executor is never invoked, with `HALT` bytes unchanged.

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — clear failure handling in `dispatch`
- src/conductor/test/engine/daemon.test.ts — negative-path tests

**Dependencies:** Task 1

### Task 3: pickEligible grants one prompt re-dispatch per distinct retryable HALT
**Story:** Story 2
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: add optional `isFreshRetryableHalt?: (slug: string) => Promise<boolean>` to `RunDaemonDeps`. In the bounded wrapper beside `isProgressReKickEligibleBounded`, admit a parked, still-halted slug when the disposition is not operator-action and either `isFreshRetryableHalt` or the progress predicate is true. Charge the shared `progressReKickCounts` counter once per admission, and refuse with the existing one-time ceiling log line once the count reaches `progressReKickDispatchCeiling`. Pass the combined predicate to `pickEligible`.
4. Verify GREEN; commit.

**Done when:**
- [test] A parked slug with a live `mechanical` HALT, `isFreshRetryableHalt` true, the progress predicate false, and an unchanged base is returned by `pickEligible` and dispatched exactly once.
- [test] With `isFreshRetryableHalt` false and the progress predicate false (identical body), `pickEligible` skips the slug on every tick, and no dispatch starts across ten idle ticks.
- [test] A slug whose `readHaltClass` is `needs-human`, `unclassified` (absent sidecar), `stack-tip-diverged`, or an unrecognized string is not admitted even when `isFreshRetryableHalt` and the progress predicate both return true, so it is never dispatched and its `.pipeline/HALT` and `.pipeline/HALT.class` bytes are unchanged.
- [test] With `isFreshRetryableHalt` always true and a ceiling of 3, exactly 3 dispatches start in the run and the ceiling log line is emitted exactly once.

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — `RunDaemonDeps.isFreshRetryableHalt`; combined bounded admission
- src/conductor/test/engine/daemon.test.ts — eligibility tests

**Dependencies:** Task 1

### Task 4: stampDispatchBaseline writes the whole-feature resolved count
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/task-evidence.test.ts` for every Done-when check below. Use a multi-child `task-status.json` fixture whose plan carries child membership.
2. Verify RED.
3. Implement `export async function stampDispatchBaseline(worktreePath: string): Promise<'stamped' | 'no-worktree'>` in `src/conductor/src/engine/task-evidence.ts`. It returns `'no-worktree'` when the directory is absent. Otherwise it calls `createTaskEvidence(worktreePath)`, sets `lastResolvedCount = await countResolvedTasks(worktreePath)` with no child argument, and calls `write()`. Write errors propagate.
4. Verify GREEN; commit.

**Done when:**
- [test] For a fixture where child 1 has 3 resolved tasks and child 2 has 2, `stampDispatchBaseline` leaves `.pipeline/task-evidence.json` `lastResolvedCount` equal to 5, the whole-feature `countResolvedTasks` result.
- [test] With a missing or a corrupt (non-JSON) `.pipeline/task-evidence.json`, it writes a parseable sidecar whose `lastResolvedCount` equals the whole-feature count.
- [test] For a nonexistent worktree path it returns `'no-worktree'`, creates no file, and does not throw.

**Files likely touched:**
- src/conductor/src/engine/task-evidence.ts — `stampDispatchBaseline`
- src/conductor/test/engine/task-evidence.test.ts — baseline tests

**Dependencies:** none

### Task 5: The dispatch boundary stamps the baseline at dispatch start
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: add optional `stampDispatchBaseline?: (slug: string) => Promise<void>` to `RunDaemonDeps`. Call it in `dispatch` after any HALT clear and immediately before `runFeature`. On a throw, log `baseline stamp failed for <slug> — <message>` and continue to `runFeature`.
4. Verify GREEN; commit.

**Done when:**
- [test] `stampDispatchBaseline` is called exactly once per dispatch, after `clearRetryableHalt` and before the executor is invoked, asserted by a recorded call order.
- [test] When `stampDispatchBaseline` throws, the executor is still invoked once and the daemon log has one line naming the slug and the stamp failure.

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — `RunDaemonDeps.stampDispatchBaseline`; call in `dispatch`
- src/conductor/test/engine/daemon.test.ts — call-order and failure tests

**Dependencies:** Task 4

### Task 6: The conductor no longer writes the progress baseline
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-verdicts-and-daemon.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: delete every `freshEvidence.lastResolvedCount = …` assignment, its surrounding `createTaskEvidence`/`write` block where it existed only for the stamp, and the T7 comments in `src/conductor/src/engine/conductor.ts`. Retarget assertions in the listed test files that pinned a conductor-written `lastResolvedCount` to the dispatch-boundary stamp, or drop the stamp precondition where the test's subject is unrelated.
4. Verify GREEN with the listed test files; commit.

**Done when:**
- [test] A daemon-mode conductor run whose `build` step resolves 2 tasks and exits (success, stall, and protected-artifact-seal exits) leaves `.pipeline/task-evidence.json` `lastResolvedCount` equal to the value seeded before the run.
- `src/conductor/src/engine/conductor.ts` contains no assignment to `lastResolvedCount`, checked by `grep -n "lastResolvedCount =" src/conductor/src/engine/conductor.ts` returning nothing.
- [test] The retargeted cases in `conductor-protected-artifact-advisory.test.ts` and `builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts` pass without asserting a conductor-written baseline.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — remove stamp sites and T7 comments
- src/conductor/test/engine/conductor-verdicts-and-daemon.test.ts — no-stamp assertion
- src/conductor/test/engine/conductor-protected-artifact-advisory.test.ts — retarget
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — retarget
- src/conductor/test/acceptance/daemon-halts-a-build-that-is-making-forward-progre.acceptance.test.ts — retarget if it seeds via the conductor

**Dependencies:** Task 5

### Task 7: Identical and volatile retryable stops are bounded in the daemon loop
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-retryable-halt-loop.test.ts` (new) for every Done-when check below. Drive `runDaemon` with the production `buildRetryableHaltDeps` from Task 8 and the real `buildProgressReKickDeps` over a temp worktree base. Use an injected executor that writes the scenario's HALT and `task-status.json`, and an injected clock and sleep that advance simulated time.
2. Verify RED.
3. Implement any wiring gaps the tests expose in `src/conductor/src/engine/daemon.ts`.
4. Verify GREEN; commit.

**Done when:**
- [test] An executor that always ends by writing the same `mechanical` HALT body and resolving no task starts exactly 2 dispatches (the original and one prompt re-dispatch) over 80 simulated seconds, and the daemon log has no `resume` line for the slug after the second dispatch ends.
- [test] An executor that writes a different `mechanical` HALT body each time (embedded counter) starts no more dispatches than `dispatch_ceiling` (set to 4) in the run, and logs the ceiling line exactly once.
- [test] A parked slug whose `.pipeline/HALT.rekicked` is a directory (unreadable) and whose live HALT is `mechanical` is dispatched exactly once by the prompt path.
- [test] After an identical repeat has waited, running the real `rekickSweep` with a new base SHA and deps whose `clearMarker` is the real `clearMarker`, or the real `sweepEpisodeHalts` for an episode-stamped slug, clears its HALT, and the next daemon tick dispatches the slug exactly once.

**Files likely touched:**
- src/conductor/test/engine/daemon-retryable-halt-loop.test.ts — new loop-level tests
- src/conductor/src/engine/daemon.ts — wiring gaps only

**Dependencies:** Task 3, Task 5, Task 8

### Task 8: Production wiring clears, records and judges retryable HALTs
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-cli-progress-rekick-wiring.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement:
   - Add `export async function clearRetryableHaltMarker(worktreePath: string): Promise<void>` to `src/conductor/src/engine/daemon-rekick.ts`, as described in Technical Approach.
   - Export `appendHaltClearedRecord` from `src/conductor/src/engine/daemon-deps.ts`.
   - Add `export function buildRetryableHaltDeps(worktreeBase, recordRemote, log)` to `src/conductor/src/daemon-cli.ts`, returning `{ clearRetryableHalt, isFreshRetryableHalt, stampDispatchBaseline }`, implemented as in Technical Approach.
   - Spread it into the `runDaemon` deps beside `...buildProgressReKickDeps(...)`, unconditionally.
4. Verify GREEN; commit.

**Done when:**
- [test] `clearRetryableHaltMarker` on a worktree with a live HALT and a `.pipeline/HALT.cleared` holding an over-scope decision block writes the HALT body byte-for-byte to `.pipeline/HALT.rekicked`, removes `HALT` and `HALT.class`, writes `.pipeline/REKICK`, and leaves `HALT.cleared` byte-identical; with no `HALT.cleared` present, it creates none.
- [test] The production `clearRetryableHalt` leaves `.pipeline/audit-trail/events.jsonl` with exactly one `halt_cleared` record with `cause` `rekick`, even with a `watchHaltCleared` watcher registered and then disposed for the slug, and rewrites the committed halt record from `Status: halted`.
- [test] The production `isFreshRetryableHalt` returns true for no `HALT.rekicked`, a differing body, and an unreadable `HALT.rekicked` (a directory at that path); and false for an identical body, a `needs-human` class, and an unreadable `HALT`.
- [test] The `buildRetryableHaltDeps` dependencies are present in the `runDaemon` deps when `build_progress_halt.enabled` is false.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — `buildRetryableHaltDeps`; spread into `runDaemon` deps
- src/conductor/src/engine/daemon-rekick.ts — `clearRetryableHaltMarker`
- src/conductor/src/engine/daemon-deps.ts — export `appendHaltClearedRecord`
- src/conductor/test/engine/daemon-rekick.test.ts — `clearRetryableHaltMarker` tests
- src/conductor/test/engine/daemon-cli-progress-rekick-wiring.test.ts — wiring, record and fresh-HALT tests

**Dependencies:** Task 1, Task 3, Task 4

### Task 9: Operator-only HALTs keep blocking every path
**Story:** Story 4
**Story:** Story 1
**Type:** verification

**Steps:**
1. Run the existing tests named below and confirm they pass without assertion changes. Confirm by reading `resolveHaltRetention` in `src/conductor/src/engine/daemon-rekick.ts` that an unrecognized class is retained. Record the evidence in an empty commit with an `Evidence: skipped` trailer.

**Done when:**
- [test] `stack-preflight-stop-reason.test.ts` cases "preserves an unauthorized live HALT and reports both reasons" (a direct `runStackPreflight` call, the entry shared by direct callers and CLI resume, returns `halted` with detail `live HALT without resume authorization` and leaves `.pipeline/HALT` byte-identical) and "crosses an authorized HALT without emitting when preflight is clear" pass with no assertion changed in this feature's diff.
- [test] The existing `refuse-daemon-auto-resume-of-an-operator-action-ha.acceptance.test.ts` case asserting the progress-gated refusal line naming the slug and the `needs-human` disposition passes with no assertion changed.
- [test] The existing `daemon-rekick.test.ts` case "applies the exhaustive halt disposition matrix through the real sweep" (`needs-human`, `unclassified`, `stack-tip-diverged` and others are skipped and never passed to `clearMarker`; `mechanical`/`legacy` are cleared) and the `daemon-cli-episode-halt-wiring.test.ts` case "retains operator-action episode halts while clearing mechanical halts, after operator-park precedence" (the `needs-human` and missing-sidecar HALT files still exist after the sweep) pass with no assertion changed.
- `runStackPreflight` in `src/conductor/src/engine/restack/stack-preflight.ts` writes a HALT and `HALT.class` only when no HALT exists at entry or an authorized HALT was crossed, so an unauthorized live HALT's `.pipeline/HALT.class` is never rewritten, unchanged in this feature's diff.
- `resolveHaltRetention` in `src/conductor/src/engine/daemon-rekick.ts` returns `retained: true` for any class string outside the named classes, and both `rekickSweep` and `sweepEpisodeHalts` skip retained halts without clearing them, unchanged in this feature's diff.

**Files likely touched:**
- none

**Verify-only:** yes

**Dependencies:** none

### Task 10: One daemon dispatch takes the #3601 HALT straight to test_suite
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-preflight-wiring.retryable-halt.realgit.test.ts` (new) for every Done-when check below. Use a real-git worktree with durable child state, a `.pipeline/HALT` reading "Step 'manual_test' is blocked by unsatisfied prerequisite: test_suite (pending). The daemon will re-dispatch the feature from an earlier reachable prerequisite.", `HALT.class` `mechanical`, a `.pipeline/HALT.cleared` holding an over-scope decision block, no resume authorization, and state with `test_suite` pending. If #3333 has already moved `runDaemonRekickStackPreflight` into `src/conductor/src/engine/daemon-feature-lifecycle.ts`, import it from there. Drive one `runDaemon` re-dispatch with the production `buildRetryableHaltDeps`. Its executor snapshots `.pipeline`, then calls `runDaemonRekickStackPreflight`, then runs a daemon-mode `Conductor` with a stub step runner that records executed steps. The test writes nothing under `.pipeline` after the initial HALT setup.
2. Verify RED.
3. Implement any wiring gaps the test exposes.
4. Verify GREEN; commit.

**Done when:**
- [test] At executor entry, `.pipeline/HALT` and `.pipeline/HALT.class` are absent, `.pipeline/HALT.rekicked` is byte-identical to the HALT body written at setup, and a `.pipeline/HALT.cleared` seeded at setup with an over-scope decision block is byte-identical to its setup content.
- [test] `runDaemonRekickStackPreflight` returns a result whose kind is not `halted`, and no `loop_halt` event containing `live HALT without resume authorization` is persisted for the slug.
- [test] The stub runner's first executed step is `test_suite`, in that same single dispatch; between setup and the dispatch the test writes or deletes nothing in the worktree, stages no resume authorization or `REKICK`, and invokes no CLI resume or other operator command.

**Files likely touched:**
- src/conductor/test/engine/stack-preflight-wiring.retryable-halt.realgit.test.ts — new integration test

**Dependencies:** Task 1, Task 8

### Task 11: Refused and idle dispatches never earn a progress re-kick
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-retryable-halt-loop.test.ts` for every Done-when check below, with the same harness as Task 7.
2. Verify RED.
3. Implement any wiring gaps the tests expose in `src/conductor/src/engine/daemon.ts`.
4. Verify GREEN; commit.

**Done when:**
- [test] An executor simulating a stack-preflight refusal (no step runs, no task resolved, a live-owner `mechanical` HALT written, earlier children holding resolved tasks) is never admitted by the progress predicate, and the slug gets at most one prompt re-dispatch.
- [test] A stacked fixture in the #3601 state run for 80 simulated seconds shows at most 2 `resume`/`start` lines for the slug in the daemon log.
- [test] An executor that resolves one task and then writes a `mechanical` HALT identical to `HALT.rekicked` is re-dispatched by the progress predicate, and the admission is counted against the ceiling.
- [test] With `build_progress_halt.enabled: false`, a progressing executor ending in a fresh `mechanical` HALT is still cleared and re-dispatched once, and never re-dispatched by the progress predicate.

**Files likely touched:**
- src/conductor/test/engine/daemon-retryable-halt-loop.test.ts — refusal and progress cases
- src/conductor/src/engine/daemon.ts — wiring gaps only

**Dependencies:** Task 7

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
