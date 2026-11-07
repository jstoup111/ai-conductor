**Status:** Accepted

# Stories: Operator restack --tip resolution always refused stale on a stacked feature

Source: jstoup111/ai-conductor#3582, folding #3557 and #3576. Track: technical (no PRD). Tier: L.

Notation: `demo` is a stacked feature. "Candidates" are the commits the restack's replay todo lists for a child. A "halt-record-only commit" is a non-merge commit whose only changed path is `.docs/halted/demo.md`. "The record ref" is `refs/conductor/demo/halt-record`. "Both recipes" means the HALT text's scratch-branch `git rebase --onto` with `stack restack-resolve --tip`, and `stack restack-resolve --decision`.

## Story 1: A resolver-settled restack keeps every commit of the child

**Requirement:** #3582 additional desired outcome: a restack or rebase resolution that removes any of a child's feature commits from the leaf halts instead of continuing into BUILD.

As an operator of a stacked feature, I want a restack the resolver settles to keep all of a child's commits, or to halt, so that a child's work can never silently leave its branch.

### Acceptance Criteria

#### Happy Path
- Given child 3's range has 8 candidates and a conflict, when the production resolver path dispatches a provider, then the provider invocation carries the Git environment the restack built, on each of the Claude, Codex and Pi adapters and on the fallback model ladder.
- Given a resolver that continues the rebase using that environment, when the restack applies, then child 3's branch holds 8 commits above its parent with the original subjects, each with the journal's committer stamp, and `restack_applied` reports a new tip different from the parent's tip.
- Given a resolver that runs `git rebase --continue` without that environment so no rewritten list is written, when it settles all 8 candidates, then child 3's new tip is the settled temporary checkout's HEAD and child 3's branch holds all 8 commits.
- Given that same run with no rewritten list, when the journal records the child as resolved, then each candidate with a unique subject maps to its rebuilt commit in the journal's rewrites, and candidates sharing a subject are omitted from that map.
- Given a child whose replay todo has no candidates, when the restack settles the child, then its tip equals the new parent and no halt is written.
- Given journal recovery resumes a planned journal that reaches the resolver, when the resolver settles without the environment, then the child keeps all of its candidates exactly as an executor run does.

#### Negative Paths
- Given a resolver that skips one of the 8 candidates, when the rebase completes, then no branch or closure ref moves, the journal aborts, and the feature halts needs-human with a `Restack-Conflict` line, both recipes and the missing commit's subject.
- Given 8 candidates, a settled rebase, an unreadable temporary checkout HEAD and no rewritten list, when the resolver result is read, then no branch or closure ref moves and the feature halts needs-human naming the unreadable tip, and no child branch is set to the new parent.
- Given 8 candidates, an unreadable temporary checkout HEAD and a rewritten list whose result lacks a candidate's subject, when the resolver result is read, then no branch or closure ref moves and the feature halts needs-human naming that subject.
- Given a resolver that reports it could not settle the conflict, when the result is read, then the shipped unresolved-conflict halt is written unchanged, with a fresh conflict record and both recipes.

### Done When
- [ ] A real-git test drives `restackResolverForStepRunner` with a resolver that runs `git rebase --continue` without the environment, and asserts the 8 commits on child 3's branch and a `restack_applied` new tip different from its parent's tip.
- [ ] A real-git test with a resolver that drops a candidate asserts unmoved `feat/` and `closed/` refs and the HALT text.
- [ ] Each provider adapter has a test asserting the spawned child's environment contains an overlay variable.

## Story 2: An operator's `--tip` is consumed despite halt bookkeeping

**Requirement:** #3582 desired outcome: an operator `--tip` resolution recorded against the parent the halt named is consumed on the next dispatch. Also #3557 desired outcomes 1 and 3.

As an operator resolving a restack conflict by hand, I want my recorded tip to be used on the next dispatch even though halting and clearing changed the halt record, so that my resolution does not go stale by construction.

### Acceptance Criteria

#### Happy Path
- Given a recorded `--tip` for child 3 and a parent that has gained two halt-record-only commits since the conflict record was written, when the next dispatch restacks, then the resolution is consumed, `restack_resolution` with action `consumed` is persisted, and no `restack-resolution-stale` event or halt occurs.
- Given a recorded `--tip` for child 3 and a parent rebuilt with new commit ids whose tree differs from the recorded tree only at `.docs/halted/demo.md`, when the next dispatch restacks, then the resolution is consumed.
- Given a recorded `--tip` for child 3 and child 3's branch has gained a halt-record-only commit past the recorded old tip, when the next dispatch restacks, then the resolution is consumed.
- Given an operator range that contains a halt-record-only commit whose record differs from the live parent's, when the resolution is consumed, then that commit is not replayed, no conflict occurs, and the rebuilt tip carries the newer of the two records.
- Given a resolution that is consumed after two halts and clears, when the restack applies, then `.docs/halted/demo.md` at the rebuilt tip is the newest record and the older records remain in the parent's history.
- Given a recorded `--tip` and a parent with halt-record-only drift, when journal recovery resumes the planned journal, then the resolution is consumed with the same result.

