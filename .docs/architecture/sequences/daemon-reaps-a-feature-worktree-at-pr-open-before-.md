# Sequence: Ship → Retain → Reap-on-Main (#1091)

**Last updated:** 2026-07-29
**Scope:** One feature from the daemon's ship happy path through the sweep passes that decide
whether its worktree is retained or reaped, including the merged, still-open, and closed-unmerged
outcomes.

## Diagram

```mermaid
sequenceDiagram
    participant R as daemon-runner (makeRunFeature)
    participant W as .worktrees/«slug»
    participant REG as mergeable-watch.jsonl
    participant S as mergeable-sweep
    participant GH as gh (PR state)
    participant G as git (origin/main)
    participant L as daemon.log / dashboard
    participant OP as Operator

    R->>R: shipmentFailureReason() === null (verified ship)
    R->>R: cleanupHaltPresentation()
    R->>REG: enrollWatch {prUrl, slug, repoCwd}
    R->>R: markProcessed(slug, prUrl)
    Note over R,W: reap call removed — worktree and .pipeline/ evidence survive
    R->>L: retained «slug» — reason: pr-open-awaiting-main

    loop each sweep pass
        S->>REG: read entries
        S->>GH: prMergeState(prUrl)
        alt state MERGED
            S->>G: fetch origin main
            S->>G: cat-file -e origin/main:.docs/shipped/«slug».md
            alt record present at path
                S->>W: teardownWorktree(keep=false)
                S->>REG: prune entry (FR-13)
                S->>L: reaped «slug» — reason: shipped-record-on-main
            else record absent (or fetch failed)
                S->>L: retained «slug» — reason: record-not-yet-on-main
                Note over S,REG: entry kept — re-checked next pass (idempotent)
            end
        else state CLOSED unmerged or NOTFOUND
            S->>REG: prune entry
            S->>L: retained «slug» — reason: pr-closed-unmerged, reclaimable
            S->>L: dashboard lists «slug» under retained worktrees
        else state OPEN
            S->>L: retained «slug» — reason: pr-open-awaiting-main
            S->>S: continue with existing label decision tree
        end
    end

    opt operator reclaims an abandoned worktree
        OP->>L: conduct daemon status (sees retained «slug»)
        OP->>W: conduct daemon reclaim-worktree «slug»
        Note over OP,W: single named slug, path printed before removal
    end

    opt resume of a closed-unmerged feature
        R->>W: read .pipeline/task-status.json + evidence sidecar
        Note over R,W: present — no false no_task_progress, no task re-execution
    end
```

## Legend

- The runner's evidence check (`shipmentFailureReason` → `evaluateShipmentEvidence`) stays
  PR-head-scoped and unchanged; the new gate is a separate, main-scoped check owned by the sweep.
- The gate is **file presence at path** on `origin/main`, not ancestry — squash-merge makes the
  feature branch a non-ancestor of main even after merging (#1114, verified against PR #1138).
- Retention is not permanent for closed-unmerged PRs: the registry entry is pruned (nothing left to
  label) but the worktree is surfaced to the operator with a named reclaim verb, satisfying the
  issue's "no worktree retained forever with no way to see or reclaim it" negative path.
- Every branch of the decision emits a log line naming the driving condition, so an operator can
  distinguish a deliberate retention from a leak.
- Post-ship **CI-fix** continues to cut `.worktrees/resolve-«slug»` from the branch tip and is
  unaffected by the retained feature worktree.
- **Rebase resolution is NOT unaffected.** `isEligibleForResolve` Gate 6 (`autoresolve.ts:216-226`)
  skips any slug whose `.worktrees/«slug»` exists, so retention suppresses automatic rebase
  resolution on every open PR. Descoped from this spec to #1150 by operator decision (2026-07-29);
  tracked as the open condition on this feature's architecture review.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-29 | Initial generation | DECIDE for #1091 |
