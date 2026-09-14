# Intake origin: reclaim-merged-feature-worktrees-without-depending

Source-Ref: jstoup111/ai-conductor#1510
Owner: jstoup111

## Desired outcome

- A worktree whose PR is merged and whose shipped record is on main is reclaimed automatically, whether or not its PR was ever recorded in the mergeable watch registry.
- Reclamation covers worktrees whose branch does not follow the `feat/daemon-<slug>` naming convention.
- A worktree for in-progress, parked, or unmerged work is never reclaimed by this path, and an operator can see from the daemon log why each retained worktree was kept.
- An operator can determine the reclaimability of every worktree in a checkout from one command, without hand-cross-referencing branches against GitHub.
