# Implementation Plan: unretryable-input routing applies to every step except build (#2418)

**Date:** 2026-10-09
**Design:** none (technical track); decision recorded in `.docs/decisions/adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md` (D2, D3 amended 2026-10-09)
**Stories:** .docs/stories/unretryable-input-routing-never-fires-outside-thre.md
**Conflict check:** skipped (Tier S)

## Summary

Widen signal (c) `unretryable-inputs` from the three verdict steps to every step except `build`, and
make the routed failure reach its `needs-human` halt without any step-specific recovery route.
Three tasks.

## Technical Approach

- **Classifier (`src/conductor/src/engine/artifacts.ts`, `classifyRetryDecision`).** Today the
  `RETRY_CLASSIFY_STEPS` early return (`if (!RETRY_CLASSIFY_STEPS.has(step)) return { decision:
  'rerun' }`) precedes the `unretryableInputs` check, so signal (c) can never fire for a non-verdict
  step even if the caller widened. Move the facet check above that early return, guarded by
  `step !== 'build'`, mirroring how `terminalRefusal` is already evaluated before eligibility. Signals
  (a) and (b) keep their verdict-step scope. Update the doc comment to state signal (c)'s scope.
- **Step-runner seam (`src/conductor/src/engine/conductor.ts`, the block after the terminal-refusal
  classification inside the attempt loop).** Delete the local `isVerdictStep` allowlist from the
  `unretryableInputs` branch and replace it with `step.name !== 'build'`, the same exclusion the
  terminal-refusal branch directly above uses. Keep `this.daemon` and `retryRoutingEnabled`. Do not
  touch the completion-gate-miss seam's own `isVerdictStep` (the `if (this.daemon &&
  retryRoutingEnabled && isVerdictStep)` block), which `adr-2026-07-13` D3 scopes deliberately.
- **Post-loop failure path (same file, the `if (this.mode === 'auto' || …)` branch of `if
  (!succeeded)`).** After the advisory-skip block and before the step-specific recovery routes
  (manual_test FAIL kickback, test_suite failure routing, build_review verdict routing, build stall
  question, prd_audit gap routing, finish publication-defect and remediation routes, as-built
  remediation), add one guard so that when `unretryableInputFailure` is set none of those routes run
  and control falls through to the existing generic terminal halt, whose reason chain already renders
  the `unretryableInputFailure` message as `needs-human`. Wrapping the recovery routes in a single
  `if (unretryableInputFailure === undefined) { … }` is acceptable; so is an equivalent early jump
  to the generic terminal halt, provided the terminal halt code is reused rather than duplicated.
  Advisory steps keep their skip (ADR D3 amendment).
- **Test pattern.** Daemon seam tests follow the existing `routes a typed unretryable build_review
  runner failure on its first attempt` test in `src/conductor/test/engine/conductor.test.ts`
  (stub `StepRunner`, `retry_decision` listener, `daemon: true`, `mode: 'auto'`, `maxRetries: 3`,
  `fromStep`), and halt assertions follow `runBuildReviewFailure` in
  `src/conductor/test/engine/conductor-halt.test.ts` (read `.pipeline/HALT` and `.pipeline/HALT.class`).
  For a `finish` fixture, seed state with every step before `finish` marked `done` as those helpers
  do; consult `src/conductor/test/engine/conductor-finish-publication.test.ts` for any finish
  preflight the fixture needs. Assert the runner's dispatched step names to prove no `remediate`
  dispatch.

## Prerequisites

- None.

## Tasks

### Task 1: Classifier evaluates signal (c) for every step except build
**Story:** Story 2 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/artifacts.test.ts` beside `routes a typed unretryable input failure on attempt 1`: `finish` + facet on attempt 1 returns `{ decision: 'route', signal: 'unretryable-inputs' }`; `finish` with completion `routeClass: 'named-route'` and no facet returns `{ decision: 'rerun' }`. Keep the existing `build_review` route test and `never classifies build from an unretryable input facet` test.
2. Verify the `finish` + facet test fails (RED) — today it returns `rerun`.
3. Implement: in `classifyRetryDecision`, move `if (unretryableInputs) return route/unretryable-inputs` above the `RETRY_CLASSIFY_STEPS` early return, guarded by `step !== 'build'`; update the doc comment to say signal (c) applies to every step except `build` while (a) and (b) remain verdict-step only.
4. Verify all four classifier cases pass (GREEN).
5. Commit: "fix(engine): classify unretryable inputs for every step except build".

