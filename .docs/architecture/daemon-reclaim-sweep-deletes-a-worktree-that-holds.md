# Sequence: Reclaim sweep retains dirty and zero-commit worktrees

**Last updated:** 2026-09-21
**Scope:** `reconcileMergedPark` in `src/conductor/src/engine/park-reconciliation.ts`: the guarded delete helper the merged-worktree reclaim sweep (#2574) calls for each candidate. Covers the two new guards from #2636.

## Diagram

```mermaid
sequenceDiagram
    participant Sweep as reconcileParkedFeatures
    participant Helper as reconcileMergedPark
    participant Git as git
    participant Gh as gh
    participant Spine as event spine

    Sweep->>Helper: candidate «slug», «branch»
    Helper->>Helper: in-flight / phase-marker guard (unchanged)
    Helper->>Git: gatherMergeEvidence (ancestry, shipped record)
    alt branch tip == merge-base with origin/main (zero commits)
        Helper->>Gh: merged PR whose head is this tip?
        alt no merged-PR head and no shipped record
            Helper-->>Sweep: refusal no-merge-proof (NEW: bare ancestry rejected)
        end
    else ancestry or merged-PR head proven
        Helper->>Helper: continue (unchanged)
    end
    Helper->>Git: status --porcelain in .worktrees/«slug» (NEW)
    alt any modified or untracked path
        Helper-->>Sweep: refusal dirty-worktree (NEW)
    else clean
        Helper->>Git: worktree remove, branch -D (unchanged)
        Helper-->>Sweep: reclaimed with proof
    end
    Sweep->>Spine: worktree_reclaim_reclaimed / _failed with refusal / _retained with reason
```

## Legend

- **NEW** marks the #2636 guards; everything else is the current behaviour.
- The dirty-tree check runs after merge proof and immediately before the destructive step, so a tree that becomes dirty during proof gathering is still caught.
- A refusal is reported through the existing `worktree_reclaim_failed` event and the sweep log line. No new channel.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-21 | Initial generation | #2636: sweep deleted a dirty zero-commit operator worktree |
