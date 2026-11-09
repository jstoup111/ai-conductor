# Implementation Plan: A dispatch's OTel is projected by the engine that emitted its events (#3646)

**Date:** 2026-11-07
**Stories:** .docs/stories/newer-engine-child-events-vanish-from-otel-when-th.md
**Conflict check:** Clean as of 2026-11-07 (one degrading conflict accepted; `.docs/conflicts/2026-11-07-newer-engine-child-events-vanish-from-otel-when-th.md`)

## Summary

A capable child executor, once accepted by its supervisor, projects its own OTel. Its spans come
from its pinned engine's visualizer and go into the shared spool. Its metrics come from its pinned
engine's `MetricsListener`, recording through a brokered `Meter` onto the supervisor's single
long-lived `MeterProvider`. The supervisor stops projecting that child's events but keeps the
dispatch bookkeeping. 11 tasks, single PR, blocked by #3333.

## Technical Approach

- **Baseline.** #3333's merged code: `createExecutorBroker` with the async `close` and the
  `ExecutorFeatureTraceContext` attach hook, `attachChildFeatureOtelVisualizer` in `daemon-cli.ts`,
  and the child-only executor. Tasks name seams by symbol, never by line.
- **Protocol (additive, `EXECUTOR_PROTOCOL_VERSION` unchanged).** `hello.otelProjection: true` is
  the child's capability. The work-order envelope carries `otelProjection: { trace }`, where
  `trace` holds `runId`, `project`, `branch`, `harnessVersion` and optional `sourceRef`. That field
  is the supervisor's acceptance. A new `meter` message kind has two shapes. `op: 'create'` carries
  `{ instrumentId, name, kind, description?, unit?, advice? }`, where `kind` is the closed union
  `counter | upDownCounter | histogram | gauge`. `op: 'record'` carries
  `{ instrumentId, value, attributes }`. Everything is parsed by `parseExecutorMessage`.
- **Brokered meter** (new `src/conductor/src/engine/otel/brokered-meter.ts`). The child side
  provides `createBrokeredMeter(send)`, an OTel `Meter` whose synchronous instruments send
  `meter` messages fire-and-forget, and whose `createObservable*` methods throw. The supervisor
  side provides `createBrokeredInstrumentHost(meter, identity)`, which materializes each `create`
  on the supervisor provider's `Meter` (compatible same-name instruments share storage) and stamps
  `project`, `worker` and `feature` on every record.
- **Child projection** (new `src/conductor/src/engine/otel/child-otel.ts`).
  `startChildOtelProjection` runs `wireOtelVisualizer` with metrics off. It hands that visualizer a
  store-only spool runtime (`createSpoolWriterRuntime`, new in `spool-wiring.ts`) when the spool is
  enabled, and otherwise the same exporters the supervisor builds. It also runs a `MetricsListener`
  (feature name = slug) over a `MetricsRecorder` on the brokered meter. It returns an async
  `stop()` that flushes.
- **Supervisor.** `child-feature-executor.ts` sends the acceptance only when the hello advertises
  the capability and the composition supplies a host. The trace identity comes from
  `buildDispatchTraceIdentity`, which is extracted from `attachChildFeatureOtelVisualizer`. The
  broker skips the supervisor visualizer for an accepted attachment, routes `meter` messages to
  the host, and discards them after close. It registers the slug in an accepted-child set that
  `MetricsListener` consults. The listener skips recording that child's forwarded events, but it
  still marks `feature_complete` and `loop_halt` terminal, and it still records
  `feature_dispatch_started` and `feature_dispatch_ended`.
- **Skewed-pair test seam.** A newer child is simulated by narrowing the supervisor's registry: the
  broker's known-type check and the root listener's subscribed types are injectable, and default to
  `EVENT_SINKS` and `otelEventTypes()`. A fixture removes `gate_verdict` from the supervisor side
  only, so the child still emits and projects it.
- **Local pattern: brokered state service.** Model this on the rate-limit and provider-availability
  brokering in `engine/executor-proxies.ts` / `createExecutorBroker` `request`. Preserve these
  traits: the supervisor is authoritative, child calls keep their synchronous signatures, and
  messages are typed and parsed in `executor-protocol.ts`. Allowed variation: `meter` messages are
  fire-and-forget with no `requestId` and no response.