**Done when:**
- [test] `classifyRetryDecision` returns `{ decision: 'route', signal: 'unretryable-inputs' }` for step `finish` on attempt 1 with the facet, asserted by a new artifacts.test.ts case.
- [test] `classifyRetryDecision` still returns `{ decision: 'route', signal: 'unretryable-inputs' }` for `build_review` on attempt 1 with the facet, asserted by the existing artifacts.test.ts case.
- [test] `classifyRetryDecision` returns `{ decision: 'rerun' }` with no signal for `build` on attempt 1 with the facet, asserted by the existing artifacts.test.ts case.
- [test] `classifyRetryDecision` returns `{ decision: 'rerun' }` with no signal for `finish` with a `routeClass: 'named-route'` completion and no facet, asserted by a new artifacts.test.ts case.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — reorder signal (c) ahead of the verdict-step eligibility check, excluding `build`
- `src/conductor/test/engine/artifacts.test.ts` — new classifier cases

**Dependencies:** none

### Task 2: Step-runner seam routes non-verdict steps straight to the needs-human halt
**Story:** Story 1 (happy criteria)
**Type:** happy-path

**Steps:**
1. Write a failing daemon test (pattern: `routes a typed unretryable build_review runner failure on its first attempt` in `src/conductor/test/engine/conductor.test.ts`, and `runBuildReviewFailure` in `src/conductor/test/engine/conductor-halt.test.ts`): a stub runner fails `finish` with `unretryableInputs: { retryAfterStep: 'test_suite' }` and succeeds every other step; run with `daemon: true`, `mode: 'auto'`, `fromStep: 'finish'`, `maxRetries: 3`. Assert the dispatched step names equal `['finish']`, the `retry_decision` events equal one `{ step: 'finish', attempt: 1, decision: 'route', signal: 'unretryable-inputs' }`, `.pipeline/HALT` matches `finish` … `inputs cannot change` … `test_suite` and does not contain `retries exhausted`, and `.pipeline/HALT.class` is `needs-human`.
2. Verify it fails (RED) — today `finish` is dispatched three times and then routed to finish remediation.
3. Implement in `src/conductor/src/engine/conductor.ts`: in the attempt loop's `unretryableInputs` branch replace the local `isVerdictStep` condition with `step.name !== 'build'`, keeping the `this.daemon` and `retryRoutingEnabled` conditions (leave the completion-gate-miss seam's `isVerdictStep` untouched); in the auto-mode post-loop failure branch, after the advisory-skip block, skip every step-specific recovery route when `unretryableInputFailure` is set so the existing generic terminal halt writes the `needs-human` reason.
4. Verify the new test and the existing build_review unretryable tests in conductor.test.ts and conductor-halt.test.ts pass (GREEN).
5. Commit: "fix(conductor): route unretryable step-runner inputs outside the verdict steps".

**Done when:**
- [test] Through `Conductor.run()` in a daemon run, a `finish` runner failing with the facet is dispatched exactly once and the emitted `retry_decision` events equal one `{ step: 'finish', attempt: 1, decision: 'route', signal: 'unretryable-inputs' }`.
- [test] In that run the stub runner's dispatched step names equal `['finish']`, proving the finish remediation planner never dispatches `remediate`.
- [test] In that run `.pipeline/HALT` names step `finish` and step `test_suite` and does not contain `retries exhausted`, and `.pipeline/HALT.class` is `needs-human`.
- [test] The existing build_review unretryable tests (`routes a typed unretryable build_review runner failure on its first attempt`, `halts typed unretryable inputs with the prerequisite, never the runner message or retry exhaustion`) still pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — seam step exclusion and post-loop recovery-route bypass
- `src/conductor/test/engine/conductor-halt.test.ts` — new non-verdict unretryable halt test

**Dependencies:** Task 1

