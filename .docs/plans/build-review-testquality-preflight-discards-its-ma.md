# Implementation Plan: build_review testQuality preflight discards its materialization error

**Date:** 2026-08-27
**Stories:** .docs/stories/build-review-testquality-preflight-discards-its-ma.md
**Conflict check:** Skipped (Tier S)

## Summary

Capture the error currently discarded by two bare catches in the testQuality preflight and surface its text through the existing `failureExcerpt` channel into the persisted rubric branch detail, the infrastructure-failure event, and the needs-human HALT body. 4 tasks.

## Technical Approach

The plumbing already exists end-to-end; only two links are missing:

- `failure()` in `src/conductor/src/engine/build-review-test-quality-preflight.ts` (line 283) already accepts an optional `failureExcerpt`, and `boundedHeadTailExcerpt` (line 161) already bounds text to `TAUTOLOGY_EXCERPT_CAP_BYTES` with a truncation marker. The two bare catches (lines 458 and 462) simply never pass it. Fix: `catch (err)` and pass `boundedHeadTailExcerpt(String((err as Error)?.stack ?? err))`.
- The coordinator (`src/conductor/src/engine/build-review-coordinator.ts` line 332) builds the persisted branch as `infrastructure(branch.rubric, preflight.reason)` — dropping the excerpt — while the event emit directly below (lines 334-339) already forwards `preflight.failureExcerpt` when defined. Fix: pass `preflight.failureExcerpt` as the third (`detail`) argument.
- Downstream is untouched: `step-runners.ts` line 1992 already renders `detail` as `` `${branch.reason}: ${branch.detail}` `` into the persisted aggregate, and `renderExhaustedMechanicalBuildReviewHalt` (`src/conductor/src/engine/conductor.ts` lines 1675-1698) already prints `(${failure.detail})` in the HALT body. Task 4 proves this flow with tests only.

Green path is untouched by construction: the catches only run on throw, and an `undefined` excerpt keeps `infrastructure()`'s detail-omitting spread, so excerpt-less failures persist byte-identically.

Local test pattern: unit tests for the preflight inject mocked `deps` (`createCheckout`, `readMergeBaseFile`, `writeFile`, `runScoped`) — follow the existing fixtures in the preflight's test file (search `runTautologyPreflight` under `src/conductor/test/`). Coordinator and halt-render tests likewise extend existing suites; find them via `grep -rn "renderExhaustedMechanicalBuildReviewHalt\|build_review_rubric_infrastructure_failure" src/conductor/test/`.

## Prerequisites

None — no schema, config, or migration changes.

## Tasks

### Task 1: Capture the materialization error into failureExcerpt
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests: with mocked `deps` where (a) `createCheckout` throws `new Error('boom-checkout')`, (b) `readMergeBaseFile` throws, (c) `writeFile` throws, assert the result is `reason: 'materialization-failed'` with `failureExcerpt` containing the thrown message; with a thrown non-Error string, assert `failureExcerpt` is non-empty; with an over-cap message, assert the `[...truncated` marker. Follow the existing mocked-deps fixtures in the preflight test suite (search `runTautologyPreflight`).
2. Verify tests fail (RED).
3. Implement: change the bare `catch {` at line 462 of the preflight to `catch (err)` and pass `boundedHeadTailExcerpt(String((err as Error)?.stack ?? err))` as `failure()`'s `failureExcerpt` argument on the non-aborted branch; keep `reason: 'aborted'` behavior when the signal fired (excerpt may be attached there too, but the reason must stay `aborted`).
4. Verify tests pass (GREEN).
5. Commit: "capture materialization error into testQuality preflight failureExcerpt".

**Done when:**
- Tests named in step 1 pass, covering throwing `createCheckout`, `readMergeBaseFile`, `writeFile`, a non-Error thrown value, and the over-cap truncation case
- A materialization throw yields `reason: 'materialization-failed'` and a `failureExcerpt` containing the error text; an aborted run still yields `reason: 'aborted'`
- The diff touches only the catch at (pre-change) line 462 plus tests

**Files likely touched:**
- src/conductor/src/engine/build-review-test-quality-preflight.ts — bind and excerpt the caught error
- src/conductor/test/engine/build-review-test-quality-preflight.test.ts — new assertions

**Dependencies:** none

