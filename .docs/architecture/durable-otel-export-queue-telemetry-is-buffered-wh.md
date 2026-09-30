# Components: Durable OTel export spool

**Last updated:** 2026-09-29
**Scope:** Where a write-first, disk-backed spool sits between the existing OTel SDK processors
(`BatchSpanProcessor`, `PeriodicExportingMetricReader`) and the OTLP transport, so telemetry
survives backend outage, local collector outage, daemon restart/crash, and network partition.
Backend targets: Datadog Agent / DDOT and Grafana LGTM (otelcol-contrib or Alloy).

## Diagram

```mermaid
graph TD
    subgraph producers["OTel producers (existing, engine/otel/)"]
        bsp["BatchSpanProcessor<br/>(per-feature + interactive providers)"]
        pemr["PeriodicExportingMetricReader<br/>(daemon + per-feature meters, LOWMEMORY temporality)"]
    end

    subgraph spool["Durable spool (NEW)"]
        sx["SpoolingExporter<br/>implements SpanExporter / PushMetricExporter<br/>serialize OTLP protobuf → write batch file → fsync → rename → ack SDK"]
        dir[".daemon/otel-spool/«signal»/«seq».pb<br/>one immutable file per batch<br/>bounded by disk-size cap"]
        rt["SpoolRuntime (spool-wiring.ts)<br/>one per main-root spool dir<br/>resolveMainRepoRoot → .daemon/otel-spool"]
        lease["SpoolLease<br/>O_EXCL lease.json: pid + uuid + heartbeat"]
        drain["SpoolDrainer<br/>one loop per signal, one file at a time<br/>oldest-first, backoff, Retry-After"]
        cls["DeliveryClassifier<br/>2xx full accept → delete<br/>4xx / partial-success rejected → delete + drop event<br/>5xx / 429 / network → keep, backoff"]
    end

    subgraph transport["OTLP transport (existing, transport.ts)"]
        http["OTLP/HTTP protobuf POST<br/>/v1/traces, /v1/metrics"]
    end

    subgraph spine["Event spine (existing)"]
        emit["ConductorEventEmitter → events.jsonl<br/>NEW: otel_spool_drop / otel_spool_backlog"]
    end

    subgraph backends["Operator backends"]
        dd["Datadog Agent / DDOT<br/>OTLP 4318 → Datadog intake<br/>(metrics ≤1h old, spans ≤18h)"]
        lgtm["Grafana LGTM collector / Alloy<br/>→ Tempo / Mimir / Prometheus<br/>(OOO window: 0 default, 10m otel-lgtm)"]
    end

    rt --> sx
    rt --> lease
    lease -->|"holder only"| drain
    sig["daemon SIGTERM / SIGHUP<br/>flush providers, release lease"] --> rt
    bsp --> sx
    pemr --> sx
    sx --> dir
    dir --> drain
    drain --> http
    http --> cls
    cls -->|"delete / keep"| dir
    cls -->|"drop or backlog counts"| emit
    http --> dd
    http --> lgtm
```

## Legend

- **NEW** — the spool layer. The SDK producers are unchanged; only the exporter they are handed
  changes. The SDK sees an export succeed as soon as the batch is durable on disk, so SDK-side
  retry, `maxQueueSize` drops, and the delta-interval loss on a failed metric export no longer occur.
- **Write-first:** every batch is persisted before any network send, so a daemon crash loses at
  most the SDK's un-exported in-memory window, never an accepted batch.
- **Backend decides staleness:** the spool applies no client-side age cap. A permanent rejection
  is deleted and counted on the spine; only transient failures are retried. The disk-size cap is
  the sole local bound; its eviction is also counted on the spine.
- **Single drainer:** multiple writer processes (daemon, per-feature providers, interactive runs)
  append independent batch files; exactly one drainer per project root holds the lease.
- `file` exporter transport is unchanged and not spooled (it is already local disk).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-29 | Initial generation | DECIDE for durable OTel export queue |
| 2026-09-29 | Added SpoolRuntime, SpoolLease and the SIGTERM/SIGHUP flush path | Plan update after the conflict-check resolutions (C3, C5) |
