# Implementation Plan: Daemon-level metrics — queue depth, halts, gate outcomes, and monotonic counters

**Date:** 2026-09-06
**Design:** .docs/decisions/architecture-review-2026-09-06-no-daemon-level-metrics-queue-depth-halts-and-gate.md
**Stories:** .docs/stories/no-daemon-level-metrics-queue-depth-halts-and-gate.md
**Conflict check:** Clean as of 2026-09-06

## Summary

Move metric ownership from per-dispatch visualizers to one daemon-lifetime meter, re-key metric
identity to project/worker, and add the daemon-level and per-feature instruments that make
backlog, halts, gates, and end-to-end duration chartable. 19 tasks.

## Technical Approach

- **One meter per daemon (adr-014 D7).** `wireDaemonOtel(config, ctx, rootEvents)` in
  `src/conductor/src/engine/otel/wire.ts` builds the `MeterProvider` + `MetricsRecorder` once at
  daemon start and returns `{ recorder, meterProvider, stop }`. `beginFeatureRun` passes the
  recorder into the existing `wireOtelVisualizer` through a new optional `metricsRecorder` field on
  `VisualizerFactoryContext`/`OtelVisualizerContext`; `OtelVisualizer.initializeProviders` skips
  meter construction when one is injected and records `ownsMeterProvider=false`, so `_doStop`
  force-flushes but never shuts down a provider it did not build. The interactive `index.ts` path
  passes nothing and behaves exactly as today.
- **Identity (D8).** `buildResource(ctx, 'metrics')` emits `service.instance.id=<project>/<worker>`,
  `conductor.project`, `conductor.worker`, `host.name`; `conductor.feature`/`conductor.branch` stay on
  the trace Resource only. `MetricsRecorder` gains a per-process identity (`project`, `worker`) and a
  per-feature identity applied only by the per-feature record methods; daemon-level record methods
  attach no `feature`. `worker` resolves from `otel.worker_name` (trimmed, non-blank) else
  `os.hostname()` else `unknown`, mirroring the `otel.project_name` chain in `otel-config.ts`.
- **Spine (D9).** Three new `ConductorEvent` variants with closed-union payloads:
  `daemon_backlog_snapshot`, `feature_dispatch_started`, `feature_shipped`. The daemon root bus gets
  an `EventPersister` writing `<mainRoot>/.daemon/events.jsonl` that skips events tagged by the
  existing `forwardedFromFeature` WeakSet. A `DaemonMetricsListener` (`otel/daemon-metrics-listener.ts`)
  subscribes to `otelEventTypes()` on the root bus and records the daemon-level instruments; the
  per-feature events it needs already reach the root bus via `ForwardingEventEmitter`.
- **Daemon loop seam.** `DaemonDeps` gains `onTick?(snapshot)`; the loop in `daemon.ts` calls it
  once per discovery pass with counts it already computed (items/waiting/blocked/gated come from the
  discovery hook layer where they are visible today — follow the `onGatedDiscovered` precedent in
  `daemon-work-source.ts` and its wiring in `daemon-cli.ts`), plus `claims.listParked()`,
  `inFlight.size`, `concurrency`, the four dispatch-blocking flags, and the pass duration. Eligibility
  age uses a `.daemon/first-seen/<slug>` marker written on first discovery (durable state, not an
  occurrence; same shape as `.daemon/parked/`).
- **Halt class source.** At dispatch end the daemon reads the worktree's `HALT.class` through a new
  `readHaltSidecarClassification()` that recognizes the eight sidecar values (the six
  `HaltDisposition` values plus `kickback-cap` and `over-scope`). `readHaltClass` and re-kick
  behavior are untouched.
- **Durations.** `feature_shipped` carries `runStartedAt` (from `readState` of the worktree's
  `conduct-state.json`) and the timing rollup's `{ state, activeMs }`; the listener records
  `duration.wall` only when `runStartedAt` is present and `duration.active` only when `state==='exact'`.
- **Local pattern basis.** The daemon-level listener follows `AuditTrailWriter`: constructed once
  near the bus, subscribed by a registry-derived type list, handlers never throw, detached on stop
  (search hints: `AuditTrailWriter`, `auditedEventTypes`, `startFeatureEventPersistence`). Allowed
  variation: it holds a recorder, not a writer. Tests follow the existing in-memory-exporter shape
  (search hints: `InMemoryMetricExporter`, `findMetric`, `daemon-otel-wiring.test.ts`,
  `daemon-otel-parity.acceptance.test.ts`); Resource assertions read the exported Resource, never
  data-point attributes.
- **Sequencing.** Spine + config + identity first (1–5), meter ownership and daemon wiring (6–8),
  the tick seam and daemon-level gauges (9–12), feature lifecycle counters (13–16), forwarding and
  gate counters (17–18), interactive parity last (19).

## Prerequisites

- None external. `@opentelemetry/sdk-metrics` 2.10 already supports multiple recorders on one meter
  (verified 2026-09-06).

## Tasks

### Task 1: Add the three daemon-level event variants and their sink rows
**Story:** Story 7 (registry rows; missing-row compile failure)
**Type:** infrastructure

**Steps:**
1. Write failing test: `otelEventTypes()` and `persistedEventTypes()` both include `daemon_backlog_snapshot`, `feature_dispatch_started`, `feature_shipped`; a type-level test (`// @ts-expect-error`) proves omitting a row for a union member fails compilation
2. Verify test fails (RED)
3. Implement: add the three variants to `src/conductor/src/types/events.ts` with closed unions `BacklogState = 'eligible'|'waiting'|'blocked'|'gated'|'parked'`, `DispatchKind = 'initial'|'resume'|'rekick'`, `DispatchBlockReason = 'paused'|'build_auth_missing'|'gh_version'|'episode_active'`, and payloads: snapshot `{ counts: Record<BacklogState, number>, oldestAgeSeconds: Partial<Record<BacklogState, number>>, slots: { busy: number; free: number }, inFlight: string[], blocked: Record<DispatchBlockReason, boolean>, pollDurationMs: number }`; dispatch `{ slug: string; kind: DispatchKind }`; shipped `{ slug: string; runStartedAt?: number; active: { state: 'exact'|'partial'|'unavailable'; activeMs?: number } }`; add `EVENT_SINKS` rows `{ render: false, persist: true, audit: false, otel: true }`
4. Verify test passes (GREEN)
5. Commit with message: "Add daemon_backlog_snapshot, feature_dispatch_started, feature_shipped events with sink rows"

**Done when:**
- A test asserts `otelEventTypes()` and `persistedEventTypes()` each contain the three new type names
- A `@ts-expect-error` fixture proves a union member without an EVENT_SINKS row fails compilation
- The three payload types use only closed string unions for state, kind, and reason fields (no `string`)
- Existing `event-sink-registry.test.ts` and `otel-visualizer-parity.test.ts` still pass

**Files likely touched:**
- src/conductor/src/types/events.ts — three variants and closed unions
- src/conductor/src/engine/event-sinks.ts — three rows
- src/conductor/test/event-sinks.test.ts — derivation and compile-failure fixture

**Dependencies:** none

### Task 2: Persist daemon-bus events to the daemon ledger, skipping forwarded copies
**Story:** Story 7 (daemon ledger persistence; forwarded events written once; unwritable ledger)
**Type:** infrastructure

