**Status:** Accepted

# Stories: A lower stack child never gains a higher child's commits (#3676)

Technical track. Governing design: `adr-2026-11-15-stack-children-never-gain-higher-child-commits` (APPROVED) and `.docs/decisions/architecture-review-2026-11-15-repair-host-merged-a-higher-child-into-its-branch-.md`.

**Notation used below.**

- **The test stack:** a stacked feature with durable child state, child branches `feat/c1/<slug>` through `feat/c3/<slug>`, and the top position built on the leaf branch.
  - Children 1 and 2 have closed: `refs/conductor/<slug>/closed/c1` and `closed/c2` exist.
  - So child 3 is **entered**. A child is entered once the closure of its predecessor position exists.
- **Child 2:** the checked-out child branch `feat/c2/<slug>`.
- **A higher-only commit:** a commit in child 3's own range (`feat/c3/<slug> ^closed/c2 ^origin/<default>`).

## Story 1: The agent-path git wrapper refuses higher-child moves before git mutates anything

**Requirement:** adr-2026-11-15-stack-children-never-gain-higher-child-commits decision 2

As the harness, I want a builder's merge, cherry-pick, reset or rebase toward a higher child refused before it runs, so that a lower child's branch, index and worktree stay exactly as they were.

### Acceptance Criteria

#### Happy Path
- Given the test stack with child 2 checked out, when the agent-path `git` runs `merge feat/c3/<slug>` (with or without `--no-ff` or `--no-commit`), then it exits non-zero without running the merge, child 2's branch tip, index and worktree are unchanged, no `MERGE_HEAD` exists, and stderr names child 3, the number of higher-only commits, and says to build the work on the child that owns its prerequisite.
- Given the test stack with child 2 checked out, when the agent-path `git` runs `cherry-pick` naming one higher-only commit or a range containing one, then it exits non-zero without creating a commit, child 2's tip is unchanged, and stderr names child 3 and the refused commits.
- Given the test stack with child 2 checked out, when the agent-path `git` runs `reset --keep`, `reset --soft` or `reset --mixed` to child 3's tip, or `rebase` with child 3's branch as upstream or `--onto` target, then it exits non-zero without moving child 2's tip and stderr names child 3.
- Given the test stack with child 2 checked out, when the agent-path `git` runs `merge`, `cherry-pick`, `reset` or `rebase` whose incoming commits are all already reachable from child 2 or come only from the default branch, then the command runs exactly as it does today.

#### Negative Paths
- Given the test stack with child 2 checked out, when a containment-class command carries an option the shared git option spec cannot resolve, then the wrapper refuses it with stderr naming the unresolved option, and child 2's tip is unchanged.
- Given the test stack with child 2 checked out, when the containment check itself cannot run (the launcher subcommand exits with an error or a ref it needs cannot be read), then the wrapper refuses the command with stderr naming the check failure, never running the command.
- Given a branch that is not a `feat/c<k>/<slug>` child branch of a feature with durable child state (the default branch, the leaf branch, an N=1 feature branch, or a repository outside the feature), when the agent-path `git` runs any of these commands, then it runs exactly as it does today, with no containment check.
- Given a stacked feature in its first pass where child 2 is open and no higher child is entered (`closed/c2` does not exist), when the agent-path `git` runs `merge` of the leaf branch into child 2, then the containment check finds nothing foreign and the command is not refused by it.
- Given the test stack with child 2 checked out, when the refusal text is inspected, then it contains no instruction to move, copy or cherry-pick the higher child's commits onto child 2.

### Done When
- [ ] Real-git tests drive the agent-path wrapper in a `prepareWorktree`-provisioned child worktree for each refused form above and assert unchanged tip, index, worktree and absent `MERGE_HEAD`.
- [ ] Each refusal's stderr names the higher child and the refused commit count or commits.
- [ ] Pass-through tests prove the commands run unchanged on non-child branches and for contained incoming commits.

## Story 2: The reference-transaction hook refuses any child-branch ref move that gains a higher child's commits

