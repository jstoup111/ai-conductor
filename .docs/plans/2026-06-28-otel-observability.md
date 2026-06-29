# Implementation Plan: OTel Observability — Phase 1

**Date:** 2026-06-28
**Design:** `.docs/specs/2026-06-28-otel-observability.md` (FR-1…FR-10)
**Stories:** `.docs/stories/otel-observability.md`
**ADR:** `.docs/decisions/adr-014-otel-observability-exporter.md` (APPROVED)
**Diagram:** `.docs/architecture/2026-06-28-otel-observability.md`
**Conflict check:** Clean as of 2026-06-28

## Summary

Build an OpenTelemetry exporter for `src/conductor` that translates the `ConductorEvent` stream
into OTel traces (run span + per-step spans) and metrics (duration/retries/tokens), shipped via
config-selected OTLP or file transport. The exporter is a **bus listener** packaged as a
**`visualizer` plugin**, requiring new generic visualizer wiring in `index.ts`. ~22 tasks.

## Technical Approach

Per ADR-014, the exporter's **internals** mirror `EventPersister` — it subscribes to
`ConductorEventEmitter` via `.on(...)` for every event type and edits no emission site (FR-1).
Its **packaging** is a `visualizer`-kind plugin (`types/plugin.ts` already declares the kind; it
is unwired today), so Phase 1 also lands the generic visualizer lifecycle in `index.ts`.

New module layout under `src/conductor/src/engine/otel/`:
- `otel-config.ts` — parse/validate the `otel:` config block; invalid/incomplete → disabled +
  one named error (never throw). Absent block → disabled (FR-1/FR-7).
- `resource.ts` — build the OTel `Resource` (`service.name`, `conductor.run.id`,
  `conductor.feature`, `conductor.project`); run id from `.pipeline/conduct-session-id` else
  generated (FR-6).
- `transport.ts` — construct the span+metric exporters: OTLP (HTTP/proto 4318 default, gRPC 4317
  optional) or file (OTLP-JSON newline-delimited → `.pipeline/otel.jsonl`) (FR-7).
- `span-manager.ts` — run/step span lifecycle, attributes, span events, force-close of incomplete
  spans (FR-2/3/4/9).
- `metrics.ts` — `conductor.step.duration` histogram, `conductor.step.retries` counter,
  `conductor.step.tokens` counter (skip-absent) (FR-5).
- `otel-visualizer.ts` — the `visualizer` plugin: owns `BatchSpanProcessor` +
  `PeriodicExportingMetricReader`, registers the bus handler, exposes `start()/stop()`; the
  handler does O(1) non-blocking work and hands off (R1/FR-8); `stop()` force-flushes (FR-10).

**Hot-path rule (R1, High):** the bus handler must never block — `emit()` awaits async handlers,
so the handler only calls non-blocking span/metric APIs and lets the batch processors export
asynchronously with a bounded timeout. This is asserted explicitly (Task 17).

**Wiring:** in `index.ts`, after the `EventPersister` block (`:516–518`), add generic visualizer
selection mirroring the `ui_renderer` pattern (`:509`): construct enabled visualizers, `start()`
each; on shutdown (`:588` region) `await stop()` each (stop flushes). The OTel visualizer is
constructed only when `config.otel` is present (honors FR-1 "never constructed when disabled").

**Sequencing:** deps + config + visualizer seam first (infra), then resource/transport, then
spans (happy→negative), then metrics, then resilience/flush, then the end-to-end integration test.

## Prerequisites

- `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-metrics`,
  `@opentelemetry/resources`, `@opentelemetry/exporter-trace-otlp-http`,
  `@opentelemetry/exporter-metrics-otlp-http` added to `src/conductor/package.json` (Task 1).
- All work in `src/conductor`; `npm run build` (tsup) and `vitest run` stay green after each task.

## Tasks

### Task 1: Add @opentelemetry dependencies
**Story:** Infra for all FRs
**Type:** infrastructure
**Steps:**
1. Add the `@opentelemetry/*` packages (api, sdk-trace-base, sdk-metrics, resources,
   exporter-trace-otlp-http, exporter-metrics-otlp-http; gRPC exporter optional/deferred) to
   `src/conductor/package.json`.
