# Conflict Report: Daemon reclaim sweep deletes a worktree that holds uncommitted work

**Date:** 2026-09-21
**Stories checked:** `.docs/stories/daemon-reclaim-sweep-deletes-a-worktree-that-holds.md` (Stories 1–3) against every story file mentioning reclaim, reconciliation, or ancestry (21 files), plus the change-set ADR `adr-2026-08-01-multi-proof-park-deletion-authority` (D1–D11).
**Result:** 1 blocking conflict, resolved. 0 degrading. Re-check clean.

## Conflict: A hotfix branch is reclaimed on ancestry alone

**Stories involved:** Story 2: Ancestry alone does not prove a merge vs Story 3: Merge proofs are keyed on the worktree's listed branch
**Files:** [.docs/stories/daemon-reclaim-sweep-deletes-a-worktree-that-holds.md] vs [.docs/stories/reclaim-merged-feature-worktrees-without-depending.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The earlier criterion said "Given a candidate at `.worktrees/hotfix-x` on branch `hotfix/x` that is an ancestor of `origin/main`, when the helper runs with that branch, then ancestry proves it merged without consulting `gh`". The new criterion says "Given a clean worktree whose non-daemon branch tip is an ancestor of `origin/main` and no merged pull request has that tip as its head, when `reconcileMergedPark` runs for its slug, then it returns refusal `no-merge-proof` and neither the worktree nor the branch is removed." One ancestry-only `hotfix/x` candidate cannot be both reclaimed and refused.

**Resolution Options:**
1. Restate the older criterion so the `hotfix/x` candidate also carries a merged-PR head matching its tip.
2. Exempt `hotfix/*` branches from D9. This reopens the #2636 data-loss path for any hand-named branch.
3. Drop D9 and keep only the dirty-tree guard.

**Recommendation:** Option 1. The older criterion's intent was to key proofs on the listed branch, and that still holds. Only the choice of proof changes.

**Resolution (operator, 2026-09-21):** Option 1. The criterion is replaced in place on a companion PR from `origin/main` (branch `docs/2636-restate-hotfix-ancestry-criterion`), because the land gate rejects edits to another stem's story files.

## Re-check

No other assertion is contradicted. The `parked-feature-reconciliation-1060` line "reclaimed on the proof set alone (adr-2026-08-01 D8)" and the `reclaim-merged-feature-worktrees-without-depending` Story 4 "merge proof alone" lines hold under the narrowed proof set. Teardown-before-remove (Story 5 there) holds because the dirty-tree probe runs before teardown. Each pair was checked in both directions; there is no oscillation.
