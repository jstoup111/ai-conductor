**Status:** Accepted

# Stories: Automatic rebase preserves merges carrying unique content

**Source:** jstoup111/ai-conductor#2498
**Track:** technical
**Governing decisions:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D1–D8; adr-2026-06-29-rebase-conflict-resolution-dispatch D2; adr-2026-07-12-rebase-evidence-stamp-translation D10

## Story 1: A branch without merges rebases exactly as today

**Requirement:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D1

As the daemon, I want a feature branch with no merge commits in `base..HEAD` to rebase with the unchanged command, so that flattening never alters the common case.

### Acceptance Criteria

#### Happy Path
- Given a feature branch whose `base..HEAD` range contains no merge commit, when the engine rebase runs, then the only rebase command it issues is `git rebase --autostash <base>` with no `-i`, no `sequence.editor` override, and no `commit-tree` call.
- Given the same branch, when the rebase completes cleanly, then no `rebase_merge_audit` event is emitted and the rebase outcome kind matches today's outcome for that branch.

#### Negative Paths
- Given a branch whose only merge commit is reachable from the base (and so is outside `base..HEAD`), when the engine rebase runs, then it takes the unchanged `git rebase --autostash <base>` path and emits no `rebase_merge_audit` event.
- Given a branch with no merges whose rebase conflicts, when the engine rebase runs, then it returns the existing `conflict_halt` outcome for the resolver path, with no `mergeAudit` field on `rebase_conflict_halt`.
- Given a merge-bearing branch that is already current with the base, or that finish classifies as a mergeable skip, when the engine rebase runs, then it returns `noop` or `mergeable_skip` as today, issues no `commit-tree` or `merge-tree` flatten call, and emits no `rebase_merge_audit` event.

### Done When
- [ ] A unit test with an injected git runner and a merge-free range asserts the recorded rebase arguments equal `['rebase', '--autostash', <base>]`.
- [ ] A unit test asserts no `rebase_merge_audit` event is emitted for a merge-free range.

## Story 2: A merge-bearing branch replays its first-parent history without add/add conflicts

**Requirement:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D2

As the daemon, I want a feature branch whose merges duplicated repair lineage to rebase without replaying both lineages, so that the #2498 re-kick no longer halts on add/add conflicts.

### Acceptance Criteria

#### Happy Path
- Given a feature branch with a merge whose second parent carries commits patch-identical to commits on the first parent, when the engine rebase runs onto a base that does not touch those files, then the rebase completes with no conflict and the rebased HEAD tree equals the merge of the pre-rebase HEAD and the base.
- Given a merge whose tree equals its first parent's tree, when the engine rebase completes, then the rebased history contains no commit carrying that merge's content or subject, and the merge sha is listed as ancestry-only in the audit.
- Given a merge whose tree differs from its first parent's tree, when the engine rebase completes, then the rebased history contains exactly one non-merge commit carrying that merge's subject, a `Flattened-merge: <merge sha>` trailer, and the diff from the merge's first parent to the merge.

