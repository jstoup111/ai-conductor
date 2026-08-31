# Implementation Plan: Exported cost equals the feature's own ledger, on any backend

**Date:** 2026-08-30
**Stories:** .docs/stories/exported-step-cost-under-records-spend-20x-so-ever.md
**Conflict check:** Clean as of 2026-08-30
**Source:** jstoup111/ai-conductor#2095 (absorbs jstoup111/ai-conductor#2086)

## Summary
Make the OTel cost export a projection of the per-feature event ledger: a per-dimension rollup,
a non-persisted `feature_cost_snapshot` bus event emitted after every step close, two cumulative
gauges recorded from it, removal of the per-process `conductor.step.cost` counter, meter-provider
shutdown on visualizer stop, a rendered `renderer_error`, and (operator extension) per step × model × kind token gauges replacing the per-process `conductor.step.tokens` counter. 11 tasks.

## Technical Approach

- **Source of truth stays the ledger.** `computeCostRollup(worktreeDir)` in
  `src/conductor/src/engine/cost-rollup.ts` already selects each dispatch once through
  `DispatchMeteringTracker` and sums whole-feature cost. It gains two additive fields:
  `byDimension` — a list of `{ step, model?, source?, costUsd }` buckets keyed by
  step × model × cost source, populated only for `fully-metered` dispatches, plus
  `tokensByDimension` — `{ step, model?, tokens: { input?, output?, cacheRead?, cacheCreation? } }`
  buckets keyed by step × model, populated for every dispatch that carries usage (fully-metered
  and cost-unmetered alike; only the kinds present are summed) (`classifyMetering`
  already maps absent/NaN/Infinity cost to `cost-unmetered`, so no new numeric guard is needed) —
  and `readErrors`, the count of unreadable ledger files or lines. Existing fields, including the
  `unmetered` absorption of unreadable records, are untouched (additive-only evolution of the cost
  rollup, adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates).
- **One new spine event.** `feature_cost_snapshot` joins the `ConductorEvent` union in
  `src/conductor/src/types/events.ts` carrying `costUsd`, `costComplete`, `byDimension`, and
  `tokensByDimension`;
  `EVENT_SINKS` declares it `render: false, persist: false, audit: false, otel: true` — the
  same shape as `pipeline_closeout`. It is not persisted because it is a projection of the ledger
  it is computed from.
- **One emission site.** Conductor's `emitExecutionEvent` already recognises the terminal of a
  step execution (`step_completed` / `step_failed`). After that terminal's delivery resolves, the
  engine computes the rollup and emits a snapshot. Emission is best-effort (wrapped like the
  finish-time `feature_usage_total` emission — a cost failure never fails a build) and is
  suppressed when `readErrors > 0`, so a missing or malformed ledger yields no data point rather
  than a small number. The ledger read is in engine code, not in a bus handler, so the OTel
  handler stays O(1).
- **Gauges, not counters.** `MetricsRecorder` (`src/conductor/src/engine/otel/metrics.ts`) gains
  `onFeatureCostSnapshot`: it records the existing `conductor.feature.cost` gauge (attributes
  `project`, `feature`, `cost_complete`) and a new `conductor.feature.step.cost` gauge
  (attributes `project`, `feature`, `step`, `model` when known, `source` when known) and a new
  `conductor.feature.step.tokens` gauge (attributes `project`, `feature`, `step`, `model` when
  known, `kind`) from every snapshot. The `conductor.step.cost` and `conductor.step.tokens`
  counters (`recordCost`, `recordTokens`) are deleted; `onDispatch` keeps dispatch counting
  unchanged — `conductor.step.dispatches` is out of scope. `onFeatureUsageTotal` (finish) still records
  `conductor.feature.cost` so the finish value and the last step-close value coincide.
