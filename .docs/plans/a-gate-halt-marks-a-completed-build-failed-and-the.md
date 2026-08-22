# Implementation Plan: A gate halt marks a completed build failed, and the residue blocks every later resume

**Date:** 2026-08-21
**Source:** jstoup111/ai-conductor#1753
**Track:** technical
**Tier:** M
**Stories:** .docs/stories/a-gate-halt-marks-a-completed-build-failed-and-the.md
**Architecture review:** .docs/decisions/architecture-review-2026-08-21-a-gate-halt-marks-a-completed-build-failed-and-the.md
**Conflict check:** Clean as of 2026-08-21

## Summary

Give the conductor one typed "refused" step outcome for the three pre-dispatch refusals (protected-artifact seal, missing worktree, live boundary) so none of them can stamp a step `failed`; make resume entry always land on a step the prerequisite gate admits; and make the residual gate-blocked halt name the prerequisite and its status. 14 tasks.

## Technical Approach

- **Typed refusal facet.** `StepRunResult` gains `refused?: { kind: 'protected-artifact' | 'missing-worktree' | 'live-boundary'; reason: string }`, following the existing typed-facet precedent (`worktreeMissing`, `permissionDenied`, `unretryableInputs`). The dispatch loop checks `result.refused` in ONE handler placed before the retry/escalation bookkeeping and before the retries-exhausted `saveConductorStepStatus(..., 'failed')`. The handler writes the HALT (class per kind: seal keeps `PROTECTED_ARTIFACT_HALT_CLASS` and its existing attempt-≥2 threshold; the other two keep their existing `emitLoopHalt` behaviour), emits the spine event, stamps the T7 `lastResolvedCount` exactly as the seal exit does today, and returns — it performs **no** status write. Routing is on the facet, never on `output` text (adr-2026-08-19 D1).
- **Spine event.** New `ConductorEvent` member `{ type: 'step_refused'; step; kind; reason }` declared in `EVENT_SINKS` as `{ render: true, persist: true, audit: false }` (the exhaustive `Record` forces the declaration). `retry_decision` is `persist: false`, so it cannot carry the persisted record Story 2 requires; a new member is the sanctioned route.
- **Resume entry.** In `Conductor.run`'s `this.resume` branch, after `findResumeIndex` and the optional verdict clamp, apply `clampToRunnablePrerequisite(steps, state, startIndex)` unconditionally. It is the same backward-only, `checkGate`-based walk adr-2026-08-03-build-repair D4 already applies at the selection site; it reads state and never writes. `--from-step` stays exempt. Task 9 pins the gap with a test on the unmodified engine first; if that test is already green, Task 10 is skipped and an intake issue records the unexplained observed jump.
- **Gate-blocked residual.** `checkGate` returns the unsatisfied prerequisites with their statuses (`unsatisfied: Array<{ step; status }>`) alongside the existing `reason` string. The markerless `gate_blocked` return writes a `needs-human` HALT whose reason is `Prerequisite gate blocked <step>: <prereq> (status: <status>)[, …]`. The finally-backstop keeps its existing wording for every other exit shape.
- **Local test pattern.** Conductor loop tests build a temp project with `createTempProject`-style fixtures and inject a fake step runner returning a scripted `StepRunResult` per attempt; seal tests seed `.pipeline/protected-artifact-seal.json` and a committed `.docs/` artifact then mutate it. Traits to preserve: fake runner per attempt, real `.pipeline/` on disk, assertions read `conduct-state.json` and `events.jsonl` back. Search hints: `test/engine/conductor.test.ts` (`step_failed`, `loop exited without a terminal verdict`), `test/engine/resume-verdict-clamp.test.ts`, `test/engine/protected-artifact-seal.test.ts`, `test/acceptance/protected-artifact-seal-rebaseline-976.acceptance.test.ts`. Allowed variation: a fresh `test/engine/step-refusal.test.ts` file for the new handler rather than growing `conductor.test.ts`.

All paths below are relative to the repository root; the engine lives under `src/conductor/`.

## Prerequisites

- None beyond a clean `npm test` baseline in `src/conductor`.

## Tasks

