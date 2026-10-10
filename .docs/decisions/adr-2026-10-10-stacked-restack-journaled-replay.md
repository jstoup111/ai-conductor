# ADR: A change to a stacked child is carried upward by a journaled off-worktree replay and one atomic ref move

**Date:** 2026-10-10
**Status:** APPROVED
**Deciders:** operator (James Stoup), with adversarial review by subagents (git mechanics, engine state, diagram, ADR ×3)

## Context

#2943 is ticket 4 of the stacked child-plans chain (#2940–#2949). The chain design is in #2940; the
diagrams are in `.docs/architecture/a-change-to-one-stacked-child-cannot-be-carried-in.md`. It builds
on three shipped tickets:
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: identity and per-child state;
- `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`: slices and ownership;
- `adr-2026-10-07-per-child-build-region`: the per-child BUILD region.

A stack is a chain of branches. Children `feat/c<k>/<slug>` are built in order, and the leaf is
`feat/daemon-<slug>`. A closed child is marked by `refs/conductor/<slug>/closed/c<k>`, and child k+1
starts from that tip.

Verified facts at `0bca4a2822`:
- **No multi-branch rebase exists.**
  - Every rebase targets the default branch (`resolveBaseCore`, `rebase.ts:216-253`), and
    `--onto` appears nowhere.
  - The callers are the FINISH `rebase` step (`conductor.ts:15052`) and the daemon re-kick
    (`daemon-rekick.ts:857`).
- **The stack is frozen once built.**
  - Re-kick skips the rebase at a non-leaf child (`adr-2026-10-07-per-child-build-region`
    decision 12, `daemon-rekick.ts:799-818`).
  - A commit on a closed child halts needs-human as divergent: "restack required (#2943)"
    (`child-cursor.ts:247-254`, `conductor.ts:719-727`). The re-kick sweep keeps needs-human halts
    (`daemon-rekick.ts:64-69`), so nothing ever repairs it.
  - Closure refs are create-only (`child-lifecycle.ts:238`).
- **One record, one map.** There is one flat rebase operation record (`.pipeline/gates/rebase.json`)
  and one flat rewrite map (`.pipeline/rebase-rewrites.json`) per worktree. The map's pre-image
  range is `onto..origHead` (`rebase-translate.ts:77`), which is wrong for an `--onto` replay.
- **The clean path trusts exit codes.** No tree or tip check accepts the result
  (`rebase.ts:891`).
- **Refunds ignore cause.** `creditBuildReviewConvergence` (`rebase-transition.ts:52-77`) refunds on
  any rebase that invalidates `build_review`.
- **Leases are bare.**
  - Four callers force-push with bare `--force-with-lease`: `ship-draft-pr.ts:397`,
    `pushRefreshedBranch` (`autoresolve.ts:772`) used by both autoresolve and ci-fix
    (`ci-fix.ts:662`), and `halt-record.ts:216`.
  - ci-fix runs a full `git fetch origin` (`ci-fix.ts:545`). That refreshes every feature
    tracking ref, so a later bare-lease push from another worktree can overwrite a remote tip it
    never saw. This is the concrete hole an expected SHA closes.

Facts tested empirically on git 2.53 in scratch repositories:
- **`rebase --update-refs`** exited 0 while leaving branches unmoved, and never moves
  `refs/conductor/*`.
- **`rebase --onto`** can exit 0 and silently revert a parent's fix.
- **`git replay`** is experimental, and its default changed in 2.53.
- **`update-ref --stdin` transactions** with old values are all-or-nothing, including packed refs
  and `refs/conductor/*`. A held lock and an old-value mismatch both exit 128.
- **No reflog.** `refs/conductor/*` refs have no reflog.
- **User config.** `rebase.updateRefs=true` makes today's leaf FINISH rebase silently move every
  child branch.
- **Per-commit plumbing replay.** `merge-tree --write-tree --merge-base c^1 <acc> c` plus
  `commit-tree` produced the same trees as `rebase --onto` in 155 of 155 clean fuzz cases, and on
  renames, mode changes, binaries and deletes. It never conflicted where rebase was clean.
- **A whole-child three-way "prediction" check is wrong as an acceptance test.** It falsely failed
  25% of clean fuzz cases: rename-then-edit, and set-then-set where the parent carries the first
  value.
- **A path-ownership check** passed all 155 cases and still caught both silent-revert cases.
- **First-parent merge flattening re-applies default-branch content** when the new parent already
  carries the merged side. It can conflict needlessly or re-add a line main reverted.
- **Commits that start empty** are kept by `rebase`. The `tdd` skill requires them as evidence
  commits.
- **The worktree after `update-ref`.** Once `update-ref` moves the checked-out branch, the index
  still holds the old tree. A halt-record commit made in that window reverts the whole restack on
  that branch.

Operator decisions (2026-10-10):
- All eight outcomes of #2943 are in scope.
- Approach B is chosen.
- Leaf force pushes are retrofitted with expected-SHA leases.
- The per-child cascade cap is enforced now.
- Restacks happen only where rebases happen today, and a re-kick restacks the stack whichever child
  is active.
- Re-validating closed children, and rewinding a closed child, move to #2944.
- An operator commit on a closed child is repaired automatically at resume.

## Options Considered

### Option A: Per-child worktree `rebase --onto` (filer hypothesis)
- **Pros:** reuses `performRebase`, the resolver and flattening directly.
- **Cons:**
  - It checks out every child, which resets the live `current-task`.
  - It moves one branch at a time, so it needs a journal anyway.
  - It inherits the silent-revert and user-config hazards.