## Prerequisites

- #3333 is merged (blocked-by). Its broker, attach-hook and child-only executor seams are the baseline.

## Tasks

### Task 1: Executor protocol carries the projection capability, acceptance and meter messages
**Story:** Story 2
**Story:** Story 4
**Type:** infrastructure
**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-protocol.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: extend the `hello` and `work-order` message types with the optional `otelProjection` fields. Add the `meter` kind with the `create` and `record` shapes and a closed instrument-kind union. Validate each in `parseExecutorMessage`, following the existing `effectiveConcurrency` validation pattern.
4. Verify GREEN and commit.

**Done when:**
- [test] `parseExecutorMessage` accepts a `hello` with `otelProjection: true` and a `work-order` with `otelProjection.trace`, and returns both fields unchanged.
- [test] `parseExecutorMessage` returns `malformed` for a `meter` message with an unknown `op`, an instrument kind outside `counter`, `upDownCounter`, `histogram`, `gauge`, a non-numeric `value`, or a non-object `attributes`.
- [test] `EXECUTOR_PROTOCOL_VERSION` is still 1, and a `hello` or `work-order` without `otelProjection` parses as before.

**Files likely touched:**
- src/conductor/src/engine/executor-protocol.ts — message types and parsing
- src/conductor/test/engine/executor-protocol.test.ts — parse tests

**Dependencies:** none

### Task 2: Child-side brokered meter
**Story:** Story 2
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/brokered-meter.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `createBrokeredMeter(send)` in `src/conductor/src/engine/otel/brokered-meter.ts`. It implements the OTel `Meter` API: `createCounter`, `createUpDownCounter`, `createHistogram` (carrying `advice`) and `createGauge` each send one `create` message with a fresh `instrumentId`, and `add` and `record` each send one `record` message. Every `createObservable*` method throws. Sends are synchronous and expect no reply, following the fire-and-forget variation of the brokered-state pattern in `engine/executor-proxies.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] A `MetricsRecorder` built on `createBrokeredMeter` emits one `create` message per instrument, and `record` messages carrying the value and attributes for each recording call.
- [test] Each recording call returns synchronously, with the `send` stub invoked before the call returns, and no response is awaited.
- [test] `createObservableGauge`, `createObservableCounter` and `createObservableUpDownCounter` on the brokered meter throw, and `send` is not invoked for them.

**Files likely touched:**
- src/conductor/src/engine/otel/brokered-meter.ts — new child-side meter
- src/conductor/test/engine/otel/brokered-meter.test.ts — new tests

**Dependencies:** Task 1

### Task 3: Supervisor-side brokered instrument host
**Story:** Story 2
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/brokered-meter.test.ts` for every Done-when check below. Use an SDK `MeterProvider` with an in-memory metric reader.
2. Verify RED.
3. Implement `createBrokeredInstrumentHost(meter, { project, worker })` in the same module. `forDispatch(slug)` returns a handler that materializes `create` messages on `meter` by descriptor, keeps an id-to-instrument map per dispatch, records `record` messages with `project`, `worker` and `feature: slug` overriding any attributes the child sent, and ignores records for unknown ids. `close()` makes later messages no-ops.
4. Verify GREEN and commit.

**Done when:**
- [test] A host-recorded `conductor.step.duration` point and a point recorded by a `MetricsRecorder` on the same meter are collected as one metric stream with two points, not two streams.
- [test] A `record` carrying `project: x`, `worker: y`, `feature: z` is collected with the host's `project` and `worker` and the dispatch slug as `feature`.
- [test] After `close()`, a `create` or `record` message for that dispatch records nothing.

**Files likely touched:**
- src/conductor/src/engine/otel/brokered-meter.ts — host
- src/conductor/test/engine/otel/brokered-meter.test.ts — host tests

**Dependencies:** Task 2

### Task 4: Store-only spool runtime for a non-draining writer
**Story:** Story 1
**Type:** infrastructure
**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/spool-wiring.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `createSpoolWriterRuntime(directory, config)` in `src/conductor/src/engine/otel/spool-wiring.ts`. It returns a runtime whose `store` writes batches, and whose `lease` and `drainer` are absent. Make `wireOtelVisualizer` accept this runtime without starting a lease or drainer.
4. Verify GREEN and commit.