2. `npm install`; run `npm run build` — verify it compiles with the new deps present.
3. Commit: "build(otel): add @opentelemetry dependencies to conductor"
**Files:** `src/conductor/package.json`, lockfile
**Dependencies:** none

### Task 2: OtelConfig type on HarnessConfig
**Story:** FR-7
**Type:** infrastructure
**Steps:**
1. Write failing test (`test/types/config.test.ts` or `test/engine/config.test.ts`): a config
   with `otel: { exporter: 'file', file: '.pipeline/otel.jsonl' }` parses into a typed `otel`
   field.
2. RED.
3. Add `OtelConfig` interface (`exporter: 'otlp' | 'file'`, `endpoint?`, `file?`, `protocol?`)
   and `otel?: OtelConfig` to `HarnessConfig` in `src/conductor/src/types/config.ts`.
4. GREEN.
5. Commit: "feat(otel): add OtelConfig type"
**Files:** `src/conductor/src/types/config.ts`, config test
**Dependencies:** none

### Task 3: Parse & validate otel config (self-disable on invalid)
**Story:** FR-7 (happy + negatives), FR-1
**Type:** negative-path
**Steps:**
1. Write failing tests in `test/engine/otel/otel-config.test.ts`:
   - `exporter: otlp` with no `endpoint` → returns `{ enabled: false }` + named error string.
   - `exporter: <unknown>` → disabled + error listing valid options.
   - `exporter: file` with no `file` → enabled with default path `.pipeline/otel.jsonl`.
   - `otel` absent → `{ enabled: false }`, no error.
2. RED.
3. Implement `resolveOtelConfig(config, pipelineDir)` in `engine/otel/otel-config.ts` returning a
   discriminated result; never throws.
4. GREEN.
5. Commit: "feat(otel): resolve and validate otel config, self-disable on invalid"
**Files:** `engine/otel/otel-config.ts`, test
**Dependencies:** Task 2

### Task 4: Visualizer plugin interface + registry support
**Story:** ADR-014 packaging
**Type:** infrastructure
**Steps:**
1. Write failing test (`test/engine/plugin-loader.test.ts` or `test/engine/registry.test.ts`): a
   `visualizer`-kind plugin can be registered and retrieved via `registry.list('visualizer')`.
2. RED.
3. Define a `VisualizerPlugin` interface (`name`, `start(emitter, ctx)`, `stop(): Promise<void>`)
   in `types/plugin.ts` (kind already in `PluginKind`); confirm registry handles the kind.
4. GREEN.
5. Commit: "feat(plugins): VisualizerPlugin interface for the visualizer kind"
**Files:** `src/conductor/src/types/plugin.ts`, registry/loader, test
**Dependencies:** none

### Task 5: Generic visualizer wiring in index.ts
**Story:** ADR-014 wiring; enables FR-1…FR-10 runtime
**Type:** infrastructure (integration point)
**Steps:**
1. Write failing test (`test/integration/visualizer-wiring.test.ts`): with a fake visualizer
   registered and enabled, a run calls its `start()` once and `stop()` once on shutdown.
2. RED.
3. In `src/conductor/src/index.ts`, after the `EventPersister` block (`:516–518`), add generic
   visualizer selection (mirror `ui_renderer` at `:509`): build the list of enabled visualizers,
   `start()` each; in the shutdown region (`:588`) `await stop()` each.
4. GREEN; `npm run build`.
5. Commit: "feat(conductor): wire visualizer plugins (start/stop lifecycle)"
**Files:** `src/conductor/src/index.ts`, test
**Dependencies:** Task 4
**Integration point:** first place a visualizer touches the live run.

### Task 6: No-op when disabled (FR-1 regression)
**Story:** FR-1
**Type:** negative-path
**Steps:**
1. Write failing test (`test/integration/otel-disabled-noop.test.ts`): run a fixture session with
   `otel` absent; assert (a) no OTel visualizer is constructed/started (constructor spy), and (b)
   `.pipeline/events.jsonl` bytes equal a baseline recording.
