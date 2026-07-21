# Implementation Plan: Conduct loop no-verdict diagnostics

**Date:** 2026-07-21
**Track:** technical (no PRD)
**Stories:** .docs/stories/conduct-loop-exits-silently-between-steps-no-termi.md
**Complexity:** S (.docs/complexity/conduct-loop-exits-silently-between-steps-no-termi.md)
**Conflict check:** N/A — Small tier skips conflict-check

## Summary

Enrich the conductor's daemon-only no-verdict backstop so a "parking for
inspection" HALT always records why the loop exited, never prints `last step:
unknown`, and so an escaped async rejection at the step-transition seam converts
to a normal HALT with a stack. All changes are confined to
`src/conductor/src/engine/conductor.ts` plus its test file and a CHANGELOG
entry. 9 tasks.

## Technical Approach

The main loop lives in `Conductor.run()` — a `try` at ~L1882 spans the whole
loop; its `catch` at ~L5125 writes `.pipeline/HALT` (`conductor error: <msg>`)
+ a `loop_halt` event for any *thrown* error; a daemon-only `finally` backstop
at ~L5166 fires when the run reaches `finally` with neither `.pipeline/DONE`
nor `.pipeline/HALT` — the "no terminal verdict" park. Today that backstop's
reason is `loop exited without a terminal verdict (last step: ${state.last_step
?? 'unknown'})` and carries no other evidence; `state.last_step` is only
assigned for `worktree`/`complexity`, so most exits print `unknown`.

Design decisions:

1. **Breadcrumb (in-run mutable state).** Introduce a local `breadcrumb` in
   `run()` — `{ lastAdvancedStep, exitIndex, lastEventType }` — updated as the
   loop advances and whenever the loop emits an event (via a small local
   `track(ev)` wrapper that sets `lastEventType` then delegates to
   `this.events.emit`). This is the single place that knows where the loop was
   when it fell through, matching the existing "enforce the invariant in one
   place" design already coded into that finally block.

2. **`resolveLastStep` (pure helper).** A module-level function that returns a
   concrete step: prefer `state.last_step`, else `breadcrumb.lastAdvancedStep`,
   else the furthest-progressed completed step key in `state` (`=== 'done'`),
   else the explicit sentinel `'no step recorded'`. It NEVER returns
   `'unknown'`. Pure and unit-testable in isolation.

3. **Enriched backstop + catch.** The `finally` backstop composes its reason
   from `resolveLastStep(...)` + breadcrumb (last event type, exit index),
   assembled failure-tolerantly (a try/catch around diagnostics so it can never
   itself throw and strand the run), and writes the SAME text to the marker and
   the emitted `loop_halt` event. The `catch` handler additionally includes the
   error's `.stack` (keeping the existing safe non-Error stringify).

4. **Transition-seam wrap (hardening).** Wrap the `await this.advanceTail(...)`
   transition call in a localized try/catch that tags an escaped rejection with
   step-transition context and re-throws, so the outer `catch` records a
   transition-tagged HALT with a stack rather than a bare message. Since the
   transition already sits inside the outer `try`, this adds diagnostic
   attribution, not a new catch of the process-level kind.

## Prerequisites

- None. All edits are within an existing file; no migrations, deps, or schema
  changes. (Engine-internal: not a `bin/conduct CLI` / `hook wiring` /
  `settings.json schema` / `skill symlink` surface, so no migration block.)

## Tasks

### Task 1: Add run-scoped breadcrumb (last-advanced step + exit index)
**Story:** No-verdict backstop HALT captures why the loop exited — happy path (last-advanced step, loop exit index)
**Type:** infrastructure

**Steps:**
1. Write failing test: a daemon run that early-returns between steps produces a `.pipeline/HALT` whose content contains the last-advanced step name and the loop exit index.
2. Verify test fails (RED).
3. Implement: declare `const breadcrumb = { lastAdvancedStep: undefined, exitIndex: undefined, lastEventType: undefined }` in `run()`; at the top of each loop iteration set `breadcrumb.lastAdvancedStep = step.name` and `breadcrumb.exitIndex = i`.
4. Verify test passes (GREEN).
5. Commit: "feat(conductor): breadcrumb tracks last-advanced step + exit index in run loop".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — add breadcrumb, update per iteration

**Wired-into:** none (no new production surface) — internal loop state read by the Task 4 backstop
**Dependencies:** none

### Task 2: Track last emitted event type on the breadcrumb
**Story:** No-verdict backstop HALT captures why the loop exited — happy path (last emitted event type)
**Type:** infrastructure

**Steps:**
1. Write failing test: after a run emits a known step-boundary event and then early-returns, the no-verdict HALT content names that last event type.
2. Verify test fails (RED).
3. Implement: add a local `const track = (ev) => { breadcrumb.lastEventType = ev.type; return this.events.emit(ev); }` in `run()` and route the loop's step-boundary emits through `track(...)`.
4. Verify test passes (GREEN).
5. Commit: "feat(conductor): breadcrumb records last emitted event type".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — add `track` wrapper, route loop emits

**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 3: Add `resolveLastStep` pure helper (never returns `unknown`)
**Story:** `last step: unknown` never appears — happy path + negative path (reconstruct furthest completed step; explicit sentinel)
**Type:** happy-path

**Steps:**
1. Write failing unit test: `resolveLastStep({ build:'done', manual_test:'done' }, {})` returns `'manual_test'`; `resolveLastStep({}, {})` returns `'no step recorded'`; neither returns `'unknown'`. Given a set `state.last_step`, it is preferred.
2. Verify test fails (RED).
3. Implement: export `function resolveLastStep(state, breadcrumb)` — prefer `state.last_step`; else `breadcrumb.lastAdvancedStep`; else the furthest-progressed step key with value `'done'` (by canonical step order); else `'no step recorded'`.
4. Verify test passes (GREEN).
5. Commit: "feat(conductor): resolveLastStep helper — concrete last step, never 'unknown'".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — new exported helper

**Wired-into:** src/conductor/src/engine/conductor.ts#run (consumed by the finally backstop in Task 4)
**Dependencies:** none

### Task 4: Enrich the no-verdict backstop reason; remove the `unknown` fallback
**Story:** No-verdict backstop HALT captures why the loop exited (happy) + `last step: unknown` never appears (happy)
**Type:** happy-path

**Steps:**
1. Write failing test: a daemon run that hits the backstop writes a `.pipeline/HALT` whose reason contains the resolved last step, the last event type, and the exit index; the emitted `loop_halt` event `reason` equals the marker content; the substring `unknown` is absent.
2. Verify test fails (RED).
3. Implement: in the `finally` backstop (~L5166) replace `state.last_step ?? 'unknown'` with `resolveLastStep(state, breadcrumb)` and append `last event: <breadcrumb.lastEventType ?? 'none'>` and `exit index: <breadcrumb.exitIndex ?? 'n/a'>`; build the string once and use it for BOTH the marker write and the `loop_halt` event.
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): no-verdict HALT records last step, event, exit index (#502)".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — finally backstop reason

**Wired-into:** same as Task 3
**Dependencies:** 1, 2, 3

### Task 5: Failure-tolerant diagnostics assembly (never throws)
**Story:** No-verdict backstop HALT captures why the loop exited — negative path (no breadcrumb/event → still well-formed HALT, no throw)
**Type:** negative-path

**Steps:**
1. Write failing test: with no breadcrumb recorded and no last event (empty breadcrumb), the backstop still writes a non-empty `.pipeline/HALT` and emits `loop_halt`, naming the absence explicitly (e.g. "no step recorded" / "last event: none"), and does not throw.
2. Verify test fails (RED).
3. Implement: wrap the diagnostics-string assembly in the backstop in a `try/catch` that falls back to a minimal fixed reason on any error, guaranteeing a marker + event are always produced.
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): backstop diagnostics assembly is failure-tolerant".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — finally backstop assembly guard

**Wired-into:** same as Task 4
**Dependencies:** 4

### Task 6: Reconstruction + empty-state coverage for `unknown` elimination
**Story:** `last step: unknown` never appears — happy path (reconstruct from state) + negative path (empty-state sentinel)
**Type:** negative-path

**Steps:**
1. Write failing test A: seed state `{ build:'done', manual_test:'done' }` with no `last_step`, trigger the backstop, assert the HALT reason names `manual_test` and does NOT contain `unknown`.
2. Write failing test B: seed empty state (no step keys, no `last_step`), trigger the backstop, assert the reason contains `no step recorded` and does NOT contain `unknown`. Add a source-level assertion that the `?? 'unknown'` token is gone from the backstop.
3. Verify tests fail (RED) — then pass (GREEN) against Tasks 3–4.
4. Commit: "test(conductor): last-step reconstruction + empty-state sentinel (#502)".

**Files likely touched:**
- src/conductor/test/engine/conductor-terminal-marker.test.ts — new cases

**Wired-into:** none (test-only)
**Dependencies:** 4

### Task 7: Tag + surface escaped step-transition rejections (with stack)
**Story:** An escaped async rejection in the step-transition path becomes a HALT — happy path (message + stack; classified halted)
**Type:** happy-path

**Steps:**
1. Write failing test: force the transition/advance path (`advanceTail`) to reject with an `Error`; assert a `.pipeline/HALT` is written, a `loop_halt` event fires, and the reason contains the error message AND its stack, and the run classifies `halted` (DONE absent, HALT present).
2. Verify test fails (RED).
3. Implement: wrap `await this.advanceTail(...)` (~L5073) in a localized try/catch that tags the caught error with step-transition context and re-throws; in the outer `catch` (~L5132) include `err instanceof Error ? err.stack ?? err.message : String(err)` in the reason (keep the safe non-Error stringify).
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): transition-seam rejections HALT with tagged stack (#502)".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — advanceTail wrap + catch reason

**Wired-into:** none (no new production surface) — hardens existing wired catch/transition path
**Dependencies:** none

### Task 8: Safe conversion of a non-Error transition rejection
**Story:** An escaped async rejection in the step-transition path becomes a HALT — negative path (non-Error rejection stringified safely; handler never throws)
**Type:** negative-path

**Steps:**
1. Write failing test: force the transition path to reject with a non-`Error` value (e.g. a string or `undefined`); assert a well-formed `.pipeline/HALT` is still written with a safely stringified reason, a `loop_halt` event fires, and no throw escapes the handler; classifies `halted`.
2. Verify test fails (RED).
3. Implement: confirm/adjust the outer `catch` and the Task 7 wrap so a non-Error rejection is coerced via `String(err)` without dereferencing `.stack`/`.message` on a non-object.
4. Verify test passes (GREEN).
5. Commit: "fix(conductor): non-Error transition rejection converts to well-formed HALT".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — catch coercion
- src/conductor/test/engine/conductor-terminal-marker.test.ts — non-Error case

**Wired-into:** same as Task 7
**Dependencies:** 7

### Task 9: CHANGELOG entry for the fix
**Story:** Repo release gate (CHANGELOG on every PR) — infrastructure
**Type:** infrastructure

**Steps:**
1. Add under `## [Unreleased]` → `### Fixed` a line: "conductor: no-verdict backstop HALT now records the last step, last event, and exit index (no more `last step: unknown`), and step-transition rejections HALT with a stack instead of exiting silently (#502)".
2. Verify `test/test_harness_integrity.sh` still passes (CHANGELOG has `[Unreleased]`).
3. Commit: "docs(changelog): no-verdict diagnostics fix (#502)".

**Files likely touched:**
- CHANGELOG.md — Unreleased/Fixed entry

**Wired-into:** none (no new production surface)
**Verify-only:** omit
**Dependencies:** none

## Task Dependency Graph

```
Task 1 ─┐
Task 2 ─┼─► Task 4 ─► Task 5
Task 3 ─┘        └──► Task 6
Task 7 ─► Task 8
Task 9  (independent)
```

## Integration Points

- After Task 4: a daemon run that hits the no-verdict backstop can be inspected end-to-end — marker + event carry the last step, last event, and exit index, with `unknown` eliminated.
- After Task 8: the step-transition seam converts both Error and non-Error escaped rejections into classified `halted` HALTs with diagnostics.

## Verification

- [ ] All happy-path criteria covered: Task 1/2/4 (backstop diagnostics), Task 3/4/6 (last-step resolution), Task 7 (transition rejection → HALT + stack)
- [ ] All negative-path criteria covered: Task 5 (failure-tolerant assembly), Task 6 (empty-state sentinel), Task 8 (non-Error rejection)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Every task carries a `**Wired-into:**` line
- [ ] `last step: unknown` token removed (Task 4 + Task 6 source assertion)