- **Lifecycle.** `OtelVisualizer.stop()` keeps `spanManager.forceCloseAll()` and the tracer
  `forceFlush()` (spans must stay readable after stop for existing tests), then replaces the
  meter `forceFlush()` with `meterProvider.shutdown()` — the SDK's `onShutdown` clears the reader's
  60 s interval, runs one final collect + export, and shuts the exporter down. Idempotency via the
  stored `stopPromise` is unchanged.
- **Visibility.** `renderer_error` becomes `render: true` in `EVENT_SINKS` and `renderDaemonEvent`
  gains a case printing the renderer name and message; boundedness comes from the existing
  `warnOnce` wrappers around both exporters.
- **Sequencing.** Rollup (1) → event + sinks (2) → engine emission (3) → recorder (4) → visualizer
  routing (5) → shutdown (6, 7) → renderer error (8, 9) → token negatives (11). Tasks 1, 2, 6, 8 have no dependencies on
  one another, so BUILD may parallelise those.
- **Local pattern to follow (search hints, not line anchors):** the finish-time emission in
  `src/conductor/src/engine/conductor.ts` — `computeCostRollup` → `toFeatureUsageTotals` →
  `emitTracked` inside a `try` whose catch is a no-op comment — is the shape for Task 3's emission
  (allowed variation: it runs after every step terminal and is gated on `readErrors === 0`).
  Test shape for gauge assertions: `src/conductor/test/engine/otel/metrics.test.ts` builds a
  `MeterProvider` with `InMemoryMetricExporter` and inspects data points by instrument name;
  acceptance shape for engine emission: `src/conductor/test/acceptance/feature-usage-total-at-finish.acceptance.test.ts`.
- **Reader-facing contract for the documentation step** (not a task): the otel section of
  `docs/reference/configuration.md` replaces the `conductor.step.cost` paragraph with the two gauges,
  states that dashboards use last-value/`max_over_time` on `conductor_feature_cost_usd`,
  `conductor_feature_step_cost_usd`, and `conductor_feature_step_tokens` (never `increase()`/`rate()`), and gives the spend-per-interval
  recipe as the difference of last values at the interval's end and start summed over series;
  `docs/reference/artifacts.md`'s Cost-block parity paragraph names the snapshot. Release
  metadata: `Release-Disposition: note`, `Release-Category: Changed`, `Release-Semver: minor`.

## Prerequisites
- #2063 (shared dispatch-metering projection; `conductor.feature.cost` gauge) on main — satisfied.
- `@opentelemetry/sdk-metrics` 2.10.0 pinned in `src/conductor` — satisfied; `MeterProvider.shutdown()` and `InMemoryMetricExporter` retaining metrics after shutdown verified from its source.

## Tasks

### Task 1: Rollup gains per-dimension cost buckets and a read-error count
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/cost-rollup.test.ts`: (a) a ledger with `build` attempts of $1.00 and $0.50 on model `m1` with `costSource: 'provider'` and a `build_review` attempt of $2.00 on `m2` with `costSource: 'rate-card'` yields `byDimension` entries `{step:'build', model:'m1', source:'provider', costUsd:1.5}` and `{step:'build_review', model:'m2', source:'rate-card', costUsd:2}` and the bucket sum equals `costUsd`; (b) a cost-unmetered attempt (tokens, no cost) and an attempt with `costUsd: NaN` create no bucket while `costUnmetered.count` increments; (c) an attempt with no model yields a bucket with `model` undefined and its cost included; (d) a missing ledger file yields `readErrors: 1`, one malformed line yields `readErrors: 1`, and a clean ledger yields `readErrors: 0` with all existing fields unchanged; (e) a ledger holding events from two separate runs of the same step sums both into one bucket; (f) the same ledger yields `tokensByDimension` entries keyed by step and model whose `input`/`output`/`cacheRead`/`cacheCreation` sums match a by-hand sum, a cost-unmetered attempt's tokens are included, an attempt with only `input`/`output` leaves the cache kinds absent (not zero), and a no-usage attempt creates no token bucket.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/cost-rollup.ts`: add `byDimension: Array<{ step: string; model?: string; source?: 'provider' | 'rate-card'; costUsd: number }>`, `tokensByDimension: Array<{ step: string; model?: string; tokens: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number } }>`, and `readErrors: number` to `CostRollup` (initialised in `zeroRollup`); in the dispatch loop, when `classifyMetering` returns `fully-metered`, upsert the bucket keyed by `step|model|source` (step falls back to the observation's step; model/source from `tokenUsage.costSource` and the observation's model); whenever `tokenUsage` is present, upsert the token bucket keyed by `step|model`, summing only the kinds that are finite numbers on the usage; increment `readErrors` at each existing site that increments `unmetered.count` for an unreadable file, unparsable line, or non-object record. Do not change `addDispatch`, `unmetered`, or `toFeatureUsageTotals`.
4. Verify tests pass (GREEN); run the existing shipped-record and kpi tests to confirm the additive fields change no rendered output.
5. Commit: "feat(cost-rollup): per-dimension cost buckets and readErrors".