**Requirement:** adr-2026-11-15-stack-children-never-gain-higher-child-commits decision 3

As the harness, I want git itself to refuse a child-branch tip move that bypasses the wrapper, so that a fast-forward merge, reset, update-ref or merge commit cannot land a higher child's commits on a lower child.

### Acceptance Criteria

#### Happy Path
- Given the test stack with child 2 checked out and `git` invoked by absolute path (bypassing the wrapper), when it runs `merge --ff-only feat/c3/<slug>`, `reset --keep feat/c3/<slug>`, or `update-ref refs/heads/feat/c2/<slug>` to child 3's tip, then git reports the ref update aborted by the hook, child 2's branch still points at its previous commit, and stderr names child 3 and the recovery `git reset --merge HEAD`.
- Given the test stack with child 2 checked out and `git` invoked by absolute path, when it runs `merge --no-ff --no-commit feat/c3/<slug>` and then `commit`, then the commit's ref update is aborted, child 2's branch still points at its previous commit, and stderr names child 3 and the recovery `git merge --abort`.
- Given the refusal state left by either case above, when the named recovery command is run, then the index and worktree match child 2's tip again and no `MERGE_HEAD` remains.

#### Negative Paths
- Given the test stack with child 2 checked out, when an ordinary commit of new work is made on child 2, then the hook allows it and the tip advances.
- Given any ref update that is not a `feat/c<k>/<slug>` child branch (the default branch, the leaf branch, `refs/conductor/` refs, tags), when the hook runs at the `prepared` stage, then it allows the line without starting the containment check, and the existing deletion rule still applies unchanged.
- Given the test stack with child 2 checked out, when the containment check cannot run during a child-branch update, then the hook aborts the transaction with stderr naming the check failure, never allowing the move.
- Given a deletion line for a branch tip reachable from another ref, when the hook runs, then it is allowed as before, and a deletion of an otherwise-unreachable tip is still refused as before.

### Done When
- [ ] Real-git tests with `git` called by absolute path prove each refused move leaves child 2's ref unchanged and names child 3 and the recovery command.
- [ ] A real-git test proves the named recovery restores the pre-command index and worktree.
- [ ] Tests prove ordinary child commits, non-child refs and existing deletion behavior are unchanged.

## Story 3: Engine operations and ordinary stacked work pass the containment checks unchanged

**Requirement:** adr-2026-11-15-stack-children-never-gain-higher-child-commits decision 4

As the harness, I want every engine ref move and every normal host repair to pass without any bypass variable, so that the guard stops only foreign gains and never the engine's own history work.

### Acceptance Criteria

#### Happy Path
- Given the test stack, when the journaled restack replay rewrites child 2 onto a moved child 1 and moves children 2 and 3 in one transaction inside the feature worktree, then the transaction succeeds with the hooks installed.
- Given the test stack with a prerequisite reroute admitted for host 2, when the reroute transaction resets child 2 to its closure, then it succeeds with the hooks installed.
- Given the test stack, when a child-cursor advance creates the next child's branch, or base refresh brings the default branch into child 2, then the ref moves succeed with the hooks installed.
- Given the test stack where child 3 has merged default-branch commit `D1` and a base-refresh restack then moves child 2 onto a base containing `D1`, when the restack transaction runs, then it succeeds with the hooks installed, and an agent-path `git merge origin/<default>` on child 2 is not refused by the containment check.
- Given a stacked feature whose leaf branch carries a pre-region halt record commit `H`, when the engine creates `feat/c1/<slug>` at `H` and later creates `feat/c2/<slug>` at `closed/c1`, then both creations succeed with the hooks installed.
- Given a routed repair round hosted on child 2, when the builder commits ordinary repair work on child 2, then each commit succeeds and the round proceeds exactly as before.

#### Negative Paths
- Given any of the engine operations above, when they run, then neither the wrapper nor the hook reads `CONDUCT_ENGINE_COMMIT` or any other escape variable to allow them; they pass because the containment check finds no higher-only commit.
- Given an N=1 feature (no durable child state), when commits, resets and merges run on its branch, then no containment check runs and behavior is unchanged.

