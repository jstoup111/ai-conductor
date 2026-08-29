# Sequence: test_suite evaluation under a drift budget

**Last updated:** 2026-08-28
**Scope:** One gate evaluation after a tree-changing event (BUILD task, foreign main-side rebase), showing the inspect-always / tolerate-within-budget flow and where the mode becomes visible (issue #2021).

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor<br/>(tree-attesting recheck / restage)
    participant V as FullSuiteVerifier
    participant F as FullSuiteFingerprint
    participant B as Drift-budget judgement
    participant X as Suite command<br/>(aggregate or scoped)
    participant E as Evidence sidecar
    participant S as Event spine

    C->>V: inspect()
    V->>F: compute fingerprint (8 categories + head sha)
    F-->>V: digest + category hashes

    alt digest matches recorded PASS
        V-->>C: CURRENT (reuse, no run)
        V->>S: evidence_reused (mode recorded)
    else digest mismatch
        V->>B: changed-category vector vs verification.drift_budget
        alt all drift within budget (no unbudgetable category touched)
            B-->>V: tolerated («categories», attested head)
            V->>E: append tolerated categories + drift record
            V->>S: verification event: preserved-within-budget
            V-->>C: CURRENT (verdict preserved, auditable)
        else budget exceeded or dependencies/migrations/environment drifted
            B-->>V: re-run required («exhausted category»)
            V->>X: run (aggregate command, or scoped_command + selectors from feature surface)
            X-->>V: exit status
            V->>E: write PASS/FAIL evidence (mode, selectors, head sha)
            V->>S: verification event: re-ran, names exhausted category
            V-->>C: done / STALE reason
        end
    end

    Note over C,S: Unset verification config = zero tolerance:<br/>every mismatch takes the re-run branch (today's behavior).
```

## Legend

- `B` is a pure function over the inspected category diff and declared budget — it never skips
  the fingerprint read that precedes it.
- The kickback path is unchanged: only a `nonzero_exit` from `X` charges the BUILD kickback
  budget; a within-budget tolerance never reaches `X`, so foreign drift alone can no longer
  burn a kickback.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-28 | Initial generation | DECIDE phase for issue #2021 |
