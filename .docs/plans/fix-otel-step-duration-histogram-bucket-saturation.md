# Implementation Plan: fix-otel-step-duration-histogram-bucket-saturation

**Date:** 2026-08-27
**Stories:** .docs/stories/fix-otel-step-duration-histogram-bucket-saturation.md
**Conflict check:** Skipped (tier S)

## Summary
Give both duration histograms explicit bucket boundaries spanning 10 ms to 30 minutes via
OTel instrument advice, so quantiles stop saturating at the default 10 s top bucket. 5 tasks.

## Technical Approach

- Add an exported `DURATION_BUCKET_BOUNDARIES_MS` constant in
  `src/conductor/src/engine/otel/metrics.ts`: a log-spaced, monotonically increasing list from
  10 ms through 1 800 000 ms (30 min), e.g.
  `[10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000]`.
- Pass it to both `meter.createHistogram(...)` calls as `advice: { explicitBucketBoundaries: DURATION_BUCKET_BOUNDARIES_MS }`.
  This is OTel API instrument advice (verified present in the pinned `@opentelemetry/api` 1.9
  typings, `MetricAdvice.explicitBucketBoundaries`), aggregated by `@opentelemetry/sdk-metrics`
  before export — backend-neutral, no exporter/collector/Prometheus coupling.
- State the saturation bound (largest finite boundary, 30 min) in each instrument's
  `description` string so the bound is discoverable from exported metric metadata. Per the
  repository Documentation Upkeep rule, the same diff updates the OTel section of
  `docs/reference/configuration.md` to state the bound; that edit rides with Task 3's diff.
- Tests follow the existing pattern in `src/conductor/test/engine/otel/metrics.test.ts`
  (constructor called with a meter test double; assert the options passed to
  `createHistogram`). Bucket-placement behavior (finite vs +Inf) is asserted directly against
  the boundary constant — pure array assertions, no live SDK pipeline needed — plus one
  SDK-level test using an in-memory `MetricReader` for the overflow negative path.

## Prerequisites
- None (all dependencies already pinned; no config or schema changes).

## Tasks

### Task 1: Define the shared duration bucket-boundary constant
**Story:** story-1
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/otel/metrics.test.ts`: import
   `DURATION_BUCKET_BOUNDARIES_MS`; assert it is strictly increasing, its first boundary is
   ≤ 10, its largest finite boundary is ≥ 1 800 000, and it contains a boundary ≥ 252464.
2. Also assert resolution: 240, 4000, 90000, and 600000 each map (first boundary ≥ value) to
   four distinct boundaries.
3. Verify test fails (RED) — constant does not exist.
4. Implement: export `DURATION_BUCKET_BOUNDARIES_MS` in `src/conductor/src/engine/otel/metrics.ts`
   with the log-spaced list from Technical Approach.
5. Verify test passes (GREEN); commit "feat(otel): add explicit duration bucket boundaries constant".

**Done when:**
- `DURATION_BUCKET_BOUNDARIES_MS` is exported from `src/conductor/src/engine/otel/metrics.ts`
- Named tests assert monotonicity, first boundary ≤ 10 ms, largest finite boundary ≥ 30 min, and a finite boundary ≥ 252464
- Named test asserts 240 ms, 4 s, 90 s, 600 s resolve to four distinct buckets

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — new exported constant
- src/conductor/test/engine/otel/metrics.test.ts — boundary property tests

**Dependencies:** none

### Task 2: Apply the boundaries to conductor.step.duration
**Story:** story-1
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/otel/metrics.test.ts`: constructing
   `MetricsRecorder` with a meter double asserts `createHistogram('conductor.step.duration', …)`
   receives `advice.explicitBucketBoundaries === DURATION_BUCKET_BOUNDARIES_MS` (existing
   test-double pattern in this file — reuse its meter fake).
2. Verify test fails (RED).
3. Implement: add the `advice` option to the `conductor.step.duration` `createHistogram` call.
4. Verify test passes (GREEN); commit "fix(otel): explicit buckets for conductor.step.duration".

**Done when:**
- `conductor.step.duration` is created with `advice.explicitBucketBoundaries` set to the shared constant
- Named test asserts the advice option is passed through the meter's `createHistogram` call
- No exporter-, collector-, or Prometheus-specific import is added to `metrics.ts`

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — advice on step-duration histogram
- src/conductor/test/engine/otel/metrics.test.ts — advice pass-through test

