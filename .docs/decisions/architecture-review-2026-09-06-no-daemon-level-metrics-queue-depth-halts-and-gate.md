# Architecture Review: No daemon-level metrics — queue depth, halts and gate outcomes are events-only

**Date:** 2026-09-06
**Stories reviewed:** none yet (pre-stories full review, Tier L, technical track). Inputs:
`.docs/track/no-daemon-level-metrics-queue-depth-halts-and-gate.md` (scope boundary, binding),
`.docs/complexity/…` (L), `.docs/architecture/no-daemon-level-metrics-queue-depth-halts-and-gate.md`,
`.docs/architecture/sequences/no-daemon-level-metrics-queue-depth-halts-and-gate.md`,
`.memory/decisions/2026-09-06-daemon-owned-meter-for-daemon-level-metrics.md`, intake #1937 and
its two field-note comments.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

Every seam was verified against current source (basis: verified unless noted).

| Seam | Finding | Confidence |
|---|---|---|
| Inject a shared `MetricsRecorder` into `OtelVisualizer` | `initializeProviders` is already guarded on preset providers; add `metricsRecorder?`/`meterProvider?` to `OtelVisualizerContext` and short-circuit. `_doStop` unconditionally calls `meterProvider.shutdown()` — needs an ownership flag. | 85% |
| Thread the recorder through the `visualizer:otel` factory | `VisualizerFactoryContext` has no recorder slot; add one, populate in `registerBuiltins`, pass from `wireOtelVisualizer`. The `start()` context is the wrong layer (per-run identity). | 90% |
| Daemon root bus | `beginFeatureRun` closes over the daemon-wide emitter. The root bus has **no** persister or audit writer; `ForwardingEventEmitter` already forwards feature events to it tagged via a `forwardedFromFeature` WeakSet. Forwarded events cannot be double-persisted; new root-bus events are not persisted at all unless a persister is attached. | 95% |
| Per-tick snapshot from the daemon loop | `DaemonDeps` carries no event emitter, and `deps.discoverBacklog` is narrowed to `BacklogItem[]` before the loop sees it; `waiting/blocked/gated` are handed to `onGatedDiscovered`-style hooks at the wiring layer. A new `onTick`/`onBacklogDiscovered` hook on `DaemonDeps`, called with the in-scope locals (`paused`, `episodeActive`, `buildAuthMissing`, `ghVersionBlocked`, `inFlight.size`, `concurrency`, `claims.listParked()`), is the precedent-following seam. Touches the core loop — the most invasive change in the set. | 65% |
| `feature_shipped` at the ship point | Happy-ship branch in `daemon-runner.ts` has `featureRun.events` in scope and does not tear down the worktree, so `.pipeline/conduct-state.json` (`run_started_at`) is readable there via the state read port. | 90% |
| Dispatch kind (`initial|resume|rekick`) | Three existing signals: `pickEligible`'s durable-HALT re-dispatch branch, worktree pre-existence in `WorktreeManager.create`, and the `.pipeline/REKICK` sentinel / `HALT.cleared` cause. `createWorktree` must surface a `wasExisting` flag or the runner checks `dirExists` first. | 75% |
| `otel.worker_name` | Mirrors the `otel.project_name` chain exactly: config → `resolveOtelConfig` → `ResolvedOtelConfig` → resource. No `os.hostname()` use exists today. | 90% |
| Three new event types | `EVENT_SINKS` is total over the union (compile-forced rows); `otelEventTypes()` auto-derives the subscription; the parity test passes automatically but does not prove `handleEvent` records anything — cases must be added by hand. | 90% |
| Concurrent features on one meter | Prototyped 2026-09-06 against `@opentelemetry/sdk-metrics` 2.10: two recorders on one meter separate gauges and counters by `feature` with no duplicate-instrument warnings. | verified |
| Backend portability of data-point attributes | Prometheus: data-point attrs → labels. Datadog (`docs.datadoghq.com/opentelemetry/mapping/semantic_mapping`): data-point attrs → tags always; resource attrs only with `resource_attributes_as_tags`. Datadog computes deltas from cumulative monotonic sums, which per-dispatch resets corrupt and the daemon-owned meter repairs. | verified (docs) |

