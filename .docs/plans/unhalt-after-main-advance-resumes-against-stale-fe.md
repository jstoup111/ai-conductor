# Implementation Plan: Unhalt after main advance resumes against stale feature base

**Date:** 2026-08-11
**Stories:** .docs/stories/unhalt-after-main-advance-resumes-against-stale-fe.md
**Conflict check:** Clean as of 2026-08-11
**Issue:** jstoup111/ai-conductor#1245

## Summary

Adds a resume-time base-advance evaluation to the daemon's halt-resume path so a feature whose base
moved on integrates that base before any judged gate grades it. 19 tasks.

## Technical Approach

**The defect.** Rebase-first play-forward is reachable only through the one-shot `.pipeline/REKICK`
sentinel, and `clearMarker` (`daemon-rekick.ts:312-326`) is its only writer. `rekickSweep` skips
`needs-human`/`unclassified` halts on every sweep, and an operator's `rm .pipeline/HALT` reaches no
`clearMarker` caller at all — so `resumeRebaseFirst` returns `'skipped'` at its first line and the
feature resumes against a stale merge-base. `build_review` then grades
`merge-base(origin/<default>, HEAD)..HEAD` and attributes an already-upstream commit to the feature.

**The change, in three parts.**

1. **A new evaluator module** (`src/conductor/src/engine/base-advance.ts`) exporting
   `evaluateBaseAdvance(git)`. It composes two existing primitives and adds no git plumbing:
   `resolveFreshBase(git)` (`rebase.ts:274-330`), then `isBranchCurrent(git, ref)`
   (`rebase.ts:360-367`). It returns a discriminated union with no boolean in its public shape:

   | verdict | condition | consequence |
   |---|---|---|
   | `current` | remote base resolved, `isBranchCurrent` true | dispatch as today |
   | `advanced` | remote base resolved, `isBranchCurrent` false | play forward |
   | `undeterminable` | `resolveFreshBase` degraded to `kind: 'local'`, or `rev-list` failed | dispatch as today, never rebase |

   The three-valued shape is load-bearing: `resolveFreshBase` fail-softs to a *local* branch name on
   any git/network error, so a boolean would collapse "verified current" with "could not verify" and
   license a rebase onto an unverified ref. `isBranchCurrent` returns `false` on an unknown ref,
   which is safe inside `performRebase` but inverted at a gate deciding *whether to rebase* — hence
   the evaluator resolves the base first and never infers `advanced` from a failed count.

2. **An explicit trigger on the play-forward.** `resumeRebaseFirst`'s guard
   (`daemon-rekick.ts:447-448`) becomes "sentinel present OR trigger passed". Sentinel handling is
   otherwise untouched: still consumed one-shot up front when present, even when the trigger also
   fired. Everything after the guard is unchanged and shared by both entry reasons, which is why the
   merged-PR guard, seal verification/rotation, bounded conflict resolution, build pre-verify and
   verdict application all cover the new entry for free.

3. **The seam.** In `runConductorInWorktree` (`src/conductor/src/daemon-cli.ts`), between the
   `isOperatorParked` check (**:1070**, re-derived) and the `resumeRebaseFirst` call (**:1079**),
   therefore before `conductor.run()` (**:1104**). Park keeps strict precedence; the verdict-aware
   resume clamp reads post-rebase verdicts; and daemon-only policy stays out of the shared conductor
   loop (`runRebaseStep` already hard-codes a noop for non-daemon runs).

**Halt-resume scoping.** Evaluation runs only on halt-resume dispatches. Two signals, both already
present: the daemon's in-memory `parked` set — a slug that reached `pickEligible`'s parked branch and
fell through because its marker cleared (`daemon.ts:140-153`) — and the durable
`.pipeline/HALT.cleared` marker (`HALT_CLEARED_MARKER`, `daemon-rekick.ts:44`) that the `clearMarker`
paths write. A HALT cleared while the daemon is stopped leaves neither signal; that gap is
**accepted and deliberately not closed** (`adr-2026-08-11-play-forward-entry-trigger`).

**Observability.** One new `ConductorEvent` variant plus its `EVENT_SINKS` entry. The registry is a
`Record` typed over the union and is total, so a missing key fails compilation — the sink entry is
not optional bookkeeping. No sidecar file, no bespoke log, no third ledger.

