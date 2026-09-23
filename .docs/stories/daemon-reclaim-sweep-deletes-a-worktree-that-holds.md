# Stories: Daemon reclaim sweep deletes a worktree that holds uncommitted work

**Status:** Accepted

Source: jstoup111/ai-conductor#2636. Governing decisions: adr-2026-08-01-multi-proof-park-deletion-authority D9–D11.

## Story 1: A dirty worktree is never reclaimed

**Requirement:** adr-2026-08-01-multi-proof-park-deletion-authority D10

As an operator working in a manual worktree under `.worktrees/`, I want the reclaim sweep to leave my worktree alone while it holds uncommitted work, so that a sweep can never destroy edits I have not committed.

### Acceptance Criteria

#### Happy Path
- Given a reclaim candidate whose branch is merge-proven and whose worktree has a modified tracked file, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree`, the worktree directory and the modified file still exist, and the branch ref still exists.
- Given a reclaim candidate whose branch is merge-proven and whose worktree holds only an untracked non-ignored file, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree` and the untracked file still exists.
- Given a reclaim candidate whose branch is merge-proven and whose worktree is clean apart from gitignored files, when `reconcileMergedPark` runs for its slug, then the worktree is removed and the branch is deleted exactly as before this change.

#### Negative Paths
- Given a merge-proven candidate whose `git status --porcelain` probe exits non-zero, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree` and no `worktree remove` or `branch -D` command is issued.
- Given a merge-proven candidate with a staged but uncommitted change, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree` and no `worktree remove` or `branch -D` command is issued.
- Given a merge-proven parked slug whose worktree directory does not exist on disk, when `reconcileMergedPark` runs for its slug, then no status probe is attempted and the branch is deleted as before this change.

### Done When
- [ ] `RefusalReason` includes the member `dirty-worktree`.
- [ ] A test with a modified tracked file asserts the refusal and that neither `worktree remove` nor `branch -D` reached the git boundary.
- [ ] A test with a failing status probe asserts the refusal `dirty-worktree`.

## Story 2: Ancestry alone does not prove a merge

**Requirement:** adr-2026-08-01-multi-proof-park-deletion-authority D9

As an operator who has just created a working branch from `origin/main`, I want the sweep to treat that branch as unmerged until real merge evidence exists, so that a fresh branch is never classed as shipped.

### Acceptance Criteria

#### Happy Path
- Given a clean worktree whose non-daemon branch tip is an ancestor of `origin/main` and no merged pull request has that tip as its head, when `reconcileMergedPark` runs for its slug, then it returns refusal `no-merge-proof` and neither the worktree nor the branch is removed.
- Given a clean worktree whose branch tip is an ancestor of `origin/main` and a merged pull request reports that tip as its `headRefOid`, when `reconcileMergedPark` runs for its slug, then the worktree and branch are removed.
- Given a clean worktree whose `feat/daemon-*` branch tip is an ancestor of `origin/main` and a shipped record for the slug is on `origin/main`, when `reconcileMergedPark` runs for its slug, then the worktree and branch are removed.

#### Negative Paths
- Given an ancestry-proven branch without a shipped record whose merged-PR lookup fails because gh is unavailable, when `reconcileMergedPark` runs for its slug, then it returns refusal `no-merge-proof` and nothing is removed.
- Given an ancestry-proven branch without a shipped record whose only merged pull request reports a different head commit, when `reconcileMergedPark` runs for its slug, then nothing is removed and the refusal is not a success outcome.
- Given a squash-merged branch that is not an ancestor of `origin/main` and whose merged pull request head equals its tip, when `reconcileMergedPark` runs for its slug, then the branch is left in place, the result carries refusal `branch-delete-failed`, and no force-delete command is issued.

### Done When
- [ ] A test of a fresh branch (tip equals `origin/main`, no PR, no record, clean tree) asserts refusal `no-merge-proof` and that no `worktree remove` or `branch -D` reached the git boundary.
- [ ] A test of an ancestry-proven branch with a matching merged-PR head asserts the reclaimed outcome.

## Story 3: Retained candidates are visible with their reason

**Requirement:** adr-2026-08-01-multi-proof-park-deletion-authority D11

As an operator reading `.daemon/daemon.log`, I want every candidate the sweep keeps to be listed with why it was kept, so that I can tell a protected worktree from a broken sweep.

### Acceptance Criteria

#### Happy Path
- Given the sweep refuses a candidate with `dirty-worktree`, when `reconcileParkedFeatures` completes, then a `worktree_reclaim_failed` event carries that slug, its branch, and refusal `dirty-worktree`, and the refusal count in the sweep result includes it.
- Given the sweep refuses a fresh ancestry-only candidate with `no-merge-proof`, when `reconcileParkedFeatures` completes, then a `worktree_reclaim_failed` event carries that slug and refusal `no-merge-proof`.

#### Negative Paths
- Given a sweep with one dirty candidate and one clean merged candidate, when `reconcileParkedFeatures` completes, then the clean candidate emits `worktree_reclaim_reclaimed` and the dirty candidate emits only `worktree_reclaim_failed`, never both.
- Given the daemon log formatter receives a `worktree_reclaim_failed` event with refusal `dirty-worktree`, when it renders the line, then the line contains the slug and the text `dirty-worktree`.

### Done When
- [ ] A sweep-level test asserts the `worktree_reclaim_failed` event payload for a dirty candidate.
- [ ] A formatter test asserts the rendered log line names `dirty-worktree`.
