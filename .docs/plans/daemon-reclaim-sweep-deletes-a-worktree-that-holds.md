# Implementation Plan: Daemon reclaim sweep deletes a worktree that holds uncommitted work

**Date:** 2026-09-21
**Design:** .docs/decisions/architecture-review-2026-09-21-daemon-reclaim-sweep-deletes-a-worktree-that-holds.md
**Stories:** .docs/stories/daemon-reclaim-sweep-deletes-a-worktree-that-holds.md
**Conflict check:** Clean after resolution, .docs/conflicts/2026-09-21-daemon-reclaim-sweep-deletes-a-worktree-that-holds.md
**Source-Ref:** jstoup111/ai-conductor#2636

## Summary

Adds two guards to the guarded reclaim helper `reconcileMergedPark`. A worktree with any modified, staged, or untracked path is refused as `dirty-worktree`. An ancestry-proven branch is reclaimed only when a merged-PR head corroborates it, or, for a `feat/daemon-*` branch, a shipped record does. Both refusals surface through the existing sweep event and log. The plan has 5 tasks.

## Technical Approach

- Single production module: `src/conductor/src/engine/park-reconciliation.ts`. `RefusalReason` gains `dirty-worktree`; the per-reason refusal initialiser in `reconcileParkedFeatures` gains the key.
- Dirty-tree guard (adr D10): inside the existing `worktreeOnDisk` branch of `reconcileMergedPark`, `git status --porcelain` runs with `cwd` set to the worktree after every merge proof and the record gate, and before halt-watcher disposal, project teardown, and `worktree remove --force`. Non-empty output or a thrown probe refuses. Gitignored files never appear in porcelain output, so clean builds with ignored output still reclaim.
- Ancestry corroboration (adr D9): when no shipped record is on `origin/main`, `proveByMergedPrHead` runs for ancestry-proven branches too, not only unproven ones. Only a `proven` diagnosis lets an ancestry-proven branch through; every other diagnosis refuses `no-merge-proof`. A shipped record on `origin/main` is corroboration on its own only for a record-gated candidate (a `feat/daemon-*` branch or a branchless parked slug); a non-daemon candidate never reads the shipped-record listing (adr-2026-08-01 D8, operator decision 2026-09-22). Non-ancestor (squash) handling is unchanged.
- Observability (adr D11; adr-2026-07-29 D9): no new event or channel. Every refusal returned by `reconcileMergedPark` is emitted as `worktree_reclaim_failed` carrying `refusal`; `worktree_reclaim_retained` is reserved for candidates never handed to the helper. The daemon-cli formatter already prints `refusal`.
- Test pattern: follow the existing injected-`runGit`/`runGh` fixtures in `src/conductor/test/engine/park-reconciliation.test.ts` (search for `reconcileMergedPark(` and `worktree_reclaim_failed`). Assert that refused calls never reach the injected git boundary by inspecting the recorded argv list for `worktree`/`remove` and `branch`/`-D`. Never touch a real worktree.
- Sequencing: Tasks 1 and 3 are independent (different blocks of the same function). Task 2 follows 1, Task 4 follows 3, and Task 5 needs both guards.

## Prerequisites

- None.

## Tasks