**Done when:**
- [test] A visualizer wired with `createSpoolWriterRuntime` writes an exported span batch as a file under `«spool»/traces/`.
- [test] Wiring with `createSpoolWriterRuntime` creates no lease file and starts no `SpoolDrainer`, which the spy on `SpoolLease.acquire` and `SpoolDrainer.drainUntilStopped` confirms by recording zero calls.

**Files likely touched:**
- src/conductor/src/engine/otel/spool-wiring.ts — writer runtime
- src/conductor/src/engine/otel/wire.ts — accept a runtime without a lease or drainer
- src/conductor/test/engine/otel/spool-wiring.test.ts — tests

**Dependencies:** none

### Task 5: Child OTel projection
**Story:** Story 1
**Story:** Story 5
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/child-otel.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `startChildOtelProjection({ config, trace, engineVersionId, slug, mainRoot, events, sendMeter })` in `src/conductor/src/engine/otel/child-otel.ts`. It runs `wireOtelVisualizer` with `metrics: false`, the trace identity, and the child's `engineVersionId`, using `createSpoolWriterRuntime` when the spool is enabled. It also starts a `MetricsListener` (feature name = slug) over a `MetricsRecorder` on `createBrokeredMeter(sendMeter)`. It returns `stop()`, which stops the listener and stops and flushes the visualizer.
4. Verify GREEN and commit.

**Done when:**
- [test] With `exporter: file`, a `step_started` and `step_completed` pair on the child bus produces a step span in the file exporter's output, the same output `wireOtelVisualizer` produces for that config.
- [test] With the spool enabled and the spool store's write failing, the batch takes the existing direct-send fallback, one bounded `renderer_error` is emitted, and the child bus keeps emitting.
- [test] An event type declared `otel: false` produces no span and no `meter` message, and a type declared `otel: true` with `otelTrace: false` (`feature_shipped`) produces `meter` records and no span.
- [test] `stop()` resolves only after the visualizer's flush resolves.
- [test] With `otel.attributes: { team: core }` configured, every `meter` record the child sends carries `team: core`.

**Files likely touched:**
- src/conductor/src/engine/otel/child-otel.ts — new child projection
- src/conductor/test/engine/otel/child-otel.test.ts — new tests

**Dependencies:** Task 2, Task 4