#### Negative Paths
- Given a parent whose tree differs from the recorded tree at `.docs/halted/other.md`, when the next dispatch restacks, then the resolution is not consumed and the halt names `parent-tree`.
- Given a parent whose tree differs at `.docs/halted/demo.md` and at `src/a.ts`, when the next dispatch restacks, then the resolution is not consumed and the halt names `parent-tree`.
- Given a live range that differs from the record by a commit changing `.docs/halted/demo.md` and `src/a.ts`, when the next dispatch restacks, then the resolution is not consumed and the halt names `range`.
- Given a live range that differs from the record by a merge commit changing only `.docs/halted/demo.md`, when the next dispatch restacks, then the resolution is not consumed and the halt names `range`.
- Given a Git failure while computing either tree without the halt record, when the next dispatch restacks, then the resolution is not consumed, no branch or closure ref moves, and the halt names `parent-tree`.

### Done When
- [ ] A real-git test runs conflict halt, `stack restack-resolve --tip`, and the next `runRestack` on a parent with halt-record-only commits, and asserts the applied refs and the `consumed` event.
- [ ] The same scenario is asserted through `recoverRestackJournal`.
- [ ] Real-git tests for each negative path assert the named field and unmoved `feat/` and `closed/` refs.

## Story 3: A genuinely stale resolution leaves an answerable conflict

**Requirement:** #3582 desired outcomes: a genuinely stale resolution is still refused, and the operator has a documented path that needs no manual `git update-ref -d`. Also #3557 desired outcome 2.

As an operator whose recorded resolution no longer fits, I want the halt to give me a fresh conflict I can answer with `--tip` or `--decision`, so that I never have to delete engine refs by hand.

### Acceptance Criteria

#### Happy Path
- Given a recorded `--tip` for child 2 and a parent whose feature content changed, when the next dispatch restacks, then no branch or closure ref moves, the resolution ref is gone, and `restack_refused` reports `restack-resolution-stale` with detail `parent-tree`.
- Given that stale outcome, when the operator reads the conflict record, then it names the live range, the live parent and the live parent's tree, and keeps the prior record's commit and paths.
- Given that stale outcome, when the operator reads `.pipeline/HALT`, then it contains `restack-resolution-stale`, `parent-tree`, `Restack-Conflict: 2 <opId>` with this restack's opId, and both recipes naming the live parent.
- Given that stale outcome, when the event log is read, then `restack_resolution` with action `retired` and the old tip is persisted.
- Given that stale halt, when the operator follows the printed `--tip` recipe and the next dispatch restacks, then the new resolution is consumed.
- Given that stale halt, when the operator runs `stack restack-resolve --decision "<answer>"`, then the decision is recorded, the halt clears, and the next restack delivers the decision to the resolver.
- Given a recorded `--tip` whose live range changed with a non-bookkeeping commit, when the next dispatch restacks, then the same outcome occurs with detail `range`.
- Given a stale resolution met during journal recovery, when recovery finishes, then the journal is aborted and the fresh record and HALT match an executor-written stale halt.
- Given a resolution ref for child 2 with no conflict record, when the next dispatch reaches child 2, then the resolution ref is gone, `restack_resolution` with action `retired` is persisted, and the ordinary replay of child 2 runs.
- Given a resolution ref for child 2 and a conflict record naming child 3, when the next dispatch reaches child 2, then the child 2 resolution is retired, the record for child 3 is unchanged, and the ordinary replay of child 2 runs.

#### Negative Paths
- Given an orphan resolution was retired and the ordinary replay conflicts with a resolver that cannot settle it, when the replay ends, then the shipped conflict halt is written with a fresh record and both recipes.
- Given a stale outcome and a fresh record that cannot be written, when the halt is written, then the HALT names the record failure, no branch or closure ref moves, and the next dispatch runs the ordinary replay with no resolution ref present.
- Given a crash after the resolution ref is deleted and before the fresh record is written, when the next dispatch restacks, then no resolution is consumed and the ordinary replay runs.
- Given a stale halt, when the operator supplies a `--tip` that does not descend from the live parent named by the fresh record, then `stack restack-resolve` refuses it and the HALT stays.

### Done When
- [ ] A real-git test runs a stale `parent-tree` outcome, then the printed `--tip` recipe verbatim, and asserts consumption on the next `runRestack` with no `git update-ref` run by the test.
- [ ] A real-git test runs a stale outcome and then `--decision`, and asserts `restack_decision` `recorded` and delivery to the resolver.
- [ ] Real-git tests assert the retired orphan paths and unmoved `feat/` and `closed/` refs, and a test asserts the `retired` action persists through `EventPersister`.

## Story 4: A stacked feature's halt record stays off its branches

**Requirement:** #3576 desired outcomes 1 and 2: halting and clearing never causes a later child boundary to refuse, and a child's published head stays at its closed tip.

As an operator of a stacked feature, I want halts recorded without touching any stack branch, so that halting and resuming cannot change a child's history.

### Acceptance Criteria