#### Negative Paths
- Given a merge-bearing branch, when the engine rebase completes, then no side-lineage commit (reachable only through a merge's second parent) appears in the rebased history as its own commit.
- Given a branch whose first parent is itself a chain of several merges, when the replay list is built, then each merge is classified independently by its own first parent's tree and none is skipped or classified twice.
- Given a merge whose author differs from the committer, when it is flattened, then the flattened commit carries the merge's author identity.

### Done When
- [ ] A real-git scratch-repository test reproduces duplicated lineage through a merge, runs the engine rebase, and asserts zero conflicts and a rebased tree equal to the expected merge tree.
- [ ] The same test asserts one `Flattened-merge:` commit per content-bearing merge and none for ancestry-only merges.
- [ ] A test asserts no commit reachable only through a merge's second parent appears in `base..HEAD` after the rebase.

## Story 3: The replay list is proven before anything moves

**Requirement:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D3

As the daemon, I want the flattened replay list proven to reproduce HEAD's tree before any rebase command runs, so that flattening can never lose content.

### Acceptance Criteria

#### Happy Path
- Given a merge-bearing branch, when the replay list is dry-run onto the merge base, then the resulting tree id equals HEAD's tree id and the real replay proceeds.
- Given a proven replay list, when the dry run onto the target is clean, then the real replay runs and its final tree id equals the dry run's final tree id.

#### Negative Paths
- Given a replay list whose in-place dry run yields a tree different from HEAD's tree, when the engine rebase runs, then it refuses with a halt naming the tree mismatch, and HEAD, the index, the worktree, and every ref are byte-identical to before.
- Given the git runner returns a non-zero exit for `merge-tree` or `commit-tree` during the dry run for any reason other than a conflict, when the engine rebase runs, then it refuses fail-closed with a halt naming the failed command and leaves the checkout unchanged.
- Given the dry run completes, when the worktree is inspected, then no file under the worktree was created or modified by the dry run (the todo file lives under the git directory).

### Done When
- [ ] A unit test with an injected runner returning a mismatched tree asserts a refusal outcome and that no `rebase` command was issued.
- [ ] A unit test with an injected runner failing `commit-tree` asserts a fail-closed refusal and no `rebase` command.
- [ ] A real-git test snapshots HEAD, `git status --porcelain`, and `for-each-ref` before and after a refused flatten and asserts they are identical.

## Story 4: A conflicting flattened merge is refused before mutation with a recovery recipe

**Requirement:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D5

As the operator, I want a flattened merge that conflicts with the new base to be refused before the worktree changes, naming the merge and how to recover, so that I never resolve a blind add/add replay and no resolver runs against a worktree with no rebase in progress.

### Acceptance Criteria

#### Happy Path
- Given a merge-bearing branch whose first dry-run conflict against the target falls on a flattened merge commit, when `performRebase` runs, then it returns a `flatten_refused` outcome carrying the merge sha, both parent shas, the flattened sha, and the conflicting paths, without issuing any rebase command.
- Given a `flatten_refused` outcome on the rebase step or the re-kick path, when the caller handles it, then `.pipeline/HALT` is written whose only recovery note is the recipe: park, `git -C <worktree> rebase -i --rebase-merges <base>`, re-apply `git diff <first parent> <merge>` at the merge stop, `git rebase --continue`, clear the HALT; and `rebase_conflict_halt` is emitted with its `mergeAudit` field populated.

#### Negative Paths
- Given a `flatten_refused` outcome, when the rebase step or the re-kick path handles it, then the gated rebase resolver is never dispatched and no resolution attempt event is emitted.
- Given a `flatten_refused` outcome, when HEAD, the index, the worktree, and refs are compared to their pre-rebase state, then all are unchanged and no `.git/rebase-merge` or `.git/rebase-apply` directory exists.
- Given a `flatten_refused` halt, when the halt record is inspected, then it contains neither `reset --hard` nor `checkout --` nor the paused-conflict instruction to resolve and `--continue` an existing rebase.
- Given a `flatten_refused` halt, when finish is attempted for the feature, then finish is blocked, no push is issued, and the protected-artifact seal is not rotated.

### Done When
- [ ] A real-git test constructs a flattened merge conflicting with an advanced base and asserts a `flatten_refused` outcome, no rebase state directory, and an unchanged HEAD.
- [ ] A test of the rebase step with a stub resolver asserts the resolver is called zero times for `flatten_refused` and the HALT text contains the recipe and excludes `reset --hard` and `checkout --`.
- [ ] A test asserts the `rebase_conflict_halt` event with `mergeAudit` is persisted to `.pipeline/events.jsonl`.
- [ ] The `RebaseOutcome` consumers compile only with an explicit `flatten_refused` branch (exhaustiveness enforced by the typecheck).

## Story 5: Ordinary conflicts on a flattened replay still reach the existing resolver

**Requirement:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D4

As the daemon, I want a conflict on an ordinary first-parent commit during a flattened replay to use the existing rebase state and resolver, so that flattening adds no second continuation model.

### Acceptance Criteria

#### Happy Path
- Given a merge-bearing branch whose first dry-run conflict falls on an ordinary commit, when the engine rebase runs, then it starts `git rebase -i --autostash <base>` with the engine-written todo and returns the existing `conflict_halt` outcome with an active rebase state for the gated resolver.
- Given the resolver resolves that conflict, when `git rebase --continue` runs, then the remaining todo entries (including flattened merge commits) replay and the rebase completes.

#### Negative Paths
- Given a flattened replay paused on a conflict, when the resolution worktree lifecycle aborts, then `git rebase --abort` restores the pre-rebase HEAD including its merge commits.
- Given the engine-written todo, when the rebase starts, then the todo file is read from the git directory and the editor never opens (no interactive prompt, no hang).
- Given dirty tracked changes in the worktree, when a flattened replay runs, then `--autostash` stashes and reapplies them as it does on today's path.
- Given a flattened replay refused by git because an untracked file would be overwritten, when the existing untracked-collision heal quarantines the file and retries, then the retry reissues the same `git rebase -i --autostash <base>` with the same engine-written todo, not the plain command.

### Done When
- [ ] A real-git test pauses a flattened replay on an ordinary conflict, resolves it, continues, and asserts the final HEAD tree equals the expected tree.
- [ ] A real-git test aborts a paused flattened replay and asserts HEAD equals the pre-rebase sha.
- [ ] A real-git test with an uncommitted tracked change asserts the change survives a flattened replay.

## Story 6: The commit-preservation guard judges a flattened replay against its replay list

**Requirement:** adr-2026-06-29-rebase-conflict-resolution-dispatch D2

As the daemon, I want FR-9 to expect the replay list's subjects on a flattened replay, so that dropped merges and side-lineage commits do not fail the guard while real losses still do.

### Acceptance Criteria

#### Happy Path
- Given a flattened replay resolved through the resolver, when FR-9 runs, then it passes when every picked first-parent commit subject and every flattened merge subject is present in `base..HEAD`, even though ancestry-only merge and side-lineage subjects are absent.

#### Negative Paths
- Given a flattened replay where the resolver skipped a picked first-parent commit, when FR-9 runs, then it fails naming that commit's subject exactly as today.
- Given a flattened replay where a flattened merge commit's subject is missing afterward, when FR-9 runs, then it fails naming the merge's subject.
- Given an unflattened replay, when FR-9 runs, then its expected subjects are still derived from `{onto}..ORIG_HEAD` and the #2607 declared test-only exception behaves unchanged.
- Given a flattened replay on the open-PR autoresolve path, when its acceptance guards run, then FR-9 uses the same replay-list subjects returned by the shared primitive, and a missing picked subject fails the guard and escalates as today.

### Done When
- [ ] A unit test of `featureCommitsPreserved` with a flattened replay list asserts pass when only ancestry-only and side-lineage subjects are absent.
- [ ] A unit test asserts failure when a picked subject from the replay list is missing.
- [ ] Existing FR-9 tests for the unflattened path pass unchanged.

## Story 7: Citations to flattened history translate to their absorption point

**Requirement:** adr-2026-07-12-rebase-evidence-stamp-translation D10

As the daemon, I want evidence and repair boundaries citing a merge or side-lineage commit to translate after a flattened rebase, so that completed tasks do not reopen.

### Acceptance Criteria

#### Happy Path
- Given a repair obligation whose `baseline.head` is a content-bearing merge sha, when a flattened rebase completes and translation runs, then `baseline.head` equals the post-image sha of that merge's flattened commit.
- Given evidence citing a side-lineage commit with no patch-id twin, absorbed by a content-bearing merge, when translation runs, then the citation maps to that merge's flattened post-image.
- Given a citation to an ancestry-only merge, when translation runs, then it maps to the post-image of the first surviving first-parent commit after that merge.
- Given a side-lineage commit patch-identical to a first-parent commit, when translation runs, then it maps by patch-id to that commit's post-image before any absorption rule applies.

#### Negative Paths
- Given an ancestry-only merge with no surviving first-parent commit after it, when translation runs, then the sha stays residue and `rebase_citation_residue` reports it.
- Given a sha that was never on the branch before the rebase, when translation runs, then it is not added to the map and is returned unchanged (no laundering).
- Given a side-lineage commit or merge that the absorption rule mapped, when translation completes, then that sha does not appear in `.pipeline/rebase-residue.json` and no `rebase_citation_residue` entry names it.
- Given a flattened rebase, when `.pipeline/rebase-rewrites.json` is read, then every absorption entry's value is reachable from HEAD and no entry was derived from subjects, trailers, or paths.

### Done When
- [ ] A unit test on `translateAfterRebase` with flatten pairs asserts merge, side-lineage, and ancestry-only shas map to the specified post-images.
- [ ] A unit test asserts an ancestry-only merge with no survivor lands in residue.
- [ ] A unit test asserts a forged sha is not mapped.

## Story 8: Flattening is visible on the event spine

**Requirement:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D6

As the operator, I want each flattened rebase recorded as one typed event, so that I can see which merges were flattened or dropped without reading git history.

### Acceptance Criteria

#### Happy Path
- Given a merge-bearing branch that flattens successfully, when the rebase runs, then exactly one `rebase_merge_audit` event is emitted, carrying the flattened merge shas, the ancestry-only merge shas, and the side-lineage commit count.
- Given the emitted event, when `.pipeline/events.jsonl` is read, then it contains the `rebase_merge_audit` record per its `EVENT_SINKS` declaration.

#### Negative Paths
- Given a flattened rebase, when the worktree and `.pipeline/` are inspected, then no sidecar file, marker file, or log line other than the persisted event records the audit.
- Given a `ConductorEvent` union that gains `rebase_merge_audit` without an `EVENT_SINKS` row, when the engine compiles, then compilation fails.

### Done When
- [ ] A test asserts one `rebase_merge_audit` emission with the expected sha lists for a two-merge fixture.
- [ ] `EVENT_SINKS` declares `rebase_merge_audit`, and the typecheck enforces exhaustiveness.

## Story 9: Open-PR autoresolve replays merge-bearing branches through the same primitive

**Requirement:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D8

As the daemon, I want the open-PR autoresolve rebase to use the same replay decision as the feature rebase, so that the two paths cannot drift and a merge-bearing PR branch no longer escalates on add/add conflicts.

### Acceptance Criteria

#### Happy Path
- Given an open PR branch whose `baseRef..HEAD` range contains a merge with duplicated lineage, when autoresolve rebases it, then it starts the rebase through the shared primitive, replays the flattened list with no add/add conflict, and proceeds to its existing acceptance guards and publication.
- Given an open PR branch with no merge in range, when autoresolve rebases it, then the command it issues is `git rebase --autostash <baseRef>` exactly as today.

#### Negative Paths
- Given the shared primitive refuses a flattened replay for an open PR branch, when autoresolve handles the refusal, then it escalates with reason `merge-flatten-refused` whose detail contains the merge sha and the recipe, and it neither enters tier-1 or tier-2 resolution nor pushes.
- Given `autoresolve.ts`, when its source is inspected, then it contains no direct `git rebase` start invocation outside the shared primitive (the continue and abort commands of its existing resolution stay as they are).
- Given a flattened replay on the autoresolve path pauses on an ordinary conflict, when tier-1 and tier-2 resolution run, then they operate on the paused `rebase -i` state exactly as they do on a plain rebase.

### Done When
- [ ] A real-git autoresolve test with a merge-bearing PR branch asserts a clean flattened replay and no `rebase-error` escalation.
- [ ] A test asserts a refused flatten yields an escalation with reason `merge-flatten-refused` and zero tier-2 dispatches.
- [ ] A test with an injected runner asserts autoresolve issues `['rebase', '--autostash', baseRef]` for a merge-free range.