2. RED.
3. Ensure the wiring constructs the OTel visualizer only when `resolveOtelConfig().enabled`.
4. GREEN.
5. Commit: "test(otel): no-op + byte-identical events.jsonl when disabled"
**Files:** `index.ts` (gating), test
**Dependencies:** Task 3, Task 5

### Task 7: Resource builder + run-id correlation
**Story:** FR-6 (happy + negatives)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests (`test/engine/otel/resource.test.ts`): Resource carries `service.name`,
   non-empty `conductor.run.id`, `conductor.feature`, `conductor.project`; with a
   `.pipeline/conduct-session-id` present run.id equals it; with none, a generated non-empty id;
   two builds with no source produce distinct ids.
2. RED.
3. Implement `buildResource(ctx)` in `engine/otel/resource.ts`.
4. GREEN.
5. Commit: "feat(otel): resource attributes and run-id correlation"
**Files:** `engine/otel/resource.ts`, test
**Dependencies:** Task 1

### Task 8: Transport factory (OTLP / file)
**Story:** FR-7 (happy)
**Type:** happy-path
**Steps:**
1. Write failing tests (`test/engine/otel/transport.test.ts`): `exporter: file` builds a span +
   metric exporter that writes OTLP-JSON lines to the configured/default path; `exporter: otlp`
   builds an OTLP-HTTP (4318) exporter targeting `endpoint`; gRPC selected only when configured.
2. RED.
3. Implement `buildExporters(otelConfig)` in `engine/otel/transport.ts`.
4. GREEN.
5. Commit: "feat(otel): OTLP and file transport factory"
**Files:** `engine/otel/transport.ts`, test
**Dependencies:** Task 3

### Task 9: Processor/provider setup (off hot path)
**Story:** FR-5/FR-8 infra; R1
**Type:** infrastructure
**Steps:**
1. Write failing test (`test/engine/otel/otel-visualizer.test.ts`): constructing the visualizer
   builds a `TracerProvider` with a `BatchSpanProcessor` and a `MeterProvider` with a
   `PeriodicExportingMetricReader` over the Task-8 exporters and Task-7 resource.
2. RED.
3. Implement the provider/processor assembly in `engine/otel/otel-visualizer.ts` (no bus
   subscription yet).
4. GREEN.
5. Commit: "feat(otel): batch span processor + periodic metric reader"
**Files:** `engine/otel/otel-visualizer.ts`, test
**Dependencies:** Task 7, Task 8

### Task 10: Run span lifecycle (one trace per run)
**Story:** FR-2 (happy + negatives)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests (`span-manager.test.ts`): first event opens exactly one root run span;
   `feature_complete` closes it OK; a run ending without `feature_complete` closes it on flush;
   two early events create only one root span.
2. RED.
3. Implement run-span open/close in `engine/otel/span-manager.ts`.
4. GREEN.
5. Commit: "feat(otel): root run span, one trace per run"
**Files:** `engine/otel/span-manager.ts`, test
**Dependencies:** Task 9

### Task 11: Step spans — duration & status
**Story:** FR-3 (happy)
**Type:** happy-path
**Steps:**
1. Write failing tests: `step_started` opens a span named for the step; `step_completed{done}`
   closes OK with duration == start→complete delta (± tolerance); `step_failed` closes ERROR.
2. RED.
3. Implement step span open/close in `span-manager.ts`, parented to the run span.
4. GREEN.
5. Commit: "feat(otel): per-step spans with duration and status"
**Files:** `span-manager.ts`, test
**Dependencies:** Task 10

### Task 12: Step span negatives — orphan & re-run
**Story:** FR-3 (negatives)
**Type:** negative-path
**Steps:**
1. Write failing tests: `step_completed` with no preceding `step_started` → zero spans + one
   warning (no throw); a second `step_started` for the same step → a distinct new span.
2. RED.
3. Handle missing-open and re-run cases in `span-manager.ts`.
4. GREEN.
5. Commit: "feat(otel): handle orphan completion and step re-runs"
**Files:** `span-manager.ts`, test
**Dependencies:** Task 11

### Task 13: Step span attributes
**Story:** FR-4 (attributes; tier-omit negative)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests: closed step span carries `conductor.step`, `conductor.step.index`,
   `conductor.step.status`, `conductor.retry.count`, and `conductor.complexity_tier` when known;
   when tier unknown the attribute is omitted (not `"undefined"`/null).
