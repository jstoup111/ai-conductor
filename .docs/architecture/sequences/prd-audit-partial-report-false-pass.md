# Sequence: prd_audit coverage-complete gate

**Last updated:** 2026-08-09
**Scope:** How the `prd_audit` SHIP gate decides pass / block / re-audit once the structured
audit manifest (`.pipeline/prd-audit.json`) is the pass signal, and how a partial audit is
resumed rather than discarded. Covers the four predicate read sites that today score a partial
report as clean.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Conductor
    participant SW as sweptArtifactStillValid
    participant GV as gateVerdictStillValid («817» code stamp)
    participant P as prd_audit predicate
    participant M as .pipeline/prd-audit.json
    participant R as .pipeline/prd-audit.md
    participant S as prd-audit skill
    participant SPEC as .docs/specs («FR-N» roster)

    Note over C,SPEC: Re-entry into prd_audit after a prior failed or kicked-back attempt

    C->>SW: sweep stale run evidence for prd_audit
    SW->>M: read manifest
    SW->>GV: has feature-runtime code moved since the stamp?
    alt code unchanged
        GV-->>SW: preserve
        SW-->>C: SPARE manifest and report
        Note right of SW: partial verdicts survive,<br/>only missing FRs need auditing
    else code changed
        GV-->>SW: invalidate
        SW-->>C: DELETE manifest and report
        Note right of SW: full re-audit of every FR
    end

    C->>S: dispatch prd-audit skill
    S->>M: read surviving manifest (if any)
    S->>SPEC: enumerate FR roster
    S->>S: audit only FRs lacking a verdict
    S->>M: write roster plus per-FR verdicts
    S->>R: write human-readable report

    C->>P: evaluate completion
    P->>M: read manifest

    alt manifest absent or unparseable
        P-->>C: BLOCK — no pass signal
    else roster empty
        P-->>C: BLOCK — roster must be non-empty
    else some roster FR has no verdict
        P-->>C: BLOCK — incomplete audit, name the missing FRs
    else roster disagrees with enumerable PRD FRs
        P->>SPEC: cross-check «FR-N» ids
        P-->>C: BLOCK — roster understates the PRD
    else a verdict is blocking and not ACCEPTED
        P-->>C: BLOCK — route by gap class
    else every roster FR has a non-blocking verdict
        P->>P: write code stamp
        P-->>C: PASS
    end
```

## Legend

- **`sweptArtifactStillValid`** (`artifacts.ts:681`) — decides whether stale run evidence is
  deleted before a re-run. This is the seam that makes partial resume possible: it already
  consults the `#817` code stamp, so "spare the partial audit" and "force a full re-audit" fall
  out of an existing question rather than new invalidation machinery.
- **`gateVerdictStillValid`** (`gate-code-validity.ts`) — answers whether the gate's
  `feature-runtime` surface has moved since the stamped verdict was formed.
- **Manifest vs report** — `.pipeline/prd-audit.json` is the machine-read pass signal;
  `.pipeline/prd-audit.md` remains the human-readable view. Both are gitignored run evidence,
  not committed design artifacts.
- **Cross-check** — applied only where the PRD carries literal `FR-N` ids (43 of 48
  non-`SUPERSEDED-` specs as of 2026-08-09). Where it cannot be applied, the manifest's own
  completeness requirement still holds, so the gate never silently degrades to fail-open.
- **Blocking verdict** — unchanged semantics: any verdict other than `ALIGNED` that is not a
  human-`ACCEPTED` divergence, routed by gap class (`impl-gap` to BUILD, otherwise HALT).

The two remaining predicate read sites not drawn above — the gate-code-validity preserve
pre-check (`artifacts.ts:2257`) and the daemon's kickback classifier
(`classifyPrdAuditGaps:3267`) — apply the same completeness question as the main path. All four
sites must share one predicate; a site left reading only for blocking rows keeps the fail-open
path alive.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Initial generation | New gate decision flow for the coverage-complete `prd_audit` manifest (scoped stopgap for #1398) |