### Task 3: Build, kill switch, no-facet, and advisory paths keep their behavior
**Story:** Story 1 (negative criteria)
**Type:** negative-path

**Steps:**
1. Write daemon tests (same pattern as Task 2) in `src/conductor/test/engine/conductor-halt.test.ts`:
   (a) a `build` runner failing with the facet versus the identical run without it — equal `build` dispatch counts and no `retry_decision` with signal `unretryable-inputs`;
   (b) `config: { retry_routing: { enabled: false } }` with a `finish` runner failing with the facet on every attempt — three `finish` dispatches and no `retry_decision` events;
   (c) a `finish` runner failing without the facet on every attempt — three `finish` dispatches and no `retry_decision` with signal `unretryable-inputs`;
   (d) state seeded with `complexity_tier: 'M'` and steps before `architecture_diagram` done, `fromStep: 'architecture_diagram'`, an `architecture_diagram` runner failing with the facet — one `architecture_diagram` dispatch, a recorded skip, no `.pipeline/HALT`, and the next step dispatched.
2. Prove each test can fail: temporarily remove the `step.name !== 'build'` exclusion (a), the `retryRoutingEnabled` condition (b), or the advisory-skip ordering (d) and observe RED; restore. (c) guards the facet-absent path against the widened seam.
3. Implement: no production change beyond Task 2 is expected; fix any defect the tests expose in the Task 2 seam or bypass.
4. Verify GREEN.
5. Commit: "test(conductor): pin build exclusion, kill switch, and advisory skip for unretryable inputs".

**Done when:**
- [test] Through `Conductor.run()` a `build` runner failing with the facet is dispatched as many times as in the identical run whose runner omits the facet, and no `retry_decision` with signal `unretryable-inputs` is emitted, because the seam excludes `build`.
- [test] With `retry_routing.enabled: false`, a `finish` runner failing with the facet on every attempt is dispatched three times (`maxRetries: 3`) and no `retry_decision` event is emitted.
- [test] With routing enabled, a `finish` runner failing without the facet on every attempt is dispatched three times (`maxRetries: 3`) and no `retry_decision` with signal `unretryable-inputs` is emitted.
- [test] An advisory `architecture_diagram` runner failing with the facet is dispatched exactly once, recorded as skipped by the auto-mode advisory-skip branch, no `.pipeline/HALT` is written, and the run dispatches the next step.