**Steps:**
1. Write failing test: with a root bus and a feature `ForwardingEventEmitter`, emitting `daemon_backlog_snapshot` on the root bus appends one line to `<mainRoot>/.daemon/events.jsonl`; emitting `gate_verdict` on the feature bus appends one line to the feature `.pipeline/events.jsonl` and zero lines to the daemon ledger; an unwritable `.daemon/` directory logs one failure line and the emit does not throw
2. Verify test fails (RED)
3. Implement: `startDaemonEventPersistence(mainRoot, rootEvents, log)` in `src/conductor/src/engine/event-persister.ts` that attaches an `EventPersister` to the root bus for `persistedEventTypes()` and returns early for events where `isForwardedFromFeature(event)` is true; wire it in `daemon-cli.ts` at daemon start and stop it at shutdown
4. Verify test passes (GREEN)
5. Commit with message: "Persist daemon-bus events to .daemon/events.jsonl, skipping forwarded feature events"

**Done when:**
- A test asserts a root-bus snapshot event appears exactly once in `.daemon/events.jsonl` in the same JSON schema as `.pipeline/events.jsonl`
- A test asserts a forwarded gate_verdict appears once in the feature ledger and zero times in the daemon ledger
- A test with an unwritable `.daemon/` asserts one logged failure line, no throw, and the emitter still delivers the event to other subscribers
- `daemon-cli.ts` starts the daemon persister before the loop and stops it in the existing shutdown path

**Files likely touched:**
- src/conductor/src/engine/event-persister.ts — startDaemonEventPersistence
- src/conductor/src/daemon-cli.ts — wire at start/stop
- src/conductor/test/daemon-event-persistence.test.ts — new

**Dependencies:** Task 1

### Task 3: Resolve otel.worker_name with hostname fallback and register the config key
**Story:** Story 2 (worker_name set/blank/absent; hostname failure fallback)
**Type:** happy-path

**Steps:**
1. Write failing test: `resolveOtelConfig` yields `workerName` = trimmed value when `otel.worker_name` is non-blank, `undefined` when blank or absent; `resolveWorkerName(resolved)` returns the config value, else `os.hostname()`, else `unknown` when hostname throws or is empty; `config-consumer-registry.test.ts` passes with `otel.worker_name` in `CONFIG_CONSUMER_KEY_SETS.otel` and a declared consumer; the scaffolder template lists the key
2. Verify test fails (RED)
3. Implement: add `worker_name?: string` under the `otel` block in `src/conductor/src/types/config.ts`; thread through `resolveOtelConfig` → `ResolvedOtelConfig.workerName` exactly as `projectName`; add `resolveWorkerName` in `otel-config.ts`; add `worker_name` to `CONFIG_CONSUMER_KEY_SETS.otel` in `src/conductor/src/engine/config.ts` and the matching consumer entry in the registry test's declaration table; add a commented `worker_name` line to `templates/project-config.yml.template`
4. Verify test passes (GREEN)
5. Commit with message: "Add otel.worker_name with hostname fallback and registry/template entries"

**Done when:**
- Tests cover `otel.worker_name` set, blank, absent, and an `os.hostname()` that throws, asserting the resolved worker is the trimmed value, the hostname, the hostname, and `unknown` respectively
- `config-consumer-registry.test.ts` passes with `otel.worker_name` present in `CONFIG_CONSUMER_KEY_SETS.otel` and a declared consumer (`otel-config.ts`)
- `templates/project-config.yml.template` contains a commented `worker_name` line under `otel:`
- `resolveOtelConfig` never throws for any `otel.worker_name` value (existing never-fails tests still pass)

**Files likely touched:**
- src/conductor/src/types/config.ts — worker_name
- src/conductor/src/engine/otel/otel-config.ts — workerName, resolveWorkerName
- src/conductor/src/engine/config.ts — CONFIG_CONSUMER_KEY_SETS.otel gains worker_name
- src/conductor/test/engine/config-consumer-registry.ts — consumer declaration
- templates/project-config.yml.template — commented key
- src/conductor/test/otel-config.test.ts — cases

**Dependencies:** none

### Task 4: Re-key the metric Resource to project/worker and keep the trace Resource feature-scoped
**Story:** Story 2 (metric Resource shape; no conductor.feature on it; trace Resource unchanged)
**Type:** happy-path

**Steps:**
1. Write failing test: `buildResource(ctx, 'metrics')` attribute set is exactly `{ service.name: 'ai-conductor', service.instance.id: 'P/W', conductor.project, conductor.worker: 'W', host.name }` with no `conductor.feature`, `conductor.branch`, `conductor.run.id`; `buildResource(ctx, 'traces')` still carries `conductor.feature`, `conductor.branch`, `conductor.run.id`, `conductor.engine.version` and the same `service.instance.id`
2. Verify test fails (RED)
3. Implement: add `workerName` to the resource context; compose the metric-signal attribute set as above and the trace-signal set as today plus `conductor.worker`; keep `unknown` fallbacks for absent project or worker
4. Verify test passes (GREEN)
5. Commit with message: "Metric Resource is worker-stable: service.instance.id=project/worker, feature only on traces"

**Done when:**
- A test asserts the exported metric Resource's exact key set and `service.instance.id === 'P/W'` and `host.name` present
- A test asserts `conductor.feature` and `conductor.branch` are absent from the metric Resource and present on the trace Resource
- A test asserts an absent worker yields `service.instance.id` ending in `/unknown` with no throw
- Existing resource tests for `service.name` constancy and run-id placement still pass

**Files likely touched:**
- src/conductor/src/engine/otel/resource.ts — signal-scoped attribute sets
- src/conductor/test/otel-resource.test.ts — exact-set assertions

**Dependencies:** Task 3

### Task 5: MetricsRecorder carries project/worker on every point and feature only on per-feature instruments
**Story:** Story 2 (per-feature points carry project, worker, feature; daemon-level points carry no feature)
**Type:** happy-path

**Steps:**
1. Write failing test: with one recorder constructed for `{ project: 'P', worker: 'W' }`, `forFeature('S').onStepClose(...)` yields a `conductor.step.duration` point with attributes `{ project: 'P', worker: 'W', feature: 'S', step }`; `onDaemonBacklog(...)` yields `conductor.daemon.backlog` points with `{ project, worker, state }` and no `feature` key
2. Verify test fails (RED)
3. Implement: constructor takes `{ project, worker }`; add `forFeature(feature)` returning a bound per-feature view over the same instruments (identity merged per call, no new instruments); add daemon-level instruments `conductor.daemon.backlog`, `conductor.daemon.backlog.oldest_age` (unit s), `conductor.daemon.slots`, `conductor.daemon.inflight`, `conductor.daemon.up`, `conductor.daemon.blocked_reason`, `conductor.daemon.poll.duration` (ms histogram, existing boundaries), `conductor.daemon.stalls`, and per-feature `conductor.feature.dispatches`, `conductor.feature.halts`, `conductor.feature.shipped`, `conductor.feature.duration.wall`, `conductor.feature.duration.active` (ms histograms), `conductor.gate.verdicts`, `conductor.gate.kickbacks`, with record methods for each; update the two existing construction sites to the new constructor
4. Verify test passes (GREEN)
5. Commit with message: "MetricsRecorder: process identity plus per-feature view; add daemon and feature instruments"

**Done when:**
- A test asserts a per-feature data point carries exactly `project`, `worker`, `feature` plus the instrument's own attributes
- A test asserts a daemon-level data point carries `project` and `worker` and has no `feature` key
- All fifteen new instrument names are created once per recorder (a second `forFeature` view creates no new instruments — asserted by instrument count on the exporter)
- Existing metrics tests pass with the new constructor signature

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — identity split and new instruments
- src/conductor/src/engine/otel/otel-visualizer.ts — construction site
- src/conductor/test/otel-metrics.test.ts — attribute assertions

