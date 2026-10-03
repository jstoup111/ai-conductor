# Architecture: Task-status recovery after abrupt daemon death

**Last updated:** 2026-10-03
**Scope:** `seedTaskStatus` (`src/conductor/src/engine/task-seed.ts`) and its pre-BUILD dispatch
caller `seedBuildTaskTelemetry` (`src/conductor/src/engine/conductor.ts`). Covers how a
`.pipeline/task-status.json` that survived an abrupt daemon death is reconciled with committed
`Task:` trailers and stale `in_progress` rows. Intake: jstoup111/ai-conductor#2673.

## Current state (the defect)

```mermaid
flowchart TD
    Callers["seed callers<br/>seedBuildTaskTelemetry (pre-BUILD dispatch)<br/>build completion predicate<br/>remediation append / repair restage"]
    Read["read task-status.json"]
    Usable{"usable rows?"}
    Scan["trailerProvenCompletions<br/>merge-base..HEAD Task: trailers"]
    NoScan["no trailer scan"]
    Merge["upsert plan tasks"]
    Missing["row missing → pending<br/><b>even when its Task: commit exists</b>"]
    InProg["in_progress row → kept as-is<br/><b>even after the session died</b>"]
    Repairs["open repair obligations → pending"]
    Out["write task-status.json"]

    Callers --> Read --> Usable
    Usable -->|no: missing/empty/corrupt| Scan --> Merge
    Usable -->|yes| NoScan --> Merge
    Merge --> Missing
    Merge --> InProg
    Missing --> Repairs
    InProg --> Repairs
    Repairs --> Out
```

## Planned state

```mermaid
flowchart TD
    Dispatch["seedBuildTaskTelemetry<br/>(pre-BUILD dispatch: no live session)"]
    Other["other seed callers<br/>(completion predicate, remediation, restage)"]
    Seed["seedTaskStatus(..., recovery)"]
    Read["read task-status.json"]
    Gap{"any plan task<br/>without a row?"}
    Scan["trailerProvenCompletions<br/>branch-scoped, fail-closed"]
    NoScan["no git cost"]
    Missing["missing row with trailer → completed<br/>restored_from: task-trailer<br/>missing row without trailer → pending"]
    Existing["existing rows untouched<br/>(completed, skipped, deliberately reverted pending)"]
    Stale{"dispatch boundary?"}
    Reset["in_progress → pending"]
    Keep["in_progress kept"]
    Repairs["open repair obligations → pending<br/>(adr-2026-09-06 D6, unchanged)"]
    Out["write task-status.json"]

    Dispatch -->|recovery: dispatch| Seed
    Other -->|default| Seed
    Seed --> Read --> Gap
    Gap -->|yes| Scan --> Missing
    Gap -->|no| NoScan --> Existing
    Missing --> Existing
    Existing --> Stale
    Stale -->|yes| Reset --> Repairs
    Stale -->|no| Keep --> Repairs
    Repairs --> Out
```

## Legend

- **Bold** labels in the current state mark the two #2673 defects.
- The trailer scan stays branch-scoped (`merge-base(origin, HEAD)..HEAD`) and fails closed: no
  provable range means no restored completions.
- Restore is additive: only a plan task with **no** row can gain a `completed` row. An existing
  `pending` row is never upgraded, so deliberately reopened or restaged rows stay pending.
- The open-repair override runs last, so an open repair obligation is never restored as
  completed from an old trailer.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | DECIDE for #2673 (abrupt-death task-status recovery) |