**Stack:** no new dependencies. **Prerequisites:** none external. **Integration surface:** `otel/`
(all files), `plugin-loader.ts`, `daemon-cli.ts`, `daemon.ts` loop, `daemon-runner.ts` ship
branch, `daemon-deps.ts`, `event-sinks.ts`, `types/events.ts`, `types/config.ts`, config-key
consumer registry, scaffolder template, docs. Crosses more than three module boundaries — expected
for a Large-tier refactor and the reason for the full review. **Worktree isolation:** unchanged;
the daemon meter is process-scoped, per-feature visualizers stay per-worktree.

## Complexity

**High** (4+ modules, a lifecycle-ownership change, new event variants). Not split: the counter-reset
fix and the daemon-level signals are one mechanism (adr-014 D7); splitting would ship the reset
defect twice. The daemon-loop hook is the only spike-shaped item and is bounded by an existing
precedent (`onGatedDiscovered`).

## Alignment

Repo-wide ADR sweep: 309 `adr-*.md` files read in full (delegated, six batches, no keyword
filter). Governing decisions and how the design honors them:

- **adr-014 (APPROVED, amended 2026-09-06 by this review, D7–D9).** D1/D2/D4/D5/D6 stand. The
  identity clause of the 2026-08-28 amendment conflicted (`<project>/<feature>`); D8 revises it to
  `<project>/<worker>` with the same boundedness argument (instance varies with the worker set, not
  runs) and carries the proof obligation forward. D7 settles meter ownership and the
  `stop()`-must-not-shut-down-a-shared-provider split the sweep flagged. D9 settles the sibling
  ledger and forwarding semantics.
- **adr-2026-07-28-total-halt-classification-legacy-boundary + adr-2026-08-05-build-settle-outcome-stamp D6 (APPROVED).** `HaltClass` is not extended and `HaltDisposition` adds `legacy | unclassified`. The design's earlier `unset` label is withdrawn; `feature.halts{haltClass}` carries `HaltDisposition` verbatim (D9).
- **adr-2026-07-26-event-sink-registry-exhaustiveness (APPROVED).** Three new variants get rows; forwarded events reuse their existing rows unchanged — "not re-persisted on the daemon bus" is enforced by the forwarding tag in the daemon persister, not by mutating a sink row (D9).
- **adr-2026-08-11-halt-events-ride-the-persisted-spine (APPROVED).** Its "hardcoded list" observation is superseded by #1934's `otelEventTypes()` subscription, but `handleEvent`'s switch remains a second routing table — condition C3.
- **adr-2026-08-12-execution-lifecycle-completeness-for-timing + adr-2026-07-29-engine-observed-provider-time-partition (APPROVED).** `feature.duration.active` is omitted, never fabricated, when the rollup is `partial`/`unavailable` (D9) — same absence-not-zero discipline as adr-2026-07-27-cost-unmetered-is-a-first-class-state.
- **adr-2026-08-27-daemon-dispatcher-executor-seam (APPROVED).** Backlog/slots/in-flight are sourced from the dispatcher's existing claims and discovery channels, never a parallel poller; the shared meter is safe under N executors (verified prototype).
- **adr-2026-08-05 blocked-is-a-distinct-state / blocked-classification-after-dedup / worktree-classification-evidence-derived-reasons (APPROVED).** `daemon.backlog{state=blocked}` reads the existing blocked channel; `daemon.blocked_reason{reason}` uses only the four dispatch-blocking flags of the loop, not BLOCKED-spec reasons — the two are different concerns and the instrument name must not conflate them (condition C5).
- **adr-2026-08-23-committed-halt-record (APPROVED).** `halt_record_written` forwarding preserves the non-throwing path — a metrics handler never throws (adr-014 D5).
- **adr-2026-07-27-project-config-scaffolder + adr-2026-08-26-config-key-consumer-registry (APPROVED).** `otel.worker_name` is added to `templates/project-config.yml.template` and gets a `ConsumerDeclaration` in the same diff (condition C4).
- **adr-2026-08-01-conduct-state-mutation-port (APPROVED).** `run_started_at` is read through the state port.
- **adr-2026-07-29-operator-park-scheduling-unit-boundary (APPROVED).** `parked` is its own backlog state; `feature.shipped`/`feature.halts` exclude it.
- **Event spine (`.agents/skills/event-spine`).** Channel? yes — a per-tick snapshot, dispatch-start and ship occurrences. Concern: occurrence. Verdict: extend the union; the daemon ledger is a sibling file in the same schema (exception B). No new channel.

