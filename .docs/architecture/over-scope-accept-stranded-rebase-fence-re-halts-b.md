# Sequence: Over-scope accept survives the rebase publication fence

**Last updated:** 2026-10-04
**Scope:** Resume after a prd_audit over-scope halt on a feature whose applied rebase preserved
`prd_audit` (issue #2983). Shows the resume-time fence split (integrity faults vs. a fresh
unsatisfied re-judgement), the unchanged finish-time fence, resume-time completion of an interrupted (`applying`) operation, and the
HALT.cleared harvest it unblocks.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant D as Daemon re-kick
    participant C as Conductor (resume path)
    participant F as Rebase publication fence
    participant G as .pipeline/gates/«gate».json
    participant A as prd_audit lap
    participant W as Widening stores + HALT.cleared
    participant T as applyRebaseTransition
    participant Fin as finish predicate

    Note over A,W: Earlier lap: NC.1 OVER_SCOPE, offer persisted, prd_audit verdict satisfied=false, HALT written
    Op->>W: halt clear (decision: accept + rationale) → HALT.cleared
    D->>C: resume
    C->>F: classify durable rebase operation
    F->>G: read rebase.json + each preserved gate verdict
    opt operation status = applying (interrupted)
        alt full descriptor with persisted candidates
            C->>T: re-apply recorded transition (same id, candidates)
            T->>G: stamp unchanged originals, keep newer verdicts, invalidate recorded gates, mark applied
        else full descriptor without candidates (pre-ADR record)
            C->>T: re-apply with invalidated + preserved re-checked, no preservation
        else provisional preparing descriptor
            C->>T: invalidate every gate downstream of rebase, no preservation
        end
        alt transition refused
            C-->>Op: HALT needs-human (as the normal path)
        end
        C->>F: re-classify completed operation
    end
    alt integrity fault (malformed / preserved PASS without replay-bound stamp / absent or pre-appliedAt verdict)
        F-->>C: blocker
        C->>W: read pending or recorded over-scope decisions
        C-->>Op: HALT needs-human naming fault + decision (criterion, recorded state) + next step
    else preserved gate re-judged unsatisfied after appliedAt
        F-->>C: no resume blocker (ordinary unsatisfied gate)
        C->>C: verdict clamp → earliest unsatisfied gate (prd_audit)
        C->>A: dispatch prd_audit
        A->>W: harvest HALT.cleared → recorded decision
        alt recorded decision = accept
            A->>G: prd_audit satisfied=true (fresh re-judgement)
        else refused or no decision
            A-->>Op: halt exactly as today
        end
    end
    C->>Fin: finish completion check
    Fin->>F: full fence (all preserved gates satisfied + stamped or fresh)
    F-->>Fin: blocks publication until every preserved gate is satisfied
```

## Legend

- **Rebase publication fence** — `rebaseOperationPublicationBlocker` (`gate-code-validity.ts`). The
  feature splits its resume use from its finish use; finish keeps the full check.
- **prd_audit verdict reason** — the persisted unsatisfied reason reports the real classification
  (awaiting operator decision) rather than a pre-reconciliation `missing-relation`.
- **applyRebaseTransition** — the existing idempotent transition writer; it now persists
  preservation candidates on the operation record so resume can complete an interrupted operation
  (adr-2026-10-04-resume-completes-interrupted-rebase-operation).
- `«gate»` — any gate named in the rebase transition's `preserved` list.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-04 | Initial generation | #2983: operator accept stranded behind the resume-time rebase fence |
