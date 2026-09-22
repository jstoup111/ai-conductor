# Halt record

Status: halted
Slug: daemon-reclaim-sweep-deletes-a-worktree-that-holds
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-daemon-reclaim-sweep-deletes-a-worktree-that-holds
Head SHA: e70e345f4fcc84cce549253a609bea91ba363cea
Halted at: 2026-09-22T02:57:22.813Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given a reclaim candidate whose branch is merge-proven and whose worktree has a modified tracked file, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree`, the worktree directory and the modified file still exist, and the branch ref still exists.
Task ids: 1
Done when checks: The `reconcileMergedPark` test with a modified tracked file in porcelain output returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test with only an untracked `??` path in porcelain output returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test with empty porcelain output returns steps `worktree-removed` and `branch-deleted`, unchanged from the pre-change outcome. | `RefusalReason` in park-reconciliation.ts contains the member `dirty-worktree`.
Missing assertion: The cited checks do not explicitly assert that the worktree directory and modified file still exist.

Criterion: Story 1 happy: Given a reclaim candidate whose branch is merge-proven and whose worktree holds only an untracked non-ignored file, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree` and the untracked file still exists.
Task ids: 1
Done when checks: The `reconcileMergedPark` test with a modified tracked file in porcelain output returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test with only an untracked `??` path in porcelain output returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test with empty porcelain output returns steps `worktree-removed` and `branch-deleted`, unchanged from the pre-change outcome. | `RefusalReason` in park-reconciliation.ts contains the member `dirty-worktree`.
Missing assertion: The cited checks do not explicitly assert that the untracked file still exists.

Criterion: Story 1 happy: Given a reclaim candidate whose branch is merge-proven and whose worktree is clean apart from gitignored files, when `reconcileMergedPark` runs for its slug, then the worktree is removed and the branch is deleted exactly as before this change.
Task ids: 1
Done when checks: The `reconcileMergedPark` test with a modified tracked file in porcelain output returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test with only an untracked `??` path in porcelain output returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call. | The `reconcileMergedPark` test with empty porcelain output returns steps `worktree-removed` and `branch-deleted`, unchanged from the pre-change outcome. | `RefusalReason` in park-reconciliation.ts contains the member `dirty-worktree`.
Missing assertion: The cited empty-porcelain check does not explicitly assert behavior for a worktree clean apart from gitignored files.

Criterion: Story 3 negative: Given a sweep with one dirty candidate and one clean merged candidate, when `reconcileParkedFeatures` completes, then the clean candidate emits `worktree_reclaim_reclaimed` and the dirty candidate emits only `worktree_reclaim_failed`, never both.
Task ids: 5
Done when checks: The `reconcileParkedFeatures` test with a dirty merge-proven candidate emits one `worktree_reclaim_failed` event carrying that slug, its branch, and refusal `dirty-worktree`, and `refusedByReason` counts it. | The `reconcileParkedFeatures` test with an ancestry-only fresh candidate emits `worktree_reclaim_failed` with refusal `no-merge-proof`. | The `reconcileParkedFeatures` mixed-sweep test emits `worktree_reclaim_reclaimed` for the clean slug and no `worktree_reclaim_reclaimed` event for the dirty slug. | The daemon-render test renders a `worktree_reclaim_failed` event with refusal `dirty-worktree` as a line containing the slug and the text `dirty-worktree`.
Missing assertion: A cited check must explicitly require, in the same mixed sweep, that the dirty candidate emits `worktree_reclaim_failed` and never both event types.
```
