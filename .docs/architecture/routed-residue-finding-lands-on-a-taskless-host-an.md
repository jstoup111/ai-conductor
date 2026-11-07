# Sequence: Task-bound residue routing and no-op routed-host settle (#3590)

**Last updated:** 2026-11-05
**Scope:** How an admitted as-built finding is classified for owner routing, and what the conductor
does when a routed audit host has no dispatchable BUILD work at region entry.

## Diagram — owner classification (`routeAdmittedRound`)

```mermaid
graph TD
    A[Admitted routing item] --> B{existing-task binding<br/>ownerTaskIds non-empty?}
    B -- yes --> T[Task-bound: deriveTaskBoundOwner<br/>owner = taskSlices of bound task]
    B -- no --> C{isResidue provenance?<br/>ADR-decision as-built, refusal rework,<br/>taskless obligation}
    C -- yes --> R[Residue judge<br/>resolveResidueOwner: single candidate = child,<br/>else earliest candidate, unchanged]
    C -- no --> T
    T --> H[selectHost: owner, prerequisite-paths fallback]
    R --> H
    H --> Rec[Route record item: owner, host, reason]
```

## Diagram — routed audit host entry with no dispatchable work

```mermaid
sequenceDiagram
    participant Cond as Conductor.enterRoutedHostRegion
    participant Entry as enterHostRegion
    participant Store as route-record-store
    participant Exit as routed-exit.advanceRound
    participant Spine as event spine (outbox → events.jsonl)

    Cond->>Entry: enter host «n» of round «r»
    Entry->>Entry: write frozen blocks, bind obligations, seed task status
    Entry->>Entry: checkStepCompletion(build, activeChild «n»)
    alt BUILD already evidence-complete (audit round)
        Entry-->>Cond: derived-already-complete
        Cond->>Exit: settleDerivedNoOpHost(«r», «n»)
        alt another host did work or a later host is pending
            Exit->>Store: admitted → repairing (credit false, reason derived-already-complete)
            Store->>Spine: routed_repair_phase (repairing, reason)
            Cond->>Exit: exitRoutedHostAndReconcile(«r», «n»)
            Exit->>Store: no-commit exit → done (or built → restacked if entry committed)
            Exit-->>Cond: navigate-host / queue / leaf-returned
        else no host in «r» did work and none is pending
            Exit-->>Cond: halt
            Cond->>Cond: needs-human HALT, Outcome: derived-already-complete
        end
    else dispatchable work
        Entry->>Store: admitted → repairing (credit granted)
        Entry-->>Cond: entered
    end
    Note over Cond,Entry: halt clear on an already-stuck round re-runs this same entry path
```

## Legend

- **Task-bound:** owner is derived mechanically from the sealed task-to-slice map
  (`adr-2026-10-12-routed-whole-feature-repair` decision 2). An existing-task binding now takes
  precedence over residue provenance.
- **No-op settle:** reuses existing host states and the routed exit (`exitRoutedHostAndReconcile`); no provider runs and
  no repair credit is charged. The no-op halt is kept only when no host in the round did work.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-05 | Initial generation | #3590 DECIDE |
| 2026-11-05 | Named `settleDerivedNoOpHost` and the routed-exit continuation | #3590 plan update |
