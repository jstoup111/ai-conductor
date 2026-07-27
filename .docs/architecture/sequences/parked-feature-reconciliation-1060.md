# Sequence: Parked-Feature Reconciliation Pass (#1060)

**Last updated:** 2026-07-27
**Scope:** One sweep pass over all parked slugs, showing the merged, orphan, and fail-closed outcomes.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon (sweepBestEffort)
    participant R as reconcileParkedFeatures
    participant P as park-marker
    participant G as git
    participant T as TrackerClient (gh)
    participant C as guarded cleanup helper
    participant L as daemon.log / dashboard state

    D->>R: run (startup, then each idle tick)
    R->>P: listOperatorParkedSlugs()
    P-->>R: [slug1, slug2, ...]
    loop per parked slug (error-isolated)
        R->>G: merge-base --is-ancestor «branch» origin/main
        alt branch fully merged into main
            alt reconcile_parked_auto_cleanup off
                R->>L: annotate «slug» merged — ready to reconcile
            else toggle on (default)
                R->>C: reconcileMergedPark(«slug»)
                C->>G: re-verify ancestry (never trusts caller)
                C->>C: preconditions: record on main, no in-flight run
                alt record missing on main
                    C->>L: defer — delegate to ST-916 repair-PR seam
                else all preconditions hold
                    C->>G: worktree remove «path», branch -D «branch» (single path)
                    C->>P: unpark «slug» (marker removal LAST)
                    C-->>R: reconciled
                    R->>L: [parked-reconciliation] reconciled «slug»
                end
            end
        else not ancestor — check issue state
            R->>R: read .docs/intake/«slug».md → Source-Ref
            alt marker missing or unparseable
                R->>L: skip «slug» (fail-closed, no classification)
            else has Source-Ref
                R->>T: issue state for owner/repo#N
                alt issue closed
                    R->>L: mark «slug» orphan — needs manual review
                else issue open
                    R->>L: normal parked (no change)
                end
            end
        end
    end
    R->>L: summary line (suppressed when unchanged)
```

## Legend

- Per-slug failures are caught and logged; one bad slug never aborts the pass (halt-pr-reconciliation pattern).
- The ancestry check is the ONLY signal that authorizes deletion; issue state alone never deletes anything.
- The summary and per-slug lines use the injected outcome cache so repeated idle ticks stay quiet when nothing changed.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-27 | Initial generation | DECIDE for #1060 |
