# Implementation Plan: Exported telemetry carries step cost

**Date:** 2026-08-26
**Stories:** .docs/stories/exported-telemetry-carries-no-cost-signal-so-spend.md
**Conflict check:** Skipped (Tier S)

## Summary

Adds two OTel instruments to `MetricsRecorder` — a `conductor.step.cost` USD counter and a
`conductor.step.dispatches` counter carrying the metering classification — in 4 tasks.

## Technical Approach

All changes are contained in `MetricsRecorder` (`src/conductor/src/engine/otel/metrics.ts`) and
its unit tests. `onStepClose` already receives everything needed: `tokenUsage` (with `costUsd`
and `costSource`) and `model` are stashed by `otel-visualizer.ts` and passed through; no wiring
changes elsewhere.

- `conductor.step.cost` — Counter, unit `usd`, recorded only when `tokenUsage.costUsd` is a
  finite number (`Number.isFinite`). Attributes: `step`, plus `model` when provided, plus
  `source` when `costSource` is present. Mirrors the token counter's absent-means-no-data-point
  rule.
- `conductor.step.dispatches` — Counter, adds exactly 1 on every `onStepClose` call. Attributes:
  `step`, `metering` = `classifyMetering(tokenUsage)` imported from
  `src/conductor/src/engine/metering.ts` — never a re-implemented predicate.
- Test pattern: extend `src/conductor/test/engine/otel/metrics.test.ts`, which drives the real
  `OtelVisualizer` with `ConductorEventEmitter` events and asserts on
  `InMemoryMetricExporter` data points (see its T15/T16 helpers — `makeVisualizer`, metric
  lookup by name). New tests follow that harness; allowed variation: direct `MetricsRecorder`
  construction with a test `Meter` if the visualizer path cannot express a case.

Out of scope (binding, from the track marker): feature-level metrics, span attributes,
provider/effort dimensions (#1934, #1940).

## Prerequisites

None — `classifyMetering`, `TokenUsage.costUsd`, and `costSource` all exist on main.

## Tasks

### Task 1: Record conductor.step.cost for finite costUsd
**Story:** Story 1 — happy-path criteria (provider source, rate-card source, zero cost)
**Type:** happy-path

**Steps:**
1. Write failing tests in the existing metrics test file (T15/T16 harness): a step_completed close whose tokenUsage carries `costUsd: 0.42, costSource: 'provider'` and a model yields one `conductor.step.cost` data point of value 0.42 with attributes step/model/`source: 'provider'`; a `costSource: 'rate-card'` close yields `source: 'rate-card'`; `costUsd: 0` yields a data point of value 0.
2. Verify tests fail (RED).
3. Implement: create the `costCounter` in the `MetricsRecorder` constructor (`unit: 'usd'`) and add a `recordCost` path in `onStepClose` guarded by `Number.isFinite(tokenUsage?.costUsd)`.
4. Verify tests pass (GREEN).
5. Commit: "Record conductor.step.cost counter for finite step cost".

**Done when:**
- The three named assertions pass in `metrics.test.ts` (provider-source value+attrs, rate-card source attr, zero-cost data point).
- The pre-existing T15/T16 tests still pass unmodified.
- The diff adds no new export from `metrics.ts` beyond the existing class.

**Files:**
- src/conductor/src/engine/otel/metrics.ts — new cost counter + record path
- src/conductor/test/engine/otel/metrics.test.ts — happy-path cost tests

**Dependencies:** none

### Task 2: Cost counter absence semantics — no zero-fill, no NaN, no invented source
**Story:** Story 1 — negative-path criteria (absent costUsd, NaN/Infinity, absent costSource)
**Type:** negative-path

**Steps:**
1. Write failing tests: tokenUsage present with `costUsd` absent → zero `conductor.step.cost` data points while token points still record; `costUsd: NaN` and `costUsd: Infinity` → zero cost data points; `costUsd` finite with `costSource` absent → a cost data point whose attributes contain no `source` key.
2. Verify tests fail (RED) — or, where Task 1's `Number.isFinite` guard already satisfies a case, confirm the test passes and keep it as pinning coverage.
3. Implement any gap (attribute-building must omit `source` rather than emit `undefined`).
4. Verify tests pass (GREEN).
5. Commit: "Pin cost counter absence semantics (no zero-fill, no NaN, no invented source)".

**Done when:**
- The four named assertions pass (absent, NaN, Infinity, source-omitted).
- The source-omitted test asserts the attribute key is absent, not `undefined`-valued.

**Files:** same

**Dependencies:** Task 1

### Task 3: Record conductor.step.dispatches with metering classification
**Story:** Story 2 — happy-path criteria (fully-metered, cost-unmetered, unmetered)
**Type:** happy-path

**Steps:**
1. Write failing tests: a close with finite `costUsd` yields one `conductor.step.dispatches` data point of value 1 with `metering: 'fully-metered'`; a close with tokenUsage but no finite cost yields `metering: 'cost-unmetered'`; a close with no tokenUsage yields `metering: 'unmetered'`.
2. Verify tests fail (RED).
3. Implement: create the `dispatchesCounter` in the constructor and add 1 per `onStepClose` with `{ step, metering: classifyMetering(tokenUsage) }`, importing `classifyMetering` from the metering module.
4. Verify tests pass (GREEN).
5. Commit: "Record conductor.step.dispatches counter with metering classification".

**Done when:**
- The three classification assertions pass in `metrics.test.ts`.
- `metrics.ts` imports `classifyMetering` from `../metering.js` and contains no local `costUsd`-based classification predicate for the dispatch counter (diff property).

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 4: Unmetered close emits dispatch point with no token or cost points
**Story:** Story 2 — negative-path criteria (classification independent of cost path; no duplicate predicate)
**Type:** negative-path

**Steps:**
1. Write failing (or pinning) test: a step close with `tokenUsage` undefined produces, for that step, exactly one `conductor.step.dispatches` data point (`metering: 'unmetered'`), a duration observation, and zero `conductor.step.tokens` / `conductor.step.cost` data points.
2. Verify RED/pinning status honestly.
3. Implement any gap (dispatch recording must sit outside the `tokenUsage !== undefined` guard).
4. Verify tests pass (GREEN).
5. Commit: "Unmetered step close is positively visible in dispatch metric".

**Done when:**
- The named test passes, asserting all four instrument outcomes for the tokenUsage-less close.
- Full metrics test file passes via the repo's vitest invocation for that path.

**Files:** same as Task 1

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 ─▶ Task 2
Task 1 ─▶ Task 3 ─▶ Task 4
```

## Integration Points

- After Task 3: both new instruments observable end-to-end through OtelVisualizer +
  InMemoryMetricExporter.

## Verification

- [ ] All Story 1/2 happy-path criteria covered (Tasks 1, 3)
- [ ] All negative-path criteria covered as explicit tasks (Tasks 2, 4)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