**Dependencies:** Task 1

### Task 3: Apply the boundaries to conductor.pipeline.closeout.duration and state the bound
**Story:** story-2
**Type:** happy-path

**Steps:**
1. Write failing test: `MetricsRecorder` construction asserts
   `createHistogram('conductor.pipeline.closeout.duration', …)` receives the same
   `advice.explicitBucketBoundaries`, and that both duration instruments' `description`
   strings state the 30-minute quantile saturation bound.
2. Verify test fails (RED).
3. Implement: add the `advice` option to the closeout histogram and extend both `description`
   strings, e.g. "…; quantiles saturate above 30 min (largest finite bucket boundary)".
4. Per Documentation Upkeep, the same diff states the bound in the OTel section of
   `docs/reference/configuration.md`.
5. Verify test passes (GREEN); commit "fix(otel): explicit buckets + stated bound for closeout duration".

**Done when:**
- `conductor.pipeline.closeout.duration` is created with `advice.explicitBucketBoundaries` set to the shared constant
- Named test asserts both instruments' `description` strings state the 30-minute bound
- The diff states the bound in the OTel section of docs/reference/configuration.md

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — advice + descriptions on closeout histogram
- src/conductor/test/engine/otel/metrics.test.ts — closeout advice + description tests
- docs/reference/configuration.md — bound stated in OTel section

**Dependencies:** Task 1

### Task 4: Overflow and zero observations remain exact (negative paths)
**Story:** story-1
**Type:** negative-path

**Steps:**
1. Write failing SDK-level test in `src/conductor/test/engine/otel/metrics.test.ts` (or the
   existing `src/conductor/test/integration/otel-observability.test.ts` if it already hosts an
   in-memory reader — reuse whichever pattern exists): wire `MetricsRecorder` to a real
   `MeterProvider` with an in-memory `MetricReader`; record a 2 000 000 ms observation (beyond
   the largest finite boundary) and a 0 ms observation on `conductor.step.duration`.
2. Assert the collected histogram point has count 2, sum exactly 2 000 000, the overflow
   observation counted in the bucket above the largest finite boundary, and the 0 ms
   observation counted in the lowest bucket; no error thrown, no dropped data point.
3. Verify RED (fails against default boundaries because bucket layout differs), then GREEN
   after Tasks 2; commit "test(otel): overflow and zero duration observations stay exact".

**Done when:**
- Named SDK-level test collects via an in-memory MetricReader and asserts count/sum exactness for a beyond-bound observation
- The test asserts the overflow lands above the largest finite boundary and 0 ms lands in the lowest bucket
- Default test suite runs it without any external service (no OTLP endpoint)

**Files likely touched:**
- src/conductor/test/engine/otel/metrics.test.ts — in-memory reader negative-path test

**Dependencies:** Task 2

### Task 5: Closeout overflow observation remains exact (negative path)
**Story:** story-2
**Type:** negative-path

**Steps:**
1. Extend the in-memory-reader test from Task 4 with a sibling case: record a beyond-bound
   observation (e.g. 2 000 000 ms) on `conductor.pipeline.closeout.duration` via
   `onPipelineCloseout` with a synthetic `pipeline_closeout` event.
2. Assert the collected point has exact sum/count, the observation counted in the bucket above
   the largest finite boundary, and no error thrown or data point dropped.
3. Verify RED then GREEN; commit "test(otel): closeout overflow observation stays exact".

**Done when:**
- Named test records a beyond-bound closeout observation through onPipelineCloseout and asserts exact sum/count
- The test asserts the observation lands above the largest finite boundary without error

**Files likely touched:**
- src/conductor/test/engine/otel/metrics.test.ts — closeout overflow test

**Dependencies:** Task 3, Task 4

## Task Dependency Graph

```
Task 1 ──> Task 2 ──> Task 4 ──> Task 5
     └───> Task 3 ─────────────> Task 5
```

## Integration Points
- After Task 3: both exported histograms carry explicit boundaries; a local collector run shows finite-bucket placement for minute-scale steps.

## Verification
- [ ] All happy path criteria covered by Tasks 1-3
- [ ] Negative paths covered by Task 4 (overflow, zero) — explicit task, no catch-all
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
