# Architecture Review: Durable OTel export spool
**Date:** 2026-09-29
**Stories reviewed:** none yet (pre-stories, technical track; input is the explore decision and `.docs/track/durable-otel-export-queue-telemetry-is-buffered-wh.md`)
**Mode:** Lightweight (Medium tier) — Sections 2 and 4
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding | Basis |
|---|---|---|
| Stack compatibility | No new dependency. `@opentelemetry/otlp-transformer` 0.221.0 (already a dependency) exports `ProtobufTraceSerializer` and `ProtobufMetricsSerializer`, producing the exact OTLP/HTTP request body. Node's built-in `fetch` sends it. | verified — `node_modules/@opentelemetry/otlp-transformer/build/src/index.d.ts` |
| SDK seam | The SDK accepts any `SpanExporter` / `PushMetricExporter`; the repo already ships custom ones (`FileSpanExporter`, `FileMetricExporter` in `transport.ts`) and a delegating metric wrapper (`warnOnceMetricExporter` in `wire.ts`). The spool wraps at the same seam. | verified — source |
| Prerequisites | None external. Backends: Datadog Agent OTLP ingest on 4318 (Agent ≥ 7.32 traces/metrics) and otel-lgtm's collector on 4318. | verified — Datadog OTLP-ingest docs; `~/observability/ai-conductor-lgtm/otelcol-config.yaml` |
| Integration surface | One subsystem (`engine/otel/`), the config schema (`otel.spool`), and the event union + `EVENT_SINKS` (two new event types). Three boundaries, all internal. | inferred from design |
| Data implications | New on-disk state under `<mainRoot>/.daemon/otel-spool/`, bounded by `max_bytes` (default 512 MiB). `.daemon/` is gitignored and excluded from the self-host live boundary, so spool writes never trip a live-checkout halt. | verified — `.gitignore`, `live-boundary.ts` exclusion list |
| Performance | One async write + fsync per SDK batch (spans every ~5 s, metrics every 60 s) — negligible. The drainer is one sequential sender per signal. | inferred |
| Worktree isolation | Spool resolves to the MAIN root, not a worktree, so worktree removal cannot lose queued data and concurrent worktrees share one spool. Multi-writer safety comes from one immutable file per batch (unique name, atomic rename); single-reader safety comes from the lease. No ports or databases. | design; precedent ADR-014 D9 (`<mainRoot>/.daemon/events.jsonl`) |

**Verified external constraints (2026-09-29):** Datadog rejects metrics older than 1 h (spans and logs 18 h). Prometheus's out-of-order window defaults to 0 (otel-lgtm sets 10 m); Mimir's defaults to 0. The JS gRPC OTLP exporter has no retry. `PeriodicExportingMetricReader` does not re-send a failed export. These bound what any spool can deliver after a long partition; the design reports those rejections, never hides them.

## Alignment