### Task 1: Add the `refused` facet and the `step_refused` spine event
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: a type-level test in `test/engine/step-refusal.test.ts` constructs `{ success: false, refused: { kind: 'protected-artifact', reason: 'x' } }` as `StepRunResult` and emits `{ type: 'step_refused', step: 'build', kind: 'protected-artifact', reason: 'x' }` through `ConductorEventEmitter`; assert it lands in `events.jsonl`.
2. Verify test fails (RED) — compile error on the unknown facet / event member.
3. Implement: add `refused?: { kind: RefusalKind; reason: string }` to `StepRunResult`; add the `step_refused` member to the `ConductorEvent` union; add `step_refused: { render: true, persist: true, audit: false }` to `EVENT_SINKS`; add a minimal renderer line.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): typed refused facet and step_refused spine event"

**Done when:**
- `StepRunResult.refused` exists with the closed `kind` union (`protected-artifact | missing-worktree | live-boundary`).
- `EVENT_SINKS` compiles with `step_refused` declared `persist: true`; the test finds the record in `events.jsonl`.
- No existing test changes.

> **Amended 2026-08-22 by #1753:** the criterion "No existing test changes" is superseded for two
> files only — `src/conductor/test/engine/daemon-render.test.ts` and
> `src/conductor/test/engine/event-sinks.test.ts`. Adding `step_refused` to the `ConductorEvent`
> union makes both files' exhaustive event-type samples fail unless the new member is listed, so
> the additions are a mechanical consequence of this task's own union change, not new behavior.
> Authorized: the renderer assertion at `daemon-render.test.ts:73`, the current/previous exhaustive
> samples at `:404` and `:479`, and the `PRE_REFACTOR_PERSISTED_EVENT_TYPES` /
> `DAEMON_SWITCH_HANDLED_EVENT_TYPES` entries at `event-sinks.test.ts:23,150`. No other existing
> test changes under this task.

**Files:**
- src/conductor/src/engine/conductor.ts — `StepRunResult` facet
- src/conductor/src/types/events.ts — event member
- src/conductor/src/engine/event-sinks.ts — sink declaration
- src/conductor/src/engine/report-renderer.ts — render line
- src/conductor/test/engine/step-refusal.test.ts — new
- src/conductor/test/engine/daemon-render.test.ts — `step_refused` added to exhaustive samples (amended 2026-08-22)
- src/conductor/test/engine/event-sinks.test.ts — `step_refused` added to exhaustive samples (amended 2026-08-22)

**Dependencies:** none

### Task 2: Seal refusal produces the refused facet instead of a bare failure
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: in `test/engine/step-refusal.test.ts`, drive a BUILD step dispatch whose injected `verifyProtectedArtifactSeal` returns `ok: false`; assert the result handed to the loop carries `refused.kind === 'protected-artifact'` and `refused.reason` equals the seal reason.
2. Verify test fails (RED).
3. Implement: at the `protectedArtifactIssue` branch, set `result = { success: false, output: dispatchIssue, refused: { kind: 'protected-artifact', reason: dispatchIssue } }`. Leave the attempt-≥2 HALT write and the T7 `lastResolvedCount` stamp in place.
4. Verify test passes (GREEN).
5. Commit: "feat(engine): seal refusal carries the refused facet"

**Done when:**
- The seal-refusal result carries `refused.kind: 'protected-artifact'`.
- Seal HALT class and reason text are byte-identical to before (existing `protected-artifact-seal` tests pass unchanged).

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/step-refusal.test.ts

**Dependencies:** Task 1

### Task 3: One refusal handler short-circuits before retry bookkeeping and the failed stamp
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: `build = done` in `conduct-state.json`, seal refuses on attempts 1 and 2; run the loop; assert `conduct-state.json` still reads `build: done`, `events.jsonl` contains `step_refused` for `build` and no `step_failed`, and the HALT marker exists with class `protected-artifact`. Second case: `build = pending`, refusal on attempt 1 only; assert `build` stays `pending` and no `step_failed`.
2. Verify test fails (RED) — today `build` flips to `failed`.
3. Implement: immediately after `result` is produced in the per-attempt loop, `if (result.refused) { … }`: emit `step_refused`; on the seal kind keep the existing attempt-1 retry (`continue`) and attempt-≥2 HALT; when the HALT is written, stop the watchers, `process.off` the signal handlers, and `return` from the step — never reaching `saveConductorStepStatus(state, step.name, 'failed')`.
4. Verify test passes (GREEN).
5. Commit: "fix(engine): refused dispatch never stamps the step failed (#1753)"

**Done when:**
- Test A: `build: done` survives two seal refusals; `HALT.class` reads `protected-artifact`; no `step_failed` in `events.jsonl`.
- Test B: `build: pending` survives one refusal; no `step_failed`.
- The refusal handler contains no call to `saveConductorStepStatus` or `ConductStateStore` mutation (asserted by Task 5).

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/step-refusal.test.ts

