**Status:** Accepted

# Stories: stack teardown deletes a merged child whose GitHub head moved

Technical track, so there is no PRD. The operator-confirmed scope is in
`.docs/track/a-partial-stack-merge-or-mid-stack-push-halts-the-.md`: the fix is in teardown only and fixes forward, with no source issue.

Terms used below:
- **Teardown** is `deleteStackChildren` in `src/conductor/src/engine/stack-teardown.ts`, reached from the mergeable sweep and from park reclaim.
- **L** is a sealed child's local branch tip.
- **P** is its recorded `refs/conductor/<slug>/pushed/<branch>` tip.
- **H** is the merged member PR's `headRefOid`.
- A **halt-record-only commit** is one that `isHaltRecordOnlyCommit` accepts for the feature's slug.
- The existing preconditions still hold in every story: the member PR is `MERGED`, and its merge commit is an ancestor of `origin/main`.

## Story 1: A merged child whose head moved after publication is deleted when every local commit is accounted for

As an operator, I want a shipped stack's child branches and engine refs removed even when GitHub's head moved after publication. Then a normal merge, whether in one go or partial, leaves no child branches behind for me to clean up by hand.

### Acceptance Criteria

#### Happy Path
- Given a sealed child whose L equals P and whose H has P as an ancestor plus later commits (a merge of `main` and a CI fix), when teardown runs, then the local child branch is deleted with a compare-and-swap expecting L, and the result is `deleted` once every other child is also deleted.
- Given a sealed child whose L equals P and whose H is a server-side rebase that shares no commit with L, when teardown runs, then the local child branch is deleted, because every commit reachable from L is reachable from P.
- Given a sealed child whose L is P plus two halt-record-only commits that never reached the PR, when teardown runs, then the local child branch is deleted.
- Given a sealed child whose L is ahead of P by commits that are all reachable from H, when teardown runs, then the local child branch is deleted.
- Given a sealed child whose L equals H, as before this change, when teardown runs, then the local child branch is deleted exactly as it was before.
- Given every sealed child is deleted under these proofs, when teardown finishes, then the feature's pushed, push-intent, `positions` and `publication` refs are deleted by explicit name and the result is `deleted`, not `kept`.

#### Negative Paths
- Given the commit H is not present in the local object store, when teardown runs, then it fetches H from `origin` by SHA before computing the proof, and deletes the branch when the fetched H accounts for L's commits.

### Done When
- [ ] A real-git test with H carrying a merge of `main` plus a fix beyond P asserts that the child branch is gone and that `deleteStackChildren` returns `deleted`.
- [ ] A real-git test with H a rebased rewrite unrelated to L asserts that the child branch is gone.
- [ ] A real-git test with two halt-record-only commits on L beyond P asserts that the child branch is gone and that every feature conductor ref, `positions` and `publication` is absent afterwards.

## Story 2: A local commit that never reached the member PR keeps the child branch

As an operator, I want teardown to keep any child branch holding work that reached neither the engine's push nor the merged PR. Then no unreviewed commit is ever destroyed.

### Acceptance Criteria

#### Happy Path
- Given a sealed child whose L carries one commit that changes a production file and is reachable from neither P nor H, when teardown runs, then that child branch is kept at L, the result is `kept`, and a later sealed child that passes the proof is still deleted.

#### Negative Paths
- Given a sealed child whose only unaccounted commit changes the halt record of a different slug, when teardown runs, then that child branch is kept.
- Given a sealed child whose only unaccounted commit changes this slug's halt record and also another file, when teardown runs, then that child branch is kept.
- Given a sealed child whose only unaccounted commit is a merge commit, when teardown runs, then that child branch is kept.
- Given a sealed child with no recorded pushed tip and an unaccounted commit not reachable from H, when teardown runs, then that child branch is kept, and the missing P is treated as contributing no reachable commits rather than as a failure.

### Done When
- [ ] A real-git test with one unaccounted production-file commit asserts that the branch still points at L, that the result is `kept`, and that a later proven child branch is gone.
- [ ] Real-git tests for a halt-record commit of another slug, a mixed-path halt-record commit and a merge commit each assert that the branch still points at L.

## Story 3: A proof that cannot be read retries and deletes nothing

As an operator, I want teardown to fail retryably whenever it cannot read the whole proof. Then a transient error neither destroys a branch nor marks the stack `tornDown`.

### Acceptance Criteria

#### Happy Path
- Given a sealed child whose H is missing locally and whose fetch from `origin` fails, when teardown runs, then the result is `failed`, no child branch is deleted, and the conductor refs are not deleted.

#### Negative Paths
- Given the local branch moves to a new commit after the proof read L, when the compare-and-swap delete runs, then it is refused, the result is `failed`, and the branch points at the new commit.
- Given the commit-range read or the halt-record classification exits with an error, when teardown runs, then the result is `failed` and no later child branch is deleted.

### Done When
- [ ] A test with a failing fetch asserts the `failed` result, every child branch present, and the `publication` ref present.
- [ ] A test that moves the branch between the proof and the delete asserts the `failed` result and the moved tip.
- [ ] A test with an erroring range read asserts the `failed` result and that later children are still present.