**Files likely touched:**
- `src/conductor/test/engine/conductor-halt.test.ts` — negative-path daemon tests

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3
```

## Integration Points

- After Task 2: a daemon run routes a non-verdict step's unretryable-input failure to a
  `needs-human` halt on its first attempt through `Conductor.run()`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon run with retry routing enabled, when the `finish` step's runner fails with the facet naming `test_suite`, then `finish` is dispatched exactly once and exactly one `retry_decision` event is emitted for it with attempt 1, decision `route`, and signal `unretryable-inputs`. | 2 | "a `finish` runner failing with the facet is dispatched exactly once and the emitted `retry_decision` events equal one `{ step: 'finish', attempt: 1, decision: 'route', signal: 'unretryable-inputs' }`" | diff-local |
| Story 1 happy: Given the same run, when the routed failure ends the run, then `.pipeline/HALT` names step `finish` and step `test_suite`, `.pipeline/HALT.class` is `needs-human`, the halt reason does not contain `retries exhausted`, and the step runner never receives a `remediate` dispatch. | 2 | "`.pipeline/HALT` names step `finish` and step `test_suite` and does not contain `retries exhausted`, and `.pipeline/HALT.class` is `needs-human`" | diff-local |
| Story 1 negative: Given a daemon run with retry routing enabled, when the `build` step's runner fails with the facet, then `build` is dispatched as many times as in the identical run whose runner omits the facet, and no `retry_decision` event with signal `unretryable-inputs` is emitted. | 3 | "a `build` runner failing with the facet is dispatched as many times as in the identical run whose runner omits the facet, and no `retry_decision` with signal `unretryable-inputs` is emitted" | diff-local |
| Story 1 negative: Given a daemon run with `retry_routing.enabled: false`, when the `finish` step's runner fails with the facet on every attempt, then `finish` is dispatched once per allowed attempt (three with `maxRetries: 3`) and no `retry_decision` event is emitted. | 3 | "With `retry_routing.enabled: false`, a `finish` runner failing with the facet on every attempt is dispatched three times (`maxRetries: 3`) and no `retry_decision` event is emitted." | diff-local |
| Story 1 negative: Given a daemon run with retry routing enabled, when an advisory step (`architecture_diagram`) fails with the facet, then it is dispatched exactly once, recorded as skipped, no `.pipeline/HALT` is written, and the run dispatches the next step. | 3 | "An advisory `architecture_diagram` runner failing with the facet is dispatched exactly once, recorded as skipped by the auto-mode advisory-skip branch, no `.pipeline/HALT` is written, and the run dispatches the next step." | diff-local |
| Story 1 negative: Given a daemon run with retry routing enabled, when the `finish` step's runner fails without the facet on every attempt, then `finish` is dispatched once per allowed attempt (three with `maxRetries: 3`) and no `retry_decision` event with signal `unretryable-inputs` is emitted. | 3 | "With routing enabled, a `finish` runner failing without the facet on every attempt is dispatched three times (`maxRetries: 3`) and no `retry_decision` with signal `unretryable-inputs` is emitted." | diff-local |
| Story 2 happy: Given `classifyRetryDecision` called for a non-verdict step (`finish`) on attempt 1 with the facet, when it classifies, then it returns decision `route` with signal `unretryable-inputs`. | 1 | "`classifyRetryDecision` returns `{ decision: 'route', signal: 'unretryable-inputs' }` for step `finish` on attempt 1 with the facet" | diff-local |
| Story 2 happy: Given `classifyRetryDecision` called for `build_review` on attempt 1 with the facet, when it classifies, then it still returns decision `route` with signal `unretryable-inputs`. | 1 | "`classifyRetryDecision` still returns `{ decision: 'route', signal: 'unretryable-inputs' }` for `build_review` on attempt 1 with the facet" | diff-local |
| Story 2 negative: Given `classifyRetryDecision` called for `build` on attempt 1 with the facet, when it classifies, then it returns decision `rerun` with no signal. | 1 | "`classifyRetryDecision` returns `{ decision: 'rerun' }` with no signal for `build` on attempt 1 with the facet" | diff-local |
| Story 2 negative: Given `classifyRetryDecision` called for a non-verdict step (`finish`) with a completion carrying `routeClass: 'named-route'` and no facet, when it classifies, then it returns decision `rerun` with no signal. | 1 | "`classifyRetryDecision` returns `{ decision: 'rerun' }` with no signal for `finish` with a `routeClass: 'named-route'` completion and no facet" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D1 | existing | none | `runBuildReview` sets `unretryableInputs: { retryAfterStep: 'test_suite' }` on a `TestSuiteProofError` class check (`src/conductor/src/engine/step-runners.ts:5487`); the facet type is `StepRunResult.unretryableInputs` (`src/conductor/src/engine/step-runner-types.ts:54`). This feature adds no producer. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D2 | task | task-1, task-2 | `classifyRetryDecision` returns `{ decision: 'route', signal: 'unretryable-inputs' }` for step `finish` on attempt 1 with the facet |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D3 | task | task-2, task-3 | `.pipeline/HALT` names step `finish` and step `test_suite` and does not contain `retries exhausted`, and `.pipeline/HALT.class` is `needs-human` |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D4 | task | task-3 | With `retry_routing.enabled: false`, a `finish` runner failing with the facet on every attempt is dispatched three times (`maxRetries: 3`) and no `retry_decision` event is emitted. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D5 | existing | none | The `retry_decision` event and its `unretryable-inputs` signal already exist (`RetryDecision` in `src/conductor/src/engine/artifacts.ts:4542`; emitted at the step-runner seam in `src/conductor/src/engine/conductor.ts:10533`). No new event member is added. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D6 | task | task-3 | a `build` runner failing with the facet is dispatched as many times as in the identical run whose runner omits the facet, and no `retry_decision` with signal `unretryable-inputs` is emitted, because the seam excludes `build` |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
