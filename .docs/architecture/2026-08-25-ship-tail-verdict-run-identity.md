# Architecture: SHIP-tail verdict run-identity contract (#1838)

**Last updated:** 2026-08-25
**Scope:** How per-dispatch run identity flows from the engine into the SHIP-tail verdict
artifacts (prd_audit, architecture_review_as_built, manual_test) and back through every
reader — completion checks, `classifyPrdAuditGaps`, and the halt/routing paths — plus the
post-dispatch write handshake.

## Components

```mermaid
graph TD
    subgraph Engine ["Engine (conductor.ts)"]
        DISP["Step dispatcher<br/>issues runId per verdict dispatch"]
        HANDSHAKE["Write handshake<br/>post-dispatch: outputs exist + carry runId"]
        RETRY["Retry classifier<br/>bounded retry, then halt"]
        HALT["Halt writer<br/>names artifact + expected/found identity"]
    end

    subgraph Skills ["Verdict skills (provider-run)"]
        PRD["prd-audit skill"]
        ASBUILT["architecture-review as-built"]
        MANUAL["manual-test skill"]
    end

    subgraph Artifacts [".pipeline/ verdict artifacts"]
        REPORT["prd-audit.md + marker<br/>Run-Id: «runId»"]
        ASREPORT["architecture-review-as-built.md + marker<br/>Run-Id: «runId»"]
        MREPORT["manual-test results + marker<br/>Run-Id: «runId»"]
    end

    subgraph Readers ["Readers (artifacts.ts)"]
        COMPLETE["Completion checks<br/>identity match, mtime fallback"]
        CLASSIFY["classifyPrdAuditGaps<br/>identity match (was session-mtime)"]
    end

    DISP --> PRD
    DISP --> ASBUILT
    DISP --> MANUAL
    PRD -->|"content only"| REPORT
    ASBUILT -->|"content only"| ASREPORT
    MANUAL -->|"content only"| MREPORT
    DISP -->|"engine stamps Run-Id at settle<br/>(second field beside codeStamp)"| REPORT
    HANDSHAKE -->|verifies| REPORT
    HANDSHAKE --> ASREPORT
    HANDSHAKE --> MREPORT
    HANDSHAKE -->|"missing / mismatched"| RETRY
    RETRY -->|"budget exhausted"| HALT
    COMPLETE -->|reads| REPORT
    CLASSIFY -->|"fresh-identity rows only"| REPORT
```

## Sequence: stale-verdict prevention

```mermaid
sequenceDiagram
    participant C as Conductor
    participant P as Provider (audit skill)
    participant A as .pipeline artifacts
    participant R as Readers (completion/classify)

    C->>C: mint runId (existing attempt.id) for this dispatch
    C->>P: dispatch audit (skill writes content only)
    P->>A: write report + marker (no identity fields)
    P-->>C: provider run completes
    C->>A: engine stamps runId into identity sidecar at settle
    C->>A: handshake: outputs written by THIS dispatch?
    alt outputs fresh (identity matches)
        C->>R: completion + classify read matching-identity verdict
        R-->>C: verdict (pass / blocking rows) — current lap only
    else missing or prior-lap identity
        C->>C: score attempt failed - staleness reason names artifact, expected runId, found id/mtime
        C->>P: bounded retry (existing step-retry budget)
        C->>C: budget exhausted: halt "audit produced no verdict" (never stale findings)
        Note over C,A: re-dispatch after halt-clear ignores prior-identity artifacts - no hand-deletion
    end
```

## Legend

- «runId» — engine-issued per-dispatch identifier (precedent: build_review `lapId`).
- Mtime fallback applies only to legacy artifacts written before this contract.
- build_review is out of scope: it already carries `lapId`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-25 | Initial generation | DECIDE for #1838 (spec authoring) |