### Task 1: Refuse removal of a worktree with modified or untracked paths
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/park-reconciliation.test.ts` with an injected `runGit`: a merge-proven candidate whose `status --porcelain` output lists a modified tracked file, and one listing only an untracked file (`??`), each expect `refusal: 'dirty-worktree'` and assert no `worktree remove` or `branch -D` call reached the injected git boundary; a candidate whose porcelain output is empty (gitignored files never appear in porcelain output) still expects the reclaimed outcome with `worktree-removed` and `branch-deleted` steps.
2. Verify the tests fail (RED): today the helper never runs `status` and removes all three.
3. Implement in `src/conductor/src/engine/park-reconciliation.ts`: add `'dirty-worktree'` to `RefusalReason` and to the sweep's per-reason refusal initialiser; in `reconcileMergedPark`, when the worktree exists on disk, run `git status --porcelain` with `cwd` set to the worktree path after every merge proof and the record gate have passed and before `disposeHaltWatcher`, project teardown, and `worktree remove`; any non-empty output returns refusal `dirty-worktree` with no steps.
4. Verify the tests pass (GREEN) and commit.

**Done when:**
- The `reconcileMergedPark` test with a modified tracked file in porcelain output returns refusal `dirty-worktree`, records no `worktree remove` or `branch -D` git call, and asserts the worktree directory and the modified file still exist on disk and the branch ref still exists afterwards.
- The `reconcileMergedPark` test with only an untracked `??` path in porcelain output returns refusal `dirty-worktree`, records no `worktree remove` or `branch -D` git call, and asserts the untracked file still exists on disk afterwards.
- The `reconcileMergedPark` test for a worktree that is clean apart from a gitignored file (empty porcelain output because ignored paths never appear in it) returns steps `worktree-removed` and `branch-deleted`, unchanged from the pre-change outcome.
- `RefusalReason` in park-reconciliation.ts contains the member `dirty-worktree`.

**Files:** src/conductor/src/engine/park-reconciliation.ts, src/conductor/test/engine/park-reconciliation.test.ts
**Dependencies:** none

### Task 2: Fail closed on a failed probe, a staged change, or skip when no worktree exists
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/park-reconciliation.test.ts`: an injected `status --porcelain` that rejects (non-zero exit) expects `dirty-worktree` with no removal calls; porcelain output with a staged-only entry (`M ` in the index column) expects `dirty-worktree`; a merge-proven parked slug whose worktree path does not exist expects no `status` call and the `branch-deleted` step.
2. Verify RED for the failed-probe case (the Task 1 implementation must treat a thrown probe as dirty, not clean).
3. Implement in `src/conductor/src/engine/park-reconciliation.ts`: wrap the porcelain probe so a thrown error returns `dirty-worktree`; keep the probe inside the `worktreeOnDisk` branch so an absent worktree never probes.
4. Verify GREEN and commit.

**Done when:**
- The `reconcileMergedPark` test whose injected porcelain probe rejects returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call.
- The `reconcileMergedPark` test with a staged-only porcelain entry returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call.
- The `reconcileMergedPark` test for a parked slug with no worktree on disk records zero `status` git calls and returns step `branch-deleted`.

**Files:** src/conductor/src/engine/park-reconciliation.ts, src/conductor/test/engine/park-reconciliation.test.ts
**Dependencies:** 1

### Task 3: Require merged-PR head, or a shipped record for a daemon branch, to corroborate ancestry
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/park-reconciliation.test.ts` with injected `runGit`/`runGh`: a clean non-daemon candidate whose branch is an ancestor of `origin/main`, with no shipped record and `gh pr list --state merged` returning no PR, expects `refusal: 'no-merge-proof'` and no removal calls; the same candidate with a merged PR whose `headRefOid` equals the tip expects the reclaimed outcome with proof `merged-pr-head`; a `feat/daemon-*` candidate with no PR but a shipped record on `origin/main` expects the reclaimed outcome; a non-daemon candidate with a shipped record on `origin/main` and no merged PR expects `no-merge-proof` and no `ls-tree` read of the shipped-record listing.
2. Verify RED: today the ancestry-only candidate is reclaimed with proof `ancestry`.
3. Implement in `src/conductor/src/engine/park-reconciliation.ts`: in `reconcileMergedPark`, when no shipped record is on `origin/main`, run `proveByMergedPrHead` for every branch, including ancestry-proven ones, and map every diagnosis other than `proven` to `no-merge-proof` for an ancestry-proven branch; a shipped record on `origin/main` is corroboration on its own only for a record-gated candidate, and a non-daemon candidate never reads the shipped-record listing. Squash-merged (non-ancestor) handling stays unchanged.
4. Verify GREEN and commit.

**Done when:**
- The `reconcileMergedPark` test for an ancestry-proven non-daemon branch with no merged PR and no shipped record returns refusal `no-merge-proof` and records no `worktree remove` or `branch -D` git call.
- The `reconcileMergedPark` test for an ancestry-proven branch whose merged PR `headRefOid` equals its tip returns steps `worktree-removed` and `branch-deleted`.
- The `reconcileMergedPark` test for an ancestry-proven `feat/daemon-*` branch with a shipped record on `origin/main` and no merged PR returns steps `worktree-removed` and `branch-deleted`.
- The `reconcileMergedPark` test for an ancestry-proven non-daemon branch with a shipped record on `origin/main` and no merged PR returns refusal `no-merge-proof`, records no `worktree remove` or `branch -D` git call, and records no `ls-tree` git call reading `origin/main:.docs/shipped`.

**Files:** src/conductor/src/engine/park-reconciliation.ts, src/conductor/test/engine/park-reconciliation.test.ts
**Dependencies:** none

### Task 4: Refuse ancestry when gh is unavailable or the PR head differs; keep squash-merge reclaim
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/park-reconciliation.test.ts`: an ancestry-proven branch without a record where the injected `gh` rejects expects `no-merge-proof` and no removal calls; one whose only merged PR reports a different `headRefOid` expects a refusal (not a reclaimed outcome) and no removal calls; a non-ancestor branch whose merged PR head equals its tip still expects the reclaimed outcome with proof `merged-pr-head`.
2. Verify RED for the gh-unavailable and different-head cases against the pre-Task-3 code (both reclaim today).
3. Implement in `src/conductor/src/engine/park-reconciliation.ts` any mapping Task 3 left open so `capability-unavailable`, `behind`, `ahead`, and `indeterminate` diagnoses on an ancestry-proven branch never reach the destructive step.
4. Verify GREEN and commit.