**Dependencies:** Task 2

### Task 4: A genuine provider failure still stamps `failed` and emits `step_failed`
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write test: seal `ok: true`, fake runner returns `{ success: false, output: 'boom' }` on every attempt with `max_retries: 2`; assert `build: failed`, a `step_failed` event, and the build-outcome record `terminalOutcome: 'failed'`. Second case: seal `ok: true`, assert no `step_refused` event and the runner was invoked.
2. Verify (expected GREEN on current code — this is the preserved contract; keep it as the regression guard).
3. No implementation unless RED.
4. Commit: "test(engine): genuine build failure keeps failed semantics"

**Done when:**
- Both cases pass after Task 3 lands.
- `grep -c step_refused events.jsonl` is 0 for the genuine-failure run.

**Files:**
- src/conductor/test/engine/step-refusal.test.ts

**Preserves:** a dispatched step whose own work fails on every retry is recorded failed and blocks its dependents

**Dependencies:** Task 3

### Task 5: Refusal path performs no state mutation (mutation-port spy)
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: wrap/spy the conductor's state-write seam (`saveConductorStepStatus` / `ConductStateStore`), run the Task 3 scenario, assert zero writes for `build` during the refusal path and that `conduct-state.json` bytes are unchanged between dispatch start and halt.
2. Verify test fails or passes (RED expected only if Task 3 left a write; otherwise GREEN is the proof).
3. Implement: remove any write found.
4. Commit: "test(engine): refusal path is mutation-free"

**Done when:**
- Spy records zero status writes for the refused step.
- `conduct-state.json` SHA before == after.

**Files:**
- src/conductor/test/engine/step-refusal.test.ts
- src/conductor/src/engine/conductor.ts

**Dependencies:** Task 3

### Task 6: Missing-worktree preflight routes through the refused facet
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: `build = done`, project root removed before dispatch of `build_review`; assert HALT written with the existing missing-worktree reason, `build_review` prior status unchanged, `step_refused` with `kind: 'missing-worktree'` emitted, no `step_failed`. Negative: root present → no `step_refused`, runner invoked.
2. Verify test fails (RED) on the missing `step_refused` event.
3. Implement: `missingWorktreeResult` sets `refused: { kind: 'missing-worktree', reason }` (keep `worktreeMissing: true` for existing consumers); the Task 3 handler covers the `missing-worktree` kind by calling the existing `emitLoopHalt(reason)` path and returning. The old `if (result.worktreeMissing)` branch is removed or delegates to the handler.
4. Verify test passes (GREEN).
5. Commit: "refactor(engine): missing-worktree refusal shares the refused handler"

**Done when:**
- Missing-worktree run emits `step_refused` kind `missing-worktree` and the unchanged HALT reason.
- Existing #681 tests (`no .pipeline/ written into the absent path`) pass unchanged.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/step-refusal.test.ts

**Dependencies:** Task 3

### Task 7: Live-boundary halt routes through the refused facet
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: seed `pendingLiveBoundaryHalt` (via the existing test seam for `consumePendingLiveBoundaryHalt`) with a reason; at the next dispatch boundary assert the completed prior step keeps `done`, a `step_refused` with `kind: 'live-boundary'` is emitted, and the HALT class is `mechanical` (unchanged).
2. Verify test fails (RED) on the missing event.
3. Implement: at the `consumePendingLiveBoundaryHalt()` consumption sites in the dispatch loop, construct `refused: { kind: 'live-boundary', reason }` and route through the Task 3 handler (which for this kind calls the existing `surfaceRemediationPr` + `emitLoopHalt` sequence).
4. Verify test passes (GREEN).
5. Commit: "refactor(engine): live-boundary refusal shares the refused handler"

**Done when:**
- Live-boundary run emits `step_refused` kind `live-boundary`; HALT reason and class unchanged.
- Existing self-host live-boundary tests pass unchanged.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/step-refusal.test.ts

**Dependencies:** Task 3

### Task 8: Refusal records stay on the spine and inside the closed HALT-class set
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write test: for each of the three kinds, after the halt assert (a) `.pipeline/` contains no new file other than `HALT`, `HALT.class`, `events.jsonl`, `conduct-state.json`, and the pre-existing evidence sidecar; (b) `HALT.class` content ∈ {`needs-human`, `mechanical`, `protected-artifact`}; (c) the `step_refused` line is in `events.jsonl`.
2. Verify (GREEN expected after Tasks 3, 6, 7; RED pinpoints any stray write).
3. Commit: "test(engine): refusal writes only the spine and closed halt classes"