2. RED.
3. Set attributes in `span-manager.ts`.
4. GREEN.
5. Commit: "feat(otel): step span attributes with safe tier omission"
**Files:** `span-manager.ts`, test
**Dependencies:** Task 11

### Task 14: Span events for retries / gate verdicts / kickbacks
**Story:** FR-4 (span events; out-of-band negative)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests: `step_retry`/`gate_verdict`/`kickback` for the active step add span
   events with their key fields to the open step span; a `gate_verdict` with no open step span
   attaches to the run span (or drops with a warning) and never crashes/mis-attributes.
2. RED.
3. Implement span-event routing in `span-manager.ts`.
4. GREEN.
5. Commit: "feat(otel): in-step span events for retries/verdicts/kickbacks"
**Files:** `span-manager.ts`, test
**Dependencies:** Task 13

### Task 15: Duration & retry metrics
**Story:** FR-5 (duration histogram, retries counter)
**Type:** happy-path
**Steps:**
1. Write failing tests (`metrics.test.ts`): step completion records `conductor.step.duration`
   (histogram, ms, `step` attr); a step with N retries increments `conductor.step.retries` by N.
2. RED.
3. Implement instruments in `engine/otel/metrics.ts`, fed from span-manager close events.
4. GREEN.
5. Commit: "feat(otel): step duration histogram and retries counter"
**Files:** `engine/otel/metrics.ts`, `span-manager.ts` (hook), test
**Dependencies:** Task 11

### Task 16: Token metrics (skip-absent)
**Story:** FR-5 (token counter negatives)
**Type:** negative-path
**Steps:**
1. Write failing tests: `step_completed.tokenUsage` present → `conductor.step.tokens` counter
   points per present `kind`; `tokenUsage` absent → zero token points (no NaN/zero-fill); partial
   kinds (input/output only) → only present kinds recorded.
2. RED.
3. Implement token recording in `metrics.ts`.
4. GREEN.
5. Commit: "feat(otel): token metrics with graceful skip when absent"
**Files:** `metrics.ts`, test
**Dependencies:** Task 15

### Task 17: Handler off the hot path (R1)
**Story:** FR-8 (hot-path); R1 High-impact
**Type:** infrastructure (guard)
**Steps:**
1. Write failing test (`otel-visualizer.test.ts`): subscribe the visualizer to a real
   `ConductorEventEmitter`; with a transport stub that blocks on export, assert `emit()` returns
   promptly (handler does not await export) — i.e. export work is queued to the batch processor,
   not run inline.
2. RED.
3. Ensure the bus handler only enqueues span/metric work and returns; export happens in the batch
   processor.
4. GREEN.
5. Commit: "feat(otel): keep export off the bus hot path"
**Files:** `otel-visualizer.ts`, test
**Dependencies:** Task 9, Task 11

### Task 18: Failure isolation (dead collector / unwritable file)
**Story:** FR-8 (negatives)
**Type:** negative-path
**Steps:**
1. Write failing tests: unreachable OTLP endpoint → run completes, exactly one bounded warning,
   no throw; unwritable file path → warning + completed run; repeated failures → warnings bounded
   (not one-per-event).
2. RED.
3. Wrap export/flush in catch + bounded warning logic in `otel-visualizer.ts` (contrast
   `EventPersister`, which re-throws).
4. GREEN.
5. Commit: "feat(otel): isolate exporter failures, never fail the run"
**Files:** `otel-visualizer.ts`, test
**Dependencies:** Task 17

### Task 19: Bounded export timeout (non-responding endpoint)
**Story:** FR-8 (timeout negative)
**Type:** negative-path
**Steps:**
1. Write failing test: a stub endpoint that accepts but never responds → export abandons within
   the configured timeout; total run delay attributable to export ≤ that bound.
2. RED.
3. Configure bounded `exportTimeoutMillis` on the batch processor / exporter.
4. GREEN.
5. Commit: "feat(otel): bounded export timeout"
**Files:** `otel-visualizer.ts`/`transport.ts`, test
**Dependencies:** Task 18

