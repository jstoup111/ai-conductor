# Components: As-Built BLOCKED Per-Finding Classification and Bounded Remediation

**Last updated:** 2026-08-26
**Scope:** issue #1874 — classify each as-built BLOCKED finding (REMEDIABLE vs DESIGN) and
route REMEDIABLE findings through the existing single-appender remediation seam under a new
`architecture_review_as_built` gate key. DESIGN findings and an ambiguous or malformed
report halt `needs-human`; cap exhaustion, a second lap, and a no-op escalation halt
`kickback-cap` with every finding listed.

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
        PF["parseAsBuiltBlockedFindings (NEW)<br/>mirrors parsePrdAuditReport:<br/>closed class set, clause cell required<br/>for REMEDIABLE (presence only),<br/>malformed row => whole report invalid"]
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
        LEDGER["kickback-ledger.json (version 1, unchanged)<br/>gates.architecture_review_as_built.laps<br/>growth.byGate (existing gate-keyed shape)"]
        PENDING["pendingAsBuiltRemediationFindings (NEW, optional)<br/>durable per-finding record of the authorized lap<br/>survives the dispatch boundary BUILD crosses<br/>ADR decision 7"]
        CAPS["caps: own lap cap (default 1)<br/>+ shared growth allowance"]
    end

    subgraph Terminals["Terminals"]
        BUILD["navigateBack => BUILD<br/>(revived, bounded route)"]
        HALT["writeHaltMarker needs-human<br/>DESIGN finding,<br/>ambiguous/malformed report"]
        CAPHALT["writeHaltMarker kickback-cap<br/>cap exhausted, second lap,<br/>no-op escalation<br/>body lists every finding:<br/>id, class, governing clause, summary"]
        SHIP["gate satisfied => SHIP tail continues<br/>remediation recorded per finding<br/>in verdict artifact + shipped record"]
        PGCONV["convergence terminal: PLAN_GAP delivered<br/>after a remediation lap<br/>both records are ADDITIVE — the remediation<br/>JSON block AND the PLAN_GAP narrative<br/>survive into the shipped record"]
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
    PR -->|"resolveAsBuiltGoverningClause<br/>binds each clause to a plan task here"| ALLOW --> CAPS
    CAPS -->|within allowance| APPEND --> LEDGER
    APPEND -->|append succeeded: record the findings it authorized| PENDING
    APPEND --> BUILD
    CAPS -->|exhausted| CAPHALT
    BUILD -.->|rerun gate after rebuild| REPORT
    CLS -->|clean APPROVED after lap| SHIP
    PENDING -->|projected into the verdict artifact, then cleared| SHIP
    CLS -->|"PLAN_GAP + Outcome delivered: yes<br/>after a lap"| PGCONV
    PENDING --> PGCONV
    PGCONV --> SHIP
```

## Legend

- **NEW** marks new machinery; everything else is existing seams reused.
- Classification is an LLM verdict constrained by a closed schema (repo design principle);
  all bookkeeping (parsing, caps, ledger, halt) is mechanical and fail-closed.
- One appender preserved: as-built findings enter through the same `planRemediation` →
  `appendRemediationTasks` seam prd_audit uses, under their own gate key — no second appender.
- `pendingAsBuiltRemediationFindings` is the feature's only durable-state addition (ADR
  decision 7). It is optional, validated fail-closed, carries no ledger version bump, and is
  cleared by the same step that projects it — a pending entry never outlives its projection.
- The two record kinds are additive, never alternatives
  (`adr-2026-08-22-as-built-review-runs-always-with-plan-gap` D2): a lap can remediate
  REMEDIABLE findings AND deliver a PLAN_GAP, and the shipped record carries both. The reader
  selects the narrative `## Recorded Findings` section, never the projected JSON block, in
  whichever order they appear.
- Supersedes `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` D3 (bounded revival of
  the as-built→build route) and amends `adr-2026-08-22-one-owner-per-review-question`'s
  appender clause.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-25 | Initial generation | DECIDE for issue #1874 |
| 2026-08-26 | Added the `pendingAsBuiltRemediationFindings` ledger node and its projection edge | Operator amendment approving ADR decision 7 (as-built finding AB-D1) |
| 2026-08-26 | Split the halt terminal into needs-human vs kickback-cap; moved clause binding off the parser | As-built drift notes: cap exhaustion is kickback-cap, and clause resolution happens in planRemediation |
| 2026-08-26 | Added the delivered-PLAN_GAP convergence terminal | AB-R10: a remediation lap and a delivered PLAN_GAP coexist, and both records are additive |
