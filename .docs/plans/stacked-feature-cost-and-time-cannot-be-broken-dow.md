# Implementation Plan: Stacked feature cost and time broken down by child

**Date:** 2026-10-28
**Stories:** .docs/stories/stacked-feature-cost-and-time-cannot-be-broken-dow.md
**Conflict check:** Clean as of 2026-10-28 (.docs/conflicts/2026-10-22-stacked-feature-cost-and-time-cannot-be-broken-dow.md)

## Summary

This plan does two things. A provider dispatch made for a region step names its stacked child on
the event spine. The shipped record of a stacked feature then gains an additive `## Children`
block that gives cost, dispatches and active time per child, plus a feature-wide row, and the rows
sum exactly to the existing `## Cost` and `## Time` totals. A feature with no child is
byte-identical to today. The plan has 9 tasks. Source: jstoup111/ai-conductor#2946.

## Technical Approach

- **Governing decisions.**
  - `adr-2026-10-03-stacked-child-plans-identity-and-state` decision 12, as amended by #2946.
  - `architecture-review-2026-10-22-stacked-feature-cost-and-time-cannot-be-broken-dow`,
    conditions C1–C4.
  - The track's scope boundary is binding. Per-child tokens, retries, halts, KPI aggregation,
    status, dashboard and OTel are out of scope, and the `## Cost` and `## Time` blocks are not
    changed.
- **Stamping (Tasks 1–3).**
  - The region-child rule lives in `Conductor.withActiveRegionChild`. Extract its predicate into
    one private helper (for example `regionChildFor(step)`). It returns `this.activeRegionChild`
    when that is defined and `isRegionStep(step)` holds, and `undefined` otherwise. Both
    `withActiveRegionChild` and a new composed attempt callback use it.
  - In its constructor the Conductor composes `providerExecution.onAttempt`, exactly as it already
    composes `onAuxiliaryAttemptFailed`. The composed callback calls the previous callback with
    `{ ...attempt, child }` only when the helper returns a child (a conditional spread), and
    otherwise with the attempt object unchanged.
  - The verified trap (review fact F5): `DefaultStepRunner` captures `providerExecution.onAttempt`
    in its constructor, and the daemon builds the StepRunner before the Conductor with the same
    context object. Task 1 therefore makes the StepRunner resolve its attempt callback at call
    time: `options.providerAttempt` when it was given, else the context's current `onAttempt`.
    This is the same pattern it already uses for `onAuxiliaryAttemptFailed`.
  - `ProviderAttemptMetadata` (`provider-execution.ts`) gains an optional `child?: ChildId`,
    documented as engine-stamped attribution that authorizes nothing, so the composed callback can
    forward it without a cast. `providerExecutionEventCallbacks` already spreads `...attempt` into
    the emitted event, so no emitter, persister or union change is needed. `ConductorEvent` already
    allows `child`.
  - `activeRegionChild` is the execution child (`resolveExecutionChild`: routed host, else
    re-validating child, else cursor child), so a dispatch made in a routed-repair or operator-round
    host region is stamped with that host. One `Conductor` composes a given context, as it already
    does for `onAuxiliaryAttemptFailed` (`executor-child-runtime.ts`, `index.ts`, `daemon-cli.ts`).
- **Cost partition (Tasks 4–5).**
  - `DispatchMeteringObservation` gains `child?: ChildId`. It is set only when the selected
    record's `child` is a JSON number that `parseChildId` accepts.
  - `computeCostRollup` collects every valid `child` seen on any ledger event. When that set is
    non-empty it adds `children: { byChild: Array<{ child, costUsd, dispatches }>, featureWide: {
    costUsd, dispatches } }` to the rollup, with `byChild` ascending and including seen children
    that have zero dispatches. Each selected dispatch adds its fully-metered `costUsd` (the same
    rule as the total) and one dispatch to exactly one bucket.
  - With no child seen, the key is absent, so every existing rollup consumer sees an identical
    object.
- **Time partition (Task 6).**
  - `calculateTimingRollup` already builds the active union `U` from terminal records'
    `activeInterval`.
  - It also groups those intervals by valid `child`. Children claim time in ascending order:
    `claimedMs_k = |U(C_1..C_k)| − |U(C_1..C_k-1)|`, computed with the existing `unionIntervals`
    measure.
  - When any terminal record carries a child, every `TimingRollup` variant gains an optional
    `childClaims: Array<{ child, claimedMs }>`. Otherwise it is absent.
