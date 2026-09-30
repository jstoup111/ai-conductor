# Sequence: Enabled delivery and concurrent feature attribution

**Last updated:** 2026-09-30
**Status:** Approved by operator in composer chat, 2026-09-30
**Scope:** Normal delivery in both modes, with one owner and unchanged local output.

## Diagram

```mermaid
sequenceDiagram
    participant Entry as Daemon or interactive entry
    participant Config as Log configuration
    participant Source as Feature or run source
    participant Bus as Owner event bus
    participant Local as Local output and persistence
    participant Logs as Shared log owner
    participant Delivery as Async log delivery
    participant Backend as Configured destination
    Entry->>Config: Resolve explicit log opt-in and destination
    Config-->>Entry: Enabled and valid
    Entry->>Logs: Attach once to owner bus
    Source->>Bus: Typed occurrence with original timestamp and identity
    Note over Source,Bus: Daemon feature events forward once to root with full feature identity
    Bus->>Local: Preserve existing local handling
    Bus->>Logs: Project event into structured log record
    Logs->>Logs: Enqueue bounded in-memory record
    Logs-->>Bus: Return without destination I/O
    Bus-->>Source: Continue execution
    Logs-->>Delivery: Export batch asynchronously
    Delivery->>Backend: Send structured records
    Note over Source,Logs: Concurrent features retain per-record ownership without a shared current-feature variable
    alt Daemon feature completes
        Source->>Bus: Feature completion occurrence
        Note over Logs: Daemon owner continues serving other features
    else Interactive run or daemon process stops
        Entry->>Logs: Bounded flush and detach
        Logs-->>Entry: Finish within the shutdown bound
    end
```

## Legend

The owner bus is the daemon root bus or the interactive run bus. The flow is shared; only lifetime and source-context wiring differ. Local handling is existing behavior and does not depend on successful remote delivery. Remote transport retries can repeat a batch; the single-owner rule prevents duplicate creation through event forwarding, not all network-level duplicates.

## Requirement Coverage

FR-2 through FR-8 and FR-11. Startup diagnostics and abrupt-exit limits will be specified by architecture review rather than implied to be lossless by this normal-flow diagram.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-09-30 | Initial proposal | DECIDE for #1935 after operator approval of the PRD |
