# Architecture Review: Spine-derived cumulative cost gauges (#2095, absorbs #2086)
**Date:** 2026-08-30
**Stories reviewed:** none yet (pre-stories DECIDE review, technical track, Medium tier — lightweight mode)
**Verdict:** APPROVED WITH CONDITIONS

Scope boundary (binding, from `.docs/track/exported-step-cost-under-records-spend-20x-so-ever.md`):
balanced — exact, restart-proof, per-dimension cost export on any OTLP backend; meter shutdown on
stop; export-failure visibility; counter-based dashboard queries retired. Out of scope: cross-run
trace linkage (#2011), delta temporality, per-provider cost measurement, the tokens/dispatch counters.

## Root cause (verified 2026-08-30 against source and the live LGTM backend)

1. `OtelVisualizer.stop()` calls `forceFlush()` on both providers and never `shutdown()`
   (`src/conductor/src/engine/otel/otel-visualizer.ts`, comment "intentionally call forceFlush()
   ONLY", unchanged since #139). The `PeriodicExportingMetricReader`'s 60 s `setInterval` is only
   cleared by `onShutdown()` (`@opentelemetry/sdk-metrics@2.10.0`
   `PeriodicExportingMetricReader.js`), so every finished daemon run keeps exporting its frozen
   cumulative values until the daemon process exits. Observed: `conductor_run_outcomes_total{outcome=halted}`
   for one feature re-exported 2,205 times; the `build` cost series alternating `3.55` / `0.52`
   every minute from two dead runs; 600 apparent resets in 1,724 samples. **Confidence 98 %, verified.**
2. ADR-014's 2026-08-28 amendment deliberately gives every run of a feature one metric identity
   (`service.instance.id = project/feature`, no run id on any label path). A per-process cumulative
   counter therefore splices N independent cumulatives onto one series; no backend aggregation
   (`sum`, `increase`, `max_over_time`) recovers the total. **Confidence 95 %, verified** (ADR text +
   the three disagreeing query results in #2095).
3. `conductor.feature.cost` (#2063, merged 11:40Z 2026-08-30, daemon refreshed 11:45Z) is exact but
   finish-only and whole-feature only. The two finishes #2095 cites as "missing" predate it. Since it
   exists it has landed 2/2. **Confidence 95 %, verified.**
4. `renderer_error` is `render: false` (`event-sinks.ts`), so an OTLP export failure in the daemon path
   is persisted to `events.jsonl` but never reaches `daemon.log`. **Verified.**

> **Amended 2026-08-30 by #2095 (operator scope extension):** `conductor.step.tokens` shares the
> splice defect exactly (same per-process cumulative counter on the same shared identity), so the
> operator extended the scope: the snapshot also carries `tokensByDimension` (step × model → per-kind
> sums, populated for every usage-bearing dispatch including cost-unmetered ones), the recorder
> exports `conductor.feature.step.tokens {step, model, kind}` as a cumulative gauge, and the
> `conductor.step.tokens` counter is removed. Two more shipped stories pinned that counter
> (`otel-observability` "Metrics for duration, retries, and tokens"; `per-feature-token-accounting`
> Story 6) and are deleted via the companion PR. `conductor.step.dispatches` stays out of scope: it
> counts occurrences, not accumulations, and its shared-identity splice is a separate, smaller
> defect. Story 5 and Task 11 carry the criteria and tests.

## Feasibility

- **Stack compatibility** — no new dependencies. `@opentelemetry/api` `Gauge` (`meter.createGauge`)
  is already used for `conductor.feature.cost`; `MeterProvider.shutdown()` exists in the pinned SDK.
- **Prerequisites** — none. #2063 (dispatch-metering projection shared by OTel and the shipped
  record) is on main and is the projection this design extends.
- **Integration surface** — `cost-rollup.ts` (per-dimension buckets), `conductor.ts` (one emission
  hook at step close, beside the existing finish-time `computeCostRollup` call), `types/events.ts` +
  `event-sinks.ts` (new `feature_cost_snapshot` variant; `renderer_error` → `render: true`),
  `otel/metrics.ts` (new gauge, counter removal), `otel/otel-visualizer.ts` (shutdown), `daemon-cli.ts`
  (render case for `renderer_error`), docs. Four module boundaries, all inside the engine.
- **Data implications** — none persisted. `feature_cost_snapshot` is `persist: false` (precedent:
  `pipeline_closeout`, adr-2026-08-08 D1) because it is a derived projection of the spine, and
  persisting it would make the rollup read its own output. The shipped-record `## Cost` block is
  untouched (adr-2026-07-27-b: additive-only evolution).
- **Performance risk** — `computeCostRollup` re-reads `events.jsonl` once per step close. Observed
  spine sizes in live worktrees: 150–430 KB; step closes are minutes apart. Negligible, and it is
  NOT on the bus hot path (ADR-014 Decision 4): the read happens in Conductor's async step-close
  code, and the visualizer's handler stays O(1) (`gauge.record`). **Confidence 95 %.**
- **Worktree isolation** — `.pipeline/` is per-worktree; `events.jsonl` is already per-feature
  (adr-2026-07-22-b). No shared resources.
- **Test constraints** — tests read spans from `InMemorySpanExporter` after `stop()`; the tracer
  side keeps flush-only. `InMemoryMetricExporter.shutdown()` only sets `_shutdown = true` and does
  not clear `_metrics` (verified in `sdk-metrics@2.10.0`), so tests that read metrics after `stop()`
  keep working. **Confidence 90 %, verified from SDK source, not yet exercised.**
- **Release gate** — removing `conductor.step.cost` and adding an instrument is a reader-visible
  change to a documented telemetry contract, not a canonical breaking surface (no CLI/hook/schema
  change): `Release-Disposition: note`, `Release-Category: Changed`, `Release-Semver: minor`.
  No VERSION/CHANGELOG edits.

## Alignment

- **Governing ADRs (reused, not duplicated):**
  - `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` (APPROVED) — the per-feature
    `events.jsonl` rollup is the cost source of truth and explicitly anticipates the "OTel-first
    work (Approach C)" as "a consumer swap, not a re-wire". This feature is that consumer swap:
    OTel becomes a projection of the rollup. Recorded as an additive amendment note.
  - `adr-014-otel-observability-exporter` (APPROVED, amended 08-26/08-28) — identity contract
    unchanged (`project`/`feature` data-point attributes, feature-stable Resource, no run id on any
    label path). Decision 4 (off the hot path) and Decision 5 (failure isolation, one bounded warning)
    both hold. Amendment note added: `stop()` shuts down the meter provider; cost instruments are
    spine projections; the bounded warning is rendered.
  - `adr-2026-07-27-cost-unmetered-is-a-first-class-state` — the snapshot carries the same
    three-valued metering; a feature with any `unmetered` or `cost-unmetered` dispatch exports
    `cost_complete=false`. No estimated or fabricated cost is ever emitted.
  - `adr-2026-07-26-event-sink-registry-exhaustiveness` — the new union member must declare all
    four sinks; `render: false, persist: false, audit: false, otel: true`.
  - `adr-2026-08-08-pipeline-owned-closeout-timestamps` D1 — precedent for an otel-only,
    non-persisted `ConductorEvent`.
- **Event-spine check** (`.agents/skills/event-spine/SKILL.md`): the snapshot is an occurrence
  ("the feature's cost changed at this step close") emitted on the bus as a `ConductorEvent` — one
  union, one reader path. Not a channel. Reading `events.jsonl` to compute it is reading the spine,
  not stamping state into an artifact.
- **Pattern consistency** — the emission site mirrors the existing finish-time `feature_usage_total`
  emission (`conductor.ts`, `computeCostRollup` → `toFeatureUsageTotals` → `emitTracked`, wrapped in
  a best-effort `try` so a cost failure never fails a build). Rediscovery seeds: `computeCostRollup`,
  `feature_usage_total`, `emitTracked`, `MetricsRecorder.onFeatureUsageTotal`. Allowed variation:
  the snapshot carries per-dimension buckets and is emitted after every step close, not only finish.
- **Provider agnosticism** — dimensions come from the shared `DispatchMeteringObservation`
  (`step`, `model`, `costSource`) that claude, codex, and pi already populate; no provider-specific
  branch is introduced.
- **Backend agnosticism (operator requirement)** — a cumulative gauge needs no reset, delta, or
  staleness semantics from the backend; any OTLP receiver stores the last value. Delta temporality
  was rejected on this ground (see `.memory/decisions/2026-08-30-spine-derived-cumulative-cost-gauges.md`).
- **Diagram accuracy** — `.docs/architecture/exported-step-cost-under-records-spend-20x-so-ever.md`
  reflects this design; operator-validated 2026-08-30.

## Domain Integrity
N/A (no domain model changes). Skipped per lightweight mode. One note for stories: the rollup's
per-dimension key is `{step, model, source}`; `model` and `source` may be absent for `unmetered`
dispatches, which contribute no cost bucket (they still count toward `cost_complete=false`).

## Wiring Surface

| New/changed production surface | Called from |
|---|---|
| `CostRollup.byDimension` (per step × model × source cumulative cost) | computed inside the existing `computeCostRollup(worktree)` in `cost-rollup.ts`; consumed by the new snapshot emission and by nothing else (shipped-record rendering unchanged) |
| `feature_cost_snapshot` ConductorEvent | emitted by Conductor's step-close path in `conductor.ts` after each `step_completed` / `step_failed` (same code region as the finish-time `feature_usage_total` emission); routed by `EVENT_SINKS` to the OTel visualizer only |
| `MetricsRecorder.onFeatureCostSnapshot` + gauge `conductor.feature.step.cost` | `OtelVisualizer.handleEvent` `case 'feature_cost_snapshot'`, alongside the existing `feature_usage_total` case; `conductor.feature.cost` recorded from the same handler |
| Removal of `conductor.step.cost` and `conductor.step.tokens` | `MetricsRecorder.recordCost` and `recordTokens` deleted; `onDispatch` keeps dispatches only |
| `conductor.feature.step.tokens` gauge | recorded by `MetricsRecorder.onFeatureCostSnapshot` from `tokensByDimension` on every snapshot |
| `meterProvider.shutdown()` in `OtelVisualizer.stop()` | already invoked from `daemon-cli.ts` `beginFeatureRun.stop` (in `daemon-runner.ts`'s `finally`, every termination path) and from `index.ts` interactive shutdown; SIGINT/SIGTERM handlers unchanged |
| `renderer_error` rendered | `EVENT_SINKS.renderer_error.render = true`; `daemon-cli.ts` `renderDaemonEvent` gains a case; `TerminalRenderer` already handles it |
| Documentation | `docs/reference/configuration.md` (otel metrics section: replace the `conductor.step.cost` paragraph, document the new gauge, the cost-over-time recipe, `cost_complete`), `docs/reference/artifacts.md` (Cost block ↔ gauge parity paragraph) |

Overlap scan run (advisory): every long-lived spec branch reports overlap on all seven paths
because their merge-bases predate recent churn — noise, no actionable collision. Nearest real
neighbours by topic are `spec/per-feature-token-accounting-so-tokens-per-shipped` and
`spec/per-step-usage-metrics-are-only-parsed-from-claude` (both unmerged specs); they touch
`cost-rollup.ts`. The plan should keep the `byDimension` addition additive (new field, no reshaping
of existing fields) so either rebases cleanly.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A worktree recreated from its branch loses `.pipeline/events.jsonl` (#497), so the gauge drops below its previous value | Data | Low | Medium | Accepted: the finish line and shipped record drop identically — the gauge stays equal to the ledger, which is the contract. Documented; durable fix belongs to #1515 |
| Operator dashboards (out of repo, `~/observability`) still query `conductor_step_cost_usd_total` after the counter is removed | Integration | Certain until re-pointed | Medium | Condition C1: docs carry the exact replacement queries; the panels go empty rather than wrong (an empty panel is the "unavailable, not a small number" outcome) |
| A process killed between the last export tick and step close loses that step's snapshot | Data | Medium | Low | The next run's first snapshot re-reads the spine and re-exports the full cumulative; loss is bounded to the window until the feature is next dispatched |
| Existing tests assert `conductor.step.cost` data points (11 references in `metrics.test.ts`) | Technical | Certain | Low | Rewrite as negative assertions (no cost counter series) plus gauge assertions; testQuality preflight is satisfied because production files change |
| `renderer_error` now rendered in `daemon.log` for every renderer failure, not only OTel | Knowledge | Low | Low | Warnings are already bounded by `warnOnce`; render text names the renderer |

## ADRs Created
None. Reused `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` and
`adr-014-otel-observability-exporter`, each with one additive amendment note (original assertions
preserved). No uncovered structural decision remains: the source of truth for cost was decided by
adr-2026-07-22-b, and this feature only changes which consumer projects it.

## Conditions
- **C1 — Dashboard follow-through is documented, not built.** The Grafana JSON lives outside this
  repository (`~/observability/ai-conductor-lgtm/dashboards`). `docs/reference/configuration.md`
  MUST carry the canonical PromQL for: cumulative feature cost, per-step/per-model split,
  per-project total, and spend-per-interval, all using last-value/`max_over_time` on the gauges and
  none using `increase()`/`rate()`. The operator re-points the panels after merge.
- **C2 — No fabricated cost.** A snapshot is emitted only when the spine was readable; when
  `computeCostRollup` throws, nothing is recorded (no zero). `cost_complete=false` whenever any
  dispatch is `unmetered` or `cost-unmetered`.
- **C3 — Amendment notes land in this diff.** The two ADR amendment notes are part of the spec
  branch baseline (adr-2026-08-04: DECIDE mutates accepted artifacts directly).