**Pattern basis (focused, local):** the daemon-level `MetricsRecorder` listener follows
`AuditTrailWriter`'s shape — constructed once near the bus, subscribed by derived type list, torn
down with the owning scope. Traits to preserve: subscribe via `EVENT_SINKS`-derived accessor, never
a literal list; handlers never throw; detach on stop. Rediscovery hints: `AuditTrailWriter`,
`auditedEventTypes`, `startFeatureEventPersistence`. Allowed variation: the listener may hold the
recorder rather than a writer. The daemon-loop hook follows `onGatedDiscovered` (`daemon-work-source.ts`, wired in `daemon-cli.ts`).

**Diagram accuracy:** the two feature diagrams were approved by the operator on 2026-09-06 and
match this review; the component diagram's `DaemonMetricsListener` is the `AuditTrailWriter`-shaped
listener above. Condition C6 adds the daemon persister to the component diagram.

**State management / DI defaults:** no new persistent stores; the daemon persister is the existing
`EventPersister` over a real file. No in-memory production defaults.

## Domain Integrity

- `DispatchKind = 'initial' | 'resume' | 'rekick'`, `BacklogState`, `DispatchBlockReason`, and
  `SlotState` are closed unions in `types/events.ts`; no free-text attribute values on any
  instrument.
- `haltClass` attribute type is `HaltDisposition`, not `string`.
- `feature.duration.active` payload carries the rollup `state` as a discriminant; the recorder
  matches exhaustively and records only on `exact`.
- The snapshot event carries counts as numbers computed by discovery, never re-derived by the
  handler (adr-014 D4).

## Wiring Surface

