# Intake origin: daemon-reclaim-sweep-deletes-a-worktree-that-holds

Source-Ref: jstoup111/ai-conductor#2636
Owner: jstoup111

## Desired outcome

- A worktree with uncommitted changes or untracked files is never removed by the sweep; it is reported as retained with a reason naming the dirty tree.
- A branch whose tip equals its base with no merged pull request or shipped record behind it is not treated as merged.
- A worktree that was genuinely merged and is clean is still reclaimed as today.
- Every retained candidate appears in the sweep's log with its reason, so an operator can see why it was kept.