### Task 20: Incomplete-span close on flush
**Story:** FR-9
**Type:** negative-path
**Steps:**
1. Write failing tests: a step span still open at flush → closed ERROR + `conductor.incomplete =
   true`, present in export; multiple open spans → all closed innermost-first; run span closed
   even when a child was open.
2. RED.
3. Implement force-close-open-spans on flush in `span-manager.ts`/`otel-visualizer.ts`.
4. GREEN.
5. Commit: "feat(otel): force-close incomplete spans on flush"
**Files:** `span-manager.ts`, `otel-visualizer.ts`, test
**Dependencies:** Task 11

### Task 21: Flush on exit (normal + SIGINT/SIGTERM)
**Story:** FR-10
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests: normal `stop()` flushes all buffered spans/metrics (in-memory exporter
   shows none pending); a SIGINT/SIGTERM simulation triggers a bounded flush then proceeds; a
   second signal during flush does not double-flush/deadlock; dead transport at flush still
   returns within the timeout.
2. RED.
3. Implement `stop()` forceFlush + signal handlers (idempotent) in `otel-visualizer.ts`; ensure
   `index.ts` shutdown awaits visualizer `stop()`.
4. GREEN.
5. Commit: "feat(otel): flush pending telemetry on exit and signals"
**Files:** `otel-visualizer.ts`, `index.ts`, test
**Dependencies:** Task 20, Task 5

### Task 22: End-to-end integration test
**Story:** Acceptance Criteria / Success Metrics
**Type:** happy-path (integration)
**Steps:**
1. Write a failing integration test (`test/integration/otel-exporter.test.ts`): run a fixture
   conductor session with `exporter: file`; decode `.pipeline/otel.jsonl` and assert exactly one
   root run span + one child span per executed step (positive durations, correct status, FR-4
   attrs) + FR-5 metrics; repeat with `exporter: otlp` against an in-memory/test collector and
   assert the same spans/metrics arrive.
2. RED → wire any remaining gaps → GREEN.
3. `npm run build`; full `vitest run` green.
4. Commit: "test(otel): end-to-end span tree + metrics over file and otlp"
**Files:** `test/integration/otel-exporter.test.ts`, fixtures
**Dependencies:** Tasks 6–21

## Task Dependency Graph

```
T1 ─┬─ T2 ── T3 ─┬─ T6
    │            ├─ T8 ── T9 ── T10 ── T11 ─┬─ T12
    └─ T7 ───────┘                          ├─ T13 ── T14
                                            ├─ T15 ── T16
                                            └─ T17 ── T18 ── T19
T4 ── T5 ──(enables)── T6, T21
T11/T9 ── T20 ── T21 ── T22 (after T6..T21)
```

## Integration Points
- **After Task 5:** visualizer lifecycle runs against a live session (fake visualizer).
- **After Task 11:** first real spans emitted for a stepping run.
- **After Task 22:** full traces + metrics verified over both transports end-to-end.

## Verification
- [ ] All happy-path criteria covered (T7,T8,T10,T11,T13,T14,T15,T21,T22)
- [ ] All negative-path criteria covered (T3,T6,T12,T13,T14,T16,T18,T19,T20,T21)
- [ ] R1 hot-path guard is an explicit task (T17)
- [ ] FR-1 no-op regression explicit (T6); FR-9 incomplete-close explicit (T20); FR-10 signal flush explicit (T21)
- [ ] No task exceeds ~5 minutes; dependencies explicit and acyclic
- [ ] `npm run build` + `vitest run` green after each task

## Coverage Map (FR → Tasks)

| FR | Tasks |
|----|-------|
| FR-1 additive/no-op | T5 (wiring gate), T6 |
| FR-2 run span | T10 |
| FR-3 step spans | T11, T12 |
| FR-4 attributes/events | T13, T14 |
| FR-5 metrics | T15, T16 |
| FR-6 resource/run-id | T7 |
| FR-7 transport/config | T2, T3, T8 |
| FR-8 resilience | T17, T18, T19 |
| FR-9 incomplete spans | T20 |
| FR-10 flush on exit | T21 |
| Acceptance / end-to-end | T22 |