| New production surface | Called from |
|---|---|
| `wireDaemonOtel(config, ctx, rootEvents)` (`otel/wire.ts`) | `daemon-cli.ts` daemon start, before the loop; returns `{ recorder, stop }`; `stop` awaited at daemon shutdown alongside the other teardown |
| Shared recorder on `VisualizerFactoryContext` / `OtelVisualizerContext` | `beginFeatureRun` passes the daemon recorder into `wireOtelVisualizer`; `registerBuiltins` factory forwards it; `initializeProviders` short-circuits meter creation; `_doStop` skips shutdown when not owner |
| `DaemonDeps.onTick(snapshot)` (new hook) | `daemon.ts` loop, once per discovery pass after `pickEligible`, with the in-scope locals; wired in `daemon-cli.ts` to emit `daemon_backlog_snapshot` on the root bus |
| `daemon_backlog_snapshot`, `feature_dispatch_started`, `feature_shipped` variants + `EVENT_SINKS` rows | emitted from the `daemon-cli.ts` hook, `daemon-runner.ts` dispatch site, and `daemon-runner.ts` ship branch respectively |
| Daemon `EventPersister` → `<mainRoot>/.daemon/events.jsonl` | attached to the root bus in `daemon-cli.ts` at daemon start; skips `forwardedFromFeature`-tagged events |
| Daemon-level metrics listener (`otel/daemon-metrics-listener.ts`) | subscribed in `wireDaemonOtel` to `otelEventTypes()`; records the D9 instruments |
| `handleEvent` cases for the three new types | `otel-visualizer.ts` switch, for the interactive path parity |
| `otel.worker_name` config key | `resolveOtelConfig` → `ResolvedOtelConfig.workerName` → `buildResource`; `ConsumerDeclaration` row; scaffolder template row; `docs/reference/configuration.md` row |
| `createWorktree` `wasExisting` (or equivalent) | `daemon-runner.ts` dispatch site to classify `kind` |
| Per-instrument query guidance (`max by (project)` vs `sum`) | `docs/reference/configuration.md` otel section |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A per-feature visualizer `stop()` shuts down the shared meter, killing metrics for every later feature in the daemon | Technical | High (current `_doStop` does this unconditionally) | High | Ownership flag on the visualizer; acceptance test: two sequential dispatches under one daemon, second still exports |
| Backlog gauges double-counted under multiple workers per project | Data | Medium | Medium | Documented `max by (project)` per instrument; `worker` attribute present so the query can be written |
| Daemon-loop hook adds I/O or latency to the tick | Performance | Low | Medium | Hook receives already-computed counts; emission is synchronous in-memory (adr-014 D4); persister write is the existing async `EventPersister` |
| Metric Resource still carries `conductor.feature` from a stale resource builder, minting per-feature `target_info` again | Data | Medium | High | D8 proof obligation: test asserts the exported metric Resource's `service.instance.id` and absence of `conductor.feature` |
| `feature.duration.wall` under-counts after a worktree recreate (#2196 loses `run_started_at`) | Data | Medium | Low | Known; recorded as a limitation in docs; #2196 owns the durable state fix |
| Interactive path behavior drifts while refactoring the visualizer | Technical | Medium | Medium | Existing `interactive-otel-wiring.test.ts` and `daemon-otel-parity` acceptance stay green; no interactive change in scope |
| Datadog/other backends drop resource-only identity | Integration | Low | Low | Identity is on data points (verified against Datadog docs) |

## ADRs Created

None new. **adr-014-otel-observability-exporter** amended (additive blockquote, decisions 7–9,
Status stays APPROVED pending operator approval of the amendment text in this review).

## Conditions

- **C1 — Meter ownership.** The visualizer records who constructed the `MeterProvider`; `stop()`
  shuts it down only when it owns it. An acceptance test runs two sequential feature dispatches
  under one daemon and asserts both export metrics and the counters are monotonic across them.
- **C2 — Resource proof.** A test asserts the exported *metric* Resource directly:
  `service.instance.id = <project>/<worker>`, `host.name` present, `conductor.feature` absent;
  and the *trace* Resource still carries `conductor.feature` and `conductor.run.id`.
- **C3 — Both routing tables.** Each new event type gets an `EVENT_SINKS` row **and** a
  `handleEvent` case; a test drives each new event through the daemon path and asserts the named
  instrument has a data point.
- **C4 — Config key completeness.** `otel.worker_name` lands with its `ConsumerDeclaration`, the
  scaffolder template row, and the `docs/reference/configuration.md` row in the same diff.
- **C5 — Vocabulary fidelity.** `haltClass` = `HaltDisposition` verbatim; `blocked_reason` uses
  only the loop's dispatch-blocking flags (closed union), never BLOCKED-spec reason strings.
- **C6 — Diagram.** Add the daemon `EventPersister` → `.daemon/events.jsonl` node to the component
  diagram before land.
- **C7 — Idle proof.** An acceptance test starts the daemon with an empty backlog and no dispatch
  and asserts `daemon.up`, `daemon.backlog{state}` (all five states) and `daemon.slots` are
  exported.
- **C8 — Absence-not-zero.** `feature.duration.active` is not recorded when the rollup state is
  `partial`/`unavailable`; a test proves the data point is absent, not zero.