### Task 2: Capture the scoped-run throw into failureExcerpt
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: mocked `deps.runScoped` throws `new Error('boom-run')`; assert result `reason: 'scoped-run-failed'` with `failureExcerpt` containing `boom-run`.
2. Verify test fails (RED).
3. Implement: same treatment as Task 1 at the sibling catch (pre-change line 458).
4. Verify test passes (GREEN).
5. Commit: "capture scoped-run throw into testQuality preflight failureExcerpt".

**Done when:**
- The step-1 test passes: a throwing `runScoped` yields `reason: 'scoped-run-failed'` and a `failureExcerpt` containing the thrown message
- Aborted-signal behavior at that catch is unchanged (`reason: 'aborted'`)

**Files likely touched:**
- src/conductor/src/engine/build-review-test-quality-preflight.ts — bind and excerpt the caught error at the scoped-run catch
- src/conductor/test/engine/build-review-test-quality-preflight.test.ts — new assertion

**Dependencies:** Task 1

### Task 3: Thread the excerpt into the persisted rubric branch detail
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: coordinator resolves a testQuality branch from a preflight infrastructure failure carrying `failureExcerpt: 'boom-checkout'`; assert the resolved branch has `detail` containing `boom-checkout` AND the emitted `build_review_rubric_infrastructure_failure` event carries `excerpt: 'boom-checkout'` (existing behavior, pinned by assertion). Also assert an excerpt-less preflight failure resolves a branch with NO `detail` property.
2. Verify test fails (RED).
3. Implement: at `build-review-coordinator.ts` line 332, change `infrastructure(branch.rubric, preflight.reason)` to `infrastructure(branch.rubric, preflight.reason, preflight.failureExcerpt)`.
4. Verify test passes (GREEN).
5. Commit: "persist testQuality preflight excerpt as rubric branch detail".

**Done when:**
- The step-1 tests pass: excerpt present → branch `detail` contains it and the event carries `excerpt`; excerpt absent → branch has no `detail` property
- The production diff is confined to the single `infrastructure(...)` call at (pre-change) line 332

**Files likely touched:**
- src/conductor/src/engine/build-review-coordinator.ts — pass the excerpt as the detail argument
- src/conductor/test/engine/build-review-coordinator.test.ts — new assertions

**Dependencies:** Task 1

### Task 4: Prove the error text reaches the persisted aggregate and the HALT body
**Story:** Story 2
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Write test (expected to pass against existing downstream code once Tasks 1-3 land): build the persisted aggregate result from a branch with `reason: 'materialization-failed'`, `detail: 'boom-checkout'` through the `step-runners.ts` mapping and assert the persisted `detail` is `materialization-failed: boom-checkout`; call `renderExhaustedMechanicalBuildReviewHalt` with an aggregate whose testQuality failure carries that detail and assert the HALT body contains `boom-checkout`.
2. Add the unchanged-output guard: an aggregate failure whose detail is only the bare reason renders a HALT body identical to today's wording, and a stayed-green preflight result persists with no error text anywhere.
3. If (and only if) step 1 reveals the detail does NOT flow into the rendered HALT, make the minimal fix at the revealed seam and record the departure in this task.
4. Commit (empty commit with `Task:` + `Evidence:` trailers if no code change was needed).

**Done when:**
- A test asserts the HALT body from `renderExhaustedMechanicalBuildReviewHalt` contains the injected excerpt text for a testQuality materialization failure
- A test asserts the persisted aggregate detail renders as `materialization-failed: boom-checkout` via the step-runners mapping
- A test asserts excerpt-less failure output and green-path output are unchanged (no new fields, no placeholder text)

**Files likely touched:**
- src/conductor/test/engine/conductor.test.ts — HALT body assertions
- src/conductor/test/engine/step-runners.test.ts — persisted detail assertions

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2
        └─▶ Task 3 ─▶ Task 4
```

## Integration Points

- After Task 3: a forced preflight throw produces an event and persisted branch carrying the real error text end-to-end.
- After Task 4: the operator-facing HALT body is proven to show the text.

## Verification

- [ ] All happy path criteria covered (Task 1 result shape, Task 3 persistence/event, Task 4 HALT)
- [ ] All negative path criteria covered (non-Error throw, abort race, truncation — Task 1; excerpt-less and green-path unchanged — Tasks 3, 4)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies explicit and acyclic