**What this plan does NOT build.** Seal rotation already happens on this path:
`resumeRebaseFirst` → `performRebase(..., { translateAfterRebase })` → rotation with trigger
`proactive-rebase` (`rebase-translate.ts:437-476`). Story 7 therefore *verifies inherited behavior*;
no new seal code is authored. Build pre-verify also already exists here
(`makeRekickBuildPreVerify`, `daemon-rekick.ts:344-376,537`) and is not re-added.

**Baseline note.** This spec's DECIDE pass amended one artifact it does not own —
`.docs/decisions/adr-2026-07-07-build-review-judgement-gate.md` gained an additive note recording
that the finish-time step is no longer the only sanctioned mid-BUILD rebase. That amendment is part
of the spec-branch baseline before BUILD begins; no task below touches it.

## Prerequisites

- None. No migration, no config key, no new dependency.

## Tasks

### Task 1: Verdict type for the base-advance evaluation
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test asserting the exported verdict type discriminates on `kind` and that
   `current`/`advanced` carry `baseRef` and `baseSha`, while `undeterminable` carries a `reason`.
2. Verify test fails (RED).
3. Implement the discriminated union in a new module — no boolean field anywhere in the public shape.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): add base-advance verdict type"

**Files likely touched:**
- `src/conductor/src/engine/base-advance.ts` — new module, type only
- `src/conductor/test/engine/base-advance.test.ts` — new test file

**Wired-into:** none (inert until Task 9)
**Dependencies:** none

### Task 2: Evaluator returns `current` for a resolved, up-to-date base
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: injected git returns a remote-kind fresh base and `rev-list --count HEAD..ref`
   of `0`; assert verdict `current` carrying that ref and sha.
2. Verify test fails (RED).
3. Implement `evaluateBaseAdvance(git)` composing `resolveFreshBase` then `isBranchCurrent`.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): evaluate base currency at resume"

**Files likely touched:**
- `src/conductor/src/engine/base-advance.ts` — evaluator implementation
- `src/conductor/test/engine/base-advance.test.ts` — happy-path case

**Wired-into:** none (inert until Task 9)
**Dependencies:** Task 1

### Task 3: Evaluator returns `advanced` when the base carries commits the branch lacks
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: remote-kind fresh base with `rev-list --count` greater than `0`; assert
   verdict `advanced` with the compared ref and sha.
2. Verify test fails (RED).
3. Extend the evaluator's branch for the non-current case.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): report an advanced base at resume"

**Files likely touched:**
- `src/conductor/src/engine/base-advance.ts` — advanced branch
- `src/conductor/test/engine/base-advance.test.ts` — advanced case

**Wired-into:** none (inert until Task 9)
**Dependencies:** Task 2

### Task 4: Evaluator returns `undeterminable` on every degraded resolution
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests, one per trigger: no `origin` remote; `ls-remote` non-zero; unresolvable
   default branch; and a `rev-list` non-zero exit against an otherwise-resolved remote base. Assert
   `undeterminable` in every case — never `advanced` — and that no rebase-adjacent git write is
   issued.
2. Verify tests fail (RED).
3. Implement: treat `resolveFreshBase`'s `kind: 'local'` fail-soft shape and a failed count as
   `undeterminable`, each with a distinguishing `reason`.
4. Verify tests pass (GREEN).
5. Commit: "fix(engine): never infer a base advance from an unverified base"

**Files likely touched:**
- `src/conductor/src/engine/base-advance.ts` — undeterminable branches
- `src/conductor/test/engine/base-advance.test.ts` — four negative cases

**Wired-into:** none (inert until Task 9)
**Dependencies:** Task 3

### Task 5: Explicit trigger option on the play-forward guard
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests for all four guard combinations: sentinel only (runs, consumes once), trigger
   only (runs, creates no sentinel), both (runs once, consumes the sentinel exactly once), neither
   (returns `'skipped'`, issues no git operation).
2. Verify tests fail (RED).
3. Add the trigger option to `resumeRebaseFirst` and change the guard to "sentinel present OR
   trigger"; leave sentinel consumption and everything after the guard untouched.