### Task 6: Supervisor accepts the capability and sends the trace identity
**Story:** Story 4
**Story:** Story 6
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/child-feature-executor.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: extract `buildDispatchTraceIdentity(projectRoot, slug, { harnessVersion, sourceRef })` from `attachChildFeatureOtelVisualizer` (run id from the worktree's `conduct-session-id`, else a fresh id; project; leaf branch; harness version; `sourceRef`). Use it in both places. In `child-feature-executor.ts`, add `otelProjection: { trace }` to the work-order envelope only when the received hello advertised `otelProjection` and the executor deps carry an `acceptOtelProjection` provider.
4. Verify GREEN and commit.

**Done when:**
- [test] A hello with `otelProjection: true` and deps with `acceptOtelProjection` produce a work order whose `otelProjection.trace` carries the worktree's `conduct-session-id` as `runId`, the installed harness version, the leaf branch and the order's `sourceRef`.
- [test] A hello without the capability, or deps without `acceptOtelProjection`, produce a work order with no `otelProjection` field.
- [test] With no feature worktree, `buildDispatchTraceIdentity` returns a fresh run id.
- [test] An accepted dispatch with a protocol-1 hello completes the work-order exchange without emitting `executor_protocol_mismatch`.

**Files likely touched:**
- src/conductor/src/engine/child-feature-executor.ts — acceptance in the work-order envelope
- src/conductor/src/engine/otel/child-otel.ts — `buildDispatchTraceIdentity`
- src/conductor/src/daemon-cli.ts — `attachChildFeatureOtelVisualizer` uses the extracted helper
- src/conductor/test/engine/child-feature-executor.test.ts — tests

**Dependencies:** Task 1

### Task 7: Child advertises, projects on acceptance, and flushes before its outcome
**Story:** Story 4
**Story:** Story 6
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-child.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement in `runExecutorChild`: send `otelProjection: true` in the hello. On a work order carrying `otelProjection`, call `startChildOtelProjection` on the feature bus, sending `meter` messages on the port. Await its `stop()` before `sendOutcome` on the success, skipped, error and stop paths. With no acceptance, start nothing.
4. Verify GREEN and commit.

**Done when:**
- [test] An accepted work order starts the child projection, and the port receives every `meter` message, and the visualizer is stopped and its flush completes, before the `outcome` message is sent.
- [test] When the feature run throws, the child projection's `stop()`, including the visualizer's stop and flush, completes before the `error` outcome is sent.
- [test] A work order without `otelProjection` starts no child visualizer, so no span batch is written, and sends no `meter` message.
- [test] With an accepted child holding an open run span, SIGTERM makes the child visualizer export the root span with `conductor.run.outcome` `terminated` before the child exits.

**Files likely touched:**
- src/conductor/src/engine/executor-child.ts — hello capability, start and stop of the projection
- src/conductor/test/engine/executor-child.test.ts — tests

**Dependencies:** Task 1, Task 5

### Task 8: Broker routes meter messages and skips supervisor projection for accepted children
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-broker.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement in `createExecutorBroker`: add optional deps `instrumentHost`, `acceptedChildren: Set<string>`, and `knownEventTypes` (default: the keys of `EVENT_SINKS`). Before that dispatch's first event is forwarded, `attach` receives whether the attachment is accepted. For an accepted attachment, do not call `attachFeatureOtelVisualizer`, add the slug to `acceptedChildren` (removed at close), and route `meter` messages to `instrumentHost.forDispatch(slug)`. At close, close that dispatch handler so late messages are discarded. Keep the unknown-type drop against `knownEventTypes`.
4. Verify GREEN and commit.

**Done when:**
- [test] An accepted attachment never calls `attachFeatureOtelVisualizer`, and a non-accepted attachment calls it once, as today.
- [test] A `meter` record message on an accepted attachment reaches the host's dispatch handler, and one received after `close()` is discarded.
- [test] A malformed `meter` message is logged as `malformed message` through `deps.log`, and nothing reaches the host.
- [test] An event whose type is outside `knownEventTypes` is neither emitted on the proxy bus nor on the root bus, so it is not rendered or persisted by the supervisor.

**Files likely touched:**
- src/conductor/src/engine/executor-broker.ts — accepted attachments, meter routing, injectable known types
- src/conductor/src/engine/child-feature-executor.ts — pass the acceptance to `attach`
- src/conductor/test/engine/executor-broker.test.ts — tests

**Dependencies:** Task 3, Task 6

### Task 9: Root-bus listener skips accepted children's events but keeps run-close bookkeeping
**Story:** Story 3
**Type:** negative-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/metrics-listener.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: `MetricsListener` accepts an optional `isChildProjected(slug)` predicate. For a forwarded event whose feature is child-projected, it records nothing, except that `feature_complete` and `loop_halt` still add the slug to `terminal`. `feature_dispatch_started` and `feature_dispatch_ended` keep recording for every slug.
4. Verify GREEN and commit.

**Done when:**
- [test] With the predicate true for slug `f`, a forwarded `step_started` and `step_completed` pair for `f` records no `conductor.step.duration` or `conductor.step.outcomes` point.
- [test] With the predicate true, a forwarded `feature_complete` followed by `feature_dispatch_ended` records zero `conductor.run.outcomes` points from the listener, and `feature_dispatch_ended` without a prior terminal event records exactly one.
- [test] With the predicate true, a forwarded `feature_shipped` for `f` records no `conductor.feature.shipped` point, `feature_dispatch_started` still records one `conductor.feature.dispatches` point, and a halted `feature_dispatch_ended` with `haltClass` and `step` records exactly one `conductor.feature.halts` point.

**Files likely touched:**
- src/conductor/src/engine/otel/metrics-listener.ts — predicate and terminal bookkeeping
- src/conductor/test/engine/otel/metrics-listener.test.ts — tests

**Dependencies:** none

### Task 10: Daemon composition wires the host, the accepted set and the listener predicate
**Story:** Story 4
**Type:** infrastructure
**Steps:**
1. Write failing tests in `src/conductor/test/daemon-otel-wiring.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: `wireDaemonOtel` builds one `createBrokeredInstrumentHost` on its provider's meter (with the resolved `project` and `worker`) and an `acceptedChildren` set. It passes `isChildProjected = (slug) => acceptedChildren.has(slug)` to its `MetricsListener`, and returns `instrumentHost` and `acceptedChildren`. In `daemon-cli.ts`, pass both to `createExecutorBroker`, and pass `acceptOtelProjection` to the child executor deps only when `wireDaemonOtel` returned a host. Accept an injectable listener type list for tests (default `otelEventTypes()`).
4. Verify GREEN and commit.

**Done when:**
- [test] With OTel enabled, `wireDaemonOtel` returns an `instrumentHost` bound to its `MeterProvider`, and its listener skips a slug that has been added to the returned `acceptedChildren`.
- [test] With OTel disabled, `runDaemonMode` dispatches a capable in-memory child whose work order carries no `otelProjection`.

**Files likely touched:**
- src/conductor/src/engine/otel/wire.ts — host, accepted set, predicate
- src/conductor/src/daemon-cli.ts — composition into the broker and executor deps
- src/conductor/test/daemon-otel-wiring.test.ts — tests

**Dependencies:** Task 3, Task 8, Task 9

### Task 11: A skewed pair exports every child OTel signal exactly once through the daemon dispatch path
**Story:** Story 1
**Story:** Story 2
**Story:** Story 3
**Story:** Story 4
**Story:** Story 5
**Story:** Story 6
**Type:** happy-path
**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-child-lifecycle.integration.test.ts` for every Done-when check below. Dispatch through the in-memory fork with the spool enabled and an in-memory metric reader on the supervisor provider. The skewed-pair fixture narrows the supervisor's `knownEventTypes` and its listener types to exclude `gate_verdict`, while the child keeps its full registry.
2. Verify RED.
3. Implement any composition gap the tests expose, within Tasks 6–10's files.
4. Verify GREEN and commit.

**Done when:**
- [test] In the accepted skewed pair, the child's `gate_verdict` produces a span batch file under `.daemon/otel-spool/traces/` written by the child and then sent by the supervisor's drainer to the stubbed OTLP endpoint, and a `conductor.gate.verdicts` point exported by the supervisor's `MeterProvider`, while the supervisor neither renders that `gate_verdict` to the daemon log nor persists it to its root ledger, and the child's `.pipeline/events.jsonl` contains it.
- [test] In the accepted pair, one completed step yields exactly one `conductor.step.duration` point and one `conductor.step.outcomes` point, `feature_complete` then `feature_dispatch_ended` yields one `conductor.run.outcomes` point, the supervisor records one `conductor.feature.dispatches` point, and a child `feature_shipped` yields exactly one `conductor.feature.shipped` point.
- [test] For an older child (hello without the capability) and for a capable child under a supervisor without `acceptOtelProjection`, every OTel type the child emits is exported once by the supervisor's projection, and no span batch is written by the child.
- [test] The accepted child's exported trace carries the worktree's `conduct-session-id` as run id, the installed harness version as `service.version`, the child's `engineVersionId` as `conductor.engine.version` and the order's `sourceRef`, and `feature_dispatch_ended` is emitted only after the child's `outcome` message is received, which follows its flush.
- [test] An event type the child declares `otel: false` and the supervisor lacks yields no span batch and no metric point, is not rendered to the daemon log, and is not persisted to the supervisor's root ledger.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — integration tests
- src/conductor/src/engine/child-feature-executor.ts — composition fixes if needed
- src/conductor/src/daemon-cli.ts — composition fixes if needed

**Dependencies:** Task 7, Task 10

## Integration Points

- After Task 8: an accepted in-memory child's meter messages reach a host.
- After Task 11: the full daemon dispatch path is proven for skewed, older-child and non-accepting pairs.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-07-child-projected-dispatch-otel#D1 | task | task-11 | no span batch is written by the child |
| adr-2026-11-07-child-projected-dispatch-otel#D2 | task | task-6 | produce a work order with no `otelProjection` field |
| adr-2026-11-07-child-projected-dispatch-otel#D3 | task | task-5, task-4 | the same output `wireOtelVisualizer` produces for that config |
| adr-2026-11-07-child-projected-dispatch-otel#D4 | task | task-7 | the visualizer is stopped and its flush completes, before the `outcome` message is sent |
| adr-2026-11-07-child-projected-dispatch-otel#D5 | task | task-2 | on the brokered meter throw, and `send` is not invoked for them |
| adr-2026-11-07-child-projected-dispatch-otel#D6 | task | task-3 | is collected with the host's `project` and `worker` and the dispatch slug as `feature` |
| adr-2026-11-07-child-projected-dispatch-otel#D7 | task | task-9 | `feature_dispatch_ended` without a prior terminal event records exactly one |
| adr-2026-11-07-child-projected-dispatch-otel#D8 | task | task-8 | is neither emitted on the proxy bus nor on the root bus |
| adr-2026-11-07-child-projected-dispatch-otel#D9 | no-change | none | A design constraint: Task 1 defines meter traffic as an executor protocol message kind, and no task adds a `ConductorEvent` variant, ledger or sidecar. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D1 | existing | none | The child executor is the only executor after #3333; this feature only adds messages to it. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D2 | existing | none | The WorkOrder pin is unchanged and becomes the child trace's engine version. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D3 | task | task-1 | a `hello` or `work-order` without `otelProjection` parses as before |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D4 | task | task-8 | An accepted attachment never calls `attachFeatureOtelVisualizer` |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D5 | no-change | none | Child lifecycle binding is untouched; the projection stops inside the existing outcome path. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D6 | no-change | none | Engine-store GC pins are unrelated to OTel projection. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D7 | no-change | none | Supervisor restart policy is unchanged; the track excludes it. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D8 | no-change | none | Cadence rebuild is unrelated to OTel projection. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D9 | no-change | none | Per-feature engine-version recording and status are unchanged. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D10 | no-change | none | That ADR's own delivery decision does not govern this spec. |
| adr-014-otel-observability-exporter#D1 | existing | none | The child projection subscribes to its own `ConductorEventEmitter` exactly as the supervisor's does. |
| adr-014-otel-observability-exporter#D2 | existing | none | The child reuses `wireOtelVisualizer` and its `visualizer` plugin packaging. |
| adr-014-otel-observability-exporter#D3 | existing | none | The generic visualizer wiring is reused unchanged in the child. |
| adr-014-otel-observability-exporter#D4 | task | task-2 | Each recording call returns synchronously |
| adr-014-otel-observability-exporter#D5 | task | task-5 | one bounded `renderer_error` is emitted, and the child bus keeps emitting |
| adr-014-otel-observability-exporter#D6 | existing | none | Transport selection is the same resolved `otel:` config, which the child loads through `loadMergedConfig`. |
| adr-014-otel-observability-exporter#D7 | task | task-10 | returns an `instrumentHost` bound to its `MeterProvider` |
| adr-014-otel-observability-exporter#D8 | task | task-3 | is collected with the host's `project` and `worker` and the dispatch slug as `feature` |
| adr-014-otel-observability-exporter#D9 | no-change | none | Daemon-level signals stay supervisor-emitted on the daemon spine. |
| adr-014-otel-observability-exporter#D10 | existing | none | Dispatch dimensions are projected by the same `MetricsListener` code in the child. |
| adr-014-otel-observability-exporter#D11 | no-change | none | No new event type is added; the meter messages are not events. |
| adr-014-otel-observability-exporter#D12 | existing | none | `otel.attributes` reaches the child through the same merged config. |
| adr-014-otel-observability-exporter#D13 | task | task-5 | every `meter` record the child sends carries `team: core` |
| adr-014-otel-observability-exporter#D14 | existing | none | Tier labels come from the events the child listener projects, unchanged. |
| adr-014-otel-observability-exporter#D15 | task | task-4 | writes an exported span batch as a file under `«spool»/traces/` |
| adr-014-otel-observability-exporter#D16 | task | task-4 | creates no lease file and starts no `SpoolDrainer` |
| adr-014-otel-observability-exporter#D17 | no-change | none | Spool health events stay drainer-owned in the supervisor. |
| adr-014-otel-observability-exporter#D18 | existing | none | Provenance is resolved at the emit sites, which run in the child as today. |
| adr-014-otel-observability-exporter#D19 | existing | none | Provenance placement is the visualizer's, reused unchanged in the child. |
| adr-014-otel-observability-exporter#D20 | existing | none | `otel.provenance` toggles reach the child through the same merged config. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