### Option B: Journaled off-worktree replay and one atomic ref move (chosen)
- **Pros:**
  - No ref moves until the whole cascade is computed and checked.
  - One compare-and-swap transaction moves branches, closure refs and the journal together.
  - Recovery is idempotent, and the old-to-new map is exact by construction.
- **Cons:**
  - A second replay executor.
  - The engine must keep commits that start empty and copy authorship.
  - It must synchronise the checked-out worktree itself, and hand conflicts to a resolver.

### Option C: One `rebase --onto … --update-refs` from the top branch
- **Pros:** a single git operation.
- **Cons:** the empirical breaks above. It reports success with refs unmoved, is not atomic, never
  moves closure refs, and patch-ids shared across children collide.

## Decision

1. **Only stacked features enter the restack. N=1 keeps `performRebase`.**
   - **Scope.** The restack planner runs only when the feature has durable child state
     (`hasDurableChildState`).
   - **N=1.** Every other feature takes today's `performRebase` path. Its replay, flatten, resolver,
     verdict and transition behaviour are unchanged, and the journal probe keeps today's non-git
     guard.
   - **The only N=1 differences:**
     - **Pinned config.** Engine-started rebases and merges pin, through `GIT_CONFIG_COUNT`/
       `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` environment variables so recorded argv stays
       unchanged, `rebase.updateRefs=false`,
       `rebase.rebaseMerges=false`, `rebase.autoSquash=false`, `merge.renames=true`,
       `merge.directoryRenames=conflict` and `diff.renameLimit`. The result differs only where an
       operator's own config had set one of those keys.
     - **Push records.** Every successful feature-branch push records a pushed tip (decision 11).
     - **One new event.** `push_lease_refused` fires only on an actual refusal.
     - **Unchanged records.** The rebase operation record gains no field for N=1: `cause` is
       written only for stacked operations (decision 10). #3019's golden suite stays byte-identical.

2. **What moves and how ranges are computed.**
   - **Existing children only.** A restack moves only children that exist: closed children, plus the
     active child when its branch exists. Unstarted children are created later from the moved
     closure tip.
   - **The leaf.** The leaf is moved only in two cases; otherwise it stays with `moveLeaf`, whose
     stray-commit guard is unchanged:
     - it is the active child;
     - it has not been entered and its tip lies inside a moved child's journaled own range (for
       example a pre-region halt record that child 1 was created from). It then moves, in the same
       transaction, to that commit's rewrite, so the later `moveLeaf` still sees no stray commit.
   - **Old parents.**
     - Child 1's old parent is `merge-base(c1, old default tip)`.
     - Child j>1's old parent is the closure tip of j-1 as journaled before the operation.
   - **Own ranges.**
     - A closed child: `oldParent..closure(j)`.
     - The active child: `oldParent..tip(j)`.
   - **Checks before planning.** Each of these halts needs-human and is never replayed:
     - `oldParent` is not an ancestor of the child's tip;
     - a closed child's branch tip does not contain its closure tip (an amended, rebased or
       reset-back closed child).
   - **Halt-record commits.**
     - In a repair, every closed child with commits appended past its closure is an
       **originating** child. All of them are repaired in one operation: every commit appended past
       an originating child's closure becomes part of its new closure, halt-record commits
       included, because that branch does not move. Each originating child counts one cascade
       (decision 10).
     - Past any other moved child's closure: only halt-record-only commits are not replayed. Any
       other commit there is an unrepaired operator change. The planner returns an internal
       `repair-pending` result, which is not a `restack_refused` event, and the stack preflight
       repairs that child first. When the branch moves to its new closure they are discarded,
       and the branch's reflog keeps them. The live halt record is on the active branch.
     - Inside a range: replayed. A conflict confined to `.docs/halted/<slug>.md` resolves
       mechanically: the upper child's record wins.
   - **Patch-equivalent commits** are skipped only against commits that are **new to the stack in
     this operation**:
     - for a base refresh, `oldDefault..newDefault`;
     - for a repair, the appended commits.

     A patch-id that already occurs in the stack's own history below the child is never an
     equivalence. So a child that reverts and then re-applies its parent's change keeps the
     re-apply. Using every commit reachable from the new parent was rejected, because it silently
     dropped a child's own re-applied commit in testing.