**Done when:**
- [ ] `cost-rollup.test.ts` cases (a)–(f) above pass, including the bucket-sum-equals-`costUsd` assertion and the token-bucket sums
- [ ] `computeCostRollup` on a ledger with one malformed line returns `readErrors === 1` and still returns the metered totals for the parsable lines
- [ ] Every previously existing `cost-rollup.test.ts`, shipped-record, and kpi-report test passes without modification

**Files likely touched:**
- src/conductor/src/engine/cost-rollup.ts — `byDimension`, `readErrors`
- src/conductor/test/engine/cost-rollup.test.ts — new cases

**Dependencies:** none

### Task 2: `feature_cost_snapshot` joins the event union with an otel-only sink declaration
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/event-sinks.test.ts` assert `EVENT_SINKS.feature_cost_snapshot` equals `{ render: false, persist: false, audit: false, otel: true }` and that `otelEventTypes()` includes it while `renderedEventTypes()` and the persisted set do not; in `src/conductor/test/engine/cost-rollup.test.ts` assert `toFeatureCostSnapshot(rollup)` returns `{ type: 'feature_cost_snapshot', costUsd, costComplete, byDimension, tokensByDimension }` with `costComplete === (unmetered.count === 0 && (costUnmetered?.count ?? 0) === 0)`.
2. Verify tests fail (RED) — the union member does not exist, so the typecheck fails too.
3. Implement: add the `feature_cost_snapshot` variant to the `ConductorEvent` union in `src/conductor/src/types/events.ts` with a doc comment stating it is a non-persisted projection of the ledger emitted after each step close; declare it in `EVENT_SINKS` in `src/conductor/src/engine/event-sinks.ts`; add `toFeatureCostSnapshot(rollup)` beside `toFeatureUsageTotals` in `src/conductor/src/engine/cost-rollup.ts`.
4. Verify tests pass (GREEN) and `npm run typecheck` passes (the exhaustive `Record` forces the sink declaration).
5. Commit: "feat(events): feature_cost_snapshot event and otel-only sink declaration".

**Done when:**
- [ ] `event-sinks.test.ts` asserts the exact four-flag declaration for `feature_cost_snapshot` and passes
- [ ] `toFeatureCostSnapshot` returns `costComplete=false` for a rollup with any `unmetered` or `costUnmetered` count and `true` otherwise, asserted by test
- [ ] `npm run typecheck` passes with the new union member declared in `EVENT_SINKS`

**Files likely touched:**
- src/conductor/src/types/events.ts — union member
- src/conductor/src/engine/event-sinks.ts — sink declaration
- src/conductor/src/engine/cost-rollup.ts — `toFeatureCostSnapshot`
- src/conductor/test/engine/event-sinks.test.ts — declaration assertions
- src/conductor/test/engine/cost-rollup.test.ts — projection assertions

**Dependencies:** 1

### Task 3: Engine emits a snapshot after every step terminal, suppressed on an unreadable ledger
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test `src/conductor/test/acceptance/feature-cost-snapshot-at-step-close.acceptance.test.ts`, modelled on `feature-usage-total-at-finish.acceptance.test.ts` (fake provider, real engine, events captured from the bus): (a) after a metered step completes, exactly one `feature_cost_snapshot` follows its `step_completed` and its `costUsd` equals the ledger rollup total; (b) with a pre-seeded `.pipeline/events.jsonl` holding a prior run's $2.10 `provider_attempt`, a new run's first step close emits `costUsd` 3.50 after a $1.40 dispatch; (c) across three step closes the snapshot values are non-decreasing; (d) a step that fails still yields a snapshot including its provider attempts; (e) with no ledger file, and separately with one malformed line, no snapshot is emitted and the run's step verdicts and outcome are identical to the clean case.
2. Verify test fails (RED).
3. Implement in `src/conductor/src/engine/conductor.ts`: in `emitExecutionEvent`, after the delivery promise of a `step_completed` / `step_failed` terminal resolves, call a private `emitFeatureCostSnapshot()` that awaits `computeCostRollup(this.projectRoot)`, returns without emitting when `rollup.readErrors > 0`, and otherwise emits `toFeatureCostSnapshot(rollup)` through `this.events.emit`; wrap the whole body in `try { … } catch { /* per-step provider lines remain the record */ }` exactly like the finish-time `feature_usage_total` emission (search hint: `computeCostRollup` in conductor.ts). The finish-time emission is left as is.
4. Verify test passes (GREEN); run `daemon-otel-parity.acceptance.test.ts` and `feature-usage-total-at-finish.acceptance.test.ts` to confirm the finish line is unchanged.
5. Commit: "feat(conductor): emit feature_cost_snapshot after each step terminal".

**Done when:**
- [ ] The new acceptance test's cases (a)–(e) pass
- [ ] Case (e) asserts zero `feature_cost_snapshot` events AND an unchanged step-verdict sequence for both the missing-ledger and malformed-line ledgers
- [ ] `feature-usage-total-at-finish.acceptance.test.ts` passes unmodified

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — `emitFeatureCostSnapshot` after step terminals
- src/conductor/test/acceptance/feature-cost-snapshot-at-step-close.acceptance.test.ts — new

**Dependencies:** 2

### Task 4: MetricsRecorder records the two cumulative gauges and drops the per-process cost counter
**Story:** 2
**Type:** happy-path

**Steps:**
1. Rewrite the cost cases in `src/conductor/test/engine/otel/metrics.test.ts` as failing tests: (a) `onFeatureCostSnapshot` with buckets `{build,m1,provider:1.5}` and `{build_review,m2,rate-card:2}` yields `conductor.feature.step.cost` points 1.5 and 2 with attributes `{project, feature, step, model, source}` and a `conductor.feature.cost` point 3.5 with `{project, feature, cost_complete: true}`; (b) a snapshot with `costComplete: false` records `cost_complete=false`; (c) a bucket without `model` records a point with the `model` attribute omitted; (d) a second snapshot with an unchanged bucket re-records the same value (cumulative last-value); (e) the collected instrument names after `onDispatch` with a finite-cost usage contain `conductor.step.tokens` and `conductor.step.dispatches` but no `conductor.step.cost`, and the only instruments whose unit is `usd` are the two feature gauges; (f) every recorded cost point carries `project` and `feature` and no attribute named `run`, `run_id`, or `conductor.run.id`; (g) a snapshot with `tokensByDimension` `{build, m1, {input:150, output:15}}` yields `conductor.feature.step.tokens` points 150 for `kind=input` and 15 for `kind=output` with attributes `{project, feature, step, model, kind}` and no `cacheRead`/`cacheCreation` points; (h) after `onDispatch` with a usage-bearing dispatch, the collected instrument names contain `conductor.step.dispatches` and no `conductor.step.tokens`; rewrite `src/conductor/test/acceptance/otel-step-tokens-model-attribute.acceptance.test.ts` so its model-attribute assertion targets `conductor.feature.step.tokens` fed by a snapshot.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/otel/metrics.ts`: create `featureStepCostGauge = meter.createGauge('conductor.feature.step.cost', { unit: 'usd' })` and `featureStepTokensGauge = meter.createGauge('conductor.feature.step.tokens')`; add `onFeatureCostSnapshot(event)` that skips non-finite `costUsd`, records `featureCostGauge` with `cost_complete: event.costComplete`, records one `featureStepCostGauge` point per cost bucket with `step`, plus `model`/`source` only when defined, and one `featureStepTokensGauge` point per token bucket per present kind with `step`, `kind`, plus `model` only when defined; delete `costCounter`, `recordCost`, `tokensCounter`, `recordTokens`, and their calls in `onDispatch` (dispatch counting stays byte-identical); update the file header comment's instrument list.
4. Verify tests pass (GREEN).
5. Commit: "feat(otel): cumulative feature cost gauges replace the step cost counter".

