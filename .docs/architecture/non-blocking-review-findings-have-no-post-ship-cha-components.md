# Components: Durable post-ship actions

**Last updated:** 2026-09-30
**Scope:** Planned storage, execution and publication authority boundaries.
**Validation:** Logical flows and plan updates approved by the operator 2026-09-30.

## Diagram

```mermaid
graph TD
  Review["Consumed classified review results"]
  Capture["Source normalization and local handoff"]
  Feature["Feature-scoped v3 case store"]
  Payload["Serializable terminal effects"]
  Outer["Outer dispatcher or attended return"]
  Snapshot["Committed shipped source snapshots"]
  Import["Exact source importer"]
  Root["Repository action-scoped v3 case store"]
  CLI["actions list / resolve / file / recover"]
  Recovery["Bounded modern and legacy recovery"]
  Intake["Guarded intake and per-action publication lease"]
  Marker["Top-level Closes-Also declaration"]
  Seal["Protected seal closure descriptor"]
  Finish["Shared FINISH closure projection and verification"]
  Host["Existing guarded issue / PR host"]
  Bus["ConductorEventEmitter and union"]
  Persist["Existing EventPersister ledgers"]
  Timeline["Existing timeline readers"]
  Review --> Capture --> Feature
  Feature --> Payload --> Outer
  Feature --> Snapshot
  Outer -->|"After claim release, before cleanup"| Import
  Snapshot --> Recovery --> Import --> Root
  CLI --> Root
  CLI --> Recovery
  CLI --> Intake --> Host
  Intake -->|"Short state leases before and after network"| Root
  Marker --> Seal --> Finish --> Host
  Capture -.-> Bus
  Import -.-> Bus
  CLI -.-> Bus
  Finish -.-> Bus
  Bus --> Persist --> Timeline
```

## Legend

Solid arrows carry state or operations; dashed arrows carry occurrences. These components stay
inside the existing harness. The feature executor writes only its own case store; the outer return
owns repository imports. Source snapshots contain evidence, never mutable repository decisions.

Both store scopes use revision checks, a lease and atomic replacement. Operator resolution and
optional issue publication are independent fields. Exact source/case relationships reconcile replay;
matching prose does not merge cases. The per-action publication lease spans network I/O, while
short repository feature-state leases allow concurrent resolution.

The event union and readers remain one telemetry spine. Standalone invocations use a single-writer
EventPersister ledger under `.pipeline/review-action-events/«invocation-id».jsonl`, consumed by the
existing timeline. No watcher, parallel log schema or new deployment is introduced.

Tasks 1–12 own capture/storage/retention; 13–23 own operator operations; 24–26 and 40 own events;
27–39 own sealed closure authority and common FINISH.

[System context and flow index](non-blocking-review-findings-have-no-post-ship-cha.md)

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial logical component proposal | Reuse existing cases while retaining actions beyond cleanup |
| 2026-09-30 | Make state scopes, outer collection and common FINISH explicit | Plan update; approved ADR |