4. Verify tests pass (GREEN).
5. Commit: "feat(daemon): accept an explicit play-forward trigger"

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — guard and options
- `src/conductor/test/engine/daemon-rekick.test.ts` — four guard combinations

**Wired-into:** src/conductor/src/daemon-cli.ts#runConductorInWorktree
**Dependencies:** Task 1

### Task 6: The one-shot contract holds when the play-forward throws
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: sentinel present, play-forward throws after consumption; assert the sentinel
   is not recreated so a crash cannot loop on it.
2. Verify test fails (RED).
3. Implement/confirm the ordering that guarantees it.
4. Verify test passes (GREEN).
5. Commit: "test(daemon): pin one-shot sentinel semantics on the failure path"

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — ordering if needed
- `src/conductor/test/engine/daemon-rekick.test.ts` — failure-path case

**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 7: Trigger entry survives an unreadable sentinel
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: trigger passed, sentinel probe raises a non-ENOENT error; assert the
   play-forward still runs via the trigger rather than aborting the resume.
2. Verify test fails (RED).
3. Implement the probe's error handling for the trigger path.
4. Verify test passes (GREEN).
5. Commit: "fix(daemon): an unreadable sentinel does not abort a triggered resume"

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — sentinel probe error handling
- `src/conductor/test/engine/daemon-rekick.test.ts` — unreadable-sentinel case

**Wired-into:** same as Task 5
**Dependencies:** Task 6

### Task 8: Halt-resume signal reaches the dispatch call site
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: a slug that fell through `pickEligible`'s parked branch because its marker
   cleared is marked as a halt-resume; a slug dispatched fresh is not.
2. Verify test fails (RED).
3. Implement the flag derivation from the daemon's existing in-memory parked bookkeeping plus the
   durable `.pipeline/HALT.cleared` marker, and thread it to the dispatch call site.
4. Verify test passes (GREEN).
5. Commit: "feat(daemon): mark halt-resume dispatches"

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — derive the flag at selection
- `src/conductor/test/engine/daemon.test.ts` — halt-resume vs fresh dispatch

**Wired-into:** src/conductor/src/daemon-cli.ts#runConductorInWorktree
**Dependencies:** none

### Task 9: Wire the evaluator into the resume path after the park check
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: a halt-resume dispatch with an advanced base calls the play-forward with the
   trigger, and does so before `conductor.run()` is reached.
2. Verify test fails (RED).
3. Call `evaluateBaseAdvance` in `runConductorInWorktree` after the `isOperatorParked` check
   (`:1070`) and before `resumeRebaseFirst` (`:1079`); pass the trigger on `advanced`. Add no second
   build-start call site — this is a second entry *condition* on the existing one.
4. Verify test passes (GREEN).
5. Commit: "feat(daemon): integrate an advanced base before resuming a halted feature"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — evaluator call and trigger wiring
- `src/conductor/test/engine/daemon-cli-base-advance-wiring.test.ts` — new wiring test

**Wired-into:** src/conductor/src/daemon-cli.ts#runConductorInWorktree
**Dependencies:** Task 4, Task 5, Task 8

### Task 10: A current base resumes with evidence untouched
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: halt-resume with verdict `current`; capture every `.pipeline/gates/*.json`
   verdict before and after and assert byte-identical, no rebase performed, and no rebase-completion
   state stamped.
2. Verify test fails (RED).
3. Implement the no-op path (dispatch unchanged when the verdict is not `advanced`).
4. Verify test passes (GREEN).
5. Commit: "test(daemon): a current base resumes without invalidating evidence"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — no-op branch
- `src/conductor/test/engine/daemon-cli-base-advance-wiring.test.ts` — current-verdict case

**Wired-into:** same as Task 9
**Dependencies:** Task 9

### Task 11: An unverifiable base never rebases, but a co-present sentinel still does
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: verdict `undeterminable` performs no rebase; the same verdict on a worktree
   holding an unconsumed sentinel still runs the sentinel play-forward — the new trigger is
   suppressed, the pre-existing behavior is not.