- **Rendering (Task 7).** A new `appendChildrenSection(content, cost, timing)` in
  `shipped-record.ts` renders the exact block shape the stories define.
  - **Cost** uses rounded prefix sums in integer ten-thousandths. With
    `P_k = Math.round(10000 × Σ_{j≤k} costUsd_j)`, row `k` is `(P_k − P_{k−1}) / 10000`, and the
    feature-wide row is `Math.round(10000 × rollup.costUsd) − P_n`, over 10000.
  - **Active time** uses `Q_k = Math.round(Σ_{j≤k} claimedMs_j)`, so row `k` is `Q_k − Q_{k−1}`
    and the feature-wide row is `Math.round(timing.activeMs) − Q_n`. `active_ms` appears only
    when the timing rollup carries `activeMs`.
  - Dispatches are integers.
- **Wiring (Task 8).** `dispatchShippedRecord` appends the block right after the Time step and
  before `appendBuildReviewMetrics`, only when the cost rollup carries `children`.
  - The block has its own degrade-never-block `try`/`catch`.
  - A Cost rollup failure leaves `rollup` undefined, so no block is rendered.
  - A Time failure renders `time: unavailable` with no `active_ms`.
- **KPI isolation (Task 9).**
  - The heading is `## Children`, which is not `## Cost`/`## Time`-prefixed.
  - Row labels are `child <k>` and `feature-wide`, and the state line is `time:`. None of them is
    a `## Cost` field name, so `parseCostBlock` and `parseTimeBlock` stay unchanged. Task 9 pins
    that with tests.
- **Local patterns.**
  - Rollup tests follow the ledger-fixture style of `cost-rollup.test.ts` and
    `timing-rollup.test.ts`: write JSONL lines into a temp `.pipeline/events.jsonl`, then call
    `compute*Rollup(dir)`.
  - The stamping integration test follows `test/engine/stacked-region-loop.test.ts`: a real-git
    stacked fixture built with `writeSliceTopologyFixture` and `sealSliceTopologyPositions`
    (`test/engine/slice-topology-fixture.ts`), driving a real `Conductor`. Add a real `DefaultStepRunner` built first with a fake provider runtime, and an
    `EventPersister` writing `.pipeline/events.jsonl`.
  - The CLI tests follow `test/acceptance/feature-usage-total-at-finish.acceptance.test.ts`, which
    calls `dispatchShippedRecord(command, dir)` over a temp repo.

## Prerequisites

