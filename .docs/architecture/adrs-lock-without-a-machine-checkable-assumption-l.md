# Components: Machine-checked ADR assumption ledger

**Last updated:** 2026-10-10
**Scope:** How an ADR's `## Assumptions` ledger is authored, parsed once, and enforced at the
two DECIDE paths that author ADRs (intake jstoup111/ai-conductor#542).

## Diagram

```mermaid
graph TD
    subgraph AUTHOR["DECIDE authoring (skills)"]
        VC["verify-claims skill<br/>surfaces assumptions:<br/>basis, confidence, impact, load-bearing"]
        AR["architecture-review skill<br/>writes ADR from template"]
        TPL["adr.md.template<br/>required ## Assumptions section"]
        OP(("Operator<br/>approves each load-bearing<br/>non-verified entry"))
    end

    ADR[("ADR file<br/>.docs/decisions/adr-«date»-«slug».md<br/>## Assumptions: entries or<br/>'No load-bearing assumptions.'")]

    subgraph PARSE["artifacts.ts — single parsing authority"]
        LEDGER["parseAdrAssumptionLedger<br/>presence + per-entry shape +<br/>approval-marker rule"]
        SCOPE["evaluateAdrAssumptionLedgers<br/>adr-assumption-ledger-scope.ts<br/>added / changed-with-section ADRs<br/>vs merge base; fails closed"]
        APPROVAL["adrApprovalStatus (existing)"]
        DECISIONS["parseAdrDecisions (existing)"]
    end

    subgraph GATES["Enforcement points"]
        LAND["compose land gate<br/>land-spec.ts — ADRs added by the spec<br/>new reason: adr-assumption-ledger"]
        CONDUCT["/conduct architecture_review gate<br/>GATE_ONLY predicate, step now gating<br/>ADRs added on feature branch"]
    end

    subgraph OUT["Outcomes"]
        REJECT["land refused<br/>names ADR + failing entries"]
        RERUN["step not complete<br/>names ADR + failing entries"]
        PASS["spec proceeds"]
    end

    VC --> AR
    TPL --> AR
    OP -. "APPROVED by operator «date»" .-> AR
    AR --> ADR

    ADR --> LEDGER
    ADR --> APPROVAL
    ADR --> DECISIONS

    LEDGER --> SCOPE
    SCOPE --> LAND
    APPROVAL --> LAND
    DECISIONS --> LAND
    SCOPE --> CONDUCT

    LAND -- "missing / malformed / unapproved entry" --> REJECT
    CONDUCT -- "missing / malformed / unapproved entry" --> RERUN
    LAND -- "valid" --> PASS
    CONDUCT -- "valid" --> PASS
```

## Sequence: compose land with a ledger

```mermaid
sequenceDiagram
    participant C as Composer session
    participant L as landSpec (land-spec.ts)
    participant G as git (merge-base diff)
    participant P as parseAdrAssumptionLedger
    C->>L: compose land --worktree «path»
    L->>G: changed .docs/decisions/adr-*.md since merge-base
    G-->>L: added ADR paths (+ changed ones already carrying the section)
    loop each in-scope ADR
        L->>P: ADR content
        P-->>L: ok | missing-section | malformed-entry | unapproved-entry
    end
    alt any ADR fails
        L-->>C: landGateError adr-assumption-ledger (ADR + entry ids + rule)
    else all pass
        L-->>C: commit .docs, print slug/branch/repoPath
    end
```

## Legend

- **AUTHOR** — prompt-level authoring. These skills produce the section; they are not what enforces it.
- **PARSE** — pure functions in `src/conductor/src/engine/artifacts.ts`. `parseAdrAssumptionLedger` is
  new; the other two exist and are shown because the same gates already call them.
- **GATES** — the two DECIDE paths that author ADRs: composer `land` (pre-merge) and the `/conduct`
  in-run DECIDE (`architecture_review` gate predicate; the step moves from advisory to gating so a
  failure blocks rather than auto-skipping). Both inspect only ADRs the spec newly added, plus changed
  pre-existing ADRs that already carry the section, so the legacy corpus is exempt. Daemon discovery
  is deliberately **not** a rung, following adr-2026-09-02-adr-decision-citability-contract D4.
- Dashed edge — a human action recorded in the artifact, not a runtime call.
- `«…»` — placeholder.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | DECIDE for intake jstoup111/ai-conductor#542 (Approach A, Tier M) |
| 2026-10-10 | Dropped daemon-discovery rung; conduct rung via gating architecture_review | Operator decisions during architecture review |
| 2026-10-10 | Added shared in-scope evaluation (`evaluateAdrAssumptionLedgers`) between parser and both gates | /plan update; one owner per adr-2026-09-23 |
