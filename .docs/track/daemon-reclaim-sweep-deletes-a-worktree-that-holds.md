# Track: Daemon reclaim sweep deletes a worktree that holds uncommitted work

Track: technical

Scope boundary: Both guards in the reclaim path — (1) a worktree with uncommitted changes or untracked files is never removed and is retained with a reason naming the dirty tree; (2) a branch whose tip equals its merge-base with origin/main is not merge-proven by ancestry alone, only by a merged-PR head or shipped record. Genuinely merged clean worktrees are still reclaimed; every retained candidate is logged with its reason. Excluded: a minimum-age floor and an audit of other `--force` removal paths elsewhere in the engine.

Daemon safety fix in `reconcileMergedPark`; no new operator-facing capability, so no PRD.