**Dependencies:** Task 3

### Task 6: OtelVisualizer accepts an injected recorder and never shuts down a meter it did not build
**Story:** Story 1 (stop force-flushes but does not shut down shared meter); Story 8 (interactive path owns and shuts down its own meter; no-recorder construction)
**Type:** infrastructure

**Steps:**
1. Write failing test: (a) a visualizer constructed with `metricsRecorder` + `meterProvider` in its context creates no `MeterProvider` of its own, and its `stop()` calls `forceFlush()` on the injected provider but never `shutdown()`; (b) a visualizer constructed without them creates its own provider and `stop()` calls `shutdown()` exactly once; (c) both variants still create their own `TracerProvider` and flush spans on stop
2. Verify test fails (RED)
3. Implement: add optional `metricsRecorder` and `meterProvider` to `OtelVisualizerContext` and `VisualizerFactoryContext`; in `initializeProviders` use them when present and set `ownsMeterProvider=false`; in `_doStop` branch on the flag (`forceFlush` vs existing shutdown path); forward the field in `plugin-loader.ts`'s `visualizer:otel` factory and in `createOtelVisualizer`
4. Verify test passes (GREEN)
5. Commit with message: "OtelVisualizer: injected shared meter is flushed on stop, never shut down"

**Done when:**
- A test asserts an injected `MeterProvider` receives `forceFlush()` and zero `shutdown()` calls across a visualizer start/stop
- A test asserts a self-built `MeterProvider` receives exactly one `shutdown()` on stop
- A test asserts a visualizer constructed with no recorder in context initializes without throwing and exports the existing instruments
- The trace side is unchanged: both variants own a `TracerProvider` and force-flush spans on stop (existing flush tests pass)

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — context fields, ownership flag, stop branch
- src/conductor/src/engine/otel/create-otel-visualizer.ts — pass-through
- src/conductor/src/engine/plugin-loader.ts — factory pass-through
- src/conductor/src/types/plugin.ts — VisualizerFactoryContext field
- src/conductor/test/otel-visualizer-meter-ownership.test.ts — new

**Dependencies:** Task 5

