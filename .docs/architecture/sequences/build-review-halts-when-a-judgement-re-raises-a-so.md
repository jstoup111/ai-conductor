# Sequence: unbound re-raise of a resolved case's source

**Last updated:** 2026-10-19
**Scope:** One build_review lap in which the remediate judgement re-raises source «S», which only a
resolved case «R» owns, as a new act case and as a new escalation (the two shapes in #3292).

## Diagram

```mermaid
sequenceDiagram
  participant J as remediate judgement
  participant C as adjudication coordinator
  participant RC as case reconciler
  participant E as decision-stop effects
  participant S as case store
  participant K as kickback ledger
  participant RD as reducer

  J->>C: unbound act row on «S» (owner «R» resolved)
  C->>C: no existingCaseId, so no regression check
  C->>RC: reconcile ordinary cases
  RC->>S: mutate: append new case «N», «R» unchanged
  S->>S: open owners of «S» = {«N»}, admitted
  S-->>RC: ok
  RC-->>C: caseIdsByRef «N», effect reserved
  C->>K: charge new action effect (cap still bounds)
  J->>C: unbound escalate row on «S»
  C->>E: persistBuildReviewDecisionStop
  E->>S: mutate: append open stop
  alt a second OPEN owner of «S» exists
    S-->>E: rejected-transition + violation
    E-->>C: reason + violation
    C-->>C: failStore names invariant, cases, sources
  else replay of the same stop
    E-->>C: already-persisted (converged)
  else admitted
    S-->>E: ok
  end
  C->>RD: reduce over all cases
  RD->>S: currentBuildReviewSourceLinks
  RD-->>C: route from the authoritative link per source
```

## Legend

- «R» is resolved history and stays byte-identical. «N» is the new case. «S» is the shared source id.
- The open-open refusal is unchanged; only resolved owners stop counting.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-19 | Initial generation | #3292 DECIDE (Medium) |