2. Verify tests fail (RED).
3. Implement the suppression so it scopes to the trigger only.
4. Verify tests pass (GREEN).
5. Commit: "fix(daemon): an unverifiable base suppresses only the new trigger"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — suppression scope
- `src/conductor/test/engine/daemon-cli-base-advance-wiring.test.ts` — undeterminable cases

**Wired-into:** same as Task 9
**Dependencies:** Task 10

### Task 12: A non-halt-resume dispatch performs no evaluation
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: an ordinary fresh dispatch issues no `ls-remote` and no `rev-list` against a
   base ref, and behaves byte-identically to today.
2. Verify test fails (RED).
3. Gate the evaluation on the halt-resume flag from Task 8.
4. Verify test passes (GREEN).
5. Commit: "fix(daemon): scope base evaluation to halt-resume dispatches"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — halt-resume gate
- `src/conductor/test/engine/daemon-cli-base-advance-wiring.test.ts` — fresh-dispatch case

**Wired-into:** same as Task 9
**Dependencies:** Task 11

### Task 13: Operator park still outranks base-advance recovery
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: a parked worktree with an advanced base issues zero evaluation git commands
   and zero rebases; its unconsumed sentinel is byte-identical afterwards; a throwing park check
   suppresses evaluation entirely (fail-toward-parked).
2. Verify tests fail (RED).
3. Confirm/adjust ordering so evaluation is strictly after the park check.
4. Verify tests pass (GREEN).
5. Commit: "test(daemon): park outranks base-advance recovery"

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — ordering if needed
- `src/conductor/test/engine/daemon-cli-base-advance-wiring.test.ts` — park precedence cases

**Wired-into:** same as Task 9
**Dependencies:** Task 12

### Task 14: Conflict HALT names the base-advance trigger
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests: a trigger-entered play-forward that conflicts past the resolution cap writes
   a HALT whose reason names the base-advance trigger and the base ref; a sentinel-entered conflict
   HALT reason is unchanged from today; a within-cap resolution writes no HALT. Assert no new halt
   class is introduced.
2. Verify tests fail (RED).
3. Thread the entry reason into the conflict HALT reason string.
4. Verify tests pass (GREEN).
5. Commit: "feat(daemon): attribute a resume-time rebase conflict to its trigger"

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — HALT reason attribution
- `src/conductor/test/engine/daemon-rekick.test.ts` — attribution cases

**Wired-into:** same as Task 5
**Dependencies:** Task 9

### Task 15: Emit the base decision on the event spine
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests: the emitted event distinguishes all three verdicts and both entry reasons,
   and carries the compared base ref and sha; a failing emitter does not prevent the rebase or the
   resume; a non-halt-resume dispatch emits nothing.
2. Verify tests fail (RED).
3. Add the variant to the `ConductorEvent` union and its `{render, persist, audit}` entry to the
   `EVENT_SINKS` registry (the Record is total — a missing key fails compilation). Emit through the
   feature's existing emitter.
4. Verify tests pass (GREEN).
5. Commit: "feat(events): record the resume-time base decision"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new union variant
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `src/conductor/src/daemon-cli.ts` — emission at the seam
- `src/conductor/test/engine/base-advance-events.test.ts` — new test file

**Wired-into:** src/conductor/src/daemon-cli.ts#runConductorInWorktree
**Dependencies:** Task 9

### Task 16: A second resume at an unchanged base grants no fresh kickback budget
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing test: after a resume-triggered rebase, a second halt-clear and resume evaluates
   `current`, performs no rebase, leaves the tree hash unchanged, and therefore grants no fresh
   cross-dispatch kickback budget — the trigger is self-limiting.
2. Verify test fails (RED).
3. Implement/confirm the behavior.
4. Verify test passes (GREEN).
5. Commit: "test(daemon): resume-triggered rebase is self-limiting"

**Files likely touched:**
- `src/conductor/test/engine/daemon-cli-base-advance-wiring.test.ts` — second-resume case

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13

### Task 17: The upstream-equivalent commit leaves the graded diff, with a control
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing acceptance test on a real local git repo: a feature commit patch-equivalent to a
   commit merged into the base after divergence. Drive the resume path; assert the commit's paths are
   absent from `merge-base(base, HEAD)..HEAD`. **Control:** the identical starting state with the
   rebase suppressed still yields those paths and a Scope failure. Also assert a same-files-but-
   different-patch commit survives the rebase, and that the stale-mirage regrade counter is
   unconsumed in the resume case.
