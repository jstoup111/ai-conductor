**Status:** Accepted

# Stories: Multi-branch restack for stacked child plans (#2943)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/a-change-to-one-stacked-child-cannot-be-carried-in.md`
  (items 1–11);
- `adr-2026-10-10-stacked-restack-journaled-replay` (decisions 1–13).

Terms used below:
- **Stacked feature:** a feature with durable child state (#2942): a child directory, a child
  branch, or a closure ref.
- **Three-child stack:** a stacked feature with slug `demo` and positions `1`, `2` and `3`.
  - `feat/c1/demo` holds `A1`, `A2` on base `B`, closed at `refs/conductor/demo/closed/c1`.
  - `feat/c2/demo` holds `C1`, `C2` on that closure, closed at `closed/c2`.
  - The leaf `feat/daemon-demo` (position 3) is the active child, holds `L1` on `closed/c2`, and is
    checked out in the clean feature worktree.
- **One-closed-one-active stack:** a stacked feature with slug `demo` and positions `1`, `2` and `3`.
  - `feat/c1/demo` holds `A1`, `A2` on `B`, closed at `closed/c1`.
  - `feat/c2/demo` is the active child, holds `C1` on `closed/c1`, has no closure ref, and is
    checked out in the clean feature worktree.
  - Position 3 is the leaf. It has not been entered yet; `feat/daemon-demo` exists at `B` with no
    commits of its own.
- **Closure ref:** `refs/conductor/<slug>/closed/c<k>`.
- **Journal:** `refs/conductor/<slug>/restack/journal`.
- **Restack:** one run of the engine's stacked restack, with cause `base-refresh` or
  `feature-repair`.
- **Default advance:** `origin/main` moves from `B` to `B'`, adding commits not in the stack.

## Story 1: A restack carries each child's own commits onto its new parent and nothing else

**Requirement:** Scope item 1; ADR decisions 1–3

As an operator, I want every child above a changed child moved onto its new parent with exactly its
own commits, so that no child replays its parent's history and no child loses its own work.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack and a default advance, when a `base-refresh` restack completes, then: `git rev-list B'..feat/c1/demo` lists exactly the rewrites of `A1` and `A2`; `git rev-list closed/c1..feat/c2/demo` lists exactly the rewrites of `C1` and `C2`; `git rev-list closed/c2..feat/daemon-demo` lists exactly the rewrite of `L1`.
- Given a restack, when each rewritten commit is compared with its original, then its author name, email, date and message are identical, and its committer name, email and date equal the stamp recorded in the journal.
- Given child 2 contains an empty evidence commit `E` (`git commit --allow-empty` with an `Evidence:` trailer), when a restack moves child 2, then the rewritten child 2 contains a commit with `E`'s message and trailer, and the rewrite map maps `E` to it.
- Given child 1's commit `A2` was cherry-picked to `origin/main` within the default advance, when a `base-refresh` restack runs, then `git rev-list B'..feat/c1/demo` lists exactly one commit (the rewrite of `A1`), and child 1's tree equals `B'` with `A1`'s change applied.
- Given child 2 reverts its parent's commit `A1` and later re-applies it as `A1r` (same patch-id), when a restack moves child 2, then `A1r` is replayed and child 2's tree keeps `A1`'s change.
- Given `commit.gpgSign=true` and a configured signing key, when a restack completes, then `git verify-commit` succeeds for every rewritten commit.

#### Negative Paths
- Given a restack in which child 2's commit `C2` becomes empty because the new `closed/c1` already carries its change, when child 2 is replayed, then no commit for `C2` appears in the new child 2.
- Given a repair restack whose originating commit `X` on child 1 was already cherry-picked into child 2 as `X2`, when child 2 is replayed, then `X2` does not appear in the new child 2.
- Given the one-closed-one-active stack, when a restack runs, then `feat/daemon-demo` is not moved, and no branch is created for position 3.
- Given the one-closed-one-active stack, where `feat/c1/demo` was created from a pre-region halt record `H` on the unentered leaf (the leaf still sits at `H`), when a `base-refresh` restack rewrites `H` to `H'`, then: the leaf moves to `H'` in the same move; no `refs/conductor/demo/leaf-moved` ref is written; when child 2 later closes, the leaf move succeeds with no stray-commit refusal.
- Given the journaled old `closed/c1` is not an ancestor of `feat/c2/demo`'s tip (child 2 was rebased elsewhere), when a restack is planned, then it halts needs-human with `restack_refused` reason `range-not-ancestor`, naming child 2, and no ref moves.
- Given the operator's git config sets `rebase.updateRefs=true`, `rebase.autoSquash=true` and `merge.renames=false`, when a restack, an N=1 rebase, or a resolver hand-off runs, then its result and resolver todo are identical to those produced with the keys unset.
- Given a crash at `planned` after child 1 was replayed, when the next resume re-plans, then child 1's rewritten SHAs are identical to the first attempt's.
- Given `feat/c1/demo` holds a halt-record-only commit past `closed/c1`, when a `base-refresh` restack moves child 1, then: the new `feat/c1/demo` equals the new `closed/c1`; that commit appears in no child; `git reflog feat/c1/demo` still lists it.

### Done When
- [ ] For every moved child, `rev-list newParent..newTip` contains exactly its own commits after the
      documented drop rules.
- [ ] Started-empty commits survive. Became-empty commits, and commits patch-equivalent to commits
      new to the stack, are dropped. A child's own re-applied commit survives.
- [ ] Committer identity and date equal the journaled stamp, and signing follows `commit.gpgSign`.
- [ ] The pinned keys in user git config cannot change any engine replay result.

## Story 2: Merge-bearing children are replayed without re-applying the merged side

**Requirement:** Scope item 1; ADR decision 3

As an operator, I want a child that merged the default branch to be restacked without its merge
re-applying, or re-reverting, content the new base already decided, so that such children neither
conflict needlessly nor silently resurrect reverted lines.

### Acceptance Criteria

#### Happy Path
- Given child 2 contains a merge `M` of `origin/main` at `D1` whose tree equals the automatic merge, and the new parent contains `D1`, when child 2 is replayed, then no commit for `M` appears.
- Given child 2 contains a merge `M` of `D1` with a hand resolution, and the new parent contains `D1`, when child 2 is replayed, then exactly one commit replaces `M`: its change is only the hand resolution; it carries a `Flattened-merge:` trailer; a `rebase_merge_audit` event is persisted.
- Given child 2 merged a side branch `Q` that the new parent does not contain, when child 2 is replayed cleanly, then one flattened commit replaces `M`, carrying `M`'s change relative to its first parent.

#### Negative Paths
- Given child 2 merged `origin/main` at `D1`, and main later changed the same lines at `D2` (the new parent contains `D2`), when a `base-refresh` restack replays child 2, then no conflict is raised and child 2's tree keeps `D2`'s lines.
- Given child 2 merged `origin/main` at `D1`, and main later reverted `D1`'s line (the new parent contains the revert), when child 2 is replayed, then the reverted line is absent from child 2.
- Given a merge-bearing child whose replay conflicts (Q carried or not), when the conflict is handled, then: the restack halts with `restack_refused` reason `flatten_refused`, naming the merge; no resolver is dispatched; no ref moves; the halt's recovery text tells the operator to resolve on the child branch and resume, and never prescribes a single-branch `git rebase` of a stacked branch.

### Done When
- [ ] Ancestry-only merges are dropped, Q-carried merges replay only their hand resolution, and
      other merges flatten. Real-git tests cover main editing, and main reverting, a merged line.
- [ ] Synthesized merge commits carry `Flattened-merge:` and emit `rebase_merge_audit`.

## Story 3: A replay that touches paths the child never owned is rejected

**Requirement:** Scope item 3; ADR decision 3

As an operator, I want a restack accepted only when each child changes only paths it changed before,
so that a replay that silently reverts a parent's fix elsewhere never lands.

### Acceptance Criteria

#### Happy Path
- Given a restack in which every replayed child changes, relative to its new parent, only paths it changed relative to its old parent, when the replay finishes, then the restack applies.
- Given child 2 renames `src/x.ts` to `src/y.ts`, then edits two lines of `src/y.ts`, and the parent does not touch `src/x.ts`, when child 2 is replayed, then the restack applies.
- Given the parent's new changes and child 2's owned paths both include `src/f.ts`, when the restack applies, then `restack_applied` for child 2 lists `src/f.ts` in `parentOverlapPaths`.

#### Negative Paths
- Given child 2 added change X to `src/g.ts` and later reverted it (no net change to `src/g.ts`), and the repaired parent now adds X, when child 2's replay removes X, then: the restack halts with `restack_refused` reason `replay-mismatch`, naming child 2 and `src/g.ts`; no ref moves; the journal and staging refs remain until that halt is cleared.
- Given child 2 sets line L of `src/h.ts` to `a` and then to `b`, and the new parent carries `L=a`, when child 2 is replayed, then the restack applies with `L=b`.
- Given child 2 renames `src/x.ts` to `src/z.ts`, and the new parent independently created `src/z.ts`, when child 2 is replayed, then the collision on `src/z.ts` is not accepted as a clean replay: it is raised as a conflict on `src/z.ts` and handed to the resolver (Story 6).
- Given no overlap between the parent's new changes and child 2's owned paths, when the restack applies, then `restack_applied` for child 2 has `parentOverlapPaths: []`.

### Done When
- [ ] Acceptance compares path sets with renames disabled; content inside owned paths never
      rejects.
- [ ] `replay-mismatch` halts before any ref moves, naming the child and every unowned path.
- [ ] `parentOverlapPaths` is present on every `restack_applied` event.

## Story 4: Every ref moves together or none do

**Requirement:** Scope items 1–3; ADR decisions 4–5

As an operator, I want child branches, closure refs and the journal state to move together or not at
all, so that no crash or concurrent change can leave a half-moved stack.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack, when a restack applies, then afterwards: `feat/c1/demo`, `feat/c2/demo`, the leaf, `closed/c1` and `closed/c2` all hold their new SHAs; `refs/conductor/demo/leaf-moved` exists; every tip equals the journal, and ancestry holds from `feat/c1/demo` to the leaf; the journal and `restack/staging/*` no longer exist.
- Given a restack, when an injected failure makes any single ref's update fail, then every ref keeps its old SHA, and the journal is not `moved`.

#### Negative Paths
- Given another process moves `feat/c2/demo` after the journal was written, when the restack tries to move the refs, then: none move; the journal is `aborted`; the run halts with `restack_refused` reason `stack-ref-changed`, naming `refs/heads/feat/c2/demo`.
- Given a lock file is held on a journaled ref for longer than the retry budget, when the restack tries to move the refs, then: none move; the journal is `aborted`; the run halts with `restack_refused` reason `lock-unavailable`, naming the lock.
- Given a lock is held briefly and released within the retry budget, when the restack moves the refs, then it applies.
- Given `feat/c1/demo` is checked out in another worktree and child 1's tip will change, when a restack is planned, then it is refused with reason `checked-out-elsewhere`, naming that worktree, and nothing moves.
- Given post-move verification finds a tree that differs from its staging ref, when it fails, then: every ref returns to its journaled old SHA; the journal ends `aborted`; the run halts with reason `verification-failed`, naming the check.
- Given a journal already exists, when a second restack is planned (for example a CLI-triggered resume racing the daemon), then the second emits `restack_refused` with reason `restack-outstanding`, creates no journal and moves no ref, and the first completes.

### Done When
- [ ] An injected single-ref failure proves no partial move.
- [ ] Lock exhaustion, stale old values and verification failures each halt with their own reason.
- [ ] A rollback restores the exact journaled old SHAs, and at most one restack per feature exists.

## Story 5: The checked-out worktree follows the move without losing local work

**Requirement:** Scope item 1; ADR decision 5

As an operator, I want the worktree synchronised to its branch's new tip without autostash and
without overwriting my edits, so that I never lose uncommitted work to a restack.

### Acceptance Criteria

#### Happy Path
- Given a clean three-child stack, when a restack moves the leaf, then: `git status` is clean afterwards; the working tree equals the new leaf tip; the protected-artifact seal verifies against the new tip.
- Given an uncommitted edit to `notes.txt`, which no change between the old and new tips touches, when a restack moves the checked-out branch, then the edit is still present and no `git stash` entry exists.
- Given an untracked `tmp/out.txt` that the new tip adds as a tracked file, when the restack runs, then the untracked file is moved to the existing quarantine location and the restack applies.
- Given the one-closed-one-active stack with `.pipeline/current-task` naming task `T3`, when a `base-refresh` restack moves child 1 and the checked-out child 2, then `current-task` still names `T3`, and its commits resolve through the rewrite map.

#### Negative Paths
- Given an uncommitted edit to `src/a.ts`, which changes between the checked-out branch's old and new tips, when a restack is planned, then: it is refused before any ref moves, with `restack_refused` reason `dirty-overlap` naming `src/a.ts`; the edit is untouched; no stash entry exists.
- Given an untracked `tmp/out.txt` that the new tip adds as a tracked file, and a quarantine destination that cannot be written (its directory is read-only), when a restack is planned, then it is refused before any ref moves with reason `sync-collision`, naming `tmp/out.txt`.
- Given the protected-artifact seal is already violated, when a restack is planned, then it halts on the seal violation before any ref moves.
- Given an ignored build-output file was modified, when a restack is planned, then it is not treated as dirty, and the restack applies.

### Done When
- [ ] No restack path stashes or autostashes.
- [ ] Dirty paths outside the delta survive; dirty paths inside it refuse before any move.
- [ ] The seal is verified before the move and rotated after the sync.
- [ ] `current-task` is preserved across a restack.

## Story 6: A conflict halts with nothing moved, after one bounded resolver attempt

**Requirement:** Scope item 4; ADR decision 6

As an operator, I want a restack conflict either resolved by the existing resolver for that one
child, or halted naming the child and commits, so that both sides' intended commits always stay
recoverable.

### Acceptance Criteria

#### Happy Path
- Given child 2's commit `C2` conflicts when replayed onto the new `closed/c1`, and the resolver resolves it, when the restack continues, then: the leaf is replayed onto the resolved child-2 tip; the restack applies; child 1 is not replayed again.
- Given a resolver hand-off, when it ends (accepted, rejected or crashed), then: no real branch moved during it; its temporary worktree no longer appears in `git worktree list`.
- Given child 2 has a started-empty commit `E` and a commit cherry-picked to main within the default advance, when its resolver hand-off runs, then the commits it replays include `E` and exclude the cherry-picked commit, matching the clean replay's list.
- Given child 1's and child 2's ranges both contain halt-record commits that conflict only on `.docs/halted/demo.md`, when child 2 is replayed, then child 2's record is kept and no resolver is dispatched.

#### Negative Paths
- Given child 2's commit `C2` conflicts on `src/c.ts` and the resolver exhausts its budget, when the restack ends, then: it halts needs-human, naming child 2, `C2` and `src/c.ts`; `restack_conflict` is persisted; no child branch or closure ref moved; the journal (`aborted`) and child 2's staging ref remain until that halt is cleared.
- Given a resolver result missing one of child 2's own commit subjects, when acceptance is checked, then it is rejected, and the run halts as the unresolved conflict above.
- Given a resolver result not based on the new `closed/c1`, when acceptance is checked, then it is rejected, and the run halts as the unresolved conflict above.
- Given a resolver result changing a path child 2 never owned, when acceptance is checked, then it is rejected with reason `replay-mismatch`.
- Given a conflict touching `.docs/halted/demo.md` and `src/c.ts` together, when child 2 is replayed, then it is not resolved mechanically, and goes to the resolver.

### Done When
- [ ] Only the conflicting child is handed off, and its replay list equals the clean replay's.
- [ ] Resolver results are accepted only when based on the new parent, with every own commit present
      and every changed path owned.
- [ ] A conflict halt names the child, the commit and the paths, and leaves every ref unmoved.

## Story 7: An interrupted restack is completed or rolled back from refs alone

**Requirement:** Scope items 2 and 8; ADR decisions 4 and 7

As an operator, I want a restack interrupted at any point to be finished or undone automatically on
the next resume, even after the worktree is recreated, so that a crash never strands a stack or is
misread as divergence.

### Acceptance Criteria

#### Happy Path
- Given a crash at `planned` with child 1 replayed and its inputs unchanged, when the next resume runs, then planning continues from child 2, and child 1's new SHA is reused.
- Given a crash at `ready`, when the next resume runs, then the move completes with the journaled SHAs, and no child is replayed again.
- Given a crash at `moved`, when the next resume runs, then the worktree is synchronised, the transition is applied once, and the journal is removed.
- Given a crash at `synced`, when the next resume runs, then the transition is applied once, and the journal is removed.
- Given a crash at `rolling-back`, when the next resume runs, then every ref equals its journaled old SHA and the journal ends `aborted`.
- Given a leftover journal in `applied` (with no follow-on) or `aborted` (whose halt is cleared), when the next resume runs, then: the journal, staging refs and any temporary resolver worktree are removed; no `restack_recovered` event is emitted; resume continues.
- Given a crash at `ready`, when recovery completes the restack, then `restack_recovered` with `fromState: ready` is persisted.
- Given the feature worktree is deleted and recreated from its branch while the journal is `ready`, when the next resume runs, then the restack completes as above.
- Given a journal is outstanding and closure refs have moved, when resume runs, then no divergent halt is written, and the active child is judged only after recovery.

#### Negative Paths
- Given a crash at `planned`, after which `feat/c2/demo` moved, when resume runs, then: the journal is aborted and the staging refs are removed; no ref moves.
- Given a crash at `moved` where `src/a.ts` holds content equal to neither its old nor its new blob, when recovery syncs, then: `src/a.ts` is not overwritten; the stack is rolled back to its old SHAs; the run halts needs-human, naming `src/a.ts`.
- Given a crash at `ready`, after which an uncommitted edit overlapping the move appeared, when recovery runs, then the journal is aborted and nothing moves.
- Given an unreadable journal, when recovery runs, then it halts needs-human, naming the journal ref and every child branch, closure ref and staging ref of the feature with its live value.
- Given live refs matching neither the journaled old nor new SHAs (other than a checked-out branch carrying only halt-record commits past its new SHA), when recovery runs, then it halts needs-human, naming every journaled ref and its live value.
- Given a journal and an `applying` rebase operation record it wrote, when resume runs, then the record is not classified as interrupted until the journal is gone.
- Given recovery runs twice in a row, when the second run ends, then refs, worktree and events are unchanged by it.
- Given a crash mid-restack during a daemon re-kick, when the daemon resumes, then no second re-kick runs; only journal recovery does, and `performRebase` is never invoked.
- Given no journal exists, when resume runs, then no `restack_recovered` event is emitted.

### Done When
- [ ] Real-git tests crash at every journal state and prove ADR decision 7's table.
- [ ] Recovery reads only refs: deleting `.pipeline/` before resume changes no recovery outcome.
- [ ] Recovery is idempotent, and never single-branch rebases.

## Story 8: Engine commits and halts never undo a restack

**Requirement:** Scope item 2; ADR decision 4

As an operator, I want engine commits made in a stacked feature worktree to be unable to revert a
restack, even from another process, so that a halt record or plan amendment never silently rolls a
child back.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature worktree with no journal and `.pipeline/co-author` set, when the engine commits a halt record, then: only `.docs/halted/demo.md` changes in the commit; the message carries the same co-author and `Task:` trailers a `git commit` at that site carries today; the commit verifies when `commit.gpgSign=true`.
- Given the restack itself must halt while its journal is `moved`, when it halts, then the journal first reaches `synced` or `aborted`, and the halt record commits on the resulting HEAD.
- Given the daemon writes a halt while the journal is `moved`, when the halt record is committed, then journal recovery completed first, and the record's head SHA is the post-recovery HEAD.

#### Negative Paths
- Given the daemon's halt-record supersede read HEAD, then the restack moved the branch, then the supersede commits, when the supersede finishes, then it has failed, and the branch still holds the restacked tree.
- Given the journal is `ready`, `moved` or `rolling-back`, when any engine commit is attempted in the feature worktree, then it is refused, and HEAD is unchanged.
- Given staged changes outside the committing site's own paths, when the engine commits, then the commit contains only the site's own paths, the stray changes stay staged and uncommitted, and the commit is not blocked.
- Given setup-triage captured a repair touching `a.txt` and `b/c.txt` in a stacked worktree, when it commits the repair, then exactly those paths are committed, and the commit is not refused.
- Given halt-time recovery itself fails, when the halt is written, then the journal ends `aborted`, and exactly one halt is written.

### Done When
- [ ] Every engine commit site named in ADR decision 4 commits through the guarded path. A test
      proves that no other engine commit path runs in a stacked feature worktree.
- [ ] A two-process race test proves a restack is never reverted.
- [ ] Each site's hooks, trailers and signing match today's behaviour.

## Story 9: Operator commits on a closed child are carried upward automatically

**Requirement:** Scope item 8; ADR decisions 7 and 9

As an operator, I want a commit I make on a closed child carried into every child above it
automatically, so that I no longer recover a "restack required" halt by hand.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack in which the operator committed `X` on `feat/c1/demo` past `closed/c1`, when the next daemon dispatch or conductor resume runs, then: a `feature-repair` restack moves `closed/c1` to `X`; child 2 and the leaf are replayed onto it; no needs-human halt is written.
- Given that state before the restack runs, when `consumeResumeAuthorizations`, `kickback-budget` inspection, `task` or `rewind` reads the active child, then: they report the active child; none throws; none moves a ref or starts a restack (`kickback-budget raise` or `reset --gate restack` updates `cascades` by design; see Story 13).
- Given an operator commit on a closed child and a default advance at the same resume, when it runs, then a `feature-repair` restack applies first, and a `base-refresh` restack second, with distinct opIds.
- Given the operator committed `X` from another worktree that still has `feat/c1/demo` checked out, when the repair runs, then it applies.
- Given the operator's `X` is followed by a halt-record commit on `feat/c1/demo`, when the repair runs, then `closed/c1` moves to the halt-record commit, which includes both.

#### Negative Paths
- Given the operator amended `A2` on a closed child, so the branch no longer contains `closed/c1`, when resume runs, then: no restack runs; it halts needs-human, with `restack_refused` reason `closed-child-rewritten`, naming child 1.
- Given the operator reset `feat/c1/demo` behind `closed/c1`, when resume runs, then it halts as `closed-child-rewritten`, and `closed/c1` is unchanged.
- Given commits past `closed/c1` touching only `.docs/halted/demo.md`, when resume runs, then no repair runs.
- Given a refused repair (cap, dirty overlap or conflict) while a base refresh was also due, when the resume ends, then `restack_refused` with reason `deferred-base-refresh` is persisted, and no base-refresh restack ran.
- Given the repair applied but the follow-on base refresh is refused (for example `checked-out-elsewhere`), when the resume ends, then `restack_refused` with reason `deferred-base-refresh` is persisted.
- Given a parked feature with commits appended past `closed/c1`, when the daemon's dispatch considers it, then no restack runs and no ref moves.
- Given the repair reached `applied` and the process died before the base refresh started, when the next resume runs, then the base-refresh restack runs.
- Given the repair's journal is `applied` with a pending follow-on, when an unrelated restack is planned, then it is refused `restack-outstanding`, and the follow-on still runs.
- Given `rewind --child 1` on a closed child, when it runs, then it is refused with a message naming #2944.

### Done When
- [ ] The preflight runs after the park checks, and before resume authorization, the re-kick
      rebase, the halt-record supersede, the cursor and operation-record classification, on both
      daemon and conductor entry.
- [ ] Appended commits repair automatically; rewritten or reset closed children halt.
- [ ] A due base refresh is never lost: it runs, survives a crash between the operations, or emits
      `deferred-base-refresh`.

## Story 10: The FINISH rebase and daemon re-kick refresh the whole stack

**Requirement:** Scope items 5 and 8; ADR decision 9

As an operator, I want every place that rebases today to refresh the whole stack from child 1
upward, whichever child is active, so that no child is left on a stale base and no single-branch
rebase runs on a stacked feature.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack and a default advance, when the FINISH `rebase` step runs, then: a `base-refresh` restack moves child 1 onto `B'` and restacks child 2 and the leaf; the `rebase` step verdict's operation carries `cause: 'base-refresh'` and the whole-stack tuple: P = old leaf tip, B = `merge-base(old c1, B)`, O = `B'`, H = new leaf tip.
- Given the one-closed-one-active stack mid-build and a default advance, when the daemon re-kicks the feature, then: a `base-refresh` restack moves child 1 and the active child 2; no `rebase_skipped_for_stack` event is emitted.
- Given `B'` is already an ancestor of `feat/c1/demo`, when the FINISH step or a re-kick runs, then no ref moves.
- Given a `base-refresh` restack applies, when the events are read, then `rebase_changed` is persisted with the whole-stack delta from `B` to `B'`, so base-caused test failures stay attributed to the base advance.
- Given the leaf PR is mergeable and the base delta does not touch the feature's review inputs, when the FINISH step runs, then the existing mergeable-skip applies.

#### Negative Paths
- Given a stacked feature, when the FINISH step or a re-kick runs, then no single-branch rebase runs on any child branch or the leaf.
- Given a re-kick whose restack is refused for `dirty-overlap`, when the re-kick ends, then it halts needs-human naming the paths, and does not skip silently.
- Given a feature with no durable child state, when the FINISH step or a re-kick runs, then today's rebase runs, and its result, verdict and events match today's (pinned config aside).
- Given a stacked FINISH, when publication runs, then no `feat/c<k>/demo` branch is pushed.
- Given a stacked feature's published leaf PR has a merge conflict with `origin/main`, when the mergeable sweep's autoresolve reaches it, then: no replay or push runs; it escalates to a human; `restack_refused` with reason `published-stack`, naming #2945, is persisted.

### Done When
- [ ] Stacked features always restack at FINISH and re-kick; unstacked features rebase as today.
- [ ] The decision-12 skip is gone, and its tests assert the whole-stack refresh.
- [ ] Re-kick transitions write to the active child's stores.

## Story 11: Verdicts after a restack are re-judged against the right base

**Requirement:** Scope item 10; ADR decision 8

As an operator, I want gates re-graded after a restack exactly as much as the moved code requires,
judged against the right base, so that a restack neither wipes valid passes nor keeps stale ones.

### Acceptance Criteria

#### Happy Path
- Given a restack moves the active child 2 with an unchanged replay, when the transition runs, then child 2's passed region gates stay passed in `.pipeline/children/2/`.
- Given a restack moves the active child 2, and the new parent's changes intersect a passed region gate's inputs, when the transition runs, then that gate is invalidated in `.pipeline/children/2/`, and no flat region verdict is written.
- Given a restack moves closed child 1, when it applies, then: child 1's verdict files and closure position are unchanged; `restack_applied` for child 1 lists, in `wouldInvalidate`, the gates the same policy would invalidate.
- Given a restack moves a child whose commits carry evidence stamps and `task-status` commits, when it applies, then evidence stamps, task-status commits, the retained RED proof and `provenanceHeadSha` resolve to the new SHAs.
- Given a `feature-repair` restack whose originating commit `X` changes a path in the leaf's review inputs, when whole-feature and leaf gates are re-judged, then the gates whose inputs include that path are invalidated, even though the default branch did not move.
- Given a `feature-repair` restack whose commit `X` changes only paths outside every passed gate's inputs, when the gates are re-judged, then they stay passed.

#### Negative Paths
- Given a restack leaves the leaf in place while the last intermediate child has just closed, when the cursor checks for a pending leaf move, then the leaf move is still reported pending.
- Given a `feature-repair` restack, when whole-feature gates are re-judged, then the base used is the unchanged old default, not a freshly fetched `origin/main`.
- Given a closed child with a non-empty `wouldInvalidate`, when the feature continues, then no region gate of that closed child is re-run in this feature.
- Given a `feature-repair` restack that moves only child 2 and the leaf, when `rebase-rewrites.json` is read, then it has no entry for any child-1 or default-branch commit.

### Done When
- [ ] The active child's re-judgement writes only to its own stores, and whole-feature gates use the
      whole-stack tuple.
- [ ] Closed children's verdict files are byte-identical before and after a restack.
- [ ] `leaf-moved` exists only after a restack that moved the leaf while it was the active child.

## Story 12: Only default-branch refreshes refund review laps

**Requirement:** Scope item 6; ADR decision 10

As an operator, I want review-lap refunds limited to restacks caused by the default branch, so that
repair cascades inside the feature cannot keep resetting the convergence bound.

### Acceptance Criteria

#### Happy Path
- Given a `base-refresh` restack invalidates the active child's `build_review`, when the transition runs, then `build_review` convergence laps are credited once in that child's ledger for that opId.
- Given an N=1 feature whose rebase invalidates `build_review`, when the transition runs, then the refund equals today's, and the operation record has no `cause` field.

#### Negative Paths
- Given a `feature-repair` restack invalidates the active child's `build_review`, when the transition runs, then: no laps are credited; the operation record carries `cause: 'feature-repair'`.
- Given the same `base-refresh` transition is applied twice by recovery, when the second application runs, then no second credit is written.
- Given a `feature-repair` restack, when the step tail runs, then the legacy rebase-step refund does not credit laps.

### Done When
- [ ] Refunds check the cause; an absent cause means `base-refresh`.
- [ ] Stacked operation records carry `cause`, and N=1 records are byte-identical to today.

## Story 13: Repeated repair cascades from one child are capped and recoverable

**Requirement:** Scope item 7; ADR decision 10

As an operator, I want a bound on how often one child's changes cascade restacks through the stack,
so that a repair loop halts with the child named instead of churning indefinitely.

### Acceptance Criteria

#### Happy Path
- Given child 1 has originated 2 applied `feature-repair` restacks, when a third applies, then child 1's cascade count in `refs/conductor/demo/cascades` is 3.
- Given `base-refresh` restacks and aborted restacks, when they finish, then no cascade count changes.
- Given the cascade-cap halt for child 1, when the operator runs `kickback-budget raise --gate restack --child 1`, then: the raised limit is stored in `refs/conductor/demo/cascades`; the next resume runs the repair.
- Given the cascade-cap halt for child 1, when the operator runs `kickback-budget reset --gate restack --child 1`, then child 1's count is 0, and the next resume runs the repair.
- Given the worktree is recreated, when the counts are read, then they are unchanged.

#### Negative Paths
- Given child 1 has originated 3 applied `feature-repair` restacks, when a fourth repair is due, then: no journal is created and no `restack_planned` event is emitted; it halts with `HALT.class` `needs-human`, naming child 1; the active child's ledger holds cap evidence for gate `restack`, with allowance `restacks`, naming child 1.
- Given no live cascade-cap halt and no `restack` cap evidence, when `kickback-budget reset --gate restack --child 1` runs, then it is refused, and the ref is unchanged.
- Given the cascade-cap halt for child 1 and a recreated worktree with no `.pipeline/children/1/`, when `kickback-budget raise --gate restack --child 1` runs, then it is accepted, because `--child` is validated against the `cascades` ref.
- Given the `cascades` blob is unreadable or malformed, when a repair is due, then the cap counts as exhausted, and it halts needs-human naming the unreadable ref.
- Given cap evidence for child 1, when `kickback-budget raise --gate restack --child 2` runs, then it is refused, and the ref is unchanged.
- Given the CLI's update to `cascades` loses a race with a concurrent write, when it ends, then it has failed, no resume authorization is staged, and the concurrent write is kept.
- Given repairs originate from child 1 and child 2 alternately, when counts are read, then each child's count reflects only the restacks it originated, and the leaf's count is 0.

### Done When
- [ ] The bound is 3, charged to the originating child, and checked before any journal exists.
- [ ] `raise` and `reset` work end to end for `--gate restack`, and the PR body carries a
      `## Migration` block.

## Story 14: Force pushes never overwrite remote work the engine has not seen

**Requirement:** Scope item 9; ADR decision 11

As an operator, I want an engine force push refused whenever it would overwrite remote work the
engine never saw, so that a human's or another process's push to a feature branch is never
clobbered.

### Acceptance Criteria

#### Happy Path
- Given an engine push of `feat/daemon-demo` succeeds, plain or forced, when it completes, then `refs/conductor/demo/pushed/feat/daemon-demo` holds the pushed SHA, and no intent remains.
- Given the recorded tip equals the remote tip `R`, when the post-rebase draft refresh force-pushes, then: it fetches only `feat/daemon-demo` first; it pushes with an expected SHA of `R`; it succeeds and records the new tip.
- Given a human pushed `H` and ci-fix built its HEAD on `H`, when ci-fix force-pushes, then the push succeeds.
- Given a feature in flight before this change (no recorded tip), whose remote tip equals the tracking ref captured before the fetch, when it force-pushes, then the push succeeds and a tip is recorded.
- Given the push succeeded remotely but recording the tip failed, when the next force push runs, then it treats the intended new SHA as the recorded tip, and proceeds.
- Given shipped-record teardown, or the single-slug reclaim helper, runs for `demo`, when it completes, then each recorded `pushed/` ref, the intent, `cascades`, `leaf-moved`, and the journal and staging refs are deleted by explicit name. No glob delete is used.

#### Negative Paths
- Given a recorded tip `R1`, and another worktree's full fetch advanced `origin/feat/daemon-demo` to a human's `R2` (not an ancestor of HEAD), when autoresolve force-pushes, then: it is refused and the remote is unchanged; `push_lease_refused` {expected `R1`, actual `R2`} is persisted; autoresolve escalates with the refusal as the reason.
- Given the same remote state, when halt-record publication force-pushes, then it is refused, `push_lease_refused` and `halt_record_push_failed` are persisted, the halt-record commit is kept, and the halt path does not fail.
- Given the same remote state, when the draft refresh, ci-fix or halt-record publication force-pushes, then each is refused in the same way.
- Given no recorded tip and a remote tip that differs from the pre-fetch tracking ref and is not an ancestor of HEAD, when a force push runs, then it is refused.
- Given the single-branch fetch or the remote read fails, when a force push is due, then: no push is attempted, and no `pushed/` ref changes; halt-record publication emits `halt_record_push_failed`, keeps the commit and does not fail the halt path; the draft refresh logs a loud failure naming the ref, and the build continues; autoresolve and ci-fix escalate with the failure as the reason.
- Given no recorded tip and no tracking ref, when a force push is due, then it is refused, naming the missing tracking ref.
- Given a refused or failed push, when it ends, then no intent remains.
- Given an engine push to a non-feature ref, when it succeeds, then no `pushed/` ref is written.
- Given teardown ran for `demo` and a new feature reuses slug `demo`, when it first force-pushes, then it takes the no-record path, and its cascade counts start at 0.
- Given an explicit-SHA force push, when the engine's `pre-push` hook runs, then it passes.

### Done When
- [ ] Every successful feature-branch push records its tip.
- [ ] All four force-push callers follow the decision table, and none pushes with a bare lease.
- [ ] Teardown removes every ref this feature introduced.

## Story 15: Restacks are observable on the event spine, and N=1 stays unchanged

**Requirement:** Scope item 11; ADR decisions 1, 12 and 13

As an operator, I want every restack visible on the existing event spine, tagged with its child,
while features without children behave as before, so that dashboards and recovery see restacks and
nothing else regresses.

### Acceptance Criteria

#### Happy Path
- Given a restack that applies, when `.pipeline/events.jsonl` is read, then it contains: `restack_planned` {opId, cause, children}; then one `restack_applied` per moved child, each carrying `opId`, `cause`, `child`, `oldTip`, `newTip`, `wouldInvalidate` and `parentOverlapPaths`.
- Given a recovery, when it completes, then `restack_recovered` {opId, fromState} is persisted.
- Given any restack refusal, when it occurs, then `restack_refused` carries one of the reasons ADR decision 12 enumerates, and carries `child` whenever a child is named.
- Given a conflict halt, when it is written, then `restack_conflict` {opId, child, commit, paths} is persisted.

#### Negative Paths
- Given a feature with no durable child state, when it runs FINISH, re-kick and resume, then: #3019's N=1 golden suite is byte-identical; no `restack_*` event is emitted; no `refs/conductor/<slug>/` ref other than `pushed/` and its intent is written.
- Given a feature with no durable child state, when a force push is refused, then `push_lease_refused` is its only new event.

### Done When
- [ ] Every new event variant is typed and persisted.
- [ ] The N=1 golden suite passes unmodified.
- [ ] `child-region-access-audit` counts are updated deliberately in the same change.
