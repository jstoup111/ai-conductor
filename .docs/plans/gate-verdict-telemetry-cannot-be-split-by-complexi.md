# Implementation Plan: Gate verdict telemetry split by complexity tier

**Date:** 2026-10-09
**Design:** adr-014-otel-observability-exporter D14 (amended by #2790); technical track, no PRD
**Stories:** .docs/stories/gate-verdict-telemetry-cannot-be-split-by-complexi.md
**Conflict check:** Skipped (Tier S)

## Summary

This plan adds the run's complexity tier to `conductor.gate.verdicts` and `conductor.gate.kickbacks`.
The tier rides an optional `tier` field on the existing `gate_verdict` and `kickback` events, which
the conductor stamps through one helper. A test lock keeps infrastructure failures out of both
counters. The plan has five tasks.

## Technical Approach

- **Event spine, not a new channel.** Event-spine verdict: no channel is added. The concern is an
  occurrence. The verdict is to extend the union with additive optional fields on existing variants,
  and no exception applies. The `gate_verdict` and `kickback` variants in
  `src/conductor/src/types/events.ts` each gain `tier?: ComplexityTier`. No new event type or
  instrument is added. The metrics listener does no tier inference, per adr-014 D14 as amended by
  #2790.
- **One stamping rule, one helper.** A new pure module, `src/conductor/src/engine/gate-event-tier.ts`,
  exports `withGateTier(event, tier)`. It returns a copy carrying `tier` only when all of these hold:
  the event type is `gate_verdict` or `kickback`, `tier` is defined, the event has no `tier` of its
  own, and the event is not a `kickback` with `from === 'rebase'`. In every other case it returns the
  same event object unchanged.
- **Where the conductor applies it.** `Conductor` (`src/conductor/src/engine/conductor.ts`) gets one
  private method, `stampGateTier(event)`, that calls
  `withGateTier(event, this.haltState.complexity_tier)`. `emitLoopHalt` uses the same tier source for
  `loop_halt`, so gate and halt series agree.
  - `emitExecutionEvent` applies `stampGateTier`. That covers every `emitTracked(...)` gate verdict
    and kickback (about 20 sites).
  - Four sites emit through `this.events.emit({...})` directly. Wrap each event literal in
    `this.stampGateTier(...)` and keep the direct emit path. Do not reroute them through
    `executionLifecycle`, which serializes delivery differently. The four sites are:
    1. the `manual_test` self-heal kickback in the manual-test FAIL handler;
    2. the kickback in `scanKickbackVerdicts`;
    3. the persisted-rebase reopen kickback in `advanceTail`, which the helper leaves tierless
       because it is `from: 'rebase'`;
    4. the `gate_verdict` emitted in `advanceTail`.
  - Find the sites with `grep -n "type: 'kickback'\|type: 'gate_verdict'"` in `conductor.ts`.
  - `src/conductor/src/engine/rebase.ts` (`emitGateInvalidationEvents`) is not changed. Its kickbacks
    are all `from: 'rebase'` invalidations, which carry no tier.
- **Metrics.** `MetricsRecorder.onGateVerdict(step, outcome, tier?)` and
  `MetricsRecorder.onKickback(from, to, tier?)` in `src/conductor/src/engine/otel/metrics.ts` add
  `tier` to the attributes only when it is defined, following the existing `onFeatureHalt` pattern.
  The `gate_verdict` and `kickback` handlers in `MetricsListener.METRICS_HANDLERS`
  (`src/conductor/src/engine/otel/metrics-listener.ts`) pass the event's `tier`. `tier` is already
  in `RESERVED_CONDUCTOR_LABEL_KEYS`, so `otel.attributes` cannot collide with it.
- **Infrastructure versus substantive outcomes.** The conductor already emits `gate_verdict` and
  `kickback` only after a gate has been evaluated:
  - A grader that cannot be dispatched goes through the retry loop to `step_retry` and `step_failed`
    (#814).
  - An uncovered `build_review` rubric infrastructure fault re-lands through the mechanical-fault
    lane with no kickback.
  - A `test_suite` infrastructure failure retries under its own allowance.

  Task 5 locks that guarantee with assertions on existing tests. Exporting per-rubric `build_review`
  infrastructure failures is out of scope, and #1835 owns it.
- **In-flight overlap.** PR #3053 (stacked child plans) adds `child` to the same `gate_verdict` and
  `kickback` emit sites by conditional spread. Both changes add optional fields, so neither changes
  the other's meaning. Task 2's central seam keeps the textual overlap to the four direct sites.

## Prerequisites
- None. The adr-014 D14 amendment is already committed on this spec branch.

## Tasks

### Task 1: Gate events declare an optional tier and a pure stamping helper applies the rule
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-event-tier.test.ts` for `withGateTier`. Cover five cases:
   - `gate_verdict` with tier `'M'` gains `tier: 'M'`;
   - a `kickback` from `prd_audit` with tier `'S'` gains `tier: 'S'`;
   - tier `undefined` returns the same object with no `tier` key;
   - a `kickback` with `from: 'rebase'` and tier `'M'` returns the same object with no `tier` key;
   - an event that already carries `tier: 'L'` keeps `'L'` when stamped with `'S'`, and a
     non-gate event (for example `step_started`) is returned unchanged.
2. Verify RED.
3. Implement: add `tier?: ComplexityTier` to the `gate_verdict` and `kickback` variants in `src/conductor/src/types/events.ts`, and create `src/conductor/src/engine/gate-event-tier.ts` exporting `withGateTier`.
4. Verify GREEN, commit.

**Done when:**
- [test] `withGateTier` returns a `gate_verdict` carrying `tier: 'M'` and a `prd_audit` `kickback` carrying `tier: 'S'` when given those tiers, as asserted in `gate-event-tier.test.ts`
- [test] `withGateTier` returns an event with no `tier` key (not `L`, not `M`, not an empty string) for an undefined tier and for a `kickback` whose `from` is `rebase`, as asserted by `Object.hasOwn(result, 'tier') === false`
- [test] `withGateTier` keeps an event's existing `tier: 'L'` unchanged when stamping `'S'`, and returns a non-gate event unchanged
- `gate_verdict` and `kickback` in the `ConductorEvent` union declare an optional `tier` field typed `ComplexityTier`, and `tsc --noEmit` passes for `src/conductor`

**Files likely touched:**
- `src/conductor/src/types/events.ts` — optional `tier` on two variants
- `src/conductor/src/engine/gate-event-tier.ts` — new pure helper
- `src/conductor/test/engine/gate-event-tier.test.ts` — unit tests

**Dependencies:** none

### Task 2: The conductor stamps every gate verdict and gate kickback it emits with the run's tier
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-gate-tier.test.ts`, driving a real `Conductor` with a stub `StepRunner` and a `ConductorEventEmitter` that records events in order.
   - Reuse the fixture shape of `src/conductor/test/conductor-kickback.test.ts`: `runValidationKickback` seeds `conduct-state.json` and a FAIL validation verdict.
   - Seed state with `complexity_tier: 'M'` and assert a post-dispatch-tail `gate_verdict` carries `tier: 'M'` with its `step`, `satisfied`, and `reason`. Seed `complexity_tier: 'S'` and assert a gate-originated `kickback` to `build` (`prd_audit` → `build` or `manual_test` → `build`) carries `tier: 'S'` with its `from`, `to`, and `count`.
   - Run the same fixture with no `complexity_tier` and assert neither event has a `tier` key.
   - Seed a persisted `rebase`-origin kickback verdict, following the existing rebase reopen tests (search `kickback?.from !== 'rebase'` or `reopen persisted rebase kickbacks` under `src/conductor/test`). Assert that its `from: 'rebase'` kickback has no `tier` key in a tiered run.
2. Verify RED.
3. Implement:
   - Add `private stampGateTier(event: ConductorEvent): ConductorEvent` to `Conductor`, returning `withGateTier(event, this.haltState.complexity_tier)`.
   - Apply it inside `emitExecutionEvent`.
   - Wrap the event literal at each of the four direct sites in `this.stampGateTier(...)`: the manual-test self-heal kickback, the `scanKickbackVerdicts` kickback, the persisted-rebase reopen kickback, and the `advanceTail` `gate_verdict`. Keep each on `this.events.emit`.
   - Do not change `src/conductor/src/engine/rebase.ts`.
4. Verify GREEN, and run the affected existing conductor kickback and telemetry tests through `ai-conductor scoped-run`. Commit.

**Done when:**
- [test] In a run seeded with `complexity_tier: 'M'`, the recorded post-dispatch-tail `gate_verdict` carries `tier: 'M'` alongside its existing `step`, `satisfied`, and `reason`, as asserted in `conductor-gate-tier.test.ts`
- [test] In a run seeded with `complexity_tier: 'S'`, the recorded gate-originated `kickback` to `build` (`prd_audit` → `build` or `manual_test` → `build`) carries `tier: 'S'` alongside its existing `from`, `to`, and `count`
- [test] In a run with no `complexity_tier`, the recorded `gate_verdict` and `kickback` events carry no `tier` key, as asserted with `Object.hasOwn`
- [test] In a run seeded with `complexity_tier: 'M'`, the `kickback` with `from: 'rebase'` emitted when persisted rebase kickbacks reopen carries no `tier` key
- `Conductor.emitExecutionEvent` and the four direct gate-event `this.events.emit` sites pass their event through `stampGateTier`, which returns `withGateTier(event, this.haltState.complexity_tier)`, so every `this.events.emit` call in `conductor.ts` whose event literal has `type: 'kickback'` or `type: 'gate_verdict'` wraps that literal in `this.stampGateTier(`

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `stampGateTier` and its application
- `src/conductor/test/engine/conductor-gate-tier.test.ts` — conductor tests

**Dependencies:** Task 1

### Task 3: Gate counters record the tier label only when the event carries one
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/metrics-listener.test.ts` (or `metrics.test.ts`, following its existing gate-counter style).
   - Feed `MetricsListener` a `gate_verdict` (`step: 'build_review'`, `satisfied: true`, `tier: 'S'`) and a `kickback` (`from: 'test_suite'`, `to: 'build'`, `tier: 'M'`). Assert one `conductor.gate.verdicts` point with `step`, `outcome="pass"`, `tier="S"` and one `conductor.gate.kickbacks` point with `from`, `to`, `tier="M"`.
   - Feed tierless versions and assert the points carry exactly the pre-change attribute set: the identity attributes plus `step`/`outcome` or `from`/`to`, with no `tier`.
   - Feed three `gate_verdict` events for one step and outcome, carrying `tier` `S`, `M`, and none. Assert that the summed value across those points is 3.
2. Verify RED.
3. Implement: give `MetricsRecorder.onGateVerdict` and `MetricsRecorder.onKickback` an optional trailing `tier?: string` that adds `tier` only when defined, as `onFeatureHalt` does. Pass `verdict.tier` and `kickback.tier` from the two handlers in `MetricsListener.METRICS_HANDLERS`.
4. Verify GREEN, commit.

**Done when:**
- [test] `MetricsListener` projects a `build_review` pass `gate_verdict` with `tier: 'S'` into one `conductor.gate.verdicts` point whose attributes include `step="build_review"`, `outcome="pass"`, and `tier="S"` plus the existing identity attributes (`project`, `worker`, `feature`)
- [test] `MetricsListener` projects a `test_suite`→`build` `kickback` with `tier: 'M'` into one `conductor.gate.kickbacks` point whose attributes include `from="test_suite"`, `to="build"`, and `tier="M"`
- [test] A tierless `gate_verdict` or `kickback` yields a point with no `tier` attribute whose attribute set equals the pre-change set (identity plus `step`/`outcome` or `from`/`to`)
- [test] Three same-step, same-outcome `gate_verdict` events tagged `S`, `M`, and untagged produce points whose values sum to 3 across `tier`

**Files likely touched:**
- `src/conductor/src/engine/otel/metrics.ts` — optional tier on two recorder methods
- `src/conductor/src/engine/otel/metrics-listener.ts` — pass tier from the two handlers
- `src/conductor/test/engine/otel/metrics-listener.test.ts` — projection tests

**Dependencies:** Task 1

### Task 4: A tiered conductor run exports tier-labelled gate counters end to end
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conductor-telemetry-parity.test.ts`. Reuse its existing harness: a real `Conductor`, a `MetricsListener` on the same `ConductorEventEmitter`, `MetricsRecorder`, `InMemoryMetricExporter`, and the `metricPoints` helper. Its fixtures already seed `complexity_tier: 'M'`. Drive a run that records at least one gate verdict and one gate-originated kickback, for example a validation member that FAILs and kicks back to `build`. Assert that the exported points carry `tier="M"`.
2. Verify RED (fails until Tasks 2 and 3 are both in place).
3. Implement: no production change beyond Tasks 2 and 3. If the assertion fails, fix the wiring in `conductor.ts` or `metrics-listener.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] A `Conductor` run seeded with `complexity_tier: 'M'`, with `MetricsListener` subscribed to its emitter, exports at least one `conductor.gate.verdicts` point and at least one `conductor.gate.kickbacks` point, every one carrying `tier="M"`, read through `metricPoints` from the `InMemoryMetricExporter`
- [test] The same run's `conductor.gate.verdicts` points keep their `step` and `outcome` attributes, and their summed value equals the number of `gate_verdict` events recorded on the emitter

**Files likely touched:**
- `src/conductor/test/engine/conductor-telemetry-parity.test.ts` — production-order regression

**Dependencies:** Tasks 2, 3

### Task 5: Infrastructure failures are proven absent from the gate counters
**Story:** 3
**Type:** negative-path

**Steps:**
1. Extend `#814: build_review grader-dispatch failure re-dispatches with backoff and a diagnosable reason` in `src/conductor/test/engine/conductor.test.ts`. Record every emitted event, then assert at least one `step_retry` and one `step_failed` for `build_review`, zero `gate_verdict` events with `step: 'build_review'` and `satisfied: false`, and zero `kickback` events with `from: 'build_review'`.
2. Extend `keeps an uncovered infrastructure branch in the mechanical lane without a semantic kickback` in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`. Alongside its existing `kickbacks` and `mechanicalFaults` assertions, assert zero unsatisfied `build_review` `gate_verdict` events. If the fixture does not expose `gate_verdict` events yet, record them from its emitter.
3. Add or extend a `test_suite` infrastructure-retry test. Use the existing full-suite verification failure fixture with a non-`nonzero_exit` reason, found under `src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts` or `conductor.test.ts` (search `suiteInfrastructureRetries`). Assert a `step_retry` for `test_suite`, zero `kickback` events with `from: 'test_suite'`, and zero `gate_verdict` events for `test_suite` with `satisfied: false`.
4. These assertions describe existing behavior and are expected to pass. Commit them. If any fails, stop and report it as a defect. Do not change routing to make it pass.

**Done when:**
- [test] The grader-dispatch-failure conductor test asserts at least one `step_retry` and one `step_failed` for `build_review`, zero `gate_verdict{step: 'build_review', satisfied: false}`, and zero `kickback{from: 'build_review'}` events
- [test] The uncovered-infrastructure mechanical-lane adjudication test asserts `mechanicalFaults` incremented, zero emitted `kickback{from: 'build_review'}` events, and zero unsatisfied `build_review` `gate_verdict` events
- [test] A `test_suite` infrastructure-retry test with a non-`nonzero_exit` failure reason asserts a `step_retry` for `test_suite`, zero `kickback{from: 'test_suite'}`, and zero unsatisfied `test_suite` `gate_verdict` events

**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts` — grader-dispatch assertions
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — mechanical-lane assertion
- `src/conductor/test/integration/test-suite-gate-loop.acceptance.test.ts` — test-suite infrastructure assertion

**Verify-only:** yes

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──┬──> Task 2 ──┐
         └──> Task 3 ──┴──> Task 4
Task 5 (independent)
```

## Integration Points
- After Task 2: `events.jsonl` for a tiered run carries `tier` on gate verdicts and gate kickbacks.
- After Task 4: the exported OTel gate counters carry `tier` for a real conductor run.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a run whose state holds `complexity_tier: 'M'`, when a gating step completes and the conductor records its objective verdict on the post-dispatch tail, then the emitted `gate_verdict` carries `tier: 'M'` alongside its existing `step`, `satisfied`, and `reason` | 2 | "the recorded post-dispatch-tail `gate_verdict` carries `tier: 'M'` alongside its existing `step`, `satisfied`, and `reason`" | diff-local |
| Story 1 happy: Given a run whose state holds `complexity_tier: 'S'`, when a gate kicks work back to `build` (for example `prd_audit` → `build`), then the emitted `kickback` carries `tier: 'S'` alongside its existing `from`, `to`, and `count` | 2 | "the recorded gate-originated `kickback` to `build` (`prd_audit` → `build` or `manual_test` → `build`) carries `tier: 'S'` alongside its existing `from`, `to`, and `count`" | diff-local |
| Story 1 negative: Given a run whose state has no `complexity_tier`, when a gate verdict is recorded or a gate kicks work back, then neither the `gate_verdict` nor the `kickback` carries a `tier` key — not `L`, not `M`, not an empty string | 1, 2 | "the recorded `gate_verdict` and `kickback` events carry no `tier` key" | diff-local |
| Story 1 negative: Given a run whose state holds `complexity_tier: 'M'`, when a rebase invalidates a gate and a `kickback` with `from: 'rebase'` is emitted, then that `kickback` carries no `tier` key | 2 | "the `kickback` with `from: 'rebase'` emitted when persisted rebase kickbacks reopen carries no `tier` key" | diff-local |
| Story 1 negative: Given a `gate_verdict` or `kickback` that already carries a `tier`, when the conductor emits it, then the event keeps that `tier` value and is not overwritten by the run's tier | 1, 2 | "`withGateTier` keeps an event's existing `tier: 'L'` unchanged when stamping `'S'`" | diff-local |
| Story 2 happy: Given a `gate_verdict` for `build_review` with `satisfied: true` and `tier: 'S'`, when the metrics listener projects it, then `conductor.gate.verdicts` records one point with attributes `step="build_review"`, `outcome="pass"`, and `tier="S"` plus the existing identity attributes | 3 | "projects a `build_review` pass `gate_verdict` with `tier: 'S'` into one `conductor.gate.verdicts` point" | diff-local |
| Story 2 happy: Given a `kickback` from `test_suite` to `build` with `tier: 'M'`, when the metrics listener projects it, then `conductor.gate.kickbacks` records one point with attributes `from="test_suite"`, `to="build"`, and `tier="M"` | 3 | "projects a `test_suite`→`build` `kickback` with `tier: 'M'` into one `conductor.gate.kickbacks` point" | diff-local |
| Story 2 happy: Given a conductor run whose state holds `complexity_tier: 'M'` with the metrics listener subscribed to the conductor's event emitter, when the run records a gate verdict and a gate kicks work back, then the exported `conductor.gate.verdicts` and `conductor.gate.kickbacks` points both carry `tier="M"` | 4 | "exports at least one `conductor.gate.verdicts` point and at least one `conductor.gate.kickbacks` point" | diff-local |
| Story 2 negative: Given a `gate_verdict` or `kickback` with no `tier` key, when the metrics listener projects it, then the recorded point carries no `tier` attribute and keeps exactly the attributes it carried before this change | 3 | "yields a point with no `tier` attribute whose attribute set equals the pre-change set" | diff-local |
| Story 2 negative: Given three `gate_verdict` events for the same step and outcome carrying `tier: 'S'`, `tier: 'M'`, and no tier, when the exported points for that step and outcome are summed across `tier`, then the sum is 3, which equals the count recorded for the same three events without the label | 3 | "produce points whose values sum to 3 across `tier`" | diff-local |
| Story 3 happy: Given a `build_review` dispatch whose grader cannot be dispatched (the step runner returns no result and flags a grader-dispatch failure) on every attempt, when the conductor exhausts its retries, then the run emits `step_retry` and `step_failed` for `build_review` and emits no `gate_verdict` for `build_review` with `satisfied: false` and no `kickback` from `build_review` | 5 | "zero `gate_verdict{step: 'build_review', satisfied: false}`, and zero `kickback{from: 'build_review'}` events" | diff-local |
| Story 3 happy: Given a settled `build_review` lap whose only non-pass result is an uncovered rubric infrastructure failure, when the conductor routes it through the mechanical-fault lane, then the kickback ledger's `mechanicalFaults` for `build_review` increments and no `gate_verdict` for `build_review` with `satisfied: false` and no `kickback` from `build_review` is emitted | 5 | "asserts `mechanicalFaults` incremented, zero emitted `kickback{from: 'build_review'}` events, and zero unsatisfied `build_review` `gate_verdict` events" | diff-local |
| Story 3 negative: Given a `test_suite` run whose full-suite verification fails for an infrastructure reason (any reason other than `nonzero_exit`) within its infrastructure-retry allowance, when the conductor retries it, then it emits a `step_retry` for `test_suite` and emits no `kickback` from `test_suite` and no `gate_verdict` for `test_suite` with `satisfied: false` | 5 | "asserts a `step_retry` for `test_suite`, zero `kickback{from: 'test_suite'}`, and zero unsatisfied `test_suite` `gate_verdict` events" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | The exporter still only subscribes to the emitter; the new `tier` field is stamped by the conductor at its own gate emit sites under the D11/D14 additive-field path, not by the exporter. |
| adr-014-otel-observability-exporter#D2 | no-change | none | Visualizer-plugin packaging is untouched; no plugin registration or kind changes. |
| adr-014-otel-observability-exporter#D3 | no-change | none | Visualizer selection/start/stop wiring is untouched. |
| adr-014-otel-observability-exporter#D4 | no-change | none | The two metric handlers stay O(1) in-memory attribute additions with no I/O. |
| adr-014-otel-observability-exporter#D5 | no-change | none | Handler failure isolation (`try/catch` in `MetricsListener.start`) is unchanged. |
| adr-014-otel-observability-exporter#D6 | no-change | none | Transport selection and configuration are untouched. |
| adr-014-otel-observability-exporter#D7 | no-change | none | The single dispatcher-side meter provider and its derivation from spine events are unchanged; the two counters remain projections of spine events. |
| adr-014-otel-observability-exporter#D8 | no-change | none | Metric identity (`project`, `worker`, `feature`) is still applied by `withIdentity`; `tier` is an instrument attribute beside `step`/`outcome` and `from`/`to`. |
| adr-014-otel-observability-exporter#D9 | no-change | none | No daemon-level signal or sibling ledger is added. |
| adr-014-otel-observability-exporter#D10 | no-change | none | The step instruments' bounded label set is unchanged; `tier` on the gate counters is the same closed `S|M|L` set, governed by the D14 amendment. |
| adr-014-otel-observability-exporter#D11 | task | task-1 | `gate_verdict` and `kickback` in the `ConductorEvent` union declare an optional `tier` field typed `ComplexityTier` |
| adr-014-otel-observability-exporter#D12 | existing | none | `RESERVED_CONDUCTOR_LABEL_KEYS` in `src/conductor/src/engine/otel/metrics.ts` already lists `tier`, so `otel.attributes` cannot supply or override the new label. |
| adr-014-otel-observability-exporter#D13 | no-change | none | Static attributes still ride every data point through `withIdentity`; the gate counters keep them. |
| adr-014-otel-observability-exporter#D14 | task | task-2, task-3 | `Conductor.emitExecutionEvent` and the four direct gate-event `this.events.emit` sites pass their event through `stampGateTier` |
| adr-014-otel-observability-exporter#D15 | no-change | none | The write-first export spool is untouched. |
| adr-014-otel-observability-exporter#D16 | no-change | none | The spool lease and drainer are untouched. |
| adr-014-otel-observability-exporter#D17 | no-change | none | Spool health events are untouched. |
| adr-014-otel-observability-exporter#D18 | no-change | none | Run provenance fields on `feature_complete`/`loop_halt` and rebase outcome events are untouched. |
| adr-014-otel-observability-exporter#D19 | no-change | none | Trace placement of provenance attributes is untouched; this feature adds no span attribute. |
| adr-014-otel-observability-exporter#D20 | no-change | none | `otel.provenance` toggles are untouched. |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
