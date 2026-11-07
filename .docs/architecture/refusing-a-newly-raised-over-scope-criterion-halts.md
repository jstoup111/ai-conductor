# Components and sequences: Per-entry over-scope decision capture

**Last updated:** 2026-10-31
**Scope:** #3548. Capture of a cleared over-scope decision block at PRD-audit entry and the halt recovery it renders. NC semantic reconciliation, the case-store schema, and classification projection are unchanged.

## Component diagram

```mermaid
graph TD
    Cleared[HALT.cleared over-scope-decisions block]
    Entry[Per-entry scope selection]
    Verdict[(prd-audit.json persisted verdict)]
    Story[Story-criterion capture: criterion-only scope]
    NC[NC capture: must match persisted offer]
    Offers[(remediation-cases.json prd_widening offers)]
    Decisions[(accepted-widenings.json decisions)]
    Defects[Typed defects carrying kind and criterion]
    Mapping[Total defect-kind to recovery-reason mapping]
    Recovery[prd-widening-recovery: reason, criterion, fitting action]
    Halt[Over-scope halt text]
    Events[Existing ConductorEvent spine]
    Cleared --> Entry
    Verdict -->|offered story criteria| Story
    Entry -->|story criterion, no offer reference| Story
    Story -->|criterion never offered or verdict unreadable| Defects
    Entry -->|NC ordinal or offer reference present| NC
    Story --> Offers
    Story --> Decisions
    NC --> Offers
    NC --> Decisions
    Story --> Defects
    NC --> Defects
    Defects --> Events
    Defects --> Mapping
    Mapping --> Recovery
    Recovery --> Halt
```

## Mixed block: new story criterion refused, prior NC accepted

```mermaid
sequenceDiagram
    actor Operator
    participant Capture as Decision capture
    participant Offers as Offer store
    participant Decisions as Decision store
    participant Conductor
    Operator->>Capture: Cleared block with S«n» refuse (no offer) and NC-«k» accept (offer «id»)
    Capture->>Capture: Select scope for each entry independently
    Capture->>Capture: Confirm S«n» is an outside-visible OVER_SCOPE finding in the persisted verdict
    Capture->>Offers: Materialize criterion+summary source for S«n»
    Capture->>Decisions: Append S«n» refuse, criterion-only scope
    Capture->>Offers: Read persisted offer «id»
    Capture->>Decisions: Append NC-«k» accept bound to offer «id»
    Capture-->>Conductor: Captured both, no defects
    Conductor->>Conductor: Emit imported events and continue the audit lap
```

## Rejected entry: named reason, criterion and recovery

```mermaid
sequenceDiagram
    participant Capture as Decision capture
    participant Conductor
    participant Recovery as Recovery renderer
    Capture-->>Conductor: Defect kind «kind» for criterion «c»
    Conductor->>Conductor: Map «kind» to its own recovery reason
    Conductor->>Recovery: Reason and affected criterion «c»
    Recovery-->>Conductor: Halt text naming reason, «c» and the fitting recovery
    Note over Conductor: malformed-history only when the stored widening history fails to parse or migrate
```

## Legend

- **Story criterion:** a story-numbered acceptance criterion such as `S3.17`. Its decisions keep criterion-only scope (adr-2026-09-07 D1).
- **NC:** a no-owner ordinal such as `NC-2`. It is relabeled each lap, so its decision binds to an engine-stamped offer.
- **Offer:** the engine-persisted case written before an editable entry is rendered, holding the stable `offerEntryId` and a frozen source snapshot.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-31 | Initial generation | #3548: per-entry capture scope and per-kind recovery reasons |
| 2026-10-31 | Added persisted-verdict offered-set check | Conflict-check resolution: a story criterion the halt never offered is refused |