### Task 7: Wire the daemon-owned meter at daemon start and hand it to every dispatch
**Story:** Story 1 (exactly one MeterProvider for the daemon's life; disabled config leaves the daemon unchanged)
**Type:** infrastructure

**Steps:**
1. Write failing test: with OTel enabled, the daemon start path calls `wireDaemonOtel` once and every `beginFeatureRun` receives the same recorder instance; with OTel disabled or absent, `wireDaemonOtel` returns `null`, no `MeterProvider` is constructed, and `beginFeatureRun` passes no recorder (the existing per-dispatch behavior test still passes)
2. Verify test fails (RED)
3. Implement: `wireDaemonOtel(config, { mainRoot, projectName, workerName, rootEvents })` in `src/conductor/src/engine/otel/wire.ts` building the metric Resource (Task 4), `PeriodicExportingMetricReader`, `MeterProvider`, `MetricsRecorder` (Task 5), and returning `{ recorder, meterProvider, stop }` where `stop` force-flushes and shuts down; call it in `daemon-cli.ts` before the loop and await its `stop` in the shutdown path; in `beginFeatureRun` pass `recorder.forFeature(item.slug)` and `meterProvider` into `wireOtelVisualizer`'s context
4. Verify test passes (GREEN)
5. Commit with message: "Daemon owns one MeterProvider; dispatches record onto the shared recorder"

**Done when:**
- A test asserts one `MeterProvider` is constructed per daemon start and two dispatches receive the same recorder instance
- A test asserts disabled or absent OTel config constructs no `MeterProvider` and passes no recorder to `beginFeatureRun`
- A test asserts daemon shutdown calls `forceFlush()` then `shutdown()` on the shared provider exactly once
- `daemon-otel-wiring.test.ts` and `daemon-otel-parity.acceptance.test.ts` still pass

**Files likely touched:**
- src/conductor/src/engine/otel/wire.ts — wireDaemonOtel
- src/conductor/src/daemon-cli.ts — start/stop wiring, beginFeatureRun pass-through
- src/conductor/test/daemon-otel-wiring.test.ts — daemon-meter cases

**Dependencies:** Task 4, Task 6

### Task 8: Counters accumulate across re-dispatches under one daemon
**Story:** Story 1 (run.outcomes halted reads 2; step.retries monotonic; daemon restart is a single reset)
**Type:** happy-path

**Steps:**
1. Write failing test (acceptance, in-memory exporter, fake feature runs): one daemon dispatches feature S which halts, re-dispatches S which halts again — `conductor.run.outcomes{feature=S, outcome=halted}` reads 2 after the second dispatch and never reads a value lower than a previous export; two dispatches each retrying `build` once give `conductor.step.retries{feature=S, step=build}` = 2; a second daemon process (new `wireDaemonOtel`) exports the same series identity (`service.instance.id`, `project`, `worker`, `feature`) with a fresh counter
2. Verify test fails (RED)
3. Implement: no production code expected beyond Tasks 5–7; fix any identity or reset defect the test exposes
4. Verify test passes (GREEN)
5. Commit with message: "Acceptance: per-feature counters are monotonic across dispatches under one daemon"

**Done when:**
- An acceptance test asserts `conductor.run.outcomes{outcome=halted}` for one feature reads 2 after two halting dispatches under one daemon
- The same test asserts `conductor.step.retries` for the feature is 2 after two single-retry dispatches
- A test asserts a second daemon instance exports the identical series identity attribute set with counters restarting from zero exactly once
- No duplicate-instrument warning is emitted across the two dispatches (asserted on captured warnings)

**Files likely touched:**
- src/conductor/test/acceptance/daemon-monotonic-counters.acceptance.test.ts — new

**Dependencies:** Task 7

### Task 9: Daemon loop reports a per-tick snapshot through a DaemonDeps hook
**Story:** Story 3 (counts per state; slots and in-flight; poll duration)
**Type:** infrastructure

**Steps:**
1. Write failing test: driving the daemon loop with a fake `discoverBacklog` and a `LocalWorkSource` that surfaces 3 eligible / 2 waiting / 1 blocked / 4 gated, two parked claims, concurrency 3 with two in-flight, the loop calls `deps.onTick` once per pass with `{ counts: { eligible: 3, waiting: 2, blocked: 1, gated: 4, parked: 2 }, slots: { busy: 2, free: 1 }, inFlight: [two slugs], blocked: { paused: false, build_auth_missing: false, gh_version: false, episode_active: false }, pollDurationMs: >0 }`
2. Verify test fails (RED)
3. Implement: extend the discovery hook layer so `waiting` and `blocked` counts reach the wiring layer alongside `gated` (follow the `onGatedDiscovered` shape in `daemon-work-source.ts`); add `onTick?: (snapshot: DaemonTickSnapshot) => void` to `DaemonDeps`; in `daemon.ts` call it after `pickEligible` on both the idle and busy branches with the in-scope locals and the measured discovery duration; the hook is synchronous and does no I/O
4. Verify test passes (GREEN)
5. Commit with message: "Daemon loop emits a per-tick backlog snapshot through DaemonDeps.onTick"

**Done when:**
- A loop test asserts `onTick` is called once per pass with the exact counts, slots, in-flight slugs, and flags above
- A test asserts `pollDurationMs` equals the measured discovery duration within 50 ms of a fake clock
- The hook is invoked on both the idle branch and the busy-pool branch (two tests, one per branch)
- A test asserts the hook performs no filesystem or git call (spied `fs`/`execFile` receive zero calls from inside `onTick`)

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — onTick call sites
- src/conductor/src/engine/daemon-deps.ts — DaemonDeps.onTick, DaemonTickSnapshot
- src/conductor/src/engine/daemon-work-source.ts — surface waiting/blocked counts to the hook layer
- src/conductor/test/daemon-tick-snapshot.test.ts — new

**Dependencies:** none

### Task 10: Track first-seen time per spec for backlog age
**Story:** Story 3 (oldest eligible age; specs with no determinable timestamp are excluded from age but counted)
**Type:** happy-path

**Steps:**
1. Write failing test: on first discovery of slug S a `.daemon/first-seen/S` marker is written with the current epoch ms; a later discovery does not rewrite it; `oldestAgeSeconds(state)` returns now minus the oldest marker among that state's members; a member with no marker (unreadable or absent) is excluded from the age and still counted
2. Verify test fails (RED)
3. Implement: `first-seen-marker.ts` with `recordFirstSeen(mainRoot, slug)` (write-if-absent, tmp+rename) and `readFirstSeen(mainRoot, slug)`; call `recordFirstSeen` from the discovery hook layer for every discovered slug; compute `oldestAgeSeconds` per state in the snapshot builder
4. Verify test passes (GREEN)
5. Commit with message: "Record first-seen time per spec under .daemon/first-seen for backlog age"

**Done when:**
- A test asserts the marker is created once and not rewritten on repeat discovery
- A test asserts `oldestAgeSeconds.eligible` equals the age of the oldest eligible member's marker within 1 s
- A test asserts a member with an unreadable marker is excluded from the age while `counts.eligible` still includes it
- The marker write never throws (an unwritable `.daemon/` logs once and discovery proceeds)

**Files likely touched:**
- src/conductor/src/engine/first-seen-marker.ts — new
- src/conductor/src/engine/daemon-work-source.ts — record on discovery, compute ages
- src/conductor/test/first-seen-marker.test.ts — new

**Dependencies:** Task 9

### Task 11: Emit daemon_backlog_snapshot and record the daemon-level gauges
**Story:** Story 3 (backlog per state; oldest age; slots; inflight; poll duration; blocked_reason paused and build_auth_missing; empty state reads 0)
**Type:** happy-path

**Steps:**
1. Write failing test: `DaemonMetricsListener` subscribed to a root bus receives a `daemon_backlog_snapshot` and the exporter shows `conductor.daemon.backlog` with five points (3, 2, 1, 4, 2), `conductor.daemon.backlog.oldest_age{state=eligible}` ≈ 129600, `conductor.daemon.slots` busy=2 free=1, `conductor.daemon.inflight` = 1 for each in-flight slug, `conductor.daemon.poll.duration` one observation of 840, `conductor.daemon.blocked_reason` = 1 for `paused` and 0 for the other three, and `conductor.daemon.up` = 1; a snapshot with all-zero counts still yields five backlog points reading 0
2. Verify test fails (RED)
3. Implement: `src/conductor/src/engine/otel/daemon-metrics-listener.ts` following the `AuditTrailWriter` shape (subscribe to `otelEventTypes()` on the root bus, never throw, detach on stop) with a `daemon_backlog_snapshot` handler calling the Task 5 daemon-level record methods; `wireDaemonOtel` constructs and starts it; in `daemon-cli.ts` the `onTick` hook emits `daemon_backlog_snapshot` on the root bus
4. Verify test passes (GREEN)
5. Commit with message: "DaemonMetricsListener records backlog, age, slots, inflight, blocked_reason, poll duration, and up"

**Done when:**
- A test asserts all five `conductor.daemon.backlog` states are present with the exact counts, and a zero-member state reads 0 rather than being absent
- A test asserts `oldest_age`, `slots`, `inflight`, `poll.duration`, and `up` data points match the snapshot payload
- A test asserts `blocked_reason` reads 1 for `paused` and 0 for `build_auth_missing`, `gh_version`, `episode_active`, and a second snapshot with `build_auth_missing` true flips those values
- `conductor.daemon.up` is a synchronous Gauge recorded once per snapshot, not an observable callback (asserted by instrument type on the exporter)

**Files likely touched:**
- src/conductor/src/engine/otel/daemon-metrics-listener.ts — new
- src/conductor/src/engine/otel/wire.ts — construct/start/stop the listener
- src/conductor/src/daemon-cli.ts — onTick emits the snapshot event
- src/conductor/test/daemon-metrics-listener.test.ts — new

**Dependencies:** Task 1, Task 5, Task 7, Task 9, Task 10

### Task 12: An idle daemon exports liveness, backlog, and slot series
**Story:** Story 3 (idle daemon exports up, all five backlog states, slots; hard-kill lets up go stale)
**Type:** happy-path

**Steps:**
1. Write failing test (acceptance): start the daemon loop with OTel enabled, an empty backlog, and no dispatch; after one tick and a forced export, the in-memory exporter holds `conductor.daemon.up` = 1, five `conductor.daemon.backlog` points reading 0, and `conductor.daemon.slots{busy=0, free=concurrency}`; stopping the loop and forcing one more export produces no new `up` observation
2. Verify test fails (RED)
3. Implement: no production code expected beyond Tasks 9–11; fix whatever the idle path exposes
4. Verify test passes (GREEN)
5. Commit with message: "Acceptance: an idle daemon exports up, backlog, and slots without a dispatch"

**Done when:**
- An acceptance test with no dispatch asserts `conductor.daemon.up` = 1, five backlog points reading 0, and both slot states are exported after one tick
- The same test asserts no `up` observation is recorded after the loop stops, so the series goes stale when the daemon dies
- The test runs against the real daemon loop entry (not the listener in isolation)

**Files likely touched:**
- src/conductor/test/acceptance/idle-daemon-metrics.acceptance.test.ts — new

**Dependencies:** Task 11

### Task 13: Classify dispatch kind and count feature dispatches
**Story:** Story 4 (initial dispatch; rekick after HALT clear; resume of an existing un-halted worktree)
**Type:** happy-path

**Steps:**
1. Write failing test: dispatching a slug with no existing worktree emits `feature_dispatch_started{kind: 'initial'}`; dispatching a slug whose worktree exists and whose HALT was just cleared (the `.pipeline/REKICK` sentinel or a `HALT.cleared` cause present) emits `kind: 'rekick'`; dispatching a slug whose worktree exists with no halt-clear signal emits `kind: 'resume'`; the listener records `conductor.feature.dispatches{feature, kind}` = 1 for each
2. Verify test fails (RED)
3. Implement: `createWorktree` (or the runner's call site) surfaces `wasExisting`; `classifyDispatchKind({ wasExisting, rekickSignal })` returns the closed union; `daemon-runner.ts` emits `feature_dispatch_started` on the root bus at the dispatch site; `DaemonMetricsListener` handles it
4. Verify test passes (GREEN)
5. Commit with message: "Emit feature_dispatch_started with initial/resume/rekick and count feature.dispatches"

**Done when:**
- Tests assert `kind` is `initial`, `rekick`, and `resume` for the three fixtures above
- A test asserts `conductor.feature.dispatches{feature=S, kind}` increments by 1 per dispatch and carries `project`, `worker`, `feature`
- `feature_dispatch_started` is emitted from the daemon dispatch path (asserted on the root bus in a runner test), not from inside the conductor

**Files likely touched:**
- src/conductor/src/engine/worktree.ts — wasExisting
- src/conductor/src/engine/daemon-runner.ts — classify and emit
- src/conductor/src/engine/otel/daemon-metrics-listener.ts — handler
- src/conductor/test/daemon-dispatch-kind.test.ts — new

**Dependencies:** Task 11

### Task 14: Count halts by sidecar classification and halting step
**Story:** Story 4 (halt with needs-human at build_review; missing/unreadable/unknown sidecar; legacy; kickback-cap and over-scope verbatim; record write failure still counts)
**Type:** happy-path

**Steps:**
1. Write failing test: `readHaltSidecarClassification(worktree)` returns each of the eight values for a sidecar holding it, `legacy` for a pre-sidecar HALT (HALT present, no HALT.class, legacy marker semantics as `readHaltClass` defines), and `unclassified` for missing, unreadable, or unknown content; at dispatch end for a halted feature the daemon emits the halt classification alongside the `loop_halt` step onto the root bus and `conductor.feature.halts{feature=S, haltClass, step=build_review}` reads 1; when `halt_record_written` fails but `loop_halt` was emitted, the counter still increments
2. Verify test fails (RED)
3. Implement: `readHaltSidecarClassification` in `halt-marker.ts` (a sibling of `readHaltClass`; `readHaltClass` and re-kick behavior unchanged); in `daemon-runner.ts` at the halted-dispatch end read the classification and emit it on the root bus as an additive optional `sidecarClass` field on the forwarded `loop_halt` (or a daemon-side wrapper event carrying `{ slug, haltClass, step }`); listener records `conductor.feature.halts`
4. Verify test passes (GREEN)
5. Commit with message: "Count feature halts by the eight sidecar classification values and halting step"

**Done when:**
- A test covers all eight sidecar values on `conductor.feature.halts`, plus `legacy` and `unclassified` derivations, with no free-text value possible (closed union asserted by type test)
- A test asserts `kickback-cap` and `over-scope` are recorded verbatim, not folded to `unclassified`
- A test asserts a halt still increments the counter when the halt-record write fails
- `readHaltClass` behavior and the re-kick sweep tests are unchanged

**Files likely touched:**
- src/conductor/src/engine/halt-marker.ts — readHaltSidecarClassification
- src/conductor/src/engine/daemon-runner.ts — read and emit at halted dispatch end
- src/conductor/src/engine/otel/daemon-metrics-listener.ts — handler
- src/conductor/test/halt-sidecar-classification.test.ts — new

**Dependencies:** Task 11

### Task 15: Emit feature_shipped and count ships; parked features count as neither
**Story:** Story 4 (ship increments feature.shipped; parked feature increments neither halts nor shipped)
**Type:** happy-path

**Steps:**
1. Write failing test: on the daemon's happy-ship branch the root bus receives `feature_shipped{ slug: S, runStartedAt, active }` where `runStartedAt` comes from `readState` of the worktree's `conduct-state.json` and `active` from `computeTimingRollup`; `conductor.feature.shipped{feature=S}` reads 1; an operator-parked feature appears in `backlog{state=parked}` and increments neither `feature.halts` nor `feature.shipped`
2. Verify test fails (RED)
3. Implement: in `daemon-runner.ts`'s ship branch (worktree still present) read state and rollup, emit `feature_shipped` on the root bus; listener records `conductor.feature.shipped`
4. Verify test passes (GREEN)
5. Commit with message: "Emit feature_shipped with run start and active rollup; count feature.shipped"

**Done when:**
- A test asserts `feature_shipped` is emitted on the root bus with `runStartedAt` equal to the worktree state's `run_started_at` and `active.state` equal to the rollup state
- A test asserts `conductor.feature.shipped{feature=S}` reads 1 after the ship branch
- A test asserts a parked feature is present in `conductor.daemon.backlog{state=parked}` and absent from `feature.halts` and `feature.shipped`

**Files likely touched:**
- src/conductor/src/engine/daemon-runner.ts — ship-branch emission
- src/conductor/src/engine/otel/daemon-metrics-listener.ts — handler
- src/conductor/test/daemon-feature-shipped.test.ts — new

**Dependencies:** Task 11

### Task 16: Record wall and active feature durations with absence-not-zero
**Story:** Story 6 (wall from first dispatch to ship; active from exact rollup; wall exceeds active across a halt; partial/unavailable omits active; missing run_started_at omits wall; halt records neither)
**Type:** happy-path

**Steps:**
1. Write failing test: a `feature_shipped` with `runStartedAt=T0` at ship time `T1` and `active={state:'exact', activeMs:A}` yields one `conductor.feature.duration.wall{feature=S}` observation of `T1-T0` and one `conductor.feature.duration.active` observation of `A`; with `active.state='partial'` the active histogram has no observation and wall still has one; with `runStartedAt` absent the wall histogram has no observation and `feature.shipped` still increments; a halted terminal yields no observation on either
2. Verify test fails (RED)
3. Implement: listener's `feature_shipped` handler records wall only when `runStartedAt` is a finite number and active only when `state==='exact'`; halts never touch the duration histograms
4. Verify test passes (GREEN)
5. Commit with message: "Record feature.duration.wall and .active; omit, never fabricate, on partial or missing data"

**Done when:**
- A test asserts one wall observation equal to ship time minus `runStartedAt` and one active observation equal to `activeMs` for an exact rollup
- A test asserts a partial rollup yields zero active observations (count 0, not a 0-valued point) while wall is recorded
- A test asserts a missing `runStartedAt` yields zero wall observations while `feature.shipped` increments
- A test asserts a halted terminal leaves both histograms with zero observations
- A test with a two-day gap between dispatches asserts wall minus active is at least 172800000 ms

**Files likely touched:**
- src/conductor/src/engine/otel/daemon-metrics-listener.ts — duration handling
- src/conductor/test/feature-duration-metrics.test.ts — new

**Dependencies:** Task 15

### Task 17: Forwarded per-feature events reach the daemon listener exactly once
**Story:** Story 5 (forwarded verdict counted once); Story 7 (forwarded event persisted once, in the feature ledger only)
**Type:** infrastructure

**Steps:**
1. Write failing test: with a feature `ForwardingEventEmitter` attached to the root bus, emitting one `gate_verdict` on the feature bus results in exactly one `conductor.gate.verdicts` data point with value 1 (the listener sees the forwarded copy once and the per-dispatch visualizer does not also record it); the same holds for `kickback`, `loop_halt`, `build_stall`, and `feature_complete`
2. Verify test fails (RED)
3. Implement: confirm `ForwardingEventEmitter` forwards these types (they are in its forwarded set today — if not, add them); the per-dispatch visualizer's `handleEvent` records only span-side effects for these five types under the daemon (metric recording for them lives in the listener); the listener ignores non-forwarded duplicates by identity if any path double-delivers
4. Verify test passes (GREEN)
5. Commit with message: "Forwarded gate, kickback, halt, stall, and complete events are counted once by the daemon listener"

**Done when:**
- A test asserts one feature-bus `gate_verdict` yields exactly one `conductor.gate.verdicts` point with value 1
- The same assertion holds for `kickback`, `loop_halt`, `build_stall`, and `feature_complete` (one test per type or a table test naming each)
- The Task 2 ledger test still shows the forwarded event once in the feature ledger and never in the daemon ledger

**Files likely touched:**
- src/conductor/src/engine/event-persister.ts — forwarded set (if extended)
- src/conductor/src/engine/otel/otel-visualizer.ts — no metric recording for the five types when a shared recorder is injected
- src/conductor/src/engine/otel/daemon-metrics-listener.ts — dedupe guard
- src/conductor/test/daemon-forwarded-events-once.test.ts — new

**Dependencies:** Task 11

### Task 18: Count gate verdicts, kickbacks, and stalls
**Story:** Story 5 (pass; fail plus kickback routing; stall by reason; unknown step name verbatim; three fails read 3)
**Type:** happy-path

**Steps:**
1. Write failing test: a forwarded `gate_verdict{step:'build_review', satisfied:true}` yields `conductor.gate.verdicts{feature=S, step=build_review, outcome=pass}` = 1; `satisfied:false` plus `kickback{from:'build_review', to:'build'}` yields `outcome=fail` = 1 and `conductor.gate.kickbacks{feature=S, from=build_review, to=build}` = 1; `build_stall{reason:'no_task_progress'}` yields `conductor.daemon.stalls{feature=S, reason=no_task_progress}` = 1; a verdict with step `some_future_step` records that step name verbatim without error; three consecutive fails read 3
2. Verify test fails (RED)
3. Implement: listener handlers for `gate_verdict`, `kickback`, `build_stall` calling the Task 5 record methods with the feature taken from the forwarded event's feature tag
4. Verify test passes (GREEN)
5. Commit with message: "Count gate.verdicts, gate.kickbacks, and daemon.stalls from forwarded events"

**Done when:**
- Tests assert the exact attribute sets and values for pass, fail-plus-kickback, and stall above
- A test asserts an unknown step name is carried verbatim on the `step` attribute with no thrown error
- A test asserts three fails for one gate in one dispatch read `outcome=fail` = 3

**Files likely touched:**
- src/conductor/src/engine/otel/daemon-metrics-listener.ts — handlers
- src/conductor/test/gate-metrics.test.ts — new

**Dependencies:** Task 17

### Task 19: Interactive visualizer handles the three new event types and coverage is enforced
**Story:** Story 7 (sink row with otel true but no handler case fails the coverage test); Story 8 (interactive path unchanged, own meter shut down on stop)
**Type:** infrastructure

**Steps:**
1. Write failing test: the handler-coverage test (the mechanism that fails naming an `otel: true` type with no `handleEvent` case) fails for the three new types before the cases exist; after implementation, driving each of the three events through an interactive visualizer records the matching instrument; an interactive run's metric Resource carries `service.instance.id = P/W` and per-feature points still carry `feature`; `stop()` on the interactive visualizer calls `shutdown()` on its own meter exactly once
2. Verify test fails (RED)
3. Implement: add `handleEvent` cases for `daemon_backlog_snapshot`, `feature_dispatch_started`, `feature_shipped` in `otel-visualizer.ts` delegating to the same recorder methods the listener uses (interactive runs will rarely see these, but parity is mechanical)
4. Verify test passes (GREEN)
5. Commit with message: "OtelVisualizer handles the three daemon event types; interactive path parity"

**Done when:**
- The handler-coverage test names any `otel: true` event type lacking a `handleEvent` case and passes with all three new cases present
- A test asserts each new event type recorded through the interactive visualizer yields its named instrument's data point
- A test asserts the interactive metric Resource is `P/W` and per-feature points carry `feature`, and `shutdown()` is called exactly once on stop
- `interactive-otel-wiring.test.ts` passes unchanged

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — three cases
- src/conductor/test/engine/otel-visualizer-parity.test.ts — coverage cases
- src/conductor/test/interactive-otel-wiring.test.ts — resource and shutdown assertions

**Dependencies:** Task 6, Task 11

## Task Dependency Graph

```text
1 ──► 2
1, 5, 7, 9, 10 ──► 11 ──► 12
3 ──► 4 ─┐                ├──► 13, 14, 15 ──► 16
3 ──► 5 ──► 6 ──► 7 ──► 8 ├──► 17 ──► 18
9 ──► 10                  └──► 19 (also needs 6)
```

Independent starts: Tasks 1, 3, 9. Task 8 (monotonic counters) needs only the meter chain (3→5→6→7).

## Integration Points

- After Task 7: a daemon with OTel enabled exports the existing instruments through one meter; per-dispatch visualizers still export spans.
- After Task 12: an idle daemon exports `up`, `backlog`, `slots` — the first end-to-end proof of the issue's "no dispatch required" outcome.
- After Task 18: every intake outcome is exportable; the Grafana halt/retry panels read true counts with no query change.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given OTel is enabled and one daemon process dispatches feature S, which halts, is re-kicked, and halts again, when metrics are exported after the second dispatch, then conductor.run.outcomes{feature=S, outcome=halted} reads 2 and never reads 1 in between | 8 | "reads 2 after two halting dispatches under one daemon" | diff-local |
| Story 1 happy: Given one daemon process dispatches feature S twice and each dispatch retries the build step once, when metrics are exported after the second dispatch, then conductor.step.retries{feature=S, step=build} reads 2, monotonic across both dispatches | 8 | "`conductor.step.retries` for the feature is 2 after two single-retry dispatches" | diff-local |
| Story 1 happy: Given OTel is enabled, when the daemon starts, then exactly one MeterProvider exists for the daemon's lifetime and both dispatches of Story 1's feature record onto it | 7 | "one `MeterProvider` is constructed per daemon start and two dispatches receive the same recorder instance" | diff-local |
| Story 1 negative: Given feature A's dispatch stops while feature B is still running under the same daemon, when A's per-dispatch visualizer stops, then the shared meter is force-flushed (so A's final data points are exported before the daemon could die) but not shut down, and B's next step still exports conductor.step.duration{feature=B} | 6 | "an injected `MeterProvider` receives `forceFlush()` and zero `shutdown()` calls" | diff-local |
| Story 1 negative: Given the daemon process itself restarts, when metrics resume, then counters restart from zero exactly once (an ordinary process restart) and the exported series carries the same identity so backend rate functions treat it as a counter reset, not a new series | 8 | "identical series identity attribute set with counters restarting from zero exactly once" | diff-local |
| Story 1 negative: Given OTel is disabled or the otel config block is absent, when the daemon starts and dispatches a feature, then no MeterProvider is constructed, no recorder is passed to the dispatch, and daemon behavior is byte-for-byte unchanged from today | 7 | "disabled or absent OTel config constructs no `MeterProvider` and passes no recorder to `beginFeatureRun`" | diff-local |
| Story 2 happy: Given project P and a worker whose resolved name is W, when the daemon exports metrics, then the metric Resource carries service.name=ai-conductor, service.instance.id=P/W, conductor.project, conductor.worker=W, and host.name equal to the OS hostname | 4 | "`service.instance.id === 'P/W'` and `host.name` present" | diff-local |
| Story 2 happy: Given a per-feature instrument such as conductor.step.duration for feature S, when it is exported, then its data point carries project=P, worker=W, and feature=S as attributes | 5 | "a per-feature data point carries exactly `project`, `worker`, `feature` plus the instrument's own attributes" | diff-local |
| Story 2 happy: Given a daemon-level instrument such as conductor.daemon.backlog, when it is exported, then its data point carries project=P and worker=W and no feature attribute | 5 | "a daemon-level data point carries `project` and `worker` and has no `feature` key" | diff-local |
| Story 2 happy: Given otel.worker_name is set to a non-blank value in .ai-conductor/config.yml, when the daemon exports, then W is that trimmed value; given it is absent or blank, then W is the OS hostname | 3 | "the resolved worker is the trimmed value, the hostname, the hostname, and `unknown` respectively" | diff-local |
| Story 2 negative: Given the shared meter serves many features, when the metric Resource is inspected, then it carries no conductor.feature and no conductor.branch attribute (asserted on the exported Resource, not on data-point attributes) | 4 | "`conductor.feature` and `conductor.branch` are absent from the metric Resource and present on the trace Resource" | diff-local |
| Story 2 negative: Given a per-dispatch visualizer exports spans, when the trace Resource is inspected, then it still carries conductor.feature, conductor.branch, conductor.run.id, and conductor.engine.version, unchanged from today | 4 | "`conductor.feature` and `conductor.branch` are absent from the metric Resource and present on the trace Resource" | diff-local |
| Story 2 negative: Given os.hostname() throws or returns an empty string, when identity is resolved, then W falls back to the literal unknown and the daemon proceeds without failing | 3 | "an `os.hostname()` that throws" | diff-local |
| Story 3 happy: Given a running daemon with an empty backlog and no dispatch in flight, when a metrics export occurs, then conductor.daemon.up reads 1 and conductor.daemon.backlog{state} has a data point for each of eligible, waiting, blocked, gated, and parked (each 0) | 12 | "asserts `conductor.daemon.up` = 1, five backlog points reading 0, and both slot states are exported after one tick" | diff-local |
| Story 3 happy: Given discovery finds 3 eligible, 2 waiting, 1 blocked, 4 gated specs and 2 operator-parked features, when the tick's snapshot is exported, then conductor.daemon.backlog reads 3, 2, 1, 4, 2 for those states respectively | 11 | "all five `conductor.daemon.backlog` states are present with the exact counts" | diff-local |
| Story 3 happy: Given the oldest eligible spec became eligible 36 hours ago, when the snapshot is exported, then conductor.daemon.backlog.oldest_age{state=eligible} reads approximately 129600 seconds | 11 | "`oldest_age`, `slots`, `inflight`, `poll.duration`, and `up` data points match the snapshot payload" | diff-local |
| Story 3 happy: Given daemon concurrency is 3 and 2 features are in flight, when the snapshot is exported, then conductor.daemon.slots{state=busy} reads 2, conductor.daemon.slots{state=free} reads 1, and conductor.daemon.inflight{feature} reads 1 for each of the two in-flight slugs | 11 | "`oldest_age`, `slots`, `inflight`, `poll.duration`, and `up` data points match the snapshot payload" | diff-local |
| Story 3 happy: Given a discovery pass took 840 ms, when the snapshot is exported, then conductor.daemon.poll.duration has one observation of 840 ms | 9 | "`pollDurationMs` equals the measured discovery duration within 50 ms of a fake clock" | diff-local |
| Story 3 negative: Given the daemon is paused, when the snapshot is exported, then conductor.daemon.blocked_reason{reason=paused} reads 1 and the other three reasons read 0, so an idle-because-paused daemon is distinguishable from an idle-because-drained one | 11 | "`blocked_reason` reads 1 for `paused` and 0 for `build_auth_missing`, `gh_version`, `episode_active`" | diff-local |
| Story 3 negative: Given build auth is missing, when the snapshot is exported, then conductor.daemon.blocked_reason{reason=build_auth_missing} reads 1 | 11 | "a second snapshot with `build_auth_missing` true flips those values" | diff-local |
| Story 3 negative: Given the daemon is hard-killed, when the backend's next scrape interval passes, then conductor.daemon.up stops being reported (the series goes stale) rather than continuing to read 1 | 12 | "no `up` observation is recorded after the loop stops, so the series goes stale when the daemon dies" | diff-local |
| Story 3 negative: Given a backlog state has no members, when the snapshot is exported, then that state's data point reads 0 rather than being absent, so dashboards never show a gap for an empty state | 11 | "a zero-member state reads 0 rather than being absent" | diff-local |
| Story 3 negative: Given the backlog contains an eligible spec whose eligibility timestamp cannot be determined, when oldest_age is computed, then that spec is excluded from the age and the count still includes it | 10 | "a member with an unreadable marker is excluded from the age while `counts.eligible` still includes it" | diff-local |
| Story 4 happy: Given the daemon dispatches feature S for the first time, when the dispatch begins, then conductor.feature.dispatches{feature=S, kind=initial} increments by 1 | 13 | "`kind` is `initial`, `rekick`, and `resume` for the three fixtures above" | diff-local |
| Story 4 happy: Given feature S halts with class needs-human at step build_review and a halt record is written, when metrics are exported, then conductor.feature.halts{feature=S, haltClass=needs-human, step=build_review} reads 1 | 14 | "A test covers all eight sidecar values on `conductor.feature.halts`" | diff-local |
| Story 4 happy: Given the operator clears S's HALT and the daemon re-dispatches it, when the dispatch begins, then conductor.feature.dispatches{feature=S, kind=rekick} increments by 1 | 13 | "`kind` is `initial`, `rekick`, and `resume` for the three fixtures above" | diff-local |
| Story 4 happy: Given feature S ships, when the shipped record is landed, then conductor.feature.shipped{feature=S} increments by 1 | 15 | "`conductor.feature.shipped{feature=S}` reads 1 after the ship branch" | diff-local |
| Story 4 negative: Given a halt whose HALT.class sidecar is missing, unreadable, or holds an unrecognized value, when it is recorded, then haltClass carries the existing disposition value unclassified, never an invented label and never an empty string | 14 | "plus `legacy` and `unclassified` derivations" | diff-local |
| Story 4 negative: Given a halt from a build older than the class sidecar, when it is recorded, then haltClass carries the existing disposition value legacy | 14 | "plus `legacy` and `unclassified` derivations" | diff-local |
| Story 4 negative: Given a halt whose sidecar holds kickback-cap or over-scope (the two operator-owned classes the conductor writes beyond the base HaltClass union), when it is recorded, then haltClass carries that value verbatim rather than folding it to unclassified, so operator-attention halts are never miscounted as unknown | 14 | "`kickback-cap` and `over-scope` are recorded verbatim, not folded to `unclassified`" | diff-local |
| Story 4 negative: Given a feature is operator-parked, when metrics are exported, then it appears in conductor.daemon.backlog{state=parked} and increments neither conductor.feature.halts nor conductor.feature.shipped | 15 | "a parked feature is present in `conductor.daemon.backlog{state=parked}` and absent from `feature.halts` and `feature.shipped`" | diff-local |
| Story 4 negative: Given the daemon resumes a feature whose worktree already exists and which was not halted, when the dispatch begins, then kind is resume, not initial and not rekick | 13 | "`kind` is `initial`, `rekick`, and `resume` for the three fixtures above" | diff-local |
| Story 4 negative: Given the halt record write fails after the HALT marker was written, when metrics are exported, then conductor.feature.halts still increments from the loop_halt event and the metrics handler does not throw | 14 | "a halt still increments the counter when the halt-record write fails" | diff-local |
| Story 5 happy: Given gate build_review passes for feature S, when the verdict event is emitted, then conductor.gate.verdicts{feature=S, step=build_review, outcome=pass} increments by 1 | 18 | "the exact attribute sets and values for pass, fail-plus-kickback, and stall above" | diff-local |
| Story 5 happy: Given gate build_review fails for feature S and routes work back to build, when the events are emitted, then conductor.gate.verdicts{feature=S, step=build_review, outcome=fail} increments by 1 and conductor.gate.kickbacks{feature=S, from=build_review, to=build} increments by 1 | 18 | "the exact attribute sets and values for pass, fail-plus-kickback, and stall above" | diff-local |
| Story 5 happy: Given a build stalls with reason no_task_progress, when the stall event is emitted, then conductor.daemon.stalls{feature=S, reason=no_task_progress} increments by 1 | 18 | "the exact attribute sets and values for pass, fail-plus-kickback, and stall above" | diff-local |
| Story 5 negative: Given a gate verdict is emitted on the feature bus during a daemon dispatch, when it reaches the daemon-level listener, then it is counted exactly once (the forwarded copy is counted, the original is not double-counted) | 17 | "one feature-bus `gate_verdict` yields exactly one `conductor.gate.verdicts` point with value 1" | diff-local |
| Story 5 negative: Given a gate verdict for a step name outside the known gate set, when it is recorded, then the step attribute carries the step name verbatim and no error is raised | 18 | "an unknown step name is carried verbatim on the `step` attribute with no thrown error" | diff-local |
| Story 5 negative: Given the same gate fails three times in one dispatch, when metrics are exported, then verdicts{outcome=fail} reads 3, not 1 | 18 | "three fails for one gate in one dispatch read `outcome=fail` = 3" | diff-local |
| Story 6 happy: Given feature S was first dispatched at T0 and ships at T1, when the ship is recorded, then conductor.feature.duration.wall{feature=S} has one observation of T1 minus T0 in milliseconds | 16 | "one wall observation equal to ship time minus `runStartedAt` and one active observation equal to `activeMs` for an exact rollup" | diff-local |
| Story 6 happy: Given feature S's timing rollup reports an exact active total of A ms, when the ship is recorded, then conductor.feature.duration.active{feature=S} has one observation of A | 16 | "one wall observation equal to ship time minus `runStartedAt` and one active observation equal to `activeMs` for an exact rollup" | diff-local |
| Story 6 happy: Given S halted for two days between two dispatches, when both durations are recorded, then wall exceeds active by at least those two days | 16 | "wall minus active is at least 172800000 ms" | diff-local |
| Story 6 negative: Given the timing rollup reports state partial or unavailable, when the ship is recorded, then conductor.feature.duration.active has no data point for S (absent, never zero or a fabricated total) and conductor.feature.duration.wall is still recorded | 16 | "a partial rollup yields zero active observations (count 0, not a 0-valued point) while wall is recorded" | diff-local |
| Story 6 negative: Given the worktree's conduct-state has no run_started_at, when the ship is recorded, then conductor.feature.duration.wall has no data point for S and the ship counter still increments | 16 | "a missing `runStartedAt` yields zero wall observations while `feature.shipped` increments" | diff-local |
| Story 6 negative: Given a feature terminates by halt rather than ship, when the terminal is recorded, then neither duration histogram gains an observation | 16 | "a halted terminal leaves both histograms with zero observations" | diff-local |
| Story 7 happy: Given the daemon completes a discovery tick, when the snapshot is emitted, then a daemon_backlog_snapshot event is appended to the daemon ledger at .daemon/events.jsonl in the same schema as .pipeline/events.jsonl | 2 | "a root-bus snapshot event appears exactly once in `.daemon/events.jsonl` in the same JSON schema as `.pipeline/events.jsonl`" | diff-local |
| Story 7 happy: Given the daemon dispatches or ships a feature, when the lifecycle point is reached, then feature_dispatch_started and feature_shipped events are emitted on the daemon bus and appended to the daemon ledger | 15 | "`feature_shipped` is emitted on the root bus with `runStartedAt` equal to the worktree state's `run_started_at`" | diff-local |
| Story 7 happy: Given the three new event types exist, when the event-sink registry is compiled, then each has a sink declaration row with otel true and the OTel subscription list derived from the registry includes them | 1 | "`otelEventTypes()` and `persistedEventTypes()` each contain the three new type names" | diff-local |
| Story 7 negative: Given a gate_verdict is emitted on a feature bus and forwarded to the daemon bus, when both ledgers are read, then the event appears once in that feature's .pipeline/events.jsonl and zero times in .daemon/events.jsonl | 2 | "a forwarded gate_verdict appears once in the feature ledger and zero times in the daemon ledger" | diff-local |
| Story 7 negative: Given a new event type is added to the union without a sink row, when the project compiles, then compilation fails naming the missing row | 1 | "a union member without an EVENT_SINKS row fails compilation" | diff-local |
| Story 7 negative: Given a new event type has a sink row with otel true but no handler case, when the daemon-path handler coverage test runs, then it fails naming the unhandled type | 19 | "names any `otel: true` event type lacking a `handleEvent` case" | diff-local |
| Story 7 negative: Given the daemon ledger's directory is unwritable, when a snapshot is emitted, then the daemon logs the write failure once, the metrics are still recorded, and the loop continues | 2 | "one logged failure line, no throw, and the emitter still delivers the event to other subscribers" | diff-local |
| Story 8 happy: Given OTel is enabled and conduct runs interactively, when the run completes, then one visualizer constructs its own MeterProvider and TracerProvider, exports the existing instruments, and shuts both providers down on stop | 19 | "`shutdown()` is called exactly once on stop" | diff-local |
| Story 8 happy: Given the interactive path, when the metric Resource is inspected, then service.instance.id is P/W with W resolved exactly as in Story 2 and per-feature data points still carry feature | 19 | "the interactive metric Resource is `P/W` and per-feature points carry `feature`" | diff-local |
| Story 8 negative: Given the interactive path receives no shared recorder, when the visualizer initializes, then it constructs its own meter rather than throwing on the absent handle | 6 | "a visualizer constructed with no recorder in context initializes without throwing and exports the existing instruments" | diff-local |
| Story 8 negative: Given the interactive visualizer owns its meter, when stop() runs, then meterProvider.shutdown() is called exactly once (the ownership flag does not suppress it) | 6 | "a self-built `MeterProvider` receives exactly one `shutdown()` on stop" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | The exporter remains a bus listener; the daemon-level listener subscribes via `otelEventTypes()` and modifies no emission site of existing events |
| adr-014-otel-observability-exporter#D2 | no-change | none | The `visualizer:otel` plugin packaging is untouched; the daemon-level listener is constructed by the shared wiring helper, not registered as a new plugin kind |
| adr-014-otel-observability-exporter#D3 | existing | none | Registry-driven visualizer selection and the `start(emitter, context)` seam shipped in #1516 and #1934 (`src/conductor/src/engine/otel/wire.ts`, `plugin-loader.ts` `visualizer:otel` factory) |
| adr-014-otel-observability-exporter#D4 | task | task-9, task-11 | A test asserts the hook performs no filesystem or git call (spied `fs`/`execFile` receive zero calls from inside `onTick`) |
| adr-014-otel-observability-exporter#D5 | task | task-2 | A test with an unwritable `.daemon/` asserts one logged failure line, no throw, and the emitter still delivers the event to other subscribers |
| adr-014-otel-observability-exporter#D6 | existing | none | Dual transport under `otel:` is unchanged; `wireDaemonOtel` reuses `buildExporters` from `transport.ts` |
| adr-014-otel-observability-exporter#D7 | task | task-6, task-7, task-8 | A test asserts one `MeterProvider` is constructed per daemon start and two dispatches receive the same recorder instance |
| adr-014-otel-observability-exporter#D8 | task | task-4, task-5 | A test asserts the exported metric Resource's exact key set and `service.instance.id === 'P/W'` and `host.name` present |
| adr-014-otel-observability-exporter#D9 | task | task-1, task-2, task-11, task-14, task-16, task-17 | A test asserts a forwarded gate_verdict appears once in the feature ledger and zero times in the daemon ledger |

## Verification

- [ ] All happy path criteria covered by at least one task (see Coverage Check)
- [ ] All negative path criteria covered by at least one task (see Coverage Check)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
