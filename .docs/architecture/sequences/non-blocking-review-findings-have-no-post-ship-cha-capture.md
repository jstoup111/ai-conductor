# Sequence: Capture a finding and continue shipping

**Last updated:** 2026-09-30
**Scope:** Tasks 4–12: consumed source, local handoff, terminal collection and cleanup.
**Validation:** Logical flows and plan updates approved by the operator 2026-09-30.

## Diagram

```mermaid
sequenceDiagram
  participant Review as Existing review authority
  participant Engine as Feature result consumer
  participant Local as Feature-scoped case store
  participant Ship as Existing shipping flow
  participant Outer as Dispatcher or attended return
  participant Root as Repository action importer
  participant Bus as Existing event spine
  Review->>Engine: Fresh consumed classification and source identity
  alt Genuine blocking finding
    Engine->>Engine: Preserve existing blocking authority
  else Outstanding classified non-blocking concern
    Engine->>Local: Atomically persist source and local handoff effect
    alt Required local control persistence fails
      Local-->>Engine: Existing control failure, never a false applied effect
    else Valid durable local handoff
      Local-->>Engine: Applied local effect, no remote publication claim
      Engine->>Bus: Emit persisted source occurrence
      Engine->>Ship: Continue when existing gates are satisfied
      opt Normal shipped-record generation
        Ship->>Ship: Retain source snapshots before publication and cleanup
      end
      Engine-->>Outer: Serializable sources with terminal result
      Note over Engine,Outer: Done, halted, error or parked, worker never writes root
      Outer->>Outer: Release feature claim before repository import
      Outer->>Root: Reconcile exact sources before cleanup
      alt Repository import persisted
        Root->>Bus: Emit capture occurrence after persistence
      else Repository import incomplete
        Root-->>Outer: Named recoverable diagnostic
        Outer->>Bus: Emit incomplete import occurrence
      end
      Note over Outer,Root: Optional collection does not reopen BUILD or charge budget
    end
  end
```

## Legend

Required local control persistence remains an existing gate requirement. A valid non-blocking
handoff is locally complete without remote intake. An outer repository import failure cannot
retroactively turn it into mandatory remediation. Shipped source snapshots preserve later recovery
when terminal collection was interrupted; all available terminal sources are collected before normal
cleanup. A telemetry failure is reported separately from a successfully persisted state transition.

[System context and flow index](../non-blocking-review-findings-have-no-post-ship-cha.md)

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial capture flow | PRD FR-1, FR-3, FR-5, FR-8, FR-12 |
| 2026-09-30 | Separate required local effect from optional root collection | Plan update; approved ADR |