**Done when:**
- The `reconcileMergedPark` test with a rejecting injected `gh` and an ancestry-proven branch returns refusal `no-merge-proof` and records no `worktree remove` or `branch -D` git call.
- The `reconcileMergedPark` test whose merged PR reports a different `headRefOid` returns a result carrying a `refusal` and records no `worktree remove` or `branch -D` git call.
- The `reconcileMergedPark` test for a non-ancestor branch whose merged PR head equals its tip returns steps `worktree-removed` and `branch-deleted`.

**Files:** src/conductor/src/engine/park-reconciliation.ts, src/conductor/test/engine/park-reconciliation.test.ts
**Dependencies:** 3

### Task 5: Sweep reports every helper refusal through worktree_reclaim_failed and the log
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write tests in `src/conductor/test/engine/park-reconciliation.test.ts` driving `reconcileParkedFeatures` (the daemon sweep entry point) over enumerated worktrees with injected git/gh: a dirty merge-proven candidate emits `worktree_reclaim_failed` with its slug, branch, and refusal `dirty-worktree`, and `counts.refused` plus `refusedByReason['dirty-worktree']` include it; an ancestry-only fresh candidate emits `worktree_reclaim_failed` with refusal `no-merge-proof`; a sweep mixing one dirty and one clean merged candidate emits `worktree_reclaim_reclaimed` only for the clean slug and only `worktree_reclaim_failed` for the dirty slug; candidates whose helper refuses with `branch-behind-merged-head` or `record-missing` emit `worktree_reclaim_failed` carrying that refusal and no `worktree_reclaim_retained` event.
2. Add a case in `src/conductor/test/engine/daemon-render.test.ts` rendering a `worktree_reclaim_failed` event with refusal `dirty-worktree` and assert the line contains the slug and `dirty-worktree`.
3. Verify RED on the sweep tests before Tasks 1 and 3 land, then GREEN; in `reconcileParkedFeatures`, route every helper refusal to `worktree_reclaim_failed` (adr-2026-07-29 D9). The existing formatter already prints `event.refusal`, so no daemon-cli.ts change is expected.
4. Commit.

**Done when:**
- The `reconcileParkedFeatures` test with a dirty merge-proven candidate emits one `worktree_reclaim_failed` event carrying that slug, its branch, and refusal `dirty-worktree`, and `refusedByReason` counts it.
- The `reconcileParkedFeatures` test with an ancestry-only fresh candidate emits `worktree_reclaim_failed` with refusal `no-merge-proof`.
- The `reconcileParkedFeatures` mixed-sweep test, in one sweep, emits `worktree_reclaim_reclaimed` for the clean slug, emits exactly one `worktree_reclaim_failed` for the dirty slug, and emits no `worktree_reclaim_reclaimed` event for the dirty slug and no `worktree_reclaim_failed` event for the clean slug.
- The daemon-render test renders a `worktree_reclaim_failed` event with refusal `dirty-worktree` as a line containing the slug and the text `dirty-worktree`.
- The `reconcileParkedFeatures` test whose helper refuses with `branch-behind-merged-head` and with `record-missing` emits `worktree_reclaim_failed` carrying each refusal and no `worktree_reclaim_retained` event for either slug.

**Files:** src/conductor/src/engine/park-reconciliation.ts, src/conductor/test/engine/park-reconciliation.test.ts, src/conductor/test/engine/daemon-render.test.ts
**Dependencies:** 1, 3