3. **Replay is off the worktree, and acceptance is a path-ownership check.**
   - **Ordinary commits.** For each ordinary commit c in a child's first-parent range, the new tree
     is `git merge-tree --write-tree --merge-base c^1 <acc> c`. The commit is made with
     `commit-tree`.
     - Kept from c: author name, email and date, and the message.
     - Committer identity and date are fixed per operation and recorded in the journal.
     - Commits are signed with `-S` when the repository's `commit.gpgSign` is set.
   - **Empty commits.**
     - A commit that becomes empty is dropped: its new tree equals `<acc>` while its original tree
       differed from its first parent's.
     - A commit that started empty, such as a `tdd` evidence commit, is always kept.
   - **Merges.** For a merge M with first parent P and other parent Q, let `auto` be
     `merge-tree --write-tree P Q`.
     - **Ancestry-only:** M is dropped when `tree(M) == auto` and Q is an ancestor of the new
       parent.
     - **Q already carried:** when Q is an ancestor of the new parent, only M's hand-resolved part is
       replayed: `merge-tree --merge-base auto <acc> M`.
     - **Q not carried:** M becomes one flattened commit carrying P→M.
     - Every synthesized commit keeps the `Flattened-merge:` trailer and emits `rebase_merge_audit`,
       as `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history` D2 and D6 require. The
       classification helper is the one exported from `rebase.ts`.
   - **Acceptance: path ownership.**
     - **Owned paths.** A child's owned paths are `diff --no-renames --name-only oldParent
       oldOwnTip`. For a merge whose Q side the new parent already carries, only the paths of its
       hand-resolved part count.
     - **The rule.** A replayed child is accepted only if `diff --no-renames --name-only newParent
       newTip` is a subset of its owned paths.
     - **A path outside them** is a revert outside owned paths. It halts `replay-mismatch`, naming
       the child and the paths, and is never accepted.
     - **Content inside owned paths** is accepted as replayed. That is rebase-equivalent: `rebase
       --onto` gives the same tree.
     - **The limit, stated.** A child can still drop part of its parent's change inside a file it
       owns. Example: the child reverts a fix and then edits the same file, and the parent later
       re-applies that fix.
     - **Flagging it.** Every path where the parent's delta (`oldParent..newParent`) intersects a
       child's owned paths is emitted as `parentOverlapPaths` in `restack_applied`. The leaf's
       whole-feature gates and #2944's re-validation consume it.
     - **Rejected.** A reverse-apply check of the parent's hunks was rejected: it falsely halts
       benign set-then-set histories.
   - **The next child** replays onto the actual new tip of the child below it.
   - **Not used:** `git replay` and `rebase --update-refs`.

4. **The restack journal is durable, ref-backed, and moves in the same transaction as the refs.**
   - **Storage.** The journal is a blob behind `refs/conductor/<slug>/restack/journal`.
     - It is created by compare-and-swap, create-only, so at most one restack is outstanding. A
       second planner that loses the create emits `restack_refused` with reason
       `restack-outstanding` and moves nothing.
     - Its fields:
       - opId and cause, plus an optional chained follow-on cause;
       - an owner (host, pid and process start time);
       - a committer stamp and the worktree's dirty-path set;
       - every ref with its old SHA, and every range;
       - per-child status: `pending`, `replayed` or `resolved`.
     - **Ownership.** Recovery and every other planner act on a journal only when its owner
       process is no longer alive. A journal whose owner is alive is outstanding: a second planner
       is refused `restack-outstanding`, and halt-time recovery leaves it to its owner.
     - Planned commits are pinned by staging refs `refs/conductor/<slug>/restack/staging/c<j>`, so
       they are neither garbage-collected nor recomputed.
   - **States:**

     ```text
     planned → ready → moved → synced → applied
     planned, ready              → aborted
     moved                       → rolling-back → aborted
     ```

   - **Same-transaction writes.** Every state change from `ready` onward is written in the same
     `update-ref --stdin` transaction as the refs it describes:
     - the move writes `moved`;
     - a rollback writes `aborted`;
     - `applied` also writes the cascade count (decision 10).

     A crash therefore never leaves the journal's state and the refs disagreeing.
   - **Commit fence, enforced at the commit.** Every engine commit made in a stacked feature
     worktree goes through one guarded helper. It does not use `git commit`. Instead it:
     1. refuses if the journal is `ready`, `moved` or `rolling-back`;
     2. reads HEAD;
     3. builds the commit's tree from a temporary index (`GIT_INDEX_FILE`) seeded from HEAD plus
        only its own pathspec, so stray staged changes in the worktree index are neither
        committed nor able to block the commit;
     4. afterwards updates the worktree index for its own paths only;
     5. runs the hooks `git commit` runs at that site today, in git's order, through `git hook
        run`: pre-commit, prepare-commit-msg and commit-msg on a message file before the commit,
        and post-commit after HEAD moves. The engine's prepare-commit-msg co-author and `Task:`
        stamping is therefore preserved. Where the site uses `--no-verify` today, only pre-commit
        and commit-msg are skipped, exactly as `git commit --no-verify` does. Hooks run with
        `GIT_INDEX_FILE` set to the temporary index, so they judge exactly what is committed;
     6. writes the commit with `write-tree` and `commit-tree`, signing with `-S` when
        `commit.gpgSign` is set;
     7. re-reads the journal, then moves HEAD by `update-ref HEAD <new> <head-read-in-step-2>`.

     The restack's own move transaction includes the HEAD branch's old value. So whichever of the
     two commits first, the other's compare-and-swap fails, and neither silently reverts the other.
     This holds even for a commit made by another process, such as the daemon's asynchronous
     `supersedeHaltRecord`.
   - **Shared stamping.** The helper reuses the existing shared engine commit helper's co-author
     stamping (`adr-2026-09-11-github-operation-ownership` D10.3); it is not a second stamper.
   - **Setup-triage.** Its pathspec is the set of paths captured for the repair being committed.
   - **Sites the helper covers:**
     - `commitHaltRecordChange` and `supersedeHaltRecord`;
     - the plan-amendment commit in `conductor.ts`;
     - `setup-triage.ts`;
     - `finish-publication-production.ts`;
     - `shipped-record-cli.ts`;
     - `shipment-evidence-cli.ts`.

     Build-failure escalation only pushes (through `executeRemoteGit`); it makes no commit. The plan
     enumerates the commit sites. A test asserts that no other engine `git commit` runs in a feature
     worktree.
   - **In-process failure.** If the executor throws while the process lives on, a `finally`
     drives its own journal to `aborted` (rolling back from `moved`) before the error propagates.
     The live-owner rule therefore never strands a journal in a long-lived daemon.
   - **Halts raised by the restack executor itself.** The executor halts only after it has driven
     its own journal to `synced` or `aborted`, rolling back where needed.
   - **Halts raised from outside the restack.** One raised while the journal is `ready`, `moved` or
     `rolling-back` (for example, the daemon's `writeHalt`) first runs journal recovery. That
     recovery is guarded against re-entry: a recovery that itself fails ends in `aborted` and never
     re-invokes the seam. It runs:
     - forward to `synced` when the sync can complete;
     - otherwise backward through `rolling-back` to `aborted`.

     Only then is the halt record committed, with the head SHA after recovery, so the record and its
     SHA are never stale. Recovery is idempotent, so the halt seam always has an owner.
   - **Cleanup.**
     - After `applied`, the journal and staging refs are deleted, unless the journal names a chained
       follow-on (decision 9). Then it stays `applied` until the follow-on's journal is created.
     - After `aborted`, they are kept while the halt the abort raised is outstanding, so both sides
       stay inspectable. They are deleted at the first resume after that halt clears.
     - "Outstanding" is read from git, not `.pipeline/`: the committed halt record at the active
       branch tip still reads `Status: halted`.
     - Lock failures, classified from stderr, are retried a bounded number of times. A leftover is
       removed at the next resume.
   - **Why refs and not `.pipeline/`.** `.pipeline/` does not survive worktree recreation (#497).
     This follows the `refs/conductor/<slug>/positions` precedent in
     `adr-2026-10-07-per-child-build-region` decision 1.
   - **Event-spine fit.** The ref-backed state is bookkeeping that git itself must hold, and it
     carries no telemetry, so it is not a parallel event channel (event-spine skill, exception C).
     Every state transition is also emitted on the spine (decision 12).

5. **One atomic move, then a worktree sync that never loses local work.**
   - **Checks at `ready`, before any ref moves.** The planner refuses with nothing moved, never
     autostashing, in any of these cases:
     - a branch whose tip will change is checked out in a worktree other than the feature
       worktree. Only an originating child whose own branch tip the plan leaves unchanged (no
       moved child below it) is exempt, so it may stay checked out where the operator committed;
     - a dry run, `read-tree -m -u -n <old> <new>`, of the checked-out branch's move still
       reports a collision after untracked collisions are quarantined (`sync-collision`);
     - a tracked dirty path intersects `diff(old, new)`. Ignored files never count as dirty.
   - **What is carried.** Untracked collisions are moved aside with the existing quarantine
     (`rebase.ts` untracked-collision path). Dirty paths outside the delta are carried, as
     `git switch` carries them.
   - **The move.** One `update-ref --stdin` transaction (`start`, `update <ref> <new> <old>`,
     `prepare`, `commit`) moves every journaled branch and closure ref, the leaf-moved marker
     (decision 8) and the journal state.
     - An old-value mismatch refuses the whole transaction; the engine aborts and halts
       `stack-ref-changed`, naming the ref.
     - A lock failure is retried. If the retries are exhausted, the refs are still old, so the
       journal goes to `aborted` and the run halts `lock-unavailable`, naming the lock.
   - **Verification after the move.** Every tip must equal the journal, the ancestry chain must
     hold from child 1 to the top, and every tree must equal its staging ref.
     - A failure runs a reverse compare-and-swap transaction (`rolling-back` → `aborted`), then
       halts `verification-failed`, naming the failed check.
   - **Sync.**
     - The checked-out branch is synchronised from its old tip to its new one with
       `read-tree -m -u`.
     - `current-task` is preserved: a restack never changes which child is checked out, and the
       task's commits are translated through the rewrite map.
     - The protected-artifact seal is checked before the move and rotated after the sync,
       exactly as `performRebase` does (`adr-2026-07-26-protected-artifact-seal-rebaseline` D3).
   - **Recovery of a half-applied sync.** For each path in `diff(old, new)`:
     - content equal to the old blob is restored from the new tip;
     - content equal to the new blob is left alone;
     - any other content is an operator edit.

     An operator edit is never overwritten. The engine rolls back (`rolling-back` → `aborted`) and
     halts needs-human, naming the path.

6. **A conflict is handed to a narrow resolver. Unresolved, it halts with nothing moved.**
   - **The resolver primitive.** A conflict on commit c of child j goes to a new resolver-only
     primitive. It is not `performRebase`, whose root-coupled side effects (seal, translation, HALT
     text, autostash) stay N=1-only. The primitive:
     - adds a temporary detached worktree at child j's old own tip, under the feature worktree's
       gitignored `.pipeline/restack/resolve/`;
     - runs `rebase -i --onto <newParent> <oldParent>` with no branch argument, the pinned config,
       and an engine-written todo. The todo lists exactly the commits the plumbing replay would
       apply, so the patch-equivalent and empty rules match the clean path. No real ref can move.
     - sets `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` and `GIT_COMMITTER_DATE` from the
       journal's committer stamp, so resolved commits carry the same committer as replayed ones;
     - takes its old-to-new map from rebase's rewritten list. It is not exact by construction, and
       is checked by the path-ownership rule;
     - dispatches the existing resolver within its existing budget;
     - removes the worktree and runs `git worktree prune` on every exit.
   - **Acceptance guards.** The FR-8 and FR-9 guards of
     `adr-2026-06-29-rebase-conflict-resolution-dispatch` are applied with `newParent` as FR-8's
     base and `oldParent..ORIG_HEAD` as FR-9's subject range. The path-ownership check
     (decision 3) also applies.
   - **Result.** An accepted tip is pinned by its staging ref and marked `resolved` in the journal.
   - **Merge-bearing children.** A child whose own range contains a merge refuses the hand-off and
     halts `flatten_refused`, as `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`
     D3 does.
   - **Unresolved.** The journal goes to `aborted`. The engine halts needs-human, naming the child,
     the conflicting commit and the paths. Both sides stay recoverable: the refs never moved, and the
     staging refs are kept until the halt clears.

7. **One shared stack preflight runs before anything that judges the stack.**
   - **What it is.** The preflight is one function in three phases:
     1. journal recovery;
     2. the halt-record supersede and resume-authorization consumption, which run here rather than
        later;
     3. the automatic repair (decision 9), after re-checking for a leftover `aborted` journal.
   - **Who calls it.** It runs after the park checks, so a parked feature is never restacked, and
     before any of the callers' own logic:
     - the daemon's dispatch, ahead of `consumeResumeAuthorizations` and `resumeRebaseFirst`;
     - conductor resume, ahead of the halt-record supersede, the cursor and
       `classifyRebaseOperation`.
   - **The resulting order** is always: journal recovery, repair, then any base refresh.
   - **A new cursor kind.** `resolveActiveChild` gains `repair-pending`: appended commits past a
     closure, not rewritten. It still yields the active child, so read-only consumers proceed
     instead of throwing:
     - `consumeResumeAuthorizations`;
     - the `kickback-budget` and `task` CLIs;
     - `rewind`.

     Only the preflight acts on `repair-pending`.
   - **N=1.** The preflight's journal probe keeps the non-git guard, and the preflight does
     nothing further for a feature with no durable child state.
   - **Ownership of the operation record.** While a journal exists, it owns any `applying` rebase
     operation record it wrote, and `classifyRebaseOperation` is deferred until the journal is gone.
   - **Recovery by state:**

     | Journal state | Recovery |
     |---|---|
     | `planned` | Children marked `replayed` or `resolved` whose inputs are unchanged keep their staging refs. Planning resumes from the first `pending` child. If any input ref changed, abort without raising a halt and remove the staging refs. |
     | `ready` | Refs are still old, because the move transaction carries the state. Re-run decision 5's pre-move checks; on any failure, abort. Then re-run the transaction with the journaled SHAs, nothing recomputed, and run the post-move verification, rolling back on failure. |
     | `moved` | Run the post-move verification first, rolling back on failure. Then run the bounded sync (decision 5), then `synced`. |
     | `rolling-back` | Re-run the reverse transaction. |
     | `synced` | Apply the transition (decision 8), then `applied`. |
     | `applied` with a follow-on | Run the follow-on base refresh, replacing the journal through the follow-on compare-and-swap (decision 9). |
     | `applied` (no follow-on) or `aborted` left over | Delete the journal, the staging refs and any temporary worktree, then continue. |
     | Unreadable journal | Needs-human halt naming the journal ref, and every child branch, closure ref and staging ref of the feature with its live value. |
     | Live refs matching neither side | Needs-human halt naming each journaled ref and its live value. |

   - **Halt records after the move.** In every state from `moved` onward, a checked-out branch
     whose live tip is its journaled new SHA plus halt-record-only commits counts as matching the
     new side. The `applied` transaction moves only the journal and `cascades`; it never
     compare-and-swaps a branch ref.
   - **Leftover `aborted` journals.** Their cleanup is re-checked at every restack entry, after the
     halt-record supersede and resume authorization have run. So the first resume after a halt
     clears removes the journal before any new restack is planned, and never trips
     `restack-outstanding`.
   - **Halted features.** On a feature with a live HALT, the preflight runs journal recovery only.
     It runs the repair only when no HALT is live, or a matching resume authorization is staged.
     A preflight that halts ends the dispatch, so no re-kick base refresh follows it.
   - **The re-kick sentinel.** The one-shot `REKICK` sentinel is consumed before a restack runs, so
     crash recovery depends only on the journal.

8. **Verdicts: the active child and the whole feature go through existing transitions. Closed
   children are not re-opened.**
   - **The active child.** If it moved, it gets today's transition with its own tuple:
     P = old tip, B = old parent, O = new parent, H = new tip. This applies
     `adr-2026-09-11-selective-post-rebase-verification` D2 to that child's parent pair, and its
     region gates are written to its own stores.
     - The re-kick path passes the child, fixing today's flat write (`daemon-rekick.ts:959-976`).
   - **Whole-feature gates** on the leaf use the whole-stack tuple:
     - P = old leaf tip;
     - B = `merge-base(old c1, old default)`;
     - O = the new default tip for a base refresh, or the old default for a repair;
     - H = new leaf tip.

     They are recorded in the `rebase` step verdict as today.
     - A `feature-repair` restack is never an unchanged replay, because H carries the appended
       commits that P lacks. The delta P→H therefore feeds the selective policy's gate projection,
       and every whole-feature or leaf gate whose inputs intersect that delta is invalidated.
   - **Closed children** keep their verdicts and closures. Their per-child result, computed the same
     way, is emitted in `restack_applied` as `wouldInvalidate`.
     - Re-validating them is #2944's re-entry work, recorded as a follow-up below.
     - The leaf's whole-feature gates re-run under today's rules, and member CI (#2945) checks each
       child.
   - **Translation.**
     - Each moved child's exact old-to-new map is written into the flat `rebase-rewrites.json`,
       keyed by SHA, with pre-image range `oldParent..oldTip`. Every existing reader keeps
       working.
     - The stacked path runs the existing `translateAfterRebase` orchestration with that exact
       map, not just the store rewrite. Repair-obligation baselines (with the nearest-successor
       rule and `repair_boundary_translated`), the attribution memo re-key, and residue
       (`rebase_citation_residue` for dropped commits that evidence still cites) all behave as
       they do for N=1.
     - Evidence stamps, `task-status` commits, the retained RED proof and `provenanceHeadSha` are
       translated through it in the flat stores and the active child's stores only. Closed
       children's stores are never rewritten; their SHAs resolve through the map.
   - **The leaf-moved marker.** The cursor's "leaf rewrite map present" test is replaced by an
     explicit ref, `refs/conductor/<slug>/leaf-moved`.
     - It is written only in a restack move transaction that moves the leaf **while the leaf is the
       active child**. Moving an unentered leaf (decision 2) never writes it, so that leaf's move
       is still pending.
     - A stacked leaf never runs `performRebase`, and N=1 never reads the cursor, so nothing else
       writes it.
     - A restack that leaves the leaf in place therefore never hides a pending leaf move.
     - **Features already in flight.** A stacked leaf rebased before this change has no
       `leaf-moved` ref. If the leaf already contains the last closure tip's rewrite-map image, the
       cursor treats the move as done and writes `leaf-moved`.

9. **Triggers. Restacks happen only where rebases happen today, plus the automatic repair. A
   single-branch rebase is never the fallback.**
   - **FINISH `rebase` step (stacked):** it runs the stack preflight first (decision 7), then a
     `base-refresh`. Child 1 moves onto the default tip and every existing child above it is
     restacked.
     - The stack preflight runs before the existing mergeable-skip check, so a pending repair is
       never skipped. The mergeable-skip then applies to the leaf PR's base refresh unchanged.
     - Dirty-tree handling follows decision 5.
   - **Daemon re-kick (stacked, any active child):** `base-refresh` of the whole stack. This lifts
     `adr-2026-10-07-per-child-build-region` decision 12 and remains the mandatory play-forward of
     `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` D5.
     - It is a no-op when the default tip is already an ancestor of child 1.
     - It never skips silently. A refusal under decision 5 halts needs-human, naming the paths.
   - **Automatic repair in the stack preflight (decision 7).**
     - **When it runs.** The cursor reports `repair-pending`: a closed child's branch has commits
       appended past its closure, the closure is an ancestor of the tip, and the commits are not
       halt-record-only.
     - **What it does.** It runs a `feature-repair` restack: the closure moves to the branch tip in
       the same transaction, and the children above are restacked.
     - **Where it halts instead.** A rewritten closed child (decision 2) still halts needs-human
       as divergent. So does a repair refused by the cap or by decision 5.
     - **The repaired child.** Its own new commits are not re-validated in #2943. The leaf's
       whole-feature gates re-run, and #2944 adds child re-validation.
   - **Rewind of a closed child** stays refused. The refusal now names #2944.
   - **Both causes due at once.** A repair and a base refresh run as two chained operations, repair
     first.
     - The repair's journal records the follow-on and stays `applied`.
     - The follow-on's journal replaces it by compare-and-swap from that exact `applied` journal,
       deleting the repair's staging refs in the same transaction.
       This is the one exception to create-only. A crash between the two operations therefore
       resumes the base refresh.
     - Any other planner still sees an outstanding journal and is refused `restack-outstanding`.
     - If the repair halts, or the follow-on itself is refused, `restack_refused` is emitted with
       reason `deferred-base-refresh`; the refresh is never dropped silently.
   - **Open-PR autoresolve on a stacked feature.**
     - The leaf PR is published at FINISH, so the mergeable sweep can reach it.
     - For a stacked feature, autoresolve never replays. It escalates to a human as an unresolved
       conflict does, with `restack_refused` reason `published-stack`, naming #2945.
     - #2945 owns refreshing a published stack.

10. **Cause scopes refunds. A per-child cap bounds repair cascades.**
    - **Cause.** Every stacked restack, and the rebase operation record it writes, carries
      `cause: 'feature-repair' | 'base-refresh'`. N=1 records omit the field, and an absent cause
      means `base-refresh`.
    - **Refunds.**
      - `creditBuildReviewConvergence` refunds only when the cause is `base-refresh`, as the issue
        requires. A restack caused by a repair inside the feature never refunds.
      - The legacy `advanceTail` refund credits only kickbacks whose originating operation's cause
        is `base-refresh`. A repair run by the preflight inside the FINISH step never reaches it.
        A test asserts both.
    - **Cap.**
      - Each `applied` `feature-repair` operation counts one cascade against its **originating
        child**, the child whose change caused it.
      - Charging every moved child was rejected: three unrelated repairs below would exhaust the
        top child.
      - The bound is `MAX_RESTACK_CASCADES_PER_CHILD = 3`. The cap is checked before the journal is
        created.
      - Reaching the cap halts with class `needs-human`, typed cap evidence, and the child named.
        No new halt class is added (`adr-2026-07-28-total-halt-classification-legacy-boundary` D1).
        No journal is written.
    - **Storage.** One ref-backed blob, `refs/conductor/<slug>/cascades`, is the single authority
      for each child's count and its raised limit. It is written in the `applied` transaction. It
      deliberately does not live in the child's `kickback-ledger.json`, because `.pipeline/` does
      not survive worktree recreation.
    - **The cap halt.**
      - It writes typed cap evidence to the **active** child's ledger under the pseudo-gate
        `restack`. The evidence carries allowance `restacks`, names the originating child, and
        snapshots that child's count and limit from the `cascades` ref for rendering. The ref stays
        the single authority.
      - That is the ledger `consumeResumeAuthorizations` reads.
      - `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` gains `restack: 'needs-human'`, as the `build_review`
        cap does.
      - An unreadable or malformed `cascades` blob counts as an exhausted cap, and fails closed
        (`adr-2026-08-31` ledger reads).
    - **Recovery.**
      - `kickback-budget raise|reset --gate restack --child <originating>` validates that evidence,
        and validates `--child` against the `cascades` ref rather than `.pipeline/children/<k>/`,
        so recovery works after a worktree recreation.
      - It follows the existing recovery order of
        `adr-2026-08-29-operator-authorized-kickback-budget-recovery` D5:
        1. writes the pending adjustment;
        2. appends `kickback_budget_adjustment_authorized`;
        3. updates the limit or count in the `cascades` ref by compare-and-swap;
        4. installs the resume authorization in the active child's ledger.
      - A failure before step 3 leaves the ref unchanged. A command re-run reconciles by
        adjustment id.
      - This changes `bin/conduct` CLI behaviour, so the PR carries a `## Migration` block.
    - **Accounting.** The cap counts restacks, not `build_review` laps, so it does not reintroduce
      the feature-lifetime `build_review` accounting that
      `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` rejected.

