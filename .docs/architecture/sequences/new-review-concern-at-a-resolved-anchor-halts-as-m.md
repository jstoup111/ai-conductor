# Sequence: new concern at a source owned by a resolved case

**Last updated:** 2026-10-02
**Scope:** One build_review adjudication lap for jstoup111/ai-conductor#2464, covering the declared
new case, the undeclared recurrence, and a rejected transition.

## Diagram

```mermaid
sequenceDiagram
  participant Coord as Adjudication coordinator
  participant Ctx as Adjudication context
  participant Judge as remediate case-v2
  participant Val as Case validator
  participant Rec as Case reconciler
  participant Store as RemediationCaseStore
  participant Spine as Event spine

  Coord->>Store: read history
  Store-->>Coord: valid state incl. resolved case R at source S
  Coord->>Ctx: build context
  Ctx->>Judge: current finding at S + prior case R (resolved, owns S)
  Judge-->>Coord: judgement rows
  Coord->>Val: validate graph
  alt row declares distinctFrom R
    Val-->>Coord: admitted (R is resolved and links S)
    Coord->>Rec: reconcile
    Rec->>Store: append new open case N at S, R unchanged
    Store-->>Rec: ok (one unresolved owner of S)
    Rec-->>Coord: caseIdsByRef includes N
    Coord->>Spine: existing case occurrences for N
  else row binds existingCaseId R, or reuses S without a declaration
    Rec-->>Coord: recurrence of resolved act case R
    Coord->>Spine: remediation_adjudication_failed (halt-regression, R, S)
  else declaration references an unknown, open, or unrelated case
    Val-->>Coord: rejected with typed reason
    Coord->>Spine: remediation_adjudication_failed (transition-rejected, case and source ids)
  end
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-02 | Initial generation | jstoup111/ai-conductor#2464 DECIDE |