## Task Dependency Graph

```text
Task 1 ──▶ Task 2
Task 3 ──▶ Task 4
Task 1 + Task 3 ──▶ Task 5
```

## Integration Points

- After Task 5: the daemon sweep entry point `reconcileParkedFeatures` is proven to refuse dirty and ancestry-only candidates and to report them on the event spine.

## Coverage Check

Every criterion is diff-local: each is asserted against `reconcileMergedPark` or `reconcileParkedFeatures` with injected git and gh boundaries, so no commit outside this diff can change its truth.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a reclaim candidate whose branch is merge-proven and whose worktree has a modified tracked file, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree`, the worktree directory and the modified file still exist, and the branch ref still exists. | 1 | "The `reconcileMergedPark` test with a modified tracked file in porcelain output returns refusal `dirty-worktree`, records no `worktree remove` or `branch -D` git call, and asserts the worktree directory and the modified file still exist on disk and the branch ref still exists afterwards." | diff-local |
| Story 1 happy: Given a reclaim candidate whose branch is merge-proven and whose worktree holds only an untracked non-ignored file, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree` and the untracked file still exists. | 1 | "The `reconcileMergedPark` test with only an untracked `??` path in porcelain output returns refusal `dirty-worktree`, records no `worktree remove` or `branch -D` git call, and asserts the untracked file still exists on disk afterwards." | diff-local |
| Story 1 happy: Given a reclaim candidate whose branch is merge-proven and whose worktree is clean apart from gitignored files, when `reconcileMergedPark` runs for its slug, then the worktree is removed and the branch is deleted exactly as before this change. | 1 | "The `reconcileMergedPark` test for a worktree that is clean apart from a gitignored file (empty porcelain output because ignored paths never appear in it) returns steps `worktree-removed` and `branch-deleted`, unchanged from the pre-change outcome." | diff-local |
| Story 1 negative: Given a merge-proven candidate whose `git status --porcelain` probe exits non-zero, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree` and no `worktree remove` or `branch -D` command is issued. | 2 | "The `reconcileMergedPark` test whose injected porcelain probe rejects returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call." | diff-local |
| Story 1 negative: Given a merge-proven candidate with a staged but uncommitted change, when `reconcileMergedPark` runs for its slug, then it returns refusal `dirty-worktree` and no `worktree remove` or `branch -D` command is issued. | 2 | "The `reconcileMergedPark` test with a staged-only porcelain entry returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call." | diff-local |
| Story 1 negative: Given a merge-proven parked slug whose worktree directory does not exist on disk, when `reconcileMergedPark` runs for its slug, then no status probe is attempted and the branch is deleted as before this change. | 2 | "The `reconcileMergedPark` test for a parked slug with no worktree on disk records zero `status` git calls and returns step `branch-deleted`." | diff-local |
| Story 2 happy: Given a clean worktree whose non-daemon branch tip is an ancestor of `origin/main` and no merged pull request has that tip as its head, when `reconcileMergedPark` runs for its slug, then it returns refusal `no-merge-proof` and neither the worktree nor the branch is removed. | 3 | "The `reconcileMergedPark` test for an ancestry-proven non-daemon branch with no merged PR and no shipped record returns refusal `no-merge-proof` and records no `worktree remove` or `branch -D` git call." | diff-local |
| Story 2 happy: Given a clean worktree whose branch tip is an ancestor of `origin/main` and a merged pull request reports that tip as its `headRefOid`, when `reconcileMergedPark` runs for its slug, then the worktree and branch are removed. | 3 | "The `reconcileMergedPark` test for an ancestry-proven branch whose merged PR `headRefOid` equals its tip returns steps `worktree-removed` and `branch-deleted`." | diff-local |
| Story 2 happy: Given a clean worktree whose `feat/daemon-*` branch tip is an ancestor of `origin/main` and a shipped record for the slug is on `origin/main`, when `reconcileMergedPark` runs for its slug, then the worktree and branch are removed. | 3 | "The `reconcileMergedPark` test for an ancestry-proven `feat/daemon-*` branch with a shipped record on `origin/main` and no merged PR returns steps `worktree-removed` and `branch-deleted`." | diff-local |
| Story 2 negative: Given an ancestry-proven branch without a shipped record whose merged-PR lookup fails because gh is unavailable, when `reconcileMergedPark` runs for its slug, then it returns refusal `no-merge-proof` and nothing is removed. | 4 | "The `reconcileMergedPark` test with a rejecting injected `gh` and an ancestry-proven branch returns refusal `no-merge-proof` and records no `worktree remove` or `branch -D` git call." | diff-local |
| Story 2 negative: Given an ancestry-proven branch without a shipped record whose only merged pull request reports a different head commit, when `reconcileMergedPark` runs for its slug, then nothing is removed and the refusal is not a success outcome. | 4 | "The `reconcileMergedPark` test whose merged PR reports a different `headRefOid` returns a result carrying a `refusal` and records no `worktree remove` or `branch -D` git call." | diff-local |
| Story 2 negative: Given a squash-merged branch that is not an ancestor of `origin/main` and whose merged pull request head equals its tip, when `reconcileMergedPark` runs for its slug, then it is reclaimed exactly as before this change. | 4 | "The `reconcileMergedPark` test for a non-ancestor branch whose merged PR head equals its tip returns steps `worktree-removed` and `branch-deleted`." | diff-local |
| Story 3 happy: Given the sweep refuses a candidate with `dirty-worktree`, when `reconcileParkedFeatures` completes, then a `worktree_reclaim_failed` event carries that slug, its branch, and refusal `dirty-worktree`, and the refusal count in the sweep result includes it. | 5 | "The `reconcileParkedFeatures` test with a dirty merge-proven candidate emits one `worktree_reclaim_failed` event carrying that slug, its branch, and refusal `dirty-worktree`, and `refusedByReason` counts it." | diff-local |
| Story 3 happy: Given the sweep refuses a fresh ancestry-only candidate with `no-merge-proof`, when `reconcileParkedFeatures` completes, then a `worktree_reclaim_failed` event carries that slug and refusal `no-merge-proof`. | 5 | "The `reconcileParkedFeatures` test with an ancestry-only fresh candidate emits `worktree_reclaim_failed` with refusal `no-merge-proof`." | diff-local |
| Story 3 negative: Given a sweep with one dirty candidate and one clean merged candidate, when `reconcileParkedFeatures` completes, then the clean candidate emits `worktree_reclaim_reclaimed` and the dirty candidate emits only `worktree_reclaim_failed`, never both. | 5 | "The `reconcileParkedFeatures` mixed-sweep test, in one sweep, emits `worktree_reclaim_reclaimed` for the clean slug, emits exactly one `worktree_reclaim_failed` for the dirty slug, and emits no `worktree_reclaim_reclaimed` event for the dirty slug and no `worktree_reclaim_failed` event for the clean slug." | diff-local |
| Story 3 negative: Given the daemon log formatter receives a `worktree_reclaim_failed` event with refusal `dirty-worktree`, when it renders the line, then the line contains the slug and the text `dirty-worktree`. | 5 | "The daemon-render test renders a `worktree_reclaim_failed` event with refusal `dirty-worktree` as a line containing the slug and the text `dirty-worktree`." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-01-multi-proof-park-deletion-authority#D1 | no-change | none | The proof set remains ancestry plus merged-PR head identity; D9 narrows when ancestry suffices and adds no proof, so D1 itself imposes no new implementation. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D2 | no-change | none | No proof is added to the set by this feature; the constraint that additions are ADR-level is honoured by recording D9 to D11 in this ADR. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D3 | task | task-1 | `RefusalReason` in park-reconciliation.ts contains the member `dirty-worktree`. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D4 | task | task-5 | and `refusedByReason` counts it. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D5 | no-change | none | Every change in this feature only refuses deletions that were previously allowed; nothing previously refused becomes deletable. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D6 | existing | none | reconcileParkedFeatures already enumerates git worktree list --porcelain entries under .worktrees/ via listRegisteredWorktrees and unions them with parked slugs. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D7 | existing | none | reconcileMergedPark already gathers merge evidence for opts.branch, the branch reported by the worktree listing. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D8 | existing | none | requiresShippedRecord already scopes the record precondition to feat/daemon-* branches. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D9 | task | task-3, task-4 | returns refusal `no-merge-proof` and records no `worktree remove` or `branch -D` git call. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D10 | task | task-1, task-2 | returns refusal `dirty-worktree` and records no `worktree remove` or `branch -D` git call. |
| adr-2026-08-01-multi-proof-park-deletion-authority#D11 | task | task-5 | emits one `worktree_reclaim_failed` event carrying that slug, its branch, and refusal `dirty-worktree` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
