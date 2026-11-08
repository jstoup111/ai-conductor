# ADR: A dispatch's OTel is projected by the engine that emitted its events

**Date:** 2026-11-07
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #3646

## Context

The daemon runs every feature in a child executor that is pinned to the WorkOrder's
`engineVersionId` (adr-2026-10-15-per-dispatch-engine-pinned-executor, #3333). The supervisor
keeps running its boot engine until a natural idle or an age-capped drain (adr-2026-10-15 D7), so
a child is routinely newer than its supervisor.

The child forwards every event type its own registry declares (`executor-child.ts`, the
`EVENT_SINKS` loop). Both supervisor OTel projections are built from the supervisor's registry:

- The span visualizer subscribes to `otelTracedEventTypes()` (`otel-visualizer.ts` `start`).
- `MetricsListener` subscribes to `otelEventTypes()` and holds one handler per type in
  `METRICS_HANDLERS` (`metrics-listener.ts`).

Both are verified in code. The broker also drops every type the supervisor's registry lacks
(`executor-broker.ts`, "preserve unknowns in child ledger only"), as adr-2026-10-15 D4 decided.
Forwarding those types would not help: no supervisor subscriber exists for them, and no projection
code either. A newer child's OTel event types therefore produce no span and no metric. They are
lost silently until the supervisor restarts onto that engine (#3646). The retired in-process
executor never had this gap, because it projected events with the engine that emitted them.

The forces at play:

- One long-lived `MeterProvider` in the supervisor (ADR-014 D7) keeps counters monotonic. Its
  amendment 2026-08-30 (b) adds that per-process cumulative counters cannot aggregate on a shared
  identity.
- The OTLP spool is multi-writer (ADR-014 D15) with a single lease-holding drainer (D16).
- #3333 requires the dispatch trace to carry the worktree's session id, the installed harness
  version, the pinned engine version and `sourceRef`, and to finish flushing before
  `feature_dispatch_ended`.

## Options Considered

### Option A: forward unknown types and report the drop (the filer's hypothesis)
- **Pros:** small, and leaves both projections where they are.
- **Cons:** forwarding exports nothing, because the supervisor has no subscriber and no projection
  for those types. Reporting the drop makes the loss visible but does not remove it. Rejected by
  the operator ("i want my otel to not disapear").

### Option B: the supervisor is never older than its children
- **Pros:** no OTel code moves.
- **Cons:** the supervisor gets newer only by restarting at a natural idle or after a drain
  (adr-2026-10-15 D7), and only in self-host continuous mode. Gating every newer-pin dispatch on
  that restart brings back the hours-long adoption lag that per-dispatch pinning removed (#2392).
  #3360 makes child pins newer sooner, so it widens the gap rather than closing it. Rejected.

### Option C: the child projects its own spans and metrics (chosen)
- **Pros:** the code that understands an event type runs in the process that emitted it, so any
  version skew is harmless. ADR-014 D7's one meter is kept, because only measurements cross the
  process boundary, as plain data.
- **Cons:** projection moves across a process boundary, and it needs per-dispatch negotiation for
  mixed-version pairs. A child that hangs past the teardown timeout or is OOM-killed loses its open spans (A3).

## Decision

1. **Exactly one process projects a dispatch's OTel, and it runs the engine that emitted the
   events.** When the projection is negotiated (decision 2), the child projects both spans and
   metrics for all of its own events. Otherwise the supervisor projects them exactly as today.
   Projection of one dispatch is never split between processes.
2. **Negotiation is two-sided and per dispatch.** The child advertises an `otelProjection`
   capability in `hello`. The supervisor accepts it in the work-order envelope only when its own
   OTel is enabled and it hosts the brokered meter (decision 6). The child projects only after
   that acceptance. An older child, an older supervisor, or a supervisor with OTel disabled means
   no acceptance, which leaves today's supervisor-side projection unchanged. Both fields are
   additive, so `EXECUTOR_PROTOCOL_VERSION` does not change.
3. **Spans come from the child's own visualizer.** An accepted child starts its pinned engine's
   span visualizer (spans only, no meter) on its feature bus, using the same resolved OTel config.
   The trace identity arrives with the acceptance: the run id from the worktree's
   `conduct-session-id` (or a fresh id), the project, the branch, the installed harness version
   and `sourceRef`. The engine version is the child's own pin. When the spool is enabled, the
   child gets a store-only spool runtime under the same main root, which writes immutable batch
   files and holds no lease and no drainer. When the spool is not enabled, the child builds the
   same exporters the supervisor visualizer builds today. The supervisor attaches no span
   visualizer for an accepted child.
4. **The child flushes before it reports.** An accepted child stops and flushes its visualizer and
   sends every pending meter message before it sends its terminal outcome, on success and error
   paths alike. Measurements arrive in the IPC channel's order (A2). The supervisor emits
   `feature_dispatch_ended` only after the outcome arrives, so #3333's ordering ("the visualizer
   stop completes before `feature_dispatch_ended`") holds unchanged.
5. **Metrics come from the child's own `MetricsListener`, recording through a brokered meter.** An
   accepted child runs its pinned engine's `MetricsListener` (feature name set to the slug) over a
   `MetricsRecorder` that is built on a proxy `Meter`. The proxy implements the synchronous
   instrument kinds (counter, up-down counter, histogram with its advice, gauge). Creating an
   instrument and recording on it each send a fire-and-forget `meter` message carrying the
   instrument descriptor, the value and the attributes, with no response. Recording therefore
   stays synchronous and O(1) (ADR-014 D4). Creating an observable (asynchronous) instrument on
   the proxy throws, so an engine that adds one fails its own tests rather than dropping the
   metric.
6. **The supervisor hosts the instruments on its one long-lived meter.** Each descriptor is
   materialized on the `Meter` of the supervisor's single `MeterProvider`. A compatible descriptor
   shares storage with the supervisor's own instrument of the same name (A1), so the
   supervisor-owned points and the child-projected points form one series. The host stamps the
   identity data-point attributes: `project` and `worker` take the supervisor's own values, and
   `feature` takes the dispatch slug, overriding anything the child sent. Metric identity stays
   supervisor-owned (ADR-014 D8). The Resource is the supervisor provider's. A `meter` message that
   arrives after the attachment closes is discarded.
7. **The supervisor stops projecting an accepted child's events but keeps the dispatch
   bookkeeping.** The supervisor's root-bus `MetricsListener` records nothing from events
   forwarded by an accepted child's attachment. It still records the supervisor-owned
   `feature_dispatch_started` and `feature_dispatch_ended` for that slug. A forwarded
   `feature_complete` or `loop_halt` from that child still marks the slug terminal, so the
   `feature_dispatch_ended` run-close fallback fires only for a child that closed no run itself.
   A run is therefore counted once.
8. **Unknown types keep their spine treatment and lose no OTel.** The broker still neither renders
   nor persists a type its registry does not know, and the child's ledger keeps it (adr-2026-10-15
   D4). An accepted child has already projected it. A type that the child's own registry marks
   `otel: false` is projected by neither process.
9. **The meter messages are a brokered service, not a telemetry channel.** They are coordination
   messages against the dispatcher-owned `MeterProvider`, the same class as the rate-limit and
   provider-availability services in adr-2026-10-15 D4. They carry projections of events, not
   occurrences. Every occurrence stays on the spine unchanged: the child persists it, and the
   broker forwards it. No `ConductorEvent` variant, ledger or sidecar is added (event-spine
   exception A: separate process).

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `@opentelemetry/sdk-metrics` reuses the existing metric storage when a compatible instrument of the same name is created again on the same meter, and keeps the longer description when only descriptions differ | verified | 90% | yes | Child-projected and supervisor-owned points would form duplicate streams under one name | n/a |
| A2 | Node `child_process` IPC delivers messages on one channel in send order, so every `meter` message precedes the outcome that follows it | inferred | 95% | yes | Late measurements after close would be discarded (decision 6), losing the tail of a dispatch's metrics | APPROVED by operator 2026-11-07 |
| A3 | The supervisor stops a child with SIGTERM, then SIGKILL only after the teardown timeout (`child-feature-executor.ts`), and the child visualizer's SIGTERM handler flushes and exports the root span as `terminated`. Only a child that hangs past the teardown timeout or is OOM-killed loses its open `conductor.run` root span, its in-flight step spans and its unexported batch. Spans already exported survive. Today the surviving supervisor would export those as `terminated`. This loss is accepted | verified | 85% | yes | Abruptly killed dispatches would lose more trace data than this residual | APPROVED by operator 2026-11-07 |
| A4 | Self-host containment wraps provider invocations only (`conductor.ts` `wrapForContainment`), not the executor child, and `.daemon/` is in the writable volatile set either way, so a child can write spool files | verified | 95% | yes | The child could not write spans under containment | n/a |
| A5 | A child loads the same merged OTel config as the supervisor (`executor-child-runtime.ts` `loadMergedConfig`) | verified | 90% | yes | The child would export with a different endpoint or attributes | n/a |

## Consequences

### Positive
- No OTel event that a child's engine declares is lost because the supervisor's engine is older.
- Each engine release's OTel additions are live on the first dispatch that is pinned to it.
- ADR-014 D7's single monotonic meter and D8's identity are preserved.

### Negative
- The first supervisor that carries this decision is a prerequisite. A child running under an
  older supervisor keeps the old gap until the supervisor restarts once.
- A child that hangs past the teardown timeout or is OOM-killed loses its open root and step spans (A3).
- Instrument kinds are limited to the synchronous ones while the meter is brokered (decision 5).

### Follow-up Actions
- [ ] Implement decisions 1–9 per the plan for #3646.
- [ ] Amend adr-2026-10-15-per-dispatch-engine-pinned-executor D4 and adr-014-otel-observability-exporter D7 to point here.
