# Sequence: an accepted finding is re-raised, carried and announced

**Last updated:** 2026-10-21
**Scope:** Lap L1 accepts a finding. Lap L2 re-raises the same substance under a new id and the
adjudicator binds it to the same case. A crash can occur between any two steps.

## Diagram

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Disp as Disposition store
  participant Coord as Coordinator
  participant Rem as remediate
  participant Rec as Reconciler
  participant Cases as Case store v3
  participant Pers as EventPersister

  Note over Coord: Lap L1
  Op->>Disp: build-review accept «finding A» (lap L1)
  Coord->>Disp: re-read authority at exit
  Coord->>Cases: finalize: mark case «C» operatorAcceptance (A, lap L1), retire case
  Note over Cases: one atomic mutate

  Note over Coord: Lap L2
  Coord->>Cases: drain outbox (empty)
  Coord->>Rem: context: case «C» operatorAccepted
  Rem-->>Coord: finding B bound to existingCaseId «C»
  Coord->>Rec: classifyRemediationCaseReuse(«C», lap L2)
  Rec-->>Coord: carry (mark lap L1 differs, origin A still accepted)
  Coord->>Rec: reconcile carry lane
  Rec->>Cases: append B as carried + outbox entry «eventId»
  Note over Cases: one atomic mutate
  Coord->>Pers: drain: persistDurably(build_review_acceptance_carried, «eventId»)
  Pers-->>Coord: persisted or duplicate
  Coord->>Cases: remove drained outbox entry
  Coord-->>Coord: effective PASS, no halt, no charge

  Note over Coord,Pers: Crash after the append and before the drain: the next pass drains the same «eventId».
  Note over Coord,Pers: Crash after persisting and before the outbox removal: the persister reports duplicate.
```

## Legend

`«C»` is the accepted case and `«eventId»` is engine-stamped in the same transaction as the link.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-20 | Initial generation | Respec of #3271 after revert #3319 |
| 2026-10-21 | Plan-update: carry event renamed `build_review_acceptance_carried` to match the ADR | /plan for the #3271 respec |
