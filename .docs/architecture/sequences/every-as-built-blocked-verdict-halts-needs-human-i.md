# Sequence: As-Built BLOCKED — Remediable Convergence vs Design Halt

**Last updated:** 2026-08-25
**Scope:** issue #1874 — the two BLOCKED paths after per-finding classification, plus the
fail-closed and cap-exhaustion terminals.

## Diagram

```mermaid
sequenceDiagram
    participant AR as as-built review (skill)
    participant P as engine parsers
    participant C as conductor
    participant L as kickback ledger
    participant B as BUILD
    participant H as HALT (needs-human)

    AR->>P: report with Verdict BLOCKED + Blocking Findings table
    P->>P: parse rows (closed class set, clause + plan-task binding)
    alt any row malformed or unclassified
        P->>C: outcome invalid (fail toward human)
        C->>H: writeHaltMarker naming the defect
    else all findings REMEDIABLE
        P->>C: outcome blocked-remediable
        C->>L: check laps «architecture_review_as_built» + growth allowance
        alt within allowance (first lap, tasks within caps)
            C->>C: planRemediation admits clause-bound gaps
            C->>B: append rem-as-built-«id» tasks, navigateBack, restage gate stale
            B->>AR: rebuild, then rerun as-built gate
            AR->>P: fresh report
            P->>C: APPROVED — gate satisfied, remediation recorded per finding
        else lap or growth cap exhausted
            C->>H: halt listing every finding + exhausted allowance
        end
    else any finding DESIGN
        P->>C: outcome blocked-design
        C->>H: halt recording per-finding class and governing clause
    end
```

## Legend

- «architecture_review_as_built» — the new gate key in the existing gate-keyed ledger.
- A surviving finding never loops: the second lap is a halt, not another remediation.
- The operator can read afterward which findings were remediated and against which approved
  clause (verdict artifact + shipped record projection).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-25 | Initial generation | DECIDE for issue #1874 |
