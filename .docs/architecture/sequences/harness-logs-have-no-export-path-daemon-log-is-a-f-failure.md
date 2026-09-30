# Sequence: Delivery failure and bounded shutdown

**Last updated:** 2026-09-30
**Status:** Approved by operator in composer chat, 2026-09-30
**Scope:** Remote failure remains isolated from builds, and its diagnostics cannot feed back into log delivery.

## Diagram

```mermaid
sequenceDiagram
    participant Run as Harness execution
    participant Bus as Owner event bus
    participant Logs as Shared log owner
    participant Delivery as Async bounded delivery
    participant Backend as Log destination
    participant Local as Local output and persistence
    Run->>Bus: Operational occurrence
    Bus->>Logs: Structured projection
    Logs-->>Bus: Record queued without network wait
    Bus-->>Run: Execution continues
    Logs-->>Delivery: Batch ready
    Delivery->>Backend: Send with bounded remote operation
    Backend-->>Delivery: Failure, rejection, or timeout
    Delivery->>Delivery: Apply bounded retry or discard policy
    Delivery->>Bus: Typed delivery-health occurrence
    Bus->>Local: Bounded actionable warning
    Note over Bus,Logs: Delivery-health events are excluded from export and diagnostic recapture
    loop Further failures in the same episode
        Delivery->>Delivery: Bounded retry and warning suppression
        Note over Run: Build outcome remains independent
    end
    Run->>Logs: Stop owning run or daemon process
    Logs->>Delivery: Bounded flush or preserve pending records
    Delivery-->>Logs: Settle within shutdown budget
    Logs-->>Run: Detach and complete shutdown
```

## Legend

Failure classification and durable storage reuse the governing export architecture; this feature does not create a second spool. Bounds, discard reporting, oversize handling, and ownership on restart are concrete architecture-review obligations. The diagram intentionally promises bounded shutdown rather than delivery of every pending record during an outage.

## Requirement Coverage

FR-6 through FR-9 and FR-11.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-09-30 | Initial proposal | DECIDE for #1935 after operator approval of the PRD |