- **Governing ADR reused, amended — no new ADR.** ADR-014 owns the exporter's transport and failure isolation (Decisions 4 to 6). The spool changes how Decisions 4 and 5 are realized, so it is an additive amendment (D15 to D17), per the operator's standing preference for amendments.
- **Decision 4 (off the hot path) holds.** Spool I/O runs inside the SDK's exporter call, which the batch processor and the periodic reader already run asynchronously. No bus handler gains I/O.
- **Decision 5 (failure isolation) holds.** A spool write failure, such as a full or unwritable disk, degrades to the existing bounded warning and passes the batch through to a direct send, so a broken spool never wedges a run.
- **Event spine.** Spool health is two new typed `ConductorEvent` members on the owning process's bus (D17). The spool directory is transport state, not an observation channel, because nothing but the drainer reads it. This fits the event-spine skill's schema-not-file test: the facts go on the spine, the bytes stay in the queue.
- **Local pattern basis:** main-root daemon state shared across worktrees. Precedents: ADR-014 D9's `<mainRoot>/.daemon/events.jsonl` (the daemon joins its `projectRoot`), and operator park markers, which resolve the main root from any checkout. The trait to preserve is that a process launched in a linked worktree resolves the MAIN root via `git rev-parse --git-common-dir`, not its own cwd. Variation allowed: many files instead of one appended file. Rediscovery hint: `resolveMainRepoRoot` in `engine/park-marker.ts`; the `.daemon` join in `daemon-cli.ts`.
- **Production DI defaults:** the spool is a filesystem store, and it is the production default for `exporter: otlp`. No in-memory store is a production default.
- **Security:** spooled bodies are telemetry already sent off-host today. Header values (API keys, from env references under #1939) are never written to the spool; the drainer re-resolves headers at send time. The spool directory is created mode 0700.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `SpoolingSpanExporter` / `SpoolingMetricExporter` | `buildExporters` in `engine/otel/transport.ts`, when `exporter: otlp` and the spool is enabled; that function already feeds both `wireDaemonOtel` and the per-feature/interactive visualizer wiring. |
| `SpoolDrainer` (lease + send loop) | Started by `wireDaemonOtel` (daemon lifetime) and by the interactive OTel wiring in `wire.ts` (run lifetime). Stopped on their existing shutdown paths. Takes the lease only if it is free. |
| Config keys `otel.spool.enabled`, `otel.spool.max_bytes` | `resolveOtelConfig` in `engine/otel/otel-config.ts`, including the gRPC plus enabled-spool validation error. |
| Events `otel_spool_drop`, `otel_spool_backlog` | Emitted by `SpoolDrainer` on the bus passed in by its owner; union members in `types/events.ts`; rows in `engine/event-sinks.ts`. |

Overlap scan over these paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A 401/403 misconfiguration grows the spool until eviction | Integration | Medium | Medium | Kept, not dropped (D16); `otel_spool_backlog` carries the last failure class so the operator sees "auth" early; eviction is counted. |
| Late delta points after a long partition are rejected, or corrupt Prometheus delta-to-cumulative | Integration | High (for outages over 10 min on LGTM) | Medium | Backend-authoritative rejections are counted (D16); the ops doc names the Mimir/Prometheus `out_of_order_time_window` setting. Spans are unaffected for 18 h (Datadog), and no age limit was found for Tempo. |
| Datadog silently discards stale metric points (unverified, about 60%) | Integration | Medium | Low | Documented as a known limit in D17; drop counts undercount on that backend. |
| Existing `protocol: grpc` configs fail validation once the spool defaults on | Integration | Low (repo config uses HTTP) | Medium | The error names both remedies; the implementation PR declares it in its release note. |
| Two drainers after a stale-lease race send a batch twice | Data | Low | Low | Duplicate spans dedupe by span id in Tempo and Datadog; duplicate delta points inflate one interval. The lease is heartbeated, and reclaim requires a dead owner pid plus heartbeat expiry. |
| Crash loses the SDK's in-memory window (≤ about 5 s of spans, ≤ 60 s of metrics) | Data | Low | Low | Accepted: this is the write-first boundary. A graceful stop flushes into the spool, which is local and fast. |

## ADRs Created

None. ADR-014 amended additively: `> **Amended 2026-09-29 by operator DECIDE (durable OTLP export spool)**`, which adds numbered decisions 15, 16 and 17 under `## Decision`. The amendment is presented to the operator for approval; the ADR's status stays APPROVED only on that approval.

## Conditions

1. The spool is proven against both backend families by test doubles that reproduce each response class in D16 (2xx, 400/413, partial-success, 401/403/404, 429 with `Retry-After`, 5xx, network error), plus a restart test showing a batch spooled by one process is delivered by the next lease holder.
2. The operator-facing configuration reference documents `otel.spool.*`, the gRPC restriction, and the backend age windows (Datadog 1 h metrics / 18 h spans; Prometheus/Mimir `out_of_order_time_window`), with reference collector settings for both otel-lgtm and the Datadog Agent.
3. Spool-directory resolution goes through the existing main-root resolver (`resolveMainRepoRoot`, `engine/park-marker.ts`), never a worktree's cwd. A worktree-launched process must never create a per-worktree spool.
4. Header values are never persisted to spool files.