**Done when:**
- All three kinds pass (a)–(c).

**Files:**
- src/conductor/test/engine/step-refusal.test.ts

**Dependencies:** Task 6, Task 7

### Task 9: Pin the unclamped-resume gap on the unmodified engine
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write test in `test/engine/resume-verdict-clamp.test.ts`: state `build: failed`, `build_review: stale`, `test_suite: stale`, earlier steps `done`, NO verdict files under `.pipeline/gates/`; `conductor.run({ resume: true })` in daemon mode with a fake runner; assert the first dispatched step is `build` and no `gate_blocked` event is emitted.
2. Run it against the unmodified engine and record the result in the commit body.
3. If RED: commit the failing test (skipped/todo-marked so CI stays green) and proceed to Task 10. If GREEN: commit it as a passing regression test, mark Task 10 `Evidence: skipped` with reason "pin test green on HEAD", and open an intake issue via `/intake` describing the observed `test_suite` jump with the events from #1753 as the unexplained residue.
4. Commit: "test(engine): pin resume entry for build=failed with no verdict clamp"

**Done when:**
- The test exists and its RED/GREEN result on the unmodified engine is stated in the commit body.
- If GREEN, an intake issue URL is recorded in the same commit body.

**Files:**
- src/conductor/test/engine/resume-verdict-clamp.test.ts

**Dependencies:** none

### Task 10: Apply the runnable-prerequisite walk unconditionally at resume entry
**Story:** 3
**Type:** happy-path

**Steps:**
1. Un-skip the Task 9 test (RED).
2. Implement: in `Conductor.run`'s `this.resume` branch, after the verdict-clamp block, `startIndex = clampToRunnablePrerequisite(steps, state, startIndex)`. No change to `findResumeIndex`, `checkGate`, `stepSatisfied`, `gateSatisfied`, or any state write.
3. Add assertions: `conduct-state.json` bytes unchanged across entry; a candidate whose gate already passes keeps its index (walk never moves forward) — use the existing `finish:'in_progress'` + all-satisfied fixture.
4. Verify GREEN; run `test/engine/resume-verdict-clamp.test.ts` whole.
5. Commit: "fix(engine): resume entry always lands on an admitted step (#1753)"

**Done when:**
- Task 9 test passes; all pre-existing resume-clamp tests pass unchanged.
- `git diff` touches no line inside `checkGate`, `stepSatisfied`, `gateSatisfied`, or `findResumeIndex`.
- State-bytes-unchanged assertion passes.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/resume-verdict-clamp.test.ts

**Preserves:** the resume clamp only ever lowers the start index and never mutates pipeline state

**Dependencies:** Task 9

### Task 11: `--from-step` stays exempt from the walk
**Story:** 3
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Confirm the existing `--from-step finish` exemption test in `test/engine/resume-verdict-clamp.test.ts` still passes after Task 10 and that the new walk sits inside the `this.resume` branch only.
2. If the fixture does not cover `build: failed` + `--from-step test_suite`, add that one case asserting `test_suite` is targeted.
3. Commit (empty allowed): "test(engine): from-step exempt from runnable-prerequisite walk"

**Done when:**
- A test asserts `fromStep: 'test_suite'` with `build: failed` targets `test_suite`.

**Files:**
- src/conductor/test/engine/resume-verdict-clamp.test.ts

**Dependencies:** Task 10

### Task 12: `checkGate` reports each unsatisfied prerequisite with its status
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test in `test/engine/gates.test.ts` (create if absent): `checkGate('test_suite', { build: 'failed', … })` returns `{ passed: false, reason: 'Prerequisites not satisfied: build', unsatisfied: [{ step: 'build', status: 'failed' }] }`; two-prerequisite case lists both.
2. Verify RED.
3. Implement: extend the `GateResult` failure branch with `unsatisfied: Array<{ step: StepName; status: StepStatus }>` using `getStepStatus`; `reason` string unchanged.
4. Verify GREEN.
5. Commit: "feat(engine): checkGate names unsatisfied prerequisites with status"

**Done when:**
- Both cases pass; `reason` text is unchanged so existing `gate_blocked` consumers are untouched.

**Files:**
- src/conductor/src/engine/gates.ts
- src/conductor/test/engine/gates.test.ts

