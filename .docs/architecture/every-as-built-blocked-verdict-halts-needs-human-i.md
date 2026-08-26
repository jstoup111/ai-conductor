# Components: As-Built BLOCKED Per-Finding Classification and Bounded Remediation

**Last updated:** 2026-08-25
**Scope:** issue #1874 — classify each as-built BLOCKED finding (REMEDIABLE vs DESIGN) and
route REMEDIABLE findings through the existing single-appender remediation seam under a new
`architecture_review_as_built` gate key; DESIGN, ambiguity, and cap exhaustion all halt
`needs-human`.

## Diagram

```mermaid
graph TD
    subgraph Skill["architecture-review --as-built (LLM judgement, schema-constrained)"]
        REPORT["as-built report<br/>.pipeline/architecture-review-as-built.md"]
        FTABLE["## Blocking Findings table (NEW)<br/>per finding: id, class REMEDIABLE or DESIGN,<br/>governing approved clause, plan task"]
        REPORT --> FTABLE
    end

    subgraph Parser["Engine parsers (mechanical, fail-closed)"]
        PV["parseAsBuiltVerdict<br/>artifacts.ts"]
        PF["parseAsBuiltBlockedFindings (NEW)<br/>mirrors parsePrdAuditReport:<br/>closed class set, plan-task binding,<br/>malformed row => whole report invalid"]
        CLS["classifyAsBuiltReviewOutcome<br/>widened: blocked-remediable vs blocked-design"]
    end

    subgraph Routing["Conductor routing"]
        COMP["completion predicate<br/>artifacts.ts (blocked arm)"]
        SERIAL["serial SHIP halt writer<br/>conductor.ts"]
        GROUP["validation-group join halt writer<br/>conductor.ts"]
        PR["planRemediation<br/>gap admission + caps"]
    end

    subgraph Appender["Single-appender seam (unchanged primitive)"]
        ALLOW["requiresPlanGrowthAllowance<br/>as-built source now ADMITTED"]
        APPEND["appendRemediationTasks<br/>remediation-append.ts<br/>rem-as-built-* tasks"]
        LEDGER["kickback-ledger.json<br/>gates.architecture_review_as_built.laps<br/>growth.byGate (existing gate-keyed shape)"]
        CAPS["caps: own lap cap (default 1)<br/>+ shared growth allowance"]
    end

    subgraph Terminals["Terminals"]
        BUILD["navigateBack => BUILD<br/>(revived, bounded route)"]
        HALT["writeHaltMarker needs-human<br/>DESIGN finding, ambiguous/malformed report,<br/>cap exhausted, second lap"]
        SHIP["gate satisfied => SHIP tail continues<br/>remediation recorded per finding<br/>in verdict artifact + shipped record"]
    end

    FTABLE --> PV --> CLS
    FTABLE --> PF --> CLS
    CLS --> COMP
    COMP --> SERIAL
    COMP --> GROUP
    SERIAL -->|all findings REMEDIABLE| PR
    GROUP -->|all findings REMEDIABLE| PR
    SERIAL -->|any DESIGN / invalid| HALT
    GROUP -->|any DESIGN / invalid| HALT
    PR --> ALLOW --> CAPS
    CAPS -->|within allowance| APPEND --> LEDGER
    APPEND --> BUILD
    CAPS -->|exhausted| HALT
    BUILD -.->|rerun gate after rebuild| REPORT
    CLS -->|clean APPROVED after lap| SHIP
```

## Legend

- **NEW** marks new machinery; everything else is existing seams reused.
- Classification is an LLM verdict constrained by a closed schema (repo design principle);
  all bookkeeping (parsing, caps, ledger, halt) is mechanical and fail-closed.
- One appender preserved: as-built findings enter through the same `planRemediation` →
  `appendRemediationTasks` seam prd_audit uses, under their own gate key — no second appender.
- Supersedes `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` D3 (bounded revival of
  the as-built→build route) and amends `adr-2026-08-22-one-owner-per-review-question`'s
  appender clause.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-25 | Initial generation | DECIDE for issue #1874 |
