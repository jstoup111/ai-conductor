# Sequence: As-Built BLOCKED — Remediable Convergence vs Design Halt

**Last updated:** 2026-08-26
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
    participant K as HALT (kickback-cap)

    AR->>P: report with Verdict BLOCKED + Blocking Findings table
    P->>P: parse rows — closed class set, clause cell required for REMEDIABLE
    Note over P: shape and class only — planRemediation resolves each<br/>clause to a plan task via resolveAsBuiltGoverningClause
    alt any row malformed or unclassified
        P->>C: outcome invalid (fail toward human)
        C->>H: writeHaltMarker naming the defect
    else all findings REMEDIABLE
        P->>C: outcome blocked-remediable
        C->>L: check laps «architecture_review_as_built» + growth allowance
        alt within allowance (first lap, tasks within caps)
            C->>C: planRemediation admits clause-bound gaps
            C->>L: append succeeded — persist pendingAsBuiltRemediationFindings
            Note over L: durable: the BUILD traversal below may span dispatches
            C->>B: append rem-as-built-«id» tasks, navigateBack, restage gate stale
            B->>AR: rebuild, then rerun as-built gate
            AR->>P: fresh report
            P->>C: APPROVED — gate satisfied
            C->>L: reload pending findings, project into verdict artifact, clear
        else rebuilt gate returns PLAN_GAP with Outcome delivered: yes
            C->>L: reload pending findings, project the remediation JSON block
            Note over C,L: convergence terminal — the projected block and the<br/>reviewer's PLAN_GAP narrative are ADDITIVE. The shipped<br/>record carries both, and the reader takes the narrative<br/>section in whichever order the two appear
        else lap or growth cap exhausted
            C->>K: kickback-cap halt: exhausted allowance + every finding
        end
    else any finding DESIGN
        P->>C: outcome blocked-design
        C->>H: halt recording per-finding class and governing clause
    end
```

## Legend

- «architecture_review_as_built» — the new gate key in the existing gate-keyed ledger.
- Two terminal classes, not one: DESIGN findings and an invalid report halt `needs-human`;
  cap exhaustion, a second lap, and a no-op escalation halt `kickback-cap`. Every
  `kickback-cap` body lists each finding with its class and governing clause.
- A surviving finding never loops: the second lap is a halt, not another remediation.
- The operator can read afterward which findings were remediated and against which approved
  clause (verdict artifact + shipped record projection).
- That record survives a restart because the pending set is durable ledger state (ADR decision
  7); it is cleared by the same step that projects it, so it never outlives the projection.
- A remediation lap and a delivered PLAN_GAP are not alternatives
  (`adr-2026-08-22-as-built-review-runs-always-with-plan-gap` D2). Both reach the shipped
  record; neither preempts the other.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-25 | Initial generation | DECIDE for issue #1874 |
| 2026-08-26 | Added the pending-findings persist and project-then-clear steps | Operator amendment approving ADR decision 7 (as-built finding AB-D1) |
| 2026-08-26 | Added the kickback-cap terminal; corrected where clause binding happens | As-built drift notes: exhaustion is kickback-cap, and the parser validates shape only |
| 2026-08-26 | Added the delivered-PLAN_GAP convergence branch | AB-R10: remediation and a delivered PLAN_GAP coexist additively |
