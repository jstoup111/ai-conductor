# Sequence: Durable OTel export spool — outage and recovery

**Last updated:** 2026-09-29
**Scope:** One span batch through the spool while the OTLP endpoint is unreachable, across a
daemon restart, then drained on recovery; includes a permanent backend rejection.

## Diagram

```mermaid
sequenceDiagram
    participant SDK as BatchSpanProcessor
    participant SX as SpoolingExporter
    participant FS as Spool directory
    participant DR as SpoolDrainer
    participant EP as OTLP endpoint
    participant EV as Event spine

    SDK->>SX: export(batch)
    SX->>FS: write «seq».pb, fsync, rename
    SX-->>SDK: SUCCESS (durable)
    DR->>FS: read oldest batch
    DR->>EP: POST /v1/traces
    EP-->>DR: network error / 503
    DR->>EV: otel_spool_backlog (depth, oldest age)
    Note over DR: backoff, batch kept
    Note over SDK,DR: daemon restarts — spool files persist
    DR->>FS: reacquire lease, read oldest batch
    DR->>EP: POST /v1/traces
    EP-->>DR: 200 OK
    DR->>FS: delete «seq».pb
    DR->>FS: read next batch
    DR->>EP: POST /v1/metrics
    EP-->>DR: 400 / partial-success rejected
    DR->>FS: delete batch
    DR->>EV: otel_spool_drop (reason, count)
```

## Legend

- Durability boundary is the rename: before it the batch is SDK memory, after it the batch
  survives any process death.
- Guillemets mark variable parts of a label (`«seq»`).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-29 | Initial generation | DECIDE for durable OTel export queue |
