# Sequences: Trace rotation and feature restart

**Last updated:** 2026-09-30
**Scope:** Three key flows in the #2011/#2009 bounded trace design.
**Review:** Diagrams approved by the operator on 2026-09-30.

## 1. Dispatch and ordinary execution

```mermaid
sequenceDiagram
    participant Entry as Entry point
    participant History as Existing event history
    participant Spine as Conductor event spine
    participant Trace as OTel projection
    participant Export as Existing exporter
    Entry->>History: Recover validated feature and predecessor context
    Entry->>Trace: Start feature-scoped telemetry lifecycle
    Trace->>Spine: Publish opened segment correlation
    Spine->>History: Persist typed occurrence
    Spine->>Trace: Engine step started
    Trace->>Trace: Open logical step group and execution child
    Spine->>Trace: Engine step completed or failed
    Trace->>Export: End and enqueue execution span
```

## 2. Deadline while a step is still executing

```mermaid
sequenceDiagram
    participant Clock as Segment deadline
    participant Spine as Conductor event spine
    participant Trace as OTel projection
    participant Export as Existing exporter
    Clock->>Spine: Segment rotation boundary
    Spine->>Trace: Rotate segment
    Trace->>Export: End current slices, groups and segment
    Note over Trace: Preserve logical execution and retry state
    Trace->>Trace: Open next segment linked to predecessor
    Trace->>Spine: Publish new segment correlation
    Trace->>Trace: Open continuation slices with the same execution identity
    Spine->>Trace: Later real step completion
    Trace->>Export: End final slice with actual outcome
```

A timer rotation does not emit step_completed, feature_complete, or a fake dispatch end.
All children remain independently inspectable. The deadline path also checks elapsed time
when execution resumes after scheduling delay; it must not claim that missing observations
or delayed export were timely delivery.

## 3. Halt, three-day gap, and redispatch

```mermaid
sequenceDiagram
    participant Engine as Engine
    participant Spine as Conductor event spine
    participant Trace as OTel projection
    participant History as Existing event history
    participant Export as Existing exporter
    Engine->>Spine: Halt or graceful dispatch termination
    Spine->>Trace: End active trace segment with real boundary
    Trace->>Export: Export finished spans promptly
    Trace->>Spine: Publish segment end
    Spine->>History: Persist segment record
    Note over Engine,History: Process stops and feature can remain parked for days
    Engine->>History: Recover same feature's valid predecessor context
    Engine->>Trace: Start new dispatch and new segment
    Trace->>Trace: Link new segment to predecessor
    Trace->>Spine: Publish new segment context
    Note over Trace,Export: New spans use their real current timestamps
```

An abrupt crash may leave only the opened-segment record. Recovery may link to that recorded
context without pretending the old segment ended cleanly or reached the backend.
Invalid/missing/mismatched context yields a fresh unlinked segment, never another feature's
parent. A real new execution after a halt is not mislabeled as a continuation slice.

**Plan-update review:** Approved with the implementation plan in chat on 2026-09-30.

## 4. Early member settlement and delayed classification

> **Amended 2026-09-30 by #2011:** Tasks 13–15 implement approved D24's separate
> work and outcome boundaries. In sequence 1, starting the telemetry lifecycle
> prepares context only: the segment opens lazily on trace-bearing activity, and
> its opened record is queued outside the engine-event handler before a child is
> advertised as recoverable. This also preserves no-work startup behavior.

```mermaid
sequenceDiagram
    participant Spine as Conductor event spine
    participant Trace as SpanManager and segment lifecycle
    participant Export as Existing SDK exporter
    Spine->>Trace: Member result at actual work settlement
    Trace->>Export: End work slice with awaiting-outcome
    Note over Trace: Retain measured work interval and last slice context
    Note over Trace: Segment boundaries create no waiting-work slices
    Spine->>Trace: Authoritative classification later
    Trace->>Trace: Use current segment or lazily open linked segment
    Trace->>Export: Zero-duration outcome at classification time
    Note over Trace,Export: Link outcome to last work slice and carry terminal facts once
```

The exported work span is immutable. Waiting for classification neither stretches its
work duration nor holds a span open across days. A catchable interruption records an
incomplete outcome with the original measured work interval; abrupt loss never fabricates
success. A previously active idle dispatch may open a short final segment for its terminal
outcome, whereas a dispatch with no trace-bearing activity stays span-free.

## Legend

History is the existing ConductorEvent ledger, not a new correlation file. Export means
handoff to the current SDK/exporter pipeline, not a guarantee of backend retention.
The separate durable-export-queue feature owns retry and spool delivery.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-30 | Initial three lifecycle sequences | Make deadline rotation and multi-day recovery reviewable before the ADR |
| 2026-09-30 | Plan update adds late-classification sequence and clarifies lazy startup | Preserve settlement timing, no-work behavior and bounded terminal records |