**Dependencies:** none

### Task 13: The residual gate-blocked exit writes a `needs-human` HALT naming the prerequisite
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test in `test/engine/conductor.test.ts`: daemon mode, `test_suite` selected, `build: failed`, and `build` itself gated off by an unsatisfied prerequisite so the walk has no admitted step; run; assert HALT body matches `/Prerequisite gate blocked test_suite: build \(status: failed\)/`, `HALT.class` is `needs-human`, and the `loop_halt` event carries the same reason. Negatives: (a) a runnable prerequisite is dispatched and no gate HALT is written; (b) with the breadcrumb file replaced by garbage the HALT is still written with a classifiable reason; (c) a non-gate markerless exit keeps the literal "loop exited without a terminal verdict" wording.
2. Verify RED on the new wording.
3. Implement: at the `gate_blocked` return, build the reason from `gate.unsatisfied` and call `writeHaltMarker(reason, 'needs-human')` + `emitLoopHalt` before returning; the finally-backstop is untouched (it sees the marker and does not fire).
4. Verify GREEN.
5. Commit: "fix(engine): gate-blocked residual halt names the prerequisite and its status (#1753)"

**Done when:**
- Happy case HALT matches the regex; class `needs-human`.
- Negatives (a)–(c) pass; the backstop wording test in `conductor.test.ts` is unchanged.

> **Amended 2026-08-22 by #1753:** this task additionally authorizes an edit to
> `src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts:664-679`
> (landed in `7277e3c7d`). Routing the residual gate-blocked exit through the refused facet gives the
> routed run legitimate earlier BUILD attempts, so the C1 tail comparison must anchor on each run's
> final BUILD (`lastIndexOf`) rather than its first. The comparison must stay an equality of the two
> runs' post-BUILD step sequences; it may not be narrowed further.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — C1 tail anchor (amended 2026-08-22)

**Dependencies:** Task 12, Task 10

### Task 14: Output text can never manufacture a refusal; the provider-throw path is unchanged
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write test: fake runner returns `{ success: false, output: 'Protected artifact changed: .docs/plans/x.md' }` with seal `ok: true`; assert `build: failed`, `step_failed` emitted, no `step_refused`. Second case: runner throws; assert the existing catch path stamps `failed` and writes its HALT as before. Third: with `build: failed` from the first case, `checkGate('test_suite')` is not passed.
2. Verify GREEN (contract guard); RED would reveal text-based routing, which must be removed.
3. Commit: "test(engine): refusal is never derived from output text"

**Done when:**
- All three cases pass; `grep -n "refused" src/conductor/src/engine/conductor.ts` shows no branch keyed on `output`/`reason` string content.

**Files:**
- src/conductor/test/engine/step-refusal.test.ts

**Dependencies:** Task 3

## Task Dependency Graph

```
1 → 2 → 3 → 4
          ├→ 5
          ├→ 6 ┐
          ├→ 7 ┴→ 8
          └→ 14
9 → 10 → 11
12 ┐
10 ┴→ 13
```

## Integration Points

- After Task 3: the #1753 scenario (seal refusal on a completed build) no longer rewrites `build`.
- After Task 10: clearing a refusal HALT and re-dispatching reaches `test_suite` without a hand-edit.
- After Task 13: the only remaining markerless gate exit produces an operator-readable halt.

## Coverage

| Story criterion | Task |
|---|---|
| 1 happy 1–3 | 3 |
| 1 neg 1–2 | 4 |
| 1 neg 3 | 5 |
| 2 happy 1, neg 1 | 6 |
| 2 happy 2 | 7 |
| 2 happy 3, neg 2–3 | 8 (event emission in 1/3) |
| 3 happy 1–2, neg 1–2 | 10 |
| 3 happy 3 | 11 |
| 3 neg 3 | 9 |
| 4 happy 1–3, neg 1–3 | 13 (status shape in 12) |
| 5 happy 1 | 4 |
| 5 happy 2, neg 1–2 | 14 |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
### Task rem-scope-1: src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts:667,674 — authorize and specify the terminal two-step routing assertion that tolerates legitimate earlier retry attempts
### Task rem-scope-2: src/conductor/test/engine/daemon-render.test.ts:73,404,479 — authorize adding step_refused to the rendering assertion and exhaustive current/previous event-type samples
### Task rem-scope-3: src/conductor/test/engine/event-sinks.test.ts:23,150 — authorize adding step_refused to the persisted-event and daemon-switch-handled exhaustive sets