**Done when:**
- [ ] `metrics.test.ts` cases (a)–(h) pass
- [ ] Case (e) asserts the instrument-name set contains no `conductor.step.cost` and the usd-unit instruments are exactly `conductor.feature.cost` and `conductor.feature.step.cost`; case (h) asserts no `conductor.step.tokens`
- [ ] Existing duration, retry, dispatch, run-outcome, and closeout tests in `metrics.test.ts` pass unmodified, and the rewritten `otel-step-tokens-model-attribute.acceptance.test.ts` passes

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — new gauge, `onFeatureCostSnapshot`, counter removal
- src/conductor/test/engine/otel/metrics.test.ts — rewritten cost and token cases
- src/conductor/test/acceptance/otel-step-tokens-model-attribute.acceptance.test.ts — model attribute asserted on the token gauge

**Dependencies:** 2

### Task 5: Visualizer routes snapshots to the recorder and the finish total still lands on the same gauge
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/otel-visualizer.test.ts` using the existing `InMemoryMetricExporter` harness: (a) emitting `feature_cost_snapshot` events on the bus yields `conductor.feature.step.cost`, `conductor.feature.step.tokens`, and `conductor.feature.cost` points whose values match the events, including for a `step` that never had a `step_started` (bucketing is ledger-driven, not span-driven); (b) after a snapshot with total 3.5, emitting `feature_usage_total` with `costUsd: 3.5` records `conductor.feature.cost` 3.5 again with `cost_complete` derived from its unmetered counts; (c) a fresh visualizer started for the same feature after a first one stopped, fed a snapshot carrying the cumulative total, exports that cumulative value under identical `project`/`feature` attributes.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/otel/otel-visualizer.ts`: add `case 'feature_cost_snapshot': this.metricsRecorder.onFeatureCostSnapshot(event); break;` in `handleEvent` beside the `feature_usage_total` case (subscription comes from `otelEventTypes()` automatically via Task 2's declaration).
4. Verify tests pass (GREEN); run `daemon-otel-parity.acceptance.test.ts` to confirm daemon and interactive paths both export the gauge (the parity test enumerates otel event types).
5. Commit: "feat(otel): route feature_cost_snapshot to the metrics recorder".

**Done when:**
- [ ] `otel-visualizer.test.ts` cases (a)–(c) pass
- [ ] `daemon-otel-parity.acceptance.test.ts` passes with `feature_cost_snapshot` reaching both wiring paths
- [ ] Case (b) asserts the finish-time and step-close values for the same total are equal on `conductor.feature.cost`

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — `feature_cost_snapshot` case
- src/conductor/test/engine/otel/otel-visualizer.test.ts — routing cases
- src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts — event-type coverage if it enumerates types explicitly

**Dependencies:** 3, 4

### Task 6: `stop()` shuts down the meter provider after the final flush
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/otel-visualizer.test.ts` with `vi.useFakeTimers()`: (a) record a metric, call `stop()`, assert the exporter received one export containing the latest value before `stop()` resolved; (b) advance fake time by three export intervals after `stop()` and assert the exporter's export-call count did not change; (c) finished spans are still returned by the span exporter after `stop()`; (d) a visualizer that recorded nothing stops without any metric export call.
2. Verify tests fail (RED) — (b) fails today because the interval keeps firing.
3. Implement in `src/conductor/src/engine/otel/otel-visualizer.ts` `_doStop`: keep `forceCloseAll()` and the tracer `forceFlush()`; replace `this.meterProvider.forceFlush()` with `this.meterProvider.shutdown()` inside the same `try`/`warnOnce` guard; update the method comment to say the tracer stays flush-only for post-stop span reads while the meter provider is shut down so its periodic reader stops.
4. Verify tests pass (GREEN); run the full `test/engine/otel` and `test/integration/otel-*` suites.
5. Commit: "fix(otel): shut down the meter provider on stop so finished runs stop exporting".

**Done when:**
- [ ] Fake-timer test (b) asserts zero additional metric exports across three export intervals after `stop()` resolves
- [ ] Test (a) asserts the final export carries the last recorded value and completes before `stop()` resolves
- [ ] Test (c) reads finished spans after `stop()`; all existing `otel-observability` integration tests pass unmodified

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — `_doStop` meter shutdown
- src/conductor/test/engine/otel/otel-visualizer.test.ts — lifecycle cases

**Dependencies:** none

### Task 7: Stop stays bounded and idempotent, and sequential runs never interleave
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/otel-visualizer.test.ts`: (a) a metric exporter whose `export` never calls back and whose `shutdown` hangs — `stop()` resolves within the configured export timeout plus a margin, does not throw, and `warnOnce` fires at most once; (b) calling `stop()` twice, and calling it while a stop is in flight via the registered signal handler, returns the identical promise and the exporter's `shutdown` is invoked once; (c) `stop()` on a visualizer whose `start()` never created providers resolves without error; (d) two visualizers for one feature started in sequence in one process — after the first's `stop()` resolves, advancing fake time and recording on the second yields exports only from the second's exporter instance.
2. Verify tests fail (RED) where they do (d fails today; a–c may already pass and then serve as regression pins).
3. Implement any needed guard in `_doStop`: shutdown is awaited under a `Promise.race` with the existing export-timeout bound only if the SDK's own timeout does not already bound it (verify by test a first; prefer the SDK bound, add the race only when a is red).
4. Verify tests pass (GREEN).
5. Commit: "test(otel): bounded, idempotent stop and no interleaving across sequential runs".

**Done when:**
- [ ] Test (a) asserts `stop()` resolves within the bound and throws nothing when the metric exporter hangs on both export and shutdown
- [ ] Test (b) asserts reference-equal stop promises and exactly one exporter `shutdown` call
- [ ] Test (d) asserts every metric export after the first visualizer's stop originates from the second visualizer's exporter

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — timeout guard only if test (a) is red
- src/conductor/test/engine/otel/otel-visualizer.test.ts — negative lifecycle cases

**Dependencies:** 6

### Task 8: Renderer errors are rendered into the daemon log
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/event-sinks.test.ts` assert `EVENT_SINKS.renderer_error.render === true` and `renderedEventTypes()` includes `renderer_error` (persist stays `true`); in a new `src/conductor/test/daemon-render-renderer-error.test.ts` (shape of `daemon-render-provider-attempt.test.ts`) assert `renderDaemonEvent({ type: 'renderer_error', rendererName: 'otel', error: 'export failed: 503' }, log)` logs exactly one line containing `otel` and `export failed: 503`, and that `rendererName: 'terminal'` logs a line naming `terminal`; in `src/conductor/test/engine/otel/otel-visualizer.test.ts` (or the existing terminal-renderer test) pin the interactive path: a `renderer_error` event still reaches the existing `TerminalRenderer` case and renders one line naming the renderer (regression pin, no production change).
2. Verify tests fail (RED).
3. Implement: flip `render` for `renderer_error` in `src/conductor/src/engine/event-sinks.ts`; add `case 'renderer_error'` in `renderDaemonEventUnsafe` in `src/conductor/src/daemon-cli.ts` logging a warning-styled line `renderer <name> failed: <error>`.
4. Verify tests pass (GREEN); run the `event-sinks` exhaustiveness test and existing daemon render tests.
5. Commit: "feat(daemon): render renderer_error into the daemon log".

**Done when:**
- [ ] `event-sinks.test.ts` asserts `renderer_error` is rendered and persisted, and passes
- [ ] `daemon-render-renderer-error.test.ts` asserts one line naming the renderer and the message for `otel` and for a non-otel renderer
- [ ] All existing `daemon-render-*.test.ts` files pass unmodified, and the interactive `TerminalRenderer` regression pin for `renderer_error` passes

**Files likely touched:**
- src/conductor/src/engine/event-sinks.ts — `renderer_error` render flag
- src/conductor/src/daemon-cli.ts — `renderer_error` case
- src/conductor/test/engine/event-sinks.test.ts — flag assertion
- src/conductor/test/daemon-render-renderer-error.test.ts — new

**Dependencies:** none

### Task 9: An export failure is logged once per run and never changes the run's outcome
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts` (or a sibling acceptance file using its daemon wiring harness): drive a daemon feature run whose metric exporter rejects every export; assert the feature log receives exactly one line naming `otel` across at least three export attempts, that the persisted ledger holds a `renderer_error` record with the same renderer name and message as the logged line, and that the run's step verdicts and terminal outcome equal those of an identical run whose exporter succeeds.
2. Verify test fails (RED) — today no line is logged.
3. Implement: no production change is expected beyond Task 8 (boundedness comes from the existing `warnOnce` wrappers in `otel-visualizer.ts`); if the test shows more than one line per run, route the repeated warning through the visualizer's shared `warnOnce` flag rather than adding a counter elsewhere.
4. Verify test passes (GREEN).
5. Commit: "test(daemon): export failures log once and leave the run outcome unchanged".

**Done when:**
- [ ] The acceptance test asserts exactly one `otel` renderer-error line for a run with at least three failed exports
- [ ] The same test asserts equal step verdicts and terminal outcome between the failing-exporter run and the succeeding-exporter run
- [ ] The persisted `renderer_error` record and the logged line agree on renderer name and message, asserted by test

**Files likely touched:**
- src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts — failure-path case
- src/conductor/src/engine/otel/otel-visualizer.ts — only if boundedness needs the shared flag

**Dependencies:** 8

### Task 10: Partial or untrusted cost never exports as a confident small number
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests spanning the rollup → snapshot → gauge chain: in `src/conductor/test/engine/cost-rollup.test.ts` assert a ledger with one fully-metered $1.00 attempt plus one attempt with no usage yields `toFeatureCostSnapshot` `{ costUsd: 1, costComplete: false }` with one bucket; in `src/conductor/test/engine/otel/metrics.test.ts` assert `onFeatureCostSnapshot` with `costUsd: NaN` records nothing on either gauge; in `src/conductor/test/engine/otel/otel-visualizer.test.ts` assert a snapshot whose `byDimension` is empty but `costUsd: 0` with `costComplete: false` records `conductor.feature.cost` 0 with `cost_complete=false` and no `conductor.feature.step.cost` point.
2. Verify tests fail (RED) where they do; passing cases serve as regression pins.
3. Implement any missing guard in `onFeatureCostSnapshot` (`Number.isFinite` on `costUsd`; per-bucket `Number.isFinite` skip).
4. Verify tests pass (GREEN).
5. Commit: "test(otel): partial and non-finite cost never exports as a confident figure".

**Done when:**
- [ ] The rollup test asserts `costComplete=false` and a single $1.00 bucket for the mixed metered/unmetered ledger
- [ ] `metrics.test.ts` asserts no gauge point for a non-finite snapshot total and no bucket point for a non-finite bucket value
- [ ] `otel-visualizer.test.ts` asserts `cost_complete=false` with value 0 and zero step-cost points for the empty-bucket snapshot

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — finite guards
- src/conductor/test/engine/cost-rollup.test.ts — partial-ledger projection
- src/conductor/test/engine/otel/metrics.test.ts — non-finite cases
- src/conductor/test/engine/otel/otel-visualizer.test.ts — empty-bucket case

**Dependencies:** 5

### Task 11: Token counts stay exact for partial usage, unknown models, and unreadable ledgers
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests spanning the chain: in `src/conductor/test/engine/cost-rollup.test.ts` assert a ledger with a no-usage attempt, a cost-unmetered attempt with input 40 and output 4, and an attempt carrying only `input: 10` on an unknown model yields `tokensByDimension` with the cost-unmetered tokens counted, a bucket with `model` undefined holding `input: 10` and no `output` key, and no bucket for the no-usage attempt, while `toFeatureCostSnapshot` reports `costComplete: false`; in `src/conductor/test/engine/otel/metrics.test.ts` assert `onFeatureCostSnapshot` with a token bucket carrying only `input` emits exactly one `conductor.feature.step.tokens` point (kind `input`) with the `model` attribute omitted; in the Task 3 acceptance file assert the malformed-ledger case emits no snapshot, so no token point can be recorded for that close.
2. Verify tests fail (RED) where they do; passing cases serve as regression pins.
3. Implement any missing guard: per-kind `Number.isFinite` skip in the recorder; unknown model omits the attribute rather than writing `unknown`.
4. Verify tests pass (GREEN).
5. Commit: "test(otel): token buckets stay exact for partial usage, unknown models, and unreadable ledgers".

**Done when:**
- [ ] The rollup test asserts cost-unmetered tokens are counted, absent kinds are absent keys, and a no-usage attempt creates no token bucket
- [ ] `metrics.test.ts` asserts exactly one token point with `model` omitted for the input-only unknown-model bucket
- [ ] The acceptance test asserts zero snapshots and zero `conductor.feature.step.tokens` points for the malformed-ledger close

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — per-kind finite guard
- src/conductor/test/engine/cost-rollup.test.ts — partial-usage token cases
- src/conductor/test/engine/otel/metrics.test.ts — input-only unknown-model case
- src/conductor/test/acceptance/feature-cost-snapshot-at-step-close.acceptance.test.ts — token assertion on the malformed-ledger case

**Dependencies:** 5

## Task Dependency Graph

```
1 ──▶ 2 ──▶ 3 ──┐
       └──▶ 4 ──┴──▶ 5 ──▶ 10
                      └──▶ 11
6 ──▶ 7
8 ──▶ 9
```

## Integration Points
- After Task 3: a real engine run over a seeded ledger emits `feature_cost_snapshot` on the bus with ledger-exact totals (observable via the acceptance test's captured events).
- After Task 5: the daemon and interactive wiring both export `conductor.feature.step.cost`, `conductor.feature.step.tokens`, and `conductor.feature.cost` from live runs; the parity acceptance test covers both paths.
- After Task 6: a stopped run produces no further exports; two sequential runs of one feature in one daemon process cannot interleave.
- After Task 8: an export failure appears in `daemon.log` as one line naming `otel`.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