11. **Force pushes lease against the remote tip the engine expects.**
    - **Recording.** `executeRemoteGit` is the single chokepoint for engine pushes. On every
      successful push to a feature branch, plain or forced, from the branch's creation onward, it
      records the pushed tip under `refs/conductor/<slug>/pushed/<branch>` by compare-and-swap.
    - **Before a force push.** Every caller (the post-rebase draft refresh, `pushRefreshedBranch`
      for autoresolve and ci-fix, and `publishHaltRecord`) first fetches that one branch. This
      refreshes the tracking ref, so the pre-push hook's tracking check
      (`git-hook-assets.ts:449-459`) still holds.
    - **The decision.** The engine then reads the remote tip R and decides:

      | Remote tip R | Action |
      |---|---|
      | R equals the recorded tip | Push `--force-with-lease=refs/heads/<branch>:<R>`. |
      | R is an ancestor of the HEAD being pushed (for example, ci-fix built on a human push) | Push with the same lease. Nothing on the remote is lost, though commits a human deliberately force-pushed away can be re-published. |
      | No recorded tip exists (a feature in flight before this change), and R equals the tracking-ref value captured **before** the fetch | Push with the same lease, which reproduces today's bare-lease semantics exactly. Then record. |
      | Anything else | Refuse. The remote is unchanged. The engine fails closed, naming the ref and both SHAs, and emits `push_lease_refused`. |

    - **Crash safety.** An intent `{expected, new}` is written to the same ref namespace before
      pushing, and removed after the outcome is known.
      - A remote tip equal to the intended new tip is adopted, including when the push succeeded
        but recording the tip failed.
      - A refused or failed push leaves no intent behind.
    - **Failures before the push.** The push is not attempted, and no `pushed/` ref changes, when
      any of these fails:
      - the single-branch fetch;
      - the remote read;
      - the tracking ref is missing on the no-record path.

      The push fails closed, naming the ref, and each caller keeps its existing failure handling:
      - halt-record publication stays best-effort: it emits `halt_record_push_failed`, keeps the
        commit, and never throws (`adr-2026-08-23-committed-halt-record` D5, D6);
      - the post-rebase draft refresh logs loudly and the build continues;
      - autoresolve and ci-fix escalate as today.
    - **Scope of recording.** Only pushes to a feature branch (leaf or, from #2945, child) are
      recorded. Other refs are untouched.
    - **Cleanup.** Every ref this ADR introduces under `refs/conductor/<slug>/` is deleted, so a
      reused slug never inherits them. The deletion runs in two places:
      - shipped-record teardown (`mergeable-sweep.ts`);
      - the single-slug reclaim helper used by park and reclaim.

      Each deletion names its refs explicitly, from a fixed list plus the journal's own entries;
      it never globs (CLAUDE.md daemon safety rule 1). The refs deleted are:
      - `pushed/` and the intent;
      - `cascades`;
      - `leaf-moved`;
      - `restack/`.
    - **Unchanged.** Child branches are still never pushed until #2945, which reuses this helper.
    - **N=1 change.** This deliberately changes N=1 push behaviour: a force push is now refused
      only where it would overwrite remote work the engine never saw.

12. **Events ride the existing spine and carry `child`.**
    - **New `ConductorEvent` variants,** declared `persist: true` in `event-sinks.ts`:
      - `restack_planned` {opId, cause, children};
      - `restack_applied` {opId, cause, child, oldTip, newTip, wouldInvalidate,
        parentOverlapPaths}, one per moved child;
      - `restack_conflict` {opId, child, commit, paths};
      - `restack_refused` {child?, reason, detail?}. `detail` carries what the refusal names
        beyond the child, such as a ref, lock, path or issue. The reason is one of `cascade-cap`, `dirty-overlap`,
        `sync-collision`, `checked-out-elsewhere`, `stack-ref-changed`, `lock-unavailable`,
        `verification-failed`, `replay-mismatch`, `range-not-ancestor`,
        `closed-child-rewritten`, `flatten_refused`, `restack-outstanding`,
        `published-stack` or `deferred-base-refresh`.
      - `restack_recovered` {opId, fromState}, emitted only when recovery drives a journal out of
        `planned`, `ready`, `moved`, `rolling-back` or `synced`. Deleting a leftover `applied` or
        `aborted` journal emits nothing;
      - `push_lease_refused` {ref, expected, actual}.
    - **Re-kick.** `rebase_skipped_for_stack` is no longer emitted for the re-kick, because it no
      longer skips.
    - **Base-advance attribution.** A `base-refresh` restack also persists `rebase_changed` with the
      unfiltered whole-stack delta, as `adr-2026-08-13-durable-base-advance-attribution` requires,
      so test failures caused by the base advance stay attributed to it.
    - **One emitter.** Every `restack_refused` is emitted through one function, which sets `child`
      whenever the refusal names a child.
    - **N=1** emits only `push_lease_refused`, and only on a refusal.

13. **Proof obligations.**
    - #3019's N=1 golden suite stays byte-identical.
    - `child-region-access-audit` counts are updated deliberately, not loosened.
    - Real-git tests in temporary repositories cover each tested hazard:
      - halt-record add/add;
      - both silent-revert shapes;
      - a merge-bearing child whose merged side main later edited or reverted;
      - a cherry-pick to main;
      - commits that start empty;
      - a concurrent ref change and a held lock;
      - a branch checked out elsewhere;
      - an untracked collision;
      - `rebase.updateRefs=true`;
      - a crash at every journal state;
      - a halt raised while the journal is `moved`;
      - a child that reverts and re-applies its parent's change;
      - an operator edit made during the sync window;
      - a concurrent engine commit racing the move, in a separate process.

## Consequences

### Positive
- A change to any child reaches every existing child above it, carrying only that child's own
  contribution. Nothing moves until the cascade is checked, and then refs and the journal move
  together.
- Crash recovery is mechanical and survives worktree recreation.
- Exit codes are never trusted. A revert outside a child's owned paths halts, and a revert inside
  them is flagged.
- User git config can no longer change engine replays.
- An operator commit on a closed child no longer strands the feature behind a needs-human halt.
- Force pushes cannot clobber a remote tip the engine has not seen.

### Negative
- **Two replay executors.** `performRebase` serves N=1, and plumbing replay serves stacks. They share
  the merge classification helper.
- **Closed children moved by a restack** are not re-validated until #2944. Until then they rely on
  the leaf's gates and on member CI.
- **New refusals.** A stacked feature with dirty paths overlapping the move halts instead of being
  autostashed.
- **Engine-owned refs grow** under `refs/conductor/<slug>/`: journal, staging, cascades, pushed,
  intent and leaf-moved.
- **CLI change.** `kickback-budget` gains a pseudo-gate, which needs a migration block.

### Follow-up Actions
- [ ] #2944 (scope handed over, with a comment on the issue):
  - re-validate closed children that a restack moved, using `wouldInvalidate`;
  - re-validate a repaired closed child's own new commits;
  - lift the closed-child rewind refusal;
  - make routed fixes a third `feature-repair` producer under decision 10's cap.
- [ ] #2945: child pushes through decision 11's helper; published-stack tip adoption and
      `stack-tip-diverged`; the autoresolve replay on stacks.

## Amendments made by this decision
- `adr-2026-10-07-per-child-build-region`:
  - Decision 1: closure refs move by compare-and-swap inside a restack transaction; resume reads the
    journal first and repairs appended closed-child commits; the leaf-moved ref replaces the
    map-presence test.
  - Decision 11: the rewind refusal names #2944.
  - Decision 12: the stacked rebase is a whole-stack restack at any active child.
  - Decision 14: N=1 writes `pushed/` refs.
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: the follow-up for #2943 is delivered;
  closed-child re-validation moves to #2944.
- `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`:
  - D1 and D4: pinned config; the stacked replay uses plumbing.
  - D2: classification adds the Q-carried case.
  - D8: one classification helper is shared by two executors.
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D2: refunds are scoped by
  cause.
- `adr-2026-07-23-build-review-fresh-base-disposition` 1–2: a stacked child's fresh base is its
  parent's restacked closure tip; the disposition still never rebases.
- `adr-2026-09-11-selective-post-rebase-verification` D2 and D5: per-child and whole-stack replay
  tuples.
- `adr-2026-07-03-post-rebase-force-with-lease` D1: an explicit expected SHA at every force-push
  site. D1 already named only one site, and three others exist.
- `adr-2026-09-23-engine-git-guard-on-agent-path` D13 and D14: engine force pushes use explicit
  leases after a single-branch fetch.
- `adr-2026-08-23-committed-halt-record`:
  - D2 and D4: during a restack the halt seam runs journal recovery first, and records the head SHA
    after recovery.
  - D5: the commit goes through the guarded helper, and the push uses the explicit lease.
- `adr-2026-10-07-per-child-build-region` decision 3: the leaf also moves in a restack
  transaction, as decision 2 here describes.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`: the closed-child rewind refusal
  names #2944.
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` D8: the single-slug reclaim
  helper also deletes this ADR's refs.
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`: the `restack` pseudo-gate
  recovers a `needs-human` halt through typed evidence with allowance `restacks`.
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery` D1: the `restack` pseudo-gate's count
  and limit live in one ref-backed store, a deliberate second store justified by durability. Its
  evidence and authorization stay in the active child's ledger.
- `adr-2026-10-04-resume-completes-interrupted-rebase-operation` D1 and D2: the stacked `cause`
  field; the journal is completed before the operation record is classified.
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` D5: re-kick's mandatory rebase
  is the whole-stack restack.
- `adr-2026-07-26-protected-artifact-seal-rebaseline` D3: the restack checks and rotates the seal.
- `adr-2026-06-29-rebase-conflict-resolution-dispatch` FR-8 and FR-9: explicit base and range for
  the hand-off.
- `adr-2026-07-12-rebase-evidence-stamp-translation` D1: the pre-image range is
  `oldParent..oldTip` for restacks.