#### Happy Path
- Given `demo` is stacked with child 2 active, when a needs-human halt is written, then `git show refs/conductor/demo/halt-record:.docs/halted/demo.md` prints a record with `Status: halted` and `Child: 2`, every `feat/` branch tip is unchanged, the worktree has no new or modified `.docs/halted/demo.md`, and no push runs.
- Given that halt, when it is cleared, then the record ref's record reads `Status: resolved` with its cause and the original halt body, every `feat/` branch tip is unchanged, and `git log -p refs/conductor/demo/halt-record` shows both versions.
- Given child 1 is closed and child 2 active, when a halt is written and cleared, then `feat/c1/demo` still equals `refs/conductor/demo/closed/c1`.
- Given the leaf is the active child, when a halt is written and cleared, then the leaf's tip is unchanged and no push runs.
- Given a halt written to the record ref, when the event log is read, then `halt_record_written` names the record ref as its path.
- Given a feature that is not stacked, or a leaf before its first child exists, when a needs-human halt is written, then `.docs/halted/demo.md` is committed and pushed as it is today, and no record ref is created.
- Given a stack with `Status: halted` committed at HEAD and no record ref, when the halt is cleared, then the record ref is created with the resolved text and no branch gains a commit.
- Given that upgraded stack with an aborted journal, when the next resume checks for an outstanding halt, then none is reported and the journal is cleaned up.
- Given a feature whose stack is torn down, when feature refs are deleted, then the record ref is deleted with them.

#### Negative Paths
- Given the stacked-state check returns a Git error, when a needs-human halt is written, then the HALT marker is written, no branch gains a commit, and `halt_record_write_failed` is emitted.
- Given the record ref changes between read and write, when the compare-and-swap fails, then the HALT marker is written, `halt_record_write_failed` is emitted, and nothing throws.
- Given a record ref reading `Status: resolved` and a committed HEAD record reading `Status: halted`, when outstanding-halt state is read, then no halt is outstanding.
- Given a record ref reading `Status: halted` and a committed HEAD record reading `Status: resolved`, when outstanding-halt state is read, then a halt is outstanding.
- Given a stacked feature with a `mechanical` halt, when the halt is written, then the record ref is not created or changed.
- Given only a record ref exists for a slug with no positions, closure or restack refs, when stacked state is read, then the feature is not treated as stacked.
- Given a restack journal in state `ready`, when a halt is recorded for that stacked feature, then the record ref is written, and no journaled ref moves.
- Given no record ref and no committed record, when a clear runs, then the supersede is a no-op and no ref is created.

### Done When
- [ ] A real-git test halts and clears a stacked feature at a closed-child boundary, and asserts unchanged `feat/` tips, the ref's two commits and the record fields.
- [ ] A real-git test asserts the non-stacked commit and push path is unchanged.
- [ ] A real-git test upgrades a stack holding a committed `Status: halted` record, and asserts `cleanClearedAbortedRestackJournal` cleans the aborted journal after the clear.

## Story 5: A stack crosses leaf boundaries despite halt records and a missing `origin/HEAD`

**Requirement:** #3576 desired outcomes 1, 3 and 4.

As an operator, I want child boundaries to ignore only this feature's halt bookkeeping and to find the default branch the way the rebase path does, so that a stack is refused only for real foreign work.

### Acceptance Criteria

#### Happy Path
- Given the leaf holds two halt-record-only commits outside the tip and the default branch, when the leaf move runs at a child boundary, then the leaf moves to the tip and `git reflog` still lists its old value.
- Given a clone with no `refs/remotes/origin/HEAD` whose `git remote show origin` reports `main`, when the leaf move runs, then the move succeeds, and commits on `origin/main` are not treated as strays.
- Given default-branch discovery fails entirely and every leaf commit is reachable from the tip, when the leaf move runs, then the move succeeds.

#### Negative Paths
- Given the leaf holds a commit that changes `src/a.ts`, when the leaf move runs, then it refuses, naming that commit.
- Given the leaf holds a commit changing only `.docs/halted/other.md`, when the leaf move runs, then it refuses, naming that commit.
- Given the leaf holds a commit changing `.docs/halted/demo.md` and `src/a.ts`, when the leaf move runs, then it refuses, naming that commit.
- Given the leaf holds a merge commit changing only `.docs/halted/demo.md`, when the leaf move runs, then it refuses, naming that commit.
- Given default-branch discovery fails and the leaf holds a commit outside the tip, when the leaf move runs, then it refuses, naming that commit rather than the discovery failure.
- Given discovery names a default branch with no local `origin/<default>` ref, when the leaf move runs, then the check proceeds as if discovery failed.
- Given the leaf changes between the stray check and the update, when the compare-and-swap fails, then the shipped concurrent-update refusal is returned.

### Done When
- [ ] A real-git test crosses a child boundary with halt-record-only commits on the leaf, and asserts the moved leaf and its reflog.
- [ ] A real-git test crosses a boundary in a clone after `git symbolic-ref --delete refs/remotes/origin/HEAD`.
- [ ] Real-git tests for each foreign commit shape assert that the refusal names the commit and the leaf is unchanged.
