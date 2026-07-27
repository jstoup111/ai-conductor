# Components: Parked-Feature Reconciliation Sweep (#1060)

**Last updated:** 2026-07-27
**Scope:** New `reconcileParkedFeatures` sweep, the guarded single-slug cleanup helper it shares with the operator verb, and the orphan category in the daemon dashboard.

## Diagram

```mermaid
graph TD
    subgraph daemonLoop["Daemon loop (daemon.ts)"]
        SB["sweepBestEffort()<br/>startup + idle tick"]
    end

    subgraph sweep["reconcileParkedFeatures (new module)"]
        CLS["Classifier<br/>per parked slug"]
        CACHE["Outcome cache<br/>(log-noise suppression,<br/>halt-pr-reconciliation pattern)"]
    end

    subgraph inputs["Classification inputs"]
        PM["park-marker.ts<br/>listOperatorParkedSlugs"]
        IM[".docs/intake/«slug».md<br/>Source-Ref → owner/repo#N"]
        TC["TrackerClient<br/>issue state open/closed"]
        GIT["git merge-base --is-ancestor<br/>«branch» origin/main"]
    end

    subgraph cleanup["Guarded cleanup (new helper)"]
        GC["reconcileMergedPark(slug)<br/>single-path, never bulk<br/>re-verifies: ancestry, record-on-main,<br/>no in-flight run, well-formed slug"]
        WT["worktree remove + branch delete<br/>explicit single slug"]
        UP["unpark (marker removal LAST,<br/>via unpark impl + fallback)"]
        RP["record missing → delegate to<br/>ST-916 record-only repair-PR seam<br/>(zero invented records)"]
    end

    subgraph surfaces["Operator surfaces"]
        CFG["config.yml<br/>reconcile_parked_auto_cleanup<br/>(default: true)"]
        CLI["conduct daemon reconcile-parked «slug»<br/>(new operator verb — works regardless of toggle)"]
        DASH["daemon-dashboard.ts<br/>PARKED + orphan / merged-ready annotations"]
    end

    SB --> CLS
    CLS --> CACHE
    PM --> CLS
    IM --> CLS
    TC --> CLS
    GIT --> CLS
    CFG -->|"toggle on (default)"| CLS
    CLS -->|"merged + toggle on"| GC
    CLS -->|"merged + toggle off"| DASH
    GC --> WT --> UP
    GC -.->|"record not on main"| RP
    CLS -->|"orphan: issue closed AND not ancestor"| DASH
    CLI --> GC
```

## Legend

- **merged** — the parked branch tip is an ancestor of `origin/main`: every commit is already on main, so cleanup is information-lossless. With `reconcile_parked_auto_cleanup` on (default) the sweep reconciles it automatically; off → annotated `merged — ready to reconcile` only.
- **orphan** — target issue is closed but the branch is NOT an ancestor of main: may hold unique work; surfaced only, never auto-deleted.
- Deletion preconditions (re-verified inside the helper, never trusted from the caller): ancestry proof, shipped record on the base branch, no in-flight `.pipeline` run, single well-formed slug. Record missing → delegate creation to the ST-916 repair-PR seam and defer cleanup; never invent a record.
- Slugs with no intake marker or an unparseable `Source-Ref` (shared parser) are left untouched (fail-closed: no classification → no action, no orphan label from issue state alone).
- The guarded cleanup helper is the single shared deletion path for both the sweep and the operator verb; it operates on exactly one named slug per call. Park-marker removal is its LAST step. This is the scoped exception amended into the operator-park PRD/FR-7 (see ADR).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-27 | Initial generation | DECIDE for #1060 |
