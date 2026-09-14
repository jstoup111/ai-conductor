# Track: Reclaim merged feature worktrees without depending on the mergeable watch registry

Track: technical

Scope boundary (operator-confirmed 2026-09-14, revised after the repo-wide ADR sweep):

- The candidate set for automatic reclamation is the set of git-registered worktrees directly
  under `.worktrees/` (from `git worktree list --porcelain`, never a flat `readdir`), unioned with
  the operator-parked slugs the sweep already reads. Presence in `.daemon/mergeable-watch.jsonl`
  plays no part.
- Every removal goes through the existing guarded single-slug helper `reconcileMergedPark`
  (`park-reconciliation.ts`), which keeps its multi-proof deletion authority (ancestry or merged-PR
  head identity), its project-teardown invitation, its refusal taxonomy, and its branch deletion.
  No new removal module is introduced.
- The helper is extended to take the worktree's actual branch from the listing instead of
  re-deriving it from the slug's final path segment, so hand-named worktrees (`hotfix-x` on
  `hotfix/x`) and daemon worktrees (`<slug>` on `feat/daemon-<slug>`) both resolve.
- The shipped-record-on-main precondition is scoped: it stays required for a worktree on a
  `feat/daemon-*` branch (the daemon backlog dedups on that record), and is not required for a
  worktree on any other branch, where merge proof alone authorizes teardown.
- Deleting the proven-merged branch stays in scope; it is what the helper already does.
- In-flight, parked, halted (`.pipeline/HALT`), `engineer-*`, `resolve-*`, and nested-path
  worktrees are never reclaimed by this path, and each retention names its reason.
- Per-worktree reclaim/retain/failure outcomes ride the `ConductorEvent` spine.
- The sweep is gated by a boolean config key with a stated default, registered in the config-key
  consumer registry.

Excluded by operator decision:
- No on-demand operator command reporting per-worktree reclaimability. This defers intake
  Desired-outcome #4 (`jstoup111/ai-conductor#1510`); a follow-up intake issue records it.
- No repair of watch-registry enrollment coverage or of its 100-entry trim; reclamation simply
  stops depending on that registry.

Rationale: internal daemon housekeeping with no user-facing capability, so acceptance criteria
live directly in stories and no PRD is authored.