### Done When
- [ ] Real-git tests run the restack replay, prerequisite reroute, child-cursor advance and base refresh in a hook-provisioned feature worktree and assert each succeeds.
- [ ] A test asserts the hook and wrapper assets contain no `CONDUCT_ENGINE_COMMIT` check in the containment path.
- [ ] An N=1 test asserts no containment check is started.

## Story 4: Routed host gates refuse to pass a tree that contains a higher child's commits

**Requirement:** adr-2026-11-15-stack-children-never-gain-higher-child-commits decision 5

As the operator, I want a lower child's gates to halt with the cause named when its tree already holds a higher child's commits, so that its PR never ships another child's work and I see the problem at once instead of as a later restack halt.

### Acceptance Criteria

#### Happy Path
- Given child 2's branch already contains a merge of child 3 (made with hooks bypassed), when the conductor is about to dispatch `test_suite` or `build_review` for child 2's region, then it dispatches neither step and writes a needs-human HALT with reason `stack-containment-violated`.
- Given child 2's branch contains a commit whose patch equals a higher-only commit of child 3 (a copied commit), when the conductor is about to dispatch `test_suite` or `build_review` for child 2, then it writes the same `stack-containment-violated` HALT and dispatches neither step.
- Given a routed host on child 2 whose branch contains a higher-only commit, when the routed exit is requested, then the host does not settle, no exit restack runs, and the `stack-containment-violated` HALT is written.
- Given any `stack-containment-violated` HALT, when its text is read, then it names the host child, the higher child, each offending commit marked as ancestry or patch, and the recovery: move the host back to its closure or last contained commit and rebuild the work on the child that owns its prerequisite.
- Given any `stack-containment-violated` HALT, when the event spine is read, then a `halt_record_written` event for it is present and no new event variant or sidecar file was written for the refusal.

#### Negative Paths
- Given child 2's branch holds only its own commits after its closure, when `test_suite`, `build_review` or the routed exit runs, then no containment HALT is written and each proceeds exactly as before.
- Given child 2 after a fold or feature-repair restack that moved every child in one transaction, when its re-validation gates run, then no containment HALT is written.
- Given a stacked feature in its first pass where child 2 is open and no higher child is entered, when child 2's `test_suite` and `build_review` are dispatched, then no containment HALT is written and each proceeds exactly as before.
- Given child 1 checked out while child 3 is entered (`closed/c2` exists) but `refs/conductor/<slug>/closed/c1` is missing, when its gate check runs, then the conductor writes a needs-human HALT naming the missing closure ref rather than passing the gate.
- Given a stacked feature with gapped positions `1`, `3` and `5` (5 is the leaf) where `closed/c1` and `closed/c3` exist, when child 1's gate check runs on a branch that merged `feat/c3/<slug>`, then the conductor writes the `stack-containment-violated` HALT naming child 3, so gapped positions do not let the merge through.
- Given the containment check cannot run at a gate (a git error reading a ref or computing patch-ids), when the gate check runs, then the conductor writes a needs-human HALT naming the check failure and dispatches no gate step.
- Given a leaf-executed audit host whose region runs with the leaf branch checked out, when its `test_suite`, `build_review` or routed exit runs, then no containment check runs and no containment HALT is written.
- Given the leaf branch or an N=1 feature, when its gates run, then no containment check runs.

### Done When
- [ ] Engine tests with a real-git stack assert that a merged-in higher child and a copied higher commit each stop `test_suite`, `build_review` and the routed exit with a `stack-containment-violated` HALT whose text names host, higher child, each commit with its mode, and the recovery.
- [ ] The persisted events contain the HALT's `halt_record_written` event and no other new event type.
- [ ] Tests assert a contained child, a first-pass child, a post-fold child, a leaf-executed host, the leaf and an N=1 feature pass with no containment HALT, and that a missing closure or check failure halts with its named cause.