- None. The stacked chain (#2940–#2945, #3053), routed repair and operator rounds (#2944, #3203),
  the slice-topology loader (#3365) and the `child` event field are on `main`.

## Tasks

### Task 1: Resolve the StepRunner's provider attempt callback at call time
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write a failing test in `src/conductor/test/engine/step-runner-attempt-callback.test.ts`. Construct a `DefaultStepRunner` with a `providerExecution` context whose `onAttempt` is a spy `a`. After construction, replace the context's `onAttempt` with spy `b`. Run one fake-provider dispatch and assert `b` received the attempt and `a` did not. A second case passes an explicit `options.providerAttempt` spy `c` and asserts `c` still wins.
2. Verify RED: the constructor-captured `a` is called today.
3. Implement: replace the captured `providerAttempt` field with a private accessor. It returns `options.providerAttempt` when supplied, else `this.providerExecutionContext?.onAttempt`, mirroring how `onAuxiliaryAttemptFailed` is already read from the context at each call. Route every existing `this.providerAttempt` use through it.
4. Verify GREEN and commit: "fix(step-runner): resolve provider attempt callback at call time".

**Done when:**
- [test] A `DefaultStepRunner` whose context `onAttempt` is replaced after construction delivers the next provider attempt to the replacement and not to the original callback.
- [test] An explicit `options.providerAttempt` passed to the `DefaultStepRunner` constructor still receives every provider attempt even after the context's `onAttempt` is replaced.
- `DefaultStepRunner` no longer assigns `providerExecution.onAttempt` to a field in its constructor; every attempt callback use reads it through the call-time accessor.

**Files:** src/conductor/src/engine/step-runners.ts; src/conductor/test/engine/step-runner-attempt-callback.test.ts

### Task 2: Stamp the active child on provider attempts made for a region step
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write a failing integration test in `src/conductor/test/engine/stacked-provider-attempt-child.test.ts`, following `test/engine/stacked-region-loop.test.ts`: a real-git stacked slice-topology fixture with the cursor on child 2. Build one `ProviderExecutionContext` with `providerExecutionEventCallbacks(events)` and a fake provider runtime. Construct a `DefaultStepRunner` with it first, then a `Conductor` with the same context and an `EventPersister` on `events`, writing `.pipeline/events.jsonl`. Drive a `build` dispatch whose fake provider succeeds, and assert that the persisted `provider_attempt` line contains `"child":2`. A second case puts the cursor on child 1 and makes a `build_review` fake provider fail once, then succeed, and asserts both persisted `provider_attempt` lines contain `"child":1`.
2. Verify RED: no `child` key today.
3. Implement: add optional `child?: ChildId` to `ProviderAttemptMetadata` in `provider-execution.ts`. In `conductor.ts`, extract the region predicate from `withActiveRegionChild` into one private helper returning the active region child for a step, or `undefined`, and use it in `withActiveRegionChild`. In the constructor, next to the existing `onAuxiliaryAttemptFailed` composition, compose `providerExecution.onAttempt` so that it forwards `{ ...attempt, child }` only when the helper returns a child, and otherwise forwards the attempt unchanged.
4. Verify GREEN and commit: "feat(engine): stamp the active region child on provider attempts".

**Done when:**
- [test] With the `DefaultStepRunner` constructed before the `Conductor` on one shared context and child 2 active, the persisted `provider_attempt` line in `.pipeline/events.jsonl` for a successful `build` dispatch contains `"child":2`.
- [test] With child 1 active, both persisted `provider_attempt` lines of a `build_review` dispatch whose first attempt fails and whose retry succeeds contain `"child":1`.
- `withActiveRegionChild` and the composed `onAttempt` both obtain the child from the same single private helper in `conductor.ts`; no second copy of the region-step predicate exists.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/provider-execution.ts; src/conductor/test/engine/stacked-provider-attempt-child.test.ts

### Task 3: Leave feature-wide and no-child provider attempts unqualified
**Story:** Story 1
**Type:** negative-path
**Dependencies:** Task 2

**Steps:**
1. Add failing-first cases to `src/conductor/test/engine/stacked-provider-attempt-child.test.ts`. In the first, a feature with no child state runs a `build` dispatch through the same Conductor-plus-StepRunner wiring: assert that the persisted `provider_attempt` line has no `"child"` substring, and that, parsed as JSON with `ts`, `activeInterval` and `observedIntervals` removed, it deep-equals the line recorded from the same dispatch with the Conductor's `onAttempt` composition bypassed. In the second, the leaf child 3 is active and the Conductor dispatches `prd_audit`: assert that its `provider_attempt` lines have no `"child"` substring. In the third, child 1 is active and the attempt callback receives a `manual_test` attempt: assert that no `child` key is forwarded.
2. Verify that the cases fail against a deliberately unconditional stamp, then implement or adjust the helper so that the conditional spread holds.
3. Commit: "test(engine): feature-wide and no-child provider attempts carry no child".

**Done when:**
- [test] For a feature with no child state, the persisted `provider_attempt` line of a `build` dispatch contains no `"child"` substring and, parsed as JSON with only `ts`, `activeInterval` and `observedIntervals` removed, deep-equals in every remaining field the line recorded with the `Conductor` attempt composition bypassed.
- [test] With leaf child 3 active, every persisted `provider_attempt` line of a `prd_audit` dispatch contains no `"child"` substring.
- [test] With child 1 active, the composed `onAttempt` forwards a `manual_test` attempt to the previous callback without a `child` key.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/stacked-provider-attempt-child.test.ts

### Task 4: Partition the cost rollup's dispatches by child
**Story:** Story 2
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/cost-rollup-children.test.ts` over the stories' two-child ledger, written as `.pipeline/events.jsonl` fixture lines: `provider_attempt` records with `invoked: true`, `outcome: 'success'`, a provider and fully-metered `tokenUsage.costUsd`, carrying `child` 1, 1 and 2 and no child twice, plus `child_started` records for children 1 and 2. Assert that `computeCostRollup(dir).children` deep-equals `{ byChild: [{ child: 1, costUsd: 1.75, dispatches: 2 }, { child: 2, costUsd: 2, dispatches: 1 }], featureWide: { costUsd: 1, dispatches: 2 } }`, and that the rollup's `costUsd` is 4.75 and its `dispatches` 5. A second test over a ledger with no `child` on any line asserts that the rollup has no `children` key and deep-equals the rollup computed before this change for the same fixture.
2. Verify RED.
3. Implement: add `child?: ChildId` to `DispatchMeteringObservation`, set in `toObservation` only when `record.child` is a number that `parseChildId` accepts. In `computeCostRollup`, collect the valid children seen on any event. For each selected dispatch, add its fully-metered cost (the same `classifyMetering` rule `addDispatch` uses) and one dispatch to its child's bucket or the feature-wide bucket. Attach `children` only when the seen set is non-empty.
4. Verify GREEN and commit: "feat(cost-rollup): per-child dispatch partition".

**Done when:**
- [test] `computeCostRollup` over the two-child ledger returns `children.byChild` equal to child 1 with cost 1.75 over 2 dispatches and child 2 with cost 2 over 1 dispatch, and `children.featureWide` with cost 1 over 2 dispatches, while `costUsd` is 4.75 and `dispatches` is 5.
- [test] `computeCostRollup` over a ledger with no `child` on any line returns an object with no `children` key, deep-equal to the pre-change rollup for that ledger.
- `DispatchMeteringObservation.child` is assigned only from a numeric `record.child` accepted by `parseChildId`, and each selected dispatch increments exactly one `children` bucket.

**Files:** src/conductor/src/engine/dispatch-metering.ts; src/conductor/src/engine/cost-rollup.ts; src/conductor/test/engine/cost-rollup-children.test.ts

### Task 5: Keep the cost partition exact for malformed, duplicate, corrupt and idle children
**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 4

**Steps:**
1. Add failing-first cases to `src/conductor/test/engine/cost-rollup-children.test.ts`.
   - Malformed child: the ledger has dispatch records carrying `"child":0`, `"child":10` and `"child":"x"`, plus one valid child-1 record. Assert that the three dispatches are counted in `featureWide`, and that `byChild` lists only child 1.
   - Duplicate: a child-1 `provider_attempt` success is followed by its matching `step_completed`, which also carries `"child":1`, with the same provider. Assert that child 1's `dispatches` is 1.
   - Corrupt line: one unparseable line sits among child-1 and feature-wide dispatches. Assert that the `byChild` plus `featureWide` dispatches and costs sum to the rollup's `dispatches` and `costUsd`.
   - Idle child: a ledger with a `child_started` for child 2 and no child-2 dispatch. Assert a child-2 entry with `costUsd: 0, dispatches: 0`.
2. Verify that each case exercises the Task 4 partition rules, and fix any gap. In particular, a string `child` such as `"2"` must not be accepted.
3. Commit: "test(cost-rollup): exact child partition for edge ledgers".

**Done when:**
- [test] `computeCostRollup` counts the dispatches carrying `child` 0, 10 and the string `"x"` in `children.featureWide`, and `children.byChild` contains no entry other than child 1.
- [test] `computeCostRollup` counts a child-1 `provider_attempt` success and its matching child-1 `step_completed` as one child-1 dispatch.
- [test] `computeCostRollup` over a ledger containing one corrupt line returns `children` whose bucket dispatches and costs sum exactly to the rollup's `dispatches` and `costUsd`, and no bucket counts the corrupt line.
- [test] `computeCostRollup` over a ledger naming child 2 only in `child_started` returns a child-2 `byChild` entry with `costUsd` 0 and `dispatches` 0.

**Files:** src/conductor/src/engine/cost-rollup.ts; src/conductor/test/engine/cost-rollup-children.test.ts

### Task 6: Partition the timing rollup's active union by child with ordered claiming
**Story:** Story 3
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/engine/timing-rollup-children.test.ts`.
   - Two-child ledger: matched `step_started`/`step_completed` records with `activeInterval`s of 60000 ms for child 1, 30000 ms for child 2 and 10000 ms with no child, none overlapping. Assert `state: 'measured'`, `activeMs: 100000` and `childClaims` of `[{ child: 1, claimedMs: 60000 }, { child: 2, claimedMs: 30000 }]`.
   - Overlap ledger: child-1 interval 0–40000 and child-2 interval 30000–50000. Assert claims of 40000 and 10000, and `activeMs` 50000.
   - Feature-wide overlap: a no-child interval of 35000–45000 overlapping child 1's interval of 0–40000. Assert that child 1 claims 40000 and that the claims never exceed `activeMs`.
   - No-child ledger: assert that `childClaims` is absent.
2. Verify RED.
3. Implement in `timing-rollup.ts`: while collecting terminal evidence, also group each terminal record's `activeInterval` by a numeric `child` accepted by `parseChildId`. After `unionIntervals(activeIntervals)`, compute ordered claims with `unionIntervals` measures of the growing prefix set. Attach `childClaims` to whichever `TimingRollup` variant is returned, only when at least one terminal record carried a valid child.
4. Verify GREEN and commit: "feat(timing-rollup): ordered per-child active-time claims".

**Done when:**
- [test] `computeTimingRollup` over the two-child ledger returns `activeMs` 100000 and `childClaims` of child 1 with 60000 ms and child 2 with 30000 ms.
- [test] `computeTimingRollup` over intervals 0–40000 for child 1 and 30000–50000 for child 2 returns claims of 40000 and 10000 ms and `activeMs` 50000, so the overlap is counted once.
- [test] `computeTimingRollup` with a no-child interval overlapping child 1 returns child 1's full 40000 ms claim, and the sum of `childClaims` never exceeds `activeMs`.
- [test] `computeTimingRollup` over a ledger whose terminal records carry no `child` returns no `childClaims` key.

**Files:** src/conductor/src/engine/timing-rollup.ts; src/conductor/test/engine/timing-rollup-children.test.ts

### Task 7: Render the `## Children` block with exact-sum rounding
**Story:** Story 2, Story 3
**Type:** happy-path
**Dependencies:** Task 4, Task 6

**Steps:**
1. Write failing tests in `src/conductor/test/engine/shipped-record-children.test.ts`.
   - Two-child render: render `appendChildrenSection(record, cost, timing)` over the rollups that `computeCostRollup` and `computeTimingRollup` return for the stories' two-child ledger. Assert the appended text is exactly `## Children`, `time: measured`, `child 1: cost_usd: 1.75, dispatches: 2, active_ms: 60000`, `child 2: cost_usd: 2, dispatches: 1, active_ms: 30000` and `feature-wide: cost_usd: 1, dispatches: 2, active_ms: 10000`, one per line.
   - Rounding: three dispatches of 0.33334 (child 1, child 2 and feature-wide). Assert rows `0.3333`, `0.3334` and `0.3333`.
   - Exact sums: a table of ledgers (two-child, rounding, corrupt-line, child-overlap, feature-wide-overlap, and a partial Time with `activeMs`). For the child-overlap ledger (child 1 at 0–40000, child 2 at 30000–50000), also assert the rows `active_ms: 40000`, `active_ms: 10000` and feature-wide `active_ms: 0`. Assert that the rendered `cost_usd` values sum, in ten-thousandths, to the `## Cost` block's rendered `cost_usd`, that the `dispatches` sum to its `dispatches`, and that the `active_ms` sum to the `## Time` block's `active_ms`. For the partial case, assert `time: partial`.
   - Omitted time: timing `{ state: 'unavailable' }` and `{ state: 'partial', reason }` without `activeMs`. Assert `time: <state>` and no `active_ms` on any row, with cost and dispatches present.
2. Verify RED.
3. Implement `appendChildrenSection` in `shipped-record.ts`. Separate the block with a blank line as `appendTimingSection` does. Compute cost rows from integer ten-thousandth prefix sums, with the feature-wide row closing on `Math.round(cost.costUsd × 10000)`, and time rows from rounded prefix sums of `childClaims`, with the feature-wide row closing on `Math.round(timing.activeMs)`. Rows list `cost.children.byChild` in ascending order, and a child absent from `childClaims` claims 0.
4. Verify GREEN and commit: "feat(shipped-record): render per-child Children block".

**Done when:**
- [test] `appendChildrenSection` over the two-child ledger's rollups appends exactly the five lines `## Children`, `time: measured`, `child 1: cost_usd: 1.75, dispatches: 2, active_ms: 60000`, `child 2: cost_usd: 2, dispatches: 1, active_ms: 30000` and `feature-wide: cost_usd: 1, dispatches: 2, active_ms: 10000`.
- [test] `appendChildrenSection` over three dispatches of 0.33334 renders `cost_usd: 0.3333`, `cost_usd: 0.3334` and `cost_usd: 0.3333`, which sum to the Cost block's `cost_usd: 1` with no floating-point artifact in any rendered value.
- [test] For every ledger in the exact-sum table (two-child, rounding, corrupt-line, child-overlap, feature-wide-overlap, partial), the rendered rows' `cost_usd` values sum exactly to the `renderShippedRecordWithCost` `cost_usd`, their `dispatches` sum exactly to its `dispatches`, and their `active_ms` sum exactly to the `appendTimingSection` `active_ms`, with `time: partial` rendered for the partial case and the child-overlap ledger rendering `active_ms: 40000`, `active_ms: 10000` and feature-wide `active_ms: 0`.
- [test] With timing `unavailable`, or `partial` without `activeMs`, `appendChildrenSection` renders `time: <state>` and no `active_ms` on any row while still rendering every row's `cost_usd` and `dispatches`.
- `appendChildrenSection` renders exactly one `child <k>` row per `cost.children.byChild` entry, including an entry with `costUsd` 0 and `dispatches` 0 as `cost_usd: 0, dispatches: 0`, plus one `feature-wide` row, and no other row.

**Files:** src/conductor/src/engine/shipped-record.ts; src/conductor/test/engine/shipped-record-children.test.ts

### Task 8: Write the block from `conduct shipped-record` only for stacked features
**Story:** Story 3, Story 4
**Type:** happy-path
**Dependencies:** Task 7

**Steps:**
1. Write failing tests in `src/conductor/test/engine/shipped-record-cli-children.test.ts`, following `test/acceptance/feature-usage-total-at-finish.acceptance.test.ts`: a temp git repo with a plan, stories and a `.pipeline/events.jsonl`, driven through `dispatchShippedRecord(command, dir)`.
   - Stacked: the two-child ledger. Assert that the committed `.docs/shipped/<slug>.md` has the `## Children` block immediately after the `## Time` block and immediately before `## Build Review`, and that the record with the `## Children` block removed is byte-identical to the record rendered by the pre-change composition (frontmatter, `## Cost`, `## Time`) for the same ledger.
   - No child: a ledger with no child. Assert that the whole record is byte-identical to the pre-change rendering, with no `## Children` heading.
   - Cost throws: `computeCostRollup` is mocked to throw. Assert no `## Cost` and no `## Children` block, and exit code 0.
   - Block throws: `appendChildrenSection` is mocked to throw. Assert exit 0, one stderr line naming the slug and the error, and a record equal to the no-block rendering.
   - Timing throws: `computeTimingRollup` is mocked to throw on a stacked ledger. Assert `## Time` `state: unavailable`, and a `## Children` block with `time: unavailable` and no `active_ms`.
   - Re-run: a second `dispatchShippedRecord` on the stacked ledger. Assert "already committed" and an unchanged commit count.
2. Verify RED.
3. Implement in `shipped-record-cli.ts`: keep the cost rollup result in a variable outside its `try`. After the Time `try`/`catch` (keeping the timing result, or `{ state: 'unavailable' }` on failure), and before `appendBuildReviewMetrics`, append the `## Children` block when `rollup?.children` is present, inside its own `try`/`catch` that logs `children breakdown failed — shipped record written without a Children block for <slug>: <message>` to stderr and leaves the record unchanged.
4. Verify that the existing `test/engine/n1-golden-renderings.test.ts` shipped-record cells pass with their fixtures untouched, then commit: "feat(shipped-record): append Children block for stacked features".

**Done when:**
- [test] `dispatchShippedRecord` over the two-child ledger commits a record whose `## Children` block sits directly between `## Time` and `## Build Review`, and whose text with that block removed is byte-identical to the pre-change frontmatter, `## Cost` and `## Time` rendering of the same ledger.
- [test] `dispatchShippedRecord` over a ledger with no child writes a record byte-identical to the pre-change rendering with no `## Children` heading, and `test/engine/n1-golden-renderings.test.ts` passes with no fixture file modified.
- [test] When `computeCostRollup` throws, the record has neither `## Cost` nor `## Children` and the command exits 0. When `appendChildrenSection` throws, the command exits 0, writes one stderr line containing the slug and the error message, and writes the no-block record.
- [test] When `computeTimingRollup` throws for a stacked ledger, the record's `## Time` shows `state: unavailable` and `## Children` shows `time: unavailable` with no `active_ms` field on any row.
- [test] A second `dispatchShippedRecord` over the unchanged stacked ledger reports the record as already committed and creates no new commit.

**Files:** src/conductor/src/engine/shipped-record-cli.ts; src/conductor/test/engine/shipped-record-cli-children.test.ts

### Task 9: Prove the KPI parsers ignore the Children block
**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 7

**Steps:**
1. Add tests to `src/conductor/test/engine/kpi-report.test.ts`. Build one stacked record with `appendChildrenSection` over the two-child ledger, and the same record with the block removed. Assert that `parseCostBlock` and `parseTimeBlock` return deep-equal results for both. Build a third record that has `## Children` but no `## Cost` block, and assert that `parseCostBlock` returns null, as it does for that record without `## Children`.
2. If any assertion fails, bound the parsers so they stop at the next `## ` heading without changing their results for existing records. Otherwise the tests stand as regression guards.
3. Commit: "test(kpi): Children block never parsed as Cost or Time data".

**Done when:**
- [test] `parseCostBlock` and `parseTimeBlock` return deep-equal results for a stacked record with the `## Children` block and the same record with the block removed.
- [test] `parseCostBlock` returns null for a record that has a `## Children` block and no `## Cost` block, identical to its result for that record without `## Children`.

**Files:** src/conductor/test/engine/kpi-report.test.ts; src/conductor/src/engine/kpi-report.ts

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
Task 4 ──▶ Task 5
Task 4 ──┐
Task 6 ──┴▶ Task 7 ──▶ Task 8
              Task 7 ──▶ Task 9
```

## Integration Points

- After Task 2: a real Conductor region dispatch persists `provider_attempt` with `child`.
- After Task 8: `conduct shipped-record` writes the `## Children` block for a stacked ledger.

## Coverage Check

At Medium tier, land reads the criterion rows from the coherence artifact
(`.docs/coherence/stacked-feature-cost-and-time-cannot-be-broken-dow.md`), which maps every
acceptance criterion to its task and quotes the task's `Done when` check.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | no-change | none | Branch identity ownership (`feature-branch-identity`) is untouched; no task parses or forms a branch name. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | no-change | none | No branch consumer changes; every task edits only dispatch stamping, rollups and the shipped-record body. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | no-change | none | Attribution versus authority is unaffected: the child on a dispatch record is telemetry, read only by the rollups, and authorizes nothing. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | no-change | none | The `feat/c<k>` namespace is not read or written by any task. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | task | task-4, task-5 | assigned only from a numeric `record.child` accepted by `parseChildId` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | no-change | none | The leaf is still recorded by its region child number; the breakdown names every child, leaf included, by `ChildId` and adds no branch-kind logic. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | no-change | none | Positions are only read through existing `child` values on the ledger; nothing writes or changes positions. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | no-change | none | Per-child state under `.pipeline/children/<k>/` is not read or written; the breakdown reads only the flat `.pipeline/events.jsonl` and `pipeline-events.jsonl` ledgers. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | no-change | none | Region caps are untouched; no task changes a cap, ledger or budget. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | existing | none | The active child comes from the existing `Conductor.activeRegionChild`, which `activateChildRegionState` sets from the execution-child resolver at region entry and child switch; Task 2 only reads it. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | no-change | none | No base resolution changes; the breakdown reads no git base. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | task | task-2, task-3, task-8 | for a successful `build` dispatch contains `"child":2` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | no-change | none | `rewind`, `task` and `kickback-budget` and their `--child` flag are untouched. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | task | task-3, task-8 | `test/engine/n1-golden-renderings.test.ts` passes with no fixture file modified |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | Whole-feature rubrics at the leaf are untouched; `build_review` attempts made in a child's region are stamped by the same region rule as every region step. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