2. Verify tests fail (RED).
3. Implement only if the assumption proves false; if the clean rebase already drops the commit, the
   task lands as verification.
4. Verify tests pass (GREEN).
5. Commit: "test(acceptance): upstream-equivalent work leaves the graded diff after resume"

**Files likely touched:**
- `src/conductor/test/acceptance/unhalt-after-main-advance-resumes-against-stale-fe.acceptance.test.ts` — new acceptance file

**Wired-into:** none (no new production surface)
**Dependencies:** Task 14

### Task 18: Seal rebaselines on the resume path without a manual reseal
**Story:** 7
**Type:** happy-path
**Verify-only:** yes

**Steps:**
1. Write acceptance assertions: after a resume-triggered clean rebase whose base carries newer
   protected `.docs/` content, the seal's `rebaselines[]` gains an entry with the proactive-rebase
   trigger, `fromCommit`, `toCommit` and the changed protected paths; the next seal verification
   passes with no operator command; a `noop` or `conflict_halt` outcome leaves the seal untouched;
   and a legitimately-refused rotation still halts.
2. Verify the assertions run RED against a suppressed-rotation fixture.
3. Author no new seal code — rotation is inherited via `performRebase` → `translateAfterRebase`.
4. Verify assertions pass (GREEN).
5. Commit: "test(acceptance): resume-triggered rebase rebaselines the seal"

**Files likely touched:**
- `src/conductor/test/acceptance/unhalt-after-main-advance-resumes-against-stale-fe.acceptance.test.ts` — seal lineage assertions

**Wired-into:** none (no new production surface)
**Dependencies:** Task 17

### Task 19: The reported incident reaches BUILD end to end
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing acceptance test reproducing the incident: human-required halt, sealed worktree,
   upstream-equivalent commit, advanced base, unattempted remediation tasks. Assert the conductor
   reaches its step loop rather than re-halting on the same finding, that no manual reseal or
   sentinel authoring occurred, and that the unchanged-base variant resumes with evidence intact.
   Assert the resume-time halt-state clear still completes before the first PR-consuming task and a
   re-halt leaves no half-cleared halt state.
2. Verify test fails (RED).
3. Implement any residual wiring the scenario exposes.
4. Verify test passes (GREEN).
5. Commit: "test(acceptance): #1245 scenario resumes into BUILD"

**Files likely touched:**
- `src/conductor/test/acceptance/unhalt-after-main-advance-resumes-against-stale-fe.acceptance.test.ts` — end-to-end scenario

**Wired-into:** none (no new production surface)
**Dependencies:** Task 18

## Task Dependency Graph

```
Task 1 ─┬─► Task 2 ──► Task 3 ──► Task 4 ─┐
        │                                  │
        └─► Task 5 ──► Task 6 ──► Task 7   │
                 │                          │
Task 8 ──────────┴──────────────────────────┴─► Task 9
                                                   │
                    ┌──────────────────────────────┤
                    ▼                              ▼
                 Task 15                       Task 10 ──► Task 11 ──► Task 12 ──► Task 13 ──► Task 16
                                                   │
                                               Task 14 ──► Task 17 ──► Task 18 ──► Task 19
```

Tasks 1-4 (evaluator), 5-7 (guard) and 8 (signal) are independent tracks that converge at Task 9,
the single wiring point. Task 15 (events) and Tasks 10-13 (dispatch behavior) are independent after
that. Task 16 depends on Task 13 because it asserts a *second* resume after the park-precedence
behavior is settled. The acceptance chain 17→18→19 is sequential because each extends the same
fixture repository.

## Integration Points

- **After Task 9** — the resume path integrates an advanced base end to end; the core defect is
  closed and testable against a real repository.
- **After Task 15** — the decision is observable in the daemon log and event ledger.
- **After Task 19** — the reported incident scenario is proven closed.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No new build-start call site added (park-all-dispatch-paths enumeration test still passes)
- [ ] No new seal code authored; rotation verified as inherited
- [ ] `test/test_harness_integrity.sh` passes
