# Implementation Plan: Validation-group halts are attributed to the member that raised them

**Date:** 2026-10-21
**Design:** .docs/track/ship-halts-from-as-built-are-recorded-as-prd-audit.md
**Stories:** .docs/stories/ship-halts-from-as-built-are-recorded-as-prd-audit.md
**Conflict check:** Not required (Tier S)

## Summary

Every terminal halt the daemon validation group raises names the member it is about — in `loop_halt`, in the committed halt record, and in the halted `feature_dispatch_ended` event, including under child-executor isolation. Multi-member halts name a deterministic member and refuse every failing member on the spine. Eight tasks.

## Technical Approach

- **Why it is wrong today.** The validation group runs inside the walk of its entry step, so `emitLoopHalt` reads `dispatchingStep` (the entry step, `prd_audit` in production) and the halt record reads the `step:` line of `.pipeline/phase-active` (also the entry step). The daemon's `feature_dispatch_ended` copies the last `loop_halt` step. Under child-executor isolation (the default) the supervisor emits `feature_dispatch_ended` itself and the child's copy is dropped, so the halted event carries no step and no haltClass at all, and the OTel `conductor.feature.halts` metric (which needs both) never records.
- **Explicit attribution at the halt site (one mechanism, two sinks).** `halt-marker.ts` `writeHaltMarker` gains an optional trailing halting step that the halt record prefers over the phase marker. In `conductor.ts` the private `writeHaltMarker` and `emitLoopHalt` gain the same optional argument; `emitLoopHalt` prefers it over `dispatchingStep` with the existing known-step validation. Each validation-group terminal exit passes the member it already knows; nothing is inferred from halt text. Absent the argument every existing caller behaves exactly as before, so serial (interactive) SHIP halts and non-group halts are untouched.
- **Attribution rule.** As-built exits → `architecture_review_as_built`; prd_audit route and refusal-rework exits → `prd_audit`; a member's own dispatch fault (no-verdict, mechanical fault, permission denial, cached-login trial, authentication park) → that member; a gap member's no-op escalation → that gap member; the remediation-planner halts over several gaps → the first gap member in group order (first non-`manual_test` gap member for the merged manual_test work order); the generic halt → its existing judging step (first failed member in group order, else the entry step).
- **Every failing member on the spine.** `recordGroupRefusal` already emits one member-scoped `step_refused` per refused member with an admitted execution context, and marks them `refused`. The two remediation-planner halts that skip it today now call it like the as-built planner halt does, and the as-built refused sets add `manual_test` when it has FAIL rows at the join (the generic halt's predicate). Passing siblings are never refused.
- **Child isolation.** `makeRunFeature`'s `endDispatch('halted')` already computes `{ step, haltClass }` (last `loop_halt` step, `HALT.class` sidecar); it now also returns them as an optional `halt` on the halted outcome (`FeatureOutcome` and `FeatureExecutionOutcome`). The child runner returns that outcome unchanged and the executor protocol passes the outcome object through (it validates only that it is an object), so the supervisor in `child-feature-executor.ts` spreads `halt.step` and `halt.haltClass` onto the `feature_dispatch_ended` it emits. An older pinned child sends no `halt`; the event is then emitted as today. No protocol version change and no `ConductorEvent` union change.
- **Remediation planner's own validator fault.** `planRemediation` can halt on a deterministic validator fault before the group site halts again; the group site's later `loop_halt` carries the attributed member and is the last one, which is what `feature_dispatch_ended` copies.

Local test pattern: `src/conductor/test/engine/step-refusal.test.ts` drives a real `Conductor.run()` over a seeded SHIP state with `fromStep: 'manual_test'`, stubs `verdictDispatchHandshake`, persists events with `EventPersister`, and asserts persisted `loop_halt`/`step_refused` events — the new `validation-group-halt-attribution.test.ts` follows it, adding a `vi.mock` passthrough of the halt-marker module to record the halting-step argument. Allowed variation: stub private routing/planner methods (`planRemediation`, route resolution) with `vi.spyOn(conductor as any, ...)` when a real verdict fixture is impractical. `halt-marker.test.ts`'s `makeFeatureRepository` proves the committed record. `daemon-runner.test.ts` and `child-feature-executor.test.ts` already collect `feature_dispatch_ended` via `events.on`.

## Prerequisites

- None.

## Tasks

### Task 1: The halt record names an explicit halting step
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-marker.test.ts`, reusing its `makeFeatureRepository` feature-branch fixture: (a) write `.pipeline/phase-active` with `step: prd_audit` and `phase: SHIP`, call `writeHaltMarker(root, body, 'plan-gap', emitter, undefined, 'architecture_review_as_built')`, and assert the committed `.docs/halted/operator-decision.md` contains `Halting step: architecture_review_as_built` and not `Halting step: prd_audit`; (b) the same phase marker with no halting-step argument still yields `Halting step: prd_audit`; (c) a `mechanical` halt with a halting-step argument commits no record.
2. Verify RED.
3. Implement in `src/conductor/src/engine/halt-marker.ts`: `writeHaltMarker` takes an optional trailing `haltingStep?: string` (after `recordRemote`), threads it through `writeHaltRecord` to `haltRecordInput`, which uses it in preference to the phase marker's `step:` field; with it absent, the phase-marker read and its `unknown` fallback are unchanged. The `HALT` body, `HALT.class`, and the recordability predicate are unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `writeHaltMarker` called with halting step `architecture_review_as_built` while the phase marker says `step: prd_audit` commits a halt record containing `Halting step: architecture_review_as_built` and no `Halting step: prd_audit` line, as asserted by the explicit-step record test.
- [test] `writeHaltMarker` called without a halting step still renders the phase marker's step (`Halting step: prd_audit`), and a `mechanical` halt given a halting step commits no record, as asserted by the fallback and mechanical tests.

**Files likely touched:**
- src/conductor/src/engine/halt-marker.ts
- src/conductor/test/engine/halt-marker.test.ts

**Dependencies:** none

### Task 2: As-built group halts name architecture_review_as_built
**Story:** 1
**Type:** happy-path

**Steps:**
1. Create `src/conductor/test/engine/validation-group-halt-attribution.test.ts` modelled on `src/conductor/test/engine/step-refusal.test.ts` (real `Conductor.run()` over a seeded SHIP state, `fromStep: 'manual_test'` so the group's entry step is `manual_test`, `daemon: true`, `verifyArtifacts: true`, `verdictDispatchHandshake` stubbed, events persisted through `EventPersister`). Mock `../../src/engine/halt-marker.js` with `vi.mock` passing through to the actual module while recording each `writeHaltMarker` call's halting-step argument. Search hints: `AS_BUILT_BLOCKED`, `runAndReadRefusal`, `plan-gap-undelivered`, `Outcome delivered: no`, `kickback-to-build no-op`, `could not be projected`.
2. Write failing cases, each asserting the persisted `loop_halt` event's `step` and the recorded halting-step argument: (a) as-built terminal verdicts — a typed PLAN_GAP verdict whose outcome is undelivered (class `plan-gap`), a DESIGN finding, and an invalid verdict — with `prd_audit` passing; (b) the as-built remediable route with `planRemediation` stubbed to return a needs-human halt; (c) the as-built no-op kickback escalation; (d) the all-green round whose as-built findings projection refuses; (e) an as-built terminal verdict while `prd_audit` also reports blocking gaps; (f) a BUILD-step halt outside the group.
3. Verify RED (today every group case names the entry step).
4. Implement in `src/conductor/src/engine/conductor.ts`: the private `writeHaltMarker(body, haltClass, haltingStep?)` forwards `haltingStep` as the halt-marker module's trailing argument; `emitLoopHalt(reason, prUrl?, haltingStep?)` uses `haltingStep` in preference to `dispatchingStep`, with the same known-step validation. Pass `'architecture_review_as_built'` to both calls at the four as-built exits of the validation-group join: the terminal as-built halt, the remediable route's planner halt, its no-op escalation halt, and the all-green findings projection refusal.
5. Verify GREEN and commit.

**Done when:**
- [test] For a typed undelivered PLAN_GAP verdict (class `plan-gap`), a DESIGN verdict, and an invalid verdict with `prd_audit` passing, the group's `loop_halt` step is `architecture_review_as_built` and the conductor passes `architecture_review_as_built` as the halting step to the halt-marker module's `writeHaltMarker`, so the committed record (Task 1) reads `Halting step: architecture_review_as_built`; no event or halting-step argument names the entry step `manual_test`.
- [test] The as-built remediable route's needs-human planner halt, its no-op escalation halt, and the all-green findings projection refusal each emit `loop_halt` with step `architecture_review_as_built`, as asserted by the remediable-path cases.
- [test] An as-built terminal verdict raised while `prd_audit` also reports blocking gaps emits `loop_halt` with step `architecture_review_as_built`, as asserted by the mixed-round case.
- [test] A BUILD-step halt outside the validation group still emits `loop_halt` with step `build` (the dispatching step) and passes no halting step to `writeHaltMarker`, as asserted by the outside-group case.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/validation-group-halt-attribution.test.ts

**Dependencies:** Task 1

### Task 3: prd_audit-origin group halts name prd_audit
**Story:** 2
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/validation-group-halt-attribution.test.ts` (same fixture: entry step `manual_test`, halt-marker calls recorded): the `prd_audit` route's projection halt, plan-gap halt, and over-scope halt, and the fully refused over-scope round whose rework cannot run (allowance spent, and planner fault). Drive the route by stubbing the conductor's prd-audit route resolution where a real verdict fixture is impractical; search hints: `projection-halt`, `plan-gap-halt`, `over-scope-halt`, `haltGroupedRefusalRework`, `writeRefusalReworkHalt`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`: pass `'prd_audit'` as the halting step to `writeHaltMarker` and `emitLoopHalt` at the group's prd_audit projection, plan-gap, and over-scope halts; `writeRefusalReworkHalt` and `writeRefusalReworkAllowanceHalt` accept an optional halting step they forward to `writeHaltMarker`, and `haltGroupedRefusalRework` passes `'prd_audit'` to them and to `emitLoopHalt`. Serial callers of those two writers pass nothing and keep today's attribution.
4. Verify GREEN and commit.

**Done when:**
- [test] The group's prd_audit projection, plan-gap, and over-scope halts each emit `loop_halt` with step `prd_audit` and pass `prd_audit` as the halting step to `writeHaltMarker`, so a recordable halt's committed record (Task 1) reads `Halting step: prd_audit`, with the group entered from `manual_test`, as asserted by the prd_audit route cases.
- [test] The refusal-rework halts (allowance spent, and planner fault) emit `loop_halt` with step `prd_audit` and pass `prd_audit` as the halting step to `writeHaltMarker`, as asserted by the refusal-rework cases.
- [test] In every prd_audit-origin case the as-built review passed and no `loop_halt` event, no halting-step argument, and therefore no committed halt record's `Halting step:` line (Task 1 renders that argument) names `architecture_review_as_built`.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/validation-group-halt-attribution.test.ts

**Dependencies:** Task 2

### Task 4: A member's own fault names that member
**Story:** 3
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/validation-group-halt-attribution.test.ts`: (a) `architecture_review_as_built` returns no verdict until retries are exhausted (group entered from `manual_test`); (b) a member returns a mechanical fault; (c) a member's provider denies a required permission, a member's cached-login recovery trial fails, and the group parks on a member's authentication failure (search hints: `permission review denied`, `cached-login recovery trial`, `parkOnAuthFailure`, `src/conductor/test/engine/conductor-auth-park.test.ts`); (d) a gap member's join-routed kickback-to-build no-op escalation; (e) `manual_test` returns no verdict with the group entered from `prd_audit`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`: pass the faulting member's step to `writeHaltMarker` and `emitLoopHalt` at the no-verdict halt, the permission-denial halt, the cached-login trial halt, and the authentication park halt (the first member whose dispatch hit the authentication failure), and the gap member's name at the gap no-op escalation halt. `haltForValidatorFault(state, reason, haltingStep?)` forwards an optional halting step to both calls; the group's mechanical-fault exit passes the faulting member, and every other caller passes nothing.
4. Verify GREEN and commit.

**Done when:**
- [test] An `architecture_review_as_built` no-verdict halt emits `loop_halt` with step `architecture_review_as_built` and passes it as the halting step to `writeHaltMarker` (so a recordable record names that member), as asserted by the no-verdict case.
- [test] A member's mechanical-fault halt emits `loop_halt` with that member's step and commits no halt record (class `mechanical` through `haltForValidatorFault`), as asserted by the mechanical-fault case.
- [test] The permission-denial, cached-login trial, and authentication park halts each emit `loop_halt` with the affected member's step, and a gap member's kickback no-op escalation emits `loop_halt` with that gap member's step, as asserted by the dispatch-failure and no-op cases.
- [test] A `manual_test` no-verdict halt in a group entered from `prd_audit` emits `loop_halt` with step `manual_test`, not `prd_audit`, as asserted by the manual_test case.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/validation-group-halt-attribution.test.ts

**Dependencies:** Task 3

### Task 5: Multi-member halts name a deterministic member and refuse every failing member
**Story:** 4
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/validation-group-halt-attribution.test.ts`, asserting `loop_halt` step and the persisted member-scoped `step_refused` events (`kind: 'validation-verdict'`): (a) generic halt with `manual_test` FAIL rows and `prd_audit` missing its gate (non-daemon auto mode, as the existing generic-halt refusal test does); (b) the mixed-failure planner halt with `prd_audit` the gap member (`planRemediation` stubbed to return a needs-human halt); (c) the merged manual_test planner halt with `manual_test` FAIL rows plus gap members; (d) an as-built terminal verdict while `manual_test` has FAIL rows; (e) single-member failure; (f) a passing sibling beside a multi-member halt.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`: the generic halt passes its existing judging step (the first failed member in group order, else the entry step) to `writeHaltMarker` and `emitLoopHalt`; the mixed-failure planner halt calls `recordGroupRefusal` with judging step = first gap member in group order and refused steps = every gap member, and passes that judging step to both calls; the merged manual_test planner halt does the same with judging step = first non-`manual_test` gap member and refused steps = `manual_test` plus every gap member; the as-built terminal and remediation-halt refused sets also include `manual_test` when it has FAIL rows at the join, the same predicate the generic halt uses. Passing siblings are never added to a refused set.
4. Verify GREEN and commit.

**Done when:**
- [test] The generic halt with failing `manual_test` and `prd_audit` emits `loop_halt` with step `manual_test` and a `step_refused` event for each of `manual_test` and `prd_audit`, as asserted by the generic multi-member case.
- [test] The mixed-failure planner halt for gap member `prd_audit` emits `loop_halt` with step `prd_audit` and a `step_refused` event for every gap member it planned, and the merged manual_test planner halt emits `loop_halt` with the first non-`manual_test` gap member and a `step_refused` event for `manual_test` and every gap member, as asserted by the planner-halt cases.
- [test] An as-built terminal halt while `manual_test` has FAIL rows emits `loop_halt` with step `architecture_review_as_built` and a `step_refused` event for each of `architecture_review_as_built` and `manual_test`, as asserted by the as-built-with-manual-test case.
- [test] A single failing member yields exactly one `step_refused` event naming it, and a passing sibling is neither marked `refused` in conduct state nor named by any `step_refused` event or `loop_halt` step, as asserted by the single-member and passing-sibling cases.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/validation-group-halt-attribution.test.ts

**Dependencies:** Task 4

### Task 6: The feature runner returns the halting step and class with a halted outcome
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-runner.test.ts` using its existing `makeRunFeature` fixtures (search hint: `events.on('feature_dispatch_ended'`): (a) a `runConductor` fake that emits `loop_halt` with step `architecture_review_as_built`, writes `.pipeline/HALT` and `.pipeline/HALT.class` = `plan-gap`, and returns halted: the returned outcome carries `halt: { step: 'architecture_review_as_built', haltClass: 'plan-gap' }` and the in-process `feature_dispatch_ended` event carries the same step and haltClass; (b) complete and error outcomes carry no `halt`.
2. Verify RED.
3. Implement: add optional `halt?: { step: string; haltClass: HaltDisposition }` to `FeatureOutcome` in `src/conductor/src/engine/daemon.ts` and to `FeatureExecutionOutcome` in `src/conductor/src/engine/feature-executor.ts`; in `src/conductor/src/engine/daemon-runner.ts`, `endDispatch('halted')` keeps the `{ step, haltClass }` it computes for the event and every halted return after it carries that value as `halt`. The in-process event's fields are unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] A halted run whose last `loop_halt` names `architecture_review_as_built` with `HALT.class` `plan-gap` returns an outcome whose `halt` is `{ step: 'architecture_review_as_built', haltClass: 'plan-gap' }` and emits an in-process `feature_dispatch_ended` with step `architecture_review_as_built`, as asserted by the halted-outcome test.
- [test] Complete and error runs return outcomes with no `halt` field, as asserted by the non-halted test.

**Files likely touched:**
- src/conductor/src/engine/daemon.ts
- src/conductor/src/engine/feature-executor.ts
- src/conductor/src/engine/daemon-runner.ts
- src/conductor/test/engine/daemon-runner.test.ts

**Dependencies:** none

### Task 7: The supervisor's dispatch-ended event carries the child's halting step and class
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/child-feature-executor.test.ts` using its fake-child fixtures (search hint: `events.on('feature_dispatch_ended'`): (a) the child sends a halted outcome carrying `halt: { step: 'architecture_review_as_built', haltClass: 'plan-gap' }` → the supervisor emits exactly one `feature_dispatch_ended` with outcome `halted`, step `architecture_review_as_built`, haltClass `plan-gap`; (b) a halted outcome with no `halt` (an older pinned child) → one `halted` event with no step and no haltClass, and the execute result is not an error; (c) a done outcome → one `complete` event with no step or haltClass; (d) an error outcome → one `terminated` event with no step or haltClass; (e) the child exits before any outcome → one `terminated` event with no step and no haltClass.
2. Verify RED.
3. Implement in `src/conductor/src/engine/child-feature-executor.ts`: when the collected result's status is `halted` and it carries `halt`, spread its `step` and `haltClass` onto the supervisor-emitted `feature_dispatch_ended`; otherwise emit exactly what is emitted today. Run the outcome through the child path unchanged: `makeExecutorChildFeatureRunner` already returns the runner's outcome, and the executor protocol passes the outcome object through.
4. Verify GREEN and commit.

**Done when:**
- [test] A child halted outcome carrying `halt` `{ step: 'architecture_review_as_built', haltClass: 'plan-gap' }` makes the supervisor emit exactly one `feature_dispatch_ended` with outcome `halted`, step `architecture_review_as_built`, and haltClass `plan-gap`, as asserted by the halted-child test.
- [test] A halted outcome without `halt` emits one `halted` event with no step and no haltClass while `execute` resolves a non-error result, as asserted by the older-child test.
- [test] A done outcome emits one `complete` event with no step or haltClass, an error outcome emits one `terminated` event with no step or haltClass, and a child exiting before its outcome emits exactly one `terminated` event with no step and no haltClass, as asserted by the non-halted tests.

**Files likely touched:**
- src/conductor/src/engine/child-feature-executor.ts
- src/conductor/test/engine/child-feature-executor.test.ts

**Dependencies:** Task 6

### Task 8: The halt metric records a halted event's step and class
**Story:** 5
**Type:** verification

**Steps:**
1. Run the existing OTel listener test in `src/conductor/test/engine/otel/metrics-listener.test.ts` that emits a halted `feature_dispatch_ended` carrying `haltClass` and `step`; confirm it asserts the `conductor.feature.halts` count under that step and class.
2. Complete with an empty commit carrying `Task: 8` and `Evidence: skipped existing metrics-listener coverage`.

**Done when:**
- [test] The existing metrics-listener test emits `feature_dispatch_ended` with outcome `halted`, haltClass `mechanical`, and step `build`, and asserts `conductor.feature.halts` recorded under that step and class.
- `onFeatureHalt` in `src/conductor/src/engine/otel/metrics-listener.ts` is reached for every halted `feature_dispatch_ended` carrying both `haltClass` and `step`, the shape Task 7 now emits from the supervisor.

**Files likely touched:** none

**Verify-only:** yes

**Dependencies:** Task 7

## Task Dependency Graph

```
Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5
Task 6 -> Task 7 -> Task 8
```

Tasks 2-5 serialize because they share `conductor.ts` and the new test file.

## Integration Points

- After Task 2: a validation-group as-built halt reaches `loop_halt` and the committed halt record with `architecture_review_as_built`.
- After Task 7: a child-executor halted dispatch carries the halting step and class on the supervisor's `feature_dispatch_ended`, so the OTel halt metric records again.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon validation group whose as-built review returns a terminal verdict (a PLAN_GAP the plan cannot deliver, a DESIGN finding, or an invalid verdict) while `prd_audit` passes, when the group halts, then the `loop_halt` event's step is `architecture_review_as_built` and the committed halt record reads `Halting step: architecture_review_as_built`. | 2, 1 | "the group's `loop_halt` step is `architecture_review_as_built` and the conductor passes `architecture_review_as_built` as the halting step to the halt-marker module's `writeHaltMarker`" | diff-local |
| Story 1 happy: Given a daemon validation group whose as-built review is BLOCKED with remediable findings and remediation returns a needs-human halt, hits the kickback no-op escalation, or cannot project the remediated findings into the verdict artifact, when the group halts, then the `loop_halt` event's step is `architecture_review_as_built`. | 2 | "The as-built remediable route's needs-human planner halt, its no-op escalation halt, and the all-green findings projection refusal each emit `loop_halt` with step `architecture_review_as_built`" | diff-local |
| Story 1 happy: Given the as-built halt is raised while `prd_audit` also reported blocking gaps in the same round, when the group halts on the as-built verdict, then the `loop_halt` event's step is still `architecture_review_as_built`. | 2 | "An as-built terminal verdict raised while `prd_audit` also reports blocking gaps emits `loop_halt` with step `architecture_review_as_built`" | diff-local |
| Story 1 negative: Given an as-built halt whose class is `plan-gap`, when the halt is written, then the halt record's `Halting step:` line and the `loop_halt` step are both `architecture_review_as_built` and neither names the group's entry step. | 2, 1 | "For a typed undelivered PLAN_GAP verdict (class `plan-gap`)" | diff-local |
| Story 1 negative: Given a halt raised outside a validation group (for example a BUILD step halt), when it is written, then its halting step is the step that was dispatching, exactly as before this change. | 2 | "A BUILD-step halt outside the validation group still emits `loop_halt` with step `build` (the dispatching step)" | diff-local |
| Story 2 happy: Given a daemon validation group whose `prd_audit` route resolves to a plan-gap halt, an over-scope halt, or a projection halt, when the group halts, then the `loop_halt` event's step is `prd_audit` and a recordable halt's record reads `Halting step: prd_audit`. | 3, 1 | "so a recordable halt's committed record (Task 1) reads `Halting step: prd_audit`" | diff-local |
| Story 2 happy: Given a daemon validation group whose fully refused over-scope round cannot be reworked (the refusal-rework allowance is spent or the planner faults), when the group halts, then the `loop_halt` event's step is `prd_audit`. | 3 | "The refusal-rework halts (allowance spent, and planner fault) emit `loop_halt` with step `prd_audit`" | diff-local |
| Story 2 negative: Given the validation group was entered from a step other than `prd_audit` and the halt originates in `prd_audit`, when the group halts, then the halting step is `prd_audit` and not the entry step. | 3 | "with the group entered from `manual_test`" | diff-local |
| Story 2 negative: Given a `prd_audit`-origin halt while the as-built review passed, when the group halts, then no event or record for that halt names `architecture_review_as_built` as its halting step. | 3, 1 | "no `loop_halt` event, no halting-step argument, and therefore no committed halt record's `Halting step:` line (Task 1 renders that argument) names `architecture_review_as_built`" | diff-local |
| Story 3 happy: Given a validation-group member exhausts its retries without a verdict, when the group halts, then the `loop_halt` event's step is that member's step and a halt record reads `Halting step: <that member>`. | 4 | "An `architecture_review_as_built` no-verdict halt emits `loop_halt` with step `architecture_review_as_built` and passes it as the halting step to `writeHaltMarker`" | diff-local |
| Story 3 happy: Given a validation-group member's dispatch returns a mechanical fault, when the group halts, then the `loop_halt` event's step is that member's step. | 4 | "A member's mechanical-fault halt emits `loop_halt` with that member's step" | diff-local |
| Story 3 happy: Given a validation-group member's provider denies a required permission, or its cached-login recovery trial fails, or the group parks on that member's authentication failure, when the group halts, then the `loop_halt` event's step is that member's step. | 4 | "The permission-denial, cached-login trial, and authentication park halts each emit `loop_halt` with the affected member's step" | diff-local |
| Story 3 happy: Given a validation-group gap member's join-routed kickback to build made no progress and escalates to a halt, when the group halts, then the `loop_halt` event's step is that gap member's step. | 4 | "a gap member's kickback no-op escalation emits `loop_halt` with that gap member's step" | diff-local |
| Story 3 negative: Given a mechanical-fault halt, when it is written, then no halt record is committed (mechanical halts stay unrecorded) while the `loop_halt` step still names the faulting member. | 4 | "commits no halt record (class `mechanical` through `haltForValidatorFault`)" | diff-local |
| Story 3 negative: Given the faulting member is `manual_test`, when the group halts, then the halting step is `manual_test` and not `prd_audit`. | 4 | "A `manual_test` no-verdict halt in a group entered from `prd_audit` emits `loop_halt` with step `manual_test`, not `prd_audit`" | diff-local |
| Story 4 happy: Given a validation group ends on its generic halt (no classified route remains) with `manual_test` and `prd_audit` both failing their gates, when the group halts, then the halting step is `manual_test` (the first failing member in group order) and the spine carries a member-scoped `step_refused` event for each of `manual_test` and `prd_audit`. | 5 | "The generic halt with failing `manual_test` and `prd_audit` emits `loop_halt` with step `manual_test` and a `step_refused` event for each of `manual_test` and `prd_audit`" | diff-local |
| Story 4 happy: Given `prd_audit` reports blocking gaps in a round the as-built review does not own, and the join's remediation planner returns a needs-human halt for those gaps, when the group halts, then the halting step is `prd_audit` (the first gap member in group order) and the spine carries a member-scoped `step_refused` event for every gap member the planner was given. | 5 | "The mixed-failure planner halt for gap member `prd_audit` emits `loop_halt` with step `prd_audit` and a `step_refused` event for every gap member it planned" | diff-local |
| Story 4 happy: Given `manual_test` FAIL rows are merged with gap members into one remediation work order and the planner returns a needs-human halt, when the group halts, then the halting step is the first non-`manual_test` gap member and the spine carries a member-scoped `step_refused` event for `manual_test` and for every gap member. | 5 | "the merged manual_test planner halt emits `loop_halt` with the first non-`manual_test` gap member and a `step_refused` event for `manual_test` and every gap member" | diff-local |
| Story 4 happy: Given the as-built review halts terminally while `manual_test` also failed its gate, when the group halts, then the halting step is `architecture_review_as_built` and the spine carries a member-scoped `step_refused` event for each of `architecture_review_as_built` and `manual_test`. | 5 | "An as-built terminal halt while `manual_test` has FAIL rows emits `loop_halt` with step `architecture_review_as_built` and a `step_refused` event for each of `architecture_review_as_built` and `manual_test`" | diff-local |
| Story 4 negative: Given only one member fails, when the group halts, then exactly one member-scoped `step_refused` event names that member and no passing sibling is named. | 5 | "A single failing member yields exactly one `step_refused` event naming it" | diff-local |
| Story 4 negative: Given a passing sibling in a multi-member halt, when the halt is recorded, then that sibling is not marked refused and is not named as the halting step. | 5 | "a passing sibling is neither marked `refused` in conduct state nor named by any `step_refused` event or `loop_halt` step" | diff-local |
| Story 5 happy: Given the daemon runs features in child executors and a feature halts in its validation group on the as-built review with class `plan-gap`, when the supervisor emits `feature_dispatch_ended`, then the event has outcome `halted`, step `architecture_review_as_built`, and haltClass `plan-gap`. | 7, 6 | "makes the supervisor emit exactly one `feature_dispatch_ended` with outcome `halted`, step `architecture_review_as_built`, and haltClass `plan-gap`" | diff-local |
| Story 5 happy: Given the daemon runs features in-process and a feature halts in its validation group on the as-built review, when `feature_dispatch_ended` is emitted, then its step is `architecture_review_as_built`. | 6 | "emits an in-process `feature_dispatch_ended` with step `architecture_review_as_built`" | diff-local |
| Story 5 happy: Given a halted `feature_dispatch_ended` event carrying a step and haltClass, when the OTel metrics listener consumes it, then the feature-halt metric is recorded under that step and class. | 8 | "asserts `conductor.feature.halts` recorded under that step and class" | diff-local |
| Story 5 negative: Given a child executor running an older pinned engine whose terminal outcome carries no halting step or class, when the supervisor emits `feature_dispatch_ended`, then the event is still emitted with outcome `halted` and without step or haltClass, and the dispatch is not treated as an error. | 7 | "A halted outcome without `halt` emits one `halted` event with no step and no haltClass while `execute` resolves a non-error result" | diff-local |
| Story 5 negative: Given a child executor whose feature completes or terminates without halting, when the supervisor emits `feature_dispatch_ended`, then the event carries no step and no haltClass. | 7 | "an error outcome emits one `terminated` event with no step or haltClass" | diff-local |
| Story 5 negative: Given the child exits before sending an outcome, when the supervisor records the dispatch, then `feature_dispatch_ended` is emitted once with outcome `terminated` and no step. | 7 | "a child exiting before its outcome emits exactly one `terminated` event with no step" | diff-local |
