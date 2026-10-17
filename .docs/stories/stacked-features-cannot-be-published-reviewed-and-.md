**Status:** Accepted

# Stories: Publish, review and ship a stacked feature as a GitHub native stack (#2945)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/stacked-features-cannot-be-published-reviewed-and-.md` (the
  ship-path slice of #2945, approach B);
- `adr-2026-10-17-stacked-feature-publication-as-native-stack`, decisions 1–14;
- the conditions of `architecture-review-2026-10-17-stacked-features-cannot-be-published-reviewed-and-`.

Scope outcomes (from jstoup111/ai-conductor#2945, narrowed by the operator on 2026-10-17):
1. **Publication:** a stacked feature publishes as a native stack, one PR per child, in order. The
   top PR is the retained SHIP draft. Publication is idempotent and resumable, and leaf success
   never implies a complete stack.
2. **Checks:** every member passes `ci-gate`, `release-metadata` and `shipped-record`, and the
   feature's release note appears exactly once.
3. **Ship:** only the leaf merging ships the feature. A merged lower prefix leaves it in flight.
   Every member's diff is verified reachable from `main`.
4. **Bodies:** each member's body describes only its own child, plus stack navigation.
   Feature-wide sections appear only on the leaf, and project-owned regions survive.
5. **Concurrent edits:** a published stack is written only when every remote tip matches the
   record. Any other mismatch halts with a dedicated, sweep-skipped class and never loops.
6. **Lifecycle:** a non-leaf member that is merged, closed or reverted is observable on the event
   spine.
7. **Teardown:** teardown and reclaim remove a feature's child branches only after the leaf merges.
8. **Safety:** the engine never merges a member, never touches a ruleset, and never plain
   force-pushes.
9. **Single-PR features** publish exactly as today.

Terms used below:
- **Stacked feature:** a feature whose sealed positions ref `refs/conductor/<slug>/positions`
  declares at least two positions.
- **Three-member stack:** the stacked feature `demo`, with sealed positions `1`, `3` and `5`. The
  positions are deliberately not contiguous.
  - `feat/c1/demo` and `feat/c3/demo` are closed children.
  - The leaf `feat/daemon-demo` is position 5 and is checked out in a clean feature worktree.
  - The retained SHIP draft is the leaf PR #500, with base `main`.
  - Every gate before FINISH has passed, and FINISH publication is starting.
  - Child 1 owns stories `S-A` and `S-B` and task `T1`. Child 3 owns story `S-C` and task `T3`.
- **#c1, #c3:** the PR numbers of the child PRs for positions 1 and 3.
- **The record:** the publication record `refs/conductor/demo/publication`.
- **Pushed tip:** `refs/conductor/demo/pushed/<branch>`.
- **N=1 feature:** a feature with no positions ref, or one position.

Delivered elsewhere:
- #3267: `bundled` and `Stack-Child:` contracts;
- #3268: `stack adopt`, refresh of a published stack, and server-side rebase acceptance;
- #3269: routed-fix PR comments;
- #3270: red intermediate CI surfacing.

## Story 1: A feature that is not stacked publishes exactly as today

**Requirement:** Scope outcome 9; ADR decision 1

As an operator, I want every single-PR feature to keep today's FINISH publication byte for byte, so that stacked delivery cannot regress the features that do not use it.

### Acceptance Criteria

#### Happy Path
- Given an N=1 feature at FINISH, when publication runs to completion, then it walks exactly today's seven transitions in today's order, with today's 2 × 7 progress allowance, and emits no `stack_*` event.
- Given an N=1 feature at FINISH, when the stack observer runs, then it answers `not-applicable` from local refs alone and issues no GitHub or `ls-remote` call.
- Given a three-member stack whose project now sets `stacked_prs.enabled: false`, when FINISH publication runs, then it still publishes the feature as a stack, because the sealed positions ref declares three positions.

#### Negative Paths
- Given an N=1 feature, when FINISH publication completes, then the leaf PR body, `conduct-state.json`, the gh and git argv list, the `finish_publication_*` event sequence and the shipped record's Cost block are byte-identical to the frozen pre-change goldens, and its Time block keeps today's structure.
- Given an N=1 feature whose positions ref declares exactly one position, when FINISH publication runs, then the stack dimension is `not-applicable` and no publication record is created.
- Given an N=1 feature, when FINISH publication fails part-way and resumes, then the resume follows today's path and never reads or writes the publication record.

### Done When
- [ ] The N=1 golden suite covers the FINISH transition-event sequence and the gh and git argv list, and passes unchanged against the frozen goldens.
- [ ] The allowance test still asserts 2 × 7 for an N=1 feature, and a new test asserts 2 × 9 for the three-member stack.
- [ ] A test with the flag off and three sealed positions asserts that both stacked transitions are selected.

## Story 2: Children are pushed and opened as drafts only after every gate has passed

**Requirement:** Scope outcomes 1 and 8; ADR decisions 2, 3 and 4

As a reviewer, I want each child to appear as its own draft PR, chained on the child below it, only once the whole feature's gates have passed, so that I review small PRs that are already validated.

### Acceptance Criteria

#### Happy Path
- Given the three-member stack after `establish_pr`, when `establish_child_prs` runs, then `feat/c1/demo` is pushed and opened as a draft PR with base `main`, and then `feat/c3/demo` is pushed and opened as a draft PR with base `feat/c1/demo`, in that order and in one effect.
- Given the three-member stack where neither child branch exists on `origin`, when each child is pushed, then one `ls-remote` shows the branch absent, the child's closure SHA is pushed with a plain (non-force) push, and the pushed tip is recorded for that branch.
- Given `establish_child_prs` has completed, when the record is read, then it lists positions 1, 3 and 5 in order, each with its branch and PR number (position 5 is the leaf #500), and one `stack_member_published` event carrying `child` and the PR number was emitted per child.
- Given the leaf PR #500 was made ready for review by a human before FINISH, when `establish_child_prs` runs, then #500 is converted back to a draft before any child is pushed, and `stack_member_redrafted` is emitted.

#### Negative Paths
- Given the effect crashed after child 1's PR was created but before the record was written, when publication resumes, then child 1's existing PR is found by its head ref, recorded, and no second PR is opened for `feat/c1/demo`.
- Given a PR create call for child 3 returned an ambiguous error, when publication retries, then it first re-discovers PRs for `feat/c3/demo` in every state, and creates one only if none exists.
- Given child 1's recorded PR was closed or merged by a human before the stack was assembled, when `establish_child_prs` runs, then the stack dimension is `diverged`, the feature halts with class `stack-tip-diverged` naming position 1, and nothing is pushed.
- Given an open PR for `feat/c3/demo` whose base is not `feat/c1/demo`, when `establish_child_prs` runs, then the stack dimension is `diverged` and the feature halts naming position 3.
- Given `feat/c3/demo` does not contain child 1's closure, when `establish_child_prs` runs, then no child is pushed and the feature halts naming position 1.
- Given `origin` already has a `feat/c3/demo` that the engine never recorded pushing, when child 3 is about to be pushed, then no push is made, the remote branch is unchanged, and the feature halts `stack-tip-diverged` naming position 3.
- Given `feat/c1/demo` carries a halt-record-only commit past its closure, when child 1 is pushed, then the closure SHA is pushed, the halt-record commit stays local, and publication does not halt.
- Given the `ls-remote` for `feat/c1/demo` fails for a network reason, when child 1 is about to be pushed, then the failure is a retryable publication failure, not an absent branch, and no push is made.
- Given `establish_child_prs` succeeded, when the publication allowance is checked, then the transition moved the stack dimension out of `members-missing` and is never reported as `publication_transition_unmoved`.

### Done When
- [ ] A FINISH integration test on a three-member fixture with positions 1, 3 and 5 records the push and PR-create argv in order, with the correct base for each child.
- [ ] Crash-injection tests at each record write and each GitHub write in `establish_child_prs` resume to the same two member PRs, with no duplicate create in the recorded argv.
- [ ] A test asserts every child push is a plain push of the closure SHA after an `ls-remote`, and that no recorded argv contains `--force` without an explicit expected SHA.

## Story 3: Child bodies are rendered from the child's own work, and feature-wide content stays on the leaf

**Requirement:** Scope outcomes 2 and 4; ADR decision 6

As a reviewer, I want each child PR to describe only that child, and the leaf to carry the feature's release note, plan declaration, closing reference and migration, so that I know what I am approving and the release note appears exactly once.

### Acceptance Criteria

#### Happy Path
- Given the three-member stack, when child 1's PR body is rendered, then it shows the slice name as title, stories `S-A` and `S-B` with their ids, task `T1`, a diffstat of `feat/c1/demo` against `main`, a `## Stack` section listing #c1, #c3 and #500 in order with #c1 marked, and the template's default release-disposition region with `Release-Disposition: no-note` and migration `none`.
- Given the three-member stack, when the leaf's body is finalized, then it keeps today's authored prose, release note, `Plan:` declaration, `Closes` reference, build-review blocks and migration section, and it gains the same `## Stack` section with #500 marked.
- Given the stack membership changed during publication, when `assemble_stack` completes, then every member's `## Stack` section lists the final ordered membership, and the leaf's captured project-owned regions are byte-identical after that rewrite.

#### Negative Paths
- Given story `S-A`'s title contains the text `.docs/plans/demo.md`, when child 1's body is rendered, then the body contains no `.docs/plans/…md` string, and the reference appears as the plan stem only.
- Given a rendered child body would contain a closing keyword such as `Closes jstoup111/ai-conductor#2945`, when the body postconditions are checked, then the write is refused and publication halts naming the member, and the child is never flipped ready.
- Given a child's release-disposition region differs from the template default, when the postconditions are checked before its ready flip, then the flip is refused naming the member.
- Given the project has no PR template, when a child body is rendered, then it contains the title, summary, diffstat and `## Stack` section, and no project-owned region.
- Given the leaf's project-owned region was captured at SHIP, when the child bodies are rendered, then no capture is read from or written for any child PR, and the leaf's captured region is unchanged.

### Done When
- [ ] A renderer unit test over the three-member fixture asserts each child body's exact sections, and that the leaf body contains the release note, `Plan:`, `Closes` and migration exactly once across all members.
- [ ] A test feeds a story title containing a plan path and asserts the rendered child body matches no `.docs/plans/…md` pattern, using the same regex reconcile uses.
- [ ] A test asserts that `.pipeline/pr-body-region-captures.json` holds entries only for the leaf PR URL after publication.

## Story 4: The leaf is retargeted and the stack assembled exactly once, and resumes after interruption

**Requirement:** Scope outcome 1; ADR decisions 2, 3 and 5

As an operator, I want the leaf retargeted onto the top child and the members assembled into one GitHub stack that is verified before anyone can act on it, so that publication never reports a stack it has not proven.

### Acceptance Criteria

#### Happy Path
- Given both children are published and the shipped record is written, when `assemble_stack` runs, then the record notes the retarget as intended, the leaf PR #500's base becomes `feat/c3/demo`, the record notes the retarget as observed, and a stack is created with #c1, #c3 and #500 bottom to top.
- Given the stack was created, when it is read back, then the stack number is in the record, member order equals the record and each member's head SHA equals its recorded pushed tip, the record marks the stack verified, and `stack_assembled` is emitted.
- Given a stack already holds #c1 alone, when `assemble_stack` runs, then that stack's number is recorded first, the missing members #c3 and #500 are added to it, and no second stack is created.

#### Negative Paths
- Given the process crashed after the retarget was recorded as intended but before GitHub applied it, when publication resumes, then the leaf PR is still found under base `main`, the retarget is applied once, and the record moves to observed.
- Given the process crashed after GitHub applied the retarget but before the record moved to observed, when publication resumes, then the leaf PR is found under base `feat/c3/demo`, no second retarget is issued, and the record moves to observed.
- Given #c3 belongs to a different stack, or the stack's order differs from the record, when `assemble_stack` runs, then the stack dimension is `diverged` and the feature halts `stack-tip-diverged`, and no stack is created or extended.
- Given a member's head SHA on GitHub differs from its recorded pushed tip after assembly, when the stack is verified, then the stack is not marked verified, the feature halts `stack-tip-diverged` naming that member, and `ready_pr` is never selected.
- Given the stack read times out, when `assemble_stack` runs, then the stack dimension is `indeterminate`, it is retried under today's indeterminate routing, and no member is flipped ready.
- Given only the leaf was published successfully, when publication is observed, then `pr.ready` and the stack dimension are not `valid`, and publication is not reported complete.

### Done When
- [ ] Crash-injection tests at the intended write, the retarget call and the observed write each resume with exactly one retarget in the recorded argv.
- [ ] A test with a pre-existing one-member stack asserts one `stack.add` call and no `stack.create` call.
- [ ] A test with a mismatched head SHA asserts the halt class is `stack-tip-diverged` and the record's stack is not marked verified.

## Story 5: Leaf lookups keep working after the retarget, and never adopt a foreign PR

**Requirement:** Scope outcome 1; ADR decision 5

As an operator, I want every step that finds the leaf's retained draft to keep finding it once its base moves to the top child, so that a later FINISH dispatch or self-host release gate never halts on a lost draft.

### Acceptance Criteria

#### Happy Path
- Given the leaf PR #500 was retargeted to `feat/c3/demo`, when a later self-host FINISH dispatch reads release metadata from the retained draft, then it finds #500 and reads the leaf's release-disposition region.
- Given the leaf was retargeted, when region prepare, region capture and halt-state clearing resolve the retained draft, then each resolves #500.
- Given the leaf was retargeted and its PR has no checks after the grace period, when shipped readiness is evaluated, then it reports `ci-pending`, exactly as for any PR whose base is not `main`, and adds no label.

#### Negative Paths
- Given an open PR with head `feat/daemon-demo` and base `release-x`, which is neither `main` nor `feat/c3/demo`, when the retained draft is resolved, then that PR is not adopted and the lookup reports the draft as unavailable.
- Given the leaf PR #500 was closed or merged, when the retained draft is resolved, then #500 is not adopted, as today.
- Given an N=1 feature, when the retained draft is resolved, then the lookup queries exactly as today, with base `main`, and reads no publication record.

### Done When
- [ ] Tests for each of `resolveRetainedShipDraftPrUrl`, `readShipDraftReleaseMetadata`, region prepare and capture and `clearRetainedHaltStateForDispatch` pass with a retargeted leaf.
- [ ] A test asserts a leaf-head PR on any third base is never adopted.

## Story 6: Members flip ready top-down, and nothing is mergeable until every member is ready

**Requirement:** Scope outcome 1; ADR decision 7

As a reviewer, I want the stack to become reviewable all at once, with the lowest member flipped last, so that no member can be merged while publication is still flipping the others.

### Acceptance Criteria

#### Happy Path
- Given an assembled, verified stack, when `ready_pr` runs, then #500 is flipped ready through today's presentation repair first, then #c3, then #c1, and each child flip runs only its postconditions and `ensureShipReady`.
- Given every member is ready, when the snapshot is observed, then `pr.ready` is true and publication proceeds to `record_outcome` with the leaf's `pr_url`.

#### Negative Paths
- Given #c3's ready flip, when the child flip runs, then no halt-history comment is posted, no `Closes` reference is injected, no title or body floor is applied, and no `Plan:` or accepted-risk projection is written to #c3.
- Given `ready_pr` was interrupted after #500 and #c3 were flipped, when publication resumes, then the two ready members are accepted as progress, only #c1 is flipped, and the feature does not halt.
- Given a member's head SHA or the stack's membership changed between two flips, when the next flip is about to run, then it is not performed, and the feature halts `stack-tip-diverged` naming the changed member.
- Given a child's postconditions fail before its flip, when `ready_pr` runs, then that child stays a draft and the feature halts naming it.

### Done When
- [ ] A test records the ready-flip argv order as leaf, highest child, then lowest child.
- [ ] A test asserts the child flip path issues no comment, edit or label call other than the ready flip.
- [ ] A crash-injection test between flips asserts the resume flips only the remaining drafts.

## Story 7: Every member passes the required checks, and a child can never become the feature's implementation PR

**Requirement:** Scope outcome 2; ADR decision 8

As an operator, I want every member PR to get `ci-gate`, `release-metadata` and `shipped-record` results that pass on their own merits, so that the ruleset admits each member without any bypass.

### Acceptance Criteria

#### Happy Path
- Given a member PR whose base is `feat/c1/demo`, when it is opened, then the `ci` workflow runs for it and reports `ci-gate`.
- Given a child PR with the template-default `Release-Disposition: no-note`, when it is flipped ready, then the `release-metadata` check passes and applies no semver label.
- Given a child PR whose head is `feat/c3/demo`, when the `shipped-record` premerge check runs, then it reports `not applicable (stack-child)` and passes.
- Given the leaf PR, when the `shipped-record` premerge check runs, then it classifies the leaf by its `Plan:` declaration exactly as today and requires the shipped record.

#### Negative Paths
- Given a human edited a child body to add `Plan: .docs/plans/demo.md`, when the premerge check, the post-merge reconcile or the audit runs on that child, then each classifies it `not-applicable` with `stack-child`, and no record-only repair PR is opened.
- Given a merged child PR whose body mentions `.docs/plans/demo.md` in prose, when the post-merge reconcile runs, then no record-only repair PR is opened and no `.docs/shipped/demo.md` is written.
- Given the premerge check cannot read the PR's head ref, when it runs, then the check fails with an error naming the missing head ref, and it does not pass by default.
- Given the reconcile or audit cannot read a PR's head ref, when it runs, then it opens no repair and reports the PR as unclassified.
- Given an ordinary PR whose head is `feature/x`, when the premerge check runs, then it is classified exactly as today.

### Done When
- [ ] A structural test asserts the `ci.yml` `pull_request` branches filter includes `main` and `feat/c*/**`.
- [ ] Shipment-association tests cover premerge, reconcile and audit with a child head and a plan-bearing body, and assert `stack-child` in each mode.
- [ ] Adapter tests assert that the CLI metadata reader, the event decoder, the audit query and the reconcile adapter each supply the head ref.

## Story 8: Only the leaf merging ships the feature, and every member's work is proven on main

**Requirement:** Scope outcome 3; ADR decision 9

As an operator, I want the feature recorded as shipped only when its leaf merges, and every member's diff checked on `main`, so that a partial merge never closes the intake or tears the feature down.

### Acceptance Criteria

#### Happy Path
- Given the stack was merged in one go, when the sweep sees #500 merged and `.docs/shipped/demo.md` on `origin/main`, then it verifies that #c1, #c3 and #500 are merged with their squash commits on `origin/main`, and the feature is recorded shipped exactly once.
- Given the leaf merged, when the backlog is scanned afterward, then `demo` is deduped as shipped and never re-dispatched.

#### Negative Paths
- Given only #c1 has merged, when the sweep visits `demo`, then no shipped record exists on `main`, the intake issue stays open, the worktree and branches are kept, and the watch entry is retained.
- Given #500 merged but #c3's squash commit is not an ancestor of `origin/main`, when reachability is checked, then `stack_members_unreachable` names #c3 once, `feat/c3/demo` and the record are kept, and later sweeps do not report it again.
- Given the GitHub read of a member's state fails during the reachability check, when the sweep visits `demo`, then the worktree is still removed in that pass, the watch entry is retained for the next sweep, and no child branch or conductor ref is deleted.
- Given a human dissolved the stack and merged #500 into `feat/c3/demo`, when the sweep visits `demo`, then no shipped record exists on `origin/main`, and the feature is not shipped or torn down.

### Done When
- [ ] A sweep test with a merged lower prefix asserts no teardown call, no ref deletion and a retained watch entry.
- [ ] A sweep test with an unreachable member asserts exactly one `stack_members_unreachable` event across two sweeps, and that the member's branch survives.

## Story 9: Non-leaf member lifecycle is reported on the event spine

**Requirement:** Scope outcome 6; ADR decisions 10 and 14

As an operator, I want to see when a lower member is merged, closed or reverted while its leaf is open, so that I can act on a stack that changed under me.

### Acceptance Criteria

#### Happy Path
- Given #500 is open and #c1 is merged, when the sweep visits `demo`, then one `stack_member_lifecycle` event with `child` 1, PR #c1 and state `merged` is emitted, and the record's `lastSeen` for position 1 becomes `merged`.
- Given #c3 is closed unmerged, when the sweep visits `demo`, then one `stack_member_lifecycle` event with state `closed` is emitted for position 3.
- Given #c1 merged and a later merged PR on `main` carries `Reverts jstoup111/ai-conductor#c1`, when the sweep visits `demo`, then one `stack_member_lifecycle` event with state `reverted` is emitted for position 1.

#### Negative Paths
- Given the sweep emitted the `merged` event for position 1 and crashed before writing `lastSeen`, when the next sweep visits `demo`, then the event is emitted again with the same `eventId`, and the persisted ledger holds it once.
- Given a member's state is unchanged since the last sweep, when the sweep visits `demo`, then no lifecycle event is emitted.
- Given any lifecycle event was emitted, when the feature's ship, intake and teardown state is checked, then none of them changed.
- Given an N=1 feature, when the sweep visits it, then no stack read is issued and no `stack_*` event is emitted.

### Done When
- [ ] Sweep tests assert one event per member state transition across repeated sweeps, with persister de-duplication by `eventId`.
- [ ] Each new event type has a row in the event-sinks registry, and a test asserts its `child` field is present only when it names one member.

## Story 10: A published stack is frozen against engine rewrites, and a mismatch halts once

**Requirement:** Scope outcomes 5 and 8; ADR decision 11

As an operator, I want the engine never to overwrite a published stack that GitHub or a human changed, and to stop once with a clear halt rather than loop, so that reviewed work is never silently replaced.

### Acceptance Criteria

#### Happy Path
- Given the record has members, when the FINISH `rebase` step or the re-kick base refresh would restack `demo`, then it refuses with `restack_refused` reason `published-stack`, moves no ref, and continues: FINISH proceeds to its next step and re-kick retries its gate on the current base.
- Given the record has members and a commit was added past child 1's closure, when the stack preflight would run a `feature-repair` restack, then it refuses with `published-stack`, moves no ref, and the feature halts `needs-human` naming position 1.
- Given the record has members and #500's CI is red, when the sweep evaluates ci-fix for `demo`, then ci-fix is ineligible and escalates as autoresolve does for a stacked feature.
- Given every member's remote tip equals its recorded pushed tip, when an engine push to `feat/daemon-demo` fast-forwards the recorded tip, then the push proceeds with an explicit expected-SHA lease and records the new tip.
- Given a push to `feat/c1/demo` succeeded remotely but crashed before its tip was recorded, when the guard runs on the next push, then it first adopts the outstanding push intent and then compares tips, without halting.

#### Negative Paths
- Given GitHub rebased #c3 and #500 server-side after #c1 merged, when FINISH publication attempts any push or retarget to `demo`, then the guard refuses, the feature halts with class `stack-tip-diverged` naming positions 3 and 5, and `stack_tip_diverged` is emitted.
- Given a `stack-tip-diverged` halt exists, when the daemon re-kick sweep runs, then the feature is skipped and not re-dispatched.
- Given every remote tip matches, when an engine push to a member would rewrite history so the recorded tip is not an ancestor of the source, then the push is refused and the remote branch is unchanged.
- Given remote tips do not match, when a halt-record push targets the leaf, then the push is skipped, `halt_record_push_failed` is emitted with reason `stack-tip-mismatch`, the record keeps its may-be-ahead-of-the-remote note, and no further halt is written.
- Given remote tips do not match, when the post-finish shipped-record refresh would push the leaf, then the push is skipped and logged, and the local commit is kept.
- Given the record has members, when a leaf gate admits a fix that would open a routed round, then route admission refuses it naming `published-stack`, and no route record is created.
- Given remote tips do not match, when an agent pushes to `feat/daemon-demo` through `conduct github-operation`, then the push is refused with a reason naming the stack tip mismatch.
- Given the operator merged the remaining members after a partial merge, when the sweep reads the stack, then no halt is written, because reads never halt.

### Done When
- [ ] Tests for both restack call sites assert the `published-stack` refusal with no ref movement once the record has a member.
- [ ] A guard test through `executeRemoteGit` covers match with fast-forward, match with rewrite, mismatch and intent recovery, and asserts the git argv in each case.
- [ ] `stack-tip-diverged` is accepted by `readHaltClass` and `isRecordableHaltClass`, listed in `RETAINED_HALT_CLASSES`, and a re-kick test asserts the feature is skipped.

## Story 11: Teardown and reclaim remove child branches only after the leaf merges

**Requirement:** Scope outcome 7; ADR decision 12

As an operator, I want a shipped stacked feature's child branches and refs cleaned up by name, and an unshipped feature's children kept, so that nothing leaks and no unmerged work is deleted.

### Acceptance Criteria

#### Happy Path
- Given #500 merged, `.docs/shipped/demo.md` is on `origin/main`, every member is reachable and each local child tip equals its merged PR's head, when the sweep reaps `demo`, then it removes the worktree, compare-and-swap deletes local `feat/c1/demo` and `feat/c3/demo` by name, and deletes the conductor refs, including `positions` and `publication`.
- Given the same shipped state, when the operator runs `reclaim-worktree demo`, then the same child branches and refs are deleted by name.

#### Negative Paths
- Given #500 was closed unmerged, when the operator runs `reclaim-worktree demo`, then the worktree is removed as today, `feat/c1/demo` and `feat/c3/demo` are kept, and the record is kept marked `tornDown`.
- Given local `feat/c1/demo` has a commit past #c1's merged head, when the sweep reaps `demo`, then `feat/c1/demo` is kept, and the record is kept marked `tornDown`.
- Given a `tornDown` record for `demo`, when a new feature reusing slug `demo` reaches FINISH, then the freeze, the tip guard and the stack observer ignore the old record, and the new publication replaces it.
- Given #c3 is unreachable from `origin/main`, when the sweep reaps `demo`, then `feat/c3/demo` is kept, the record is kept marked `tornDown`, and `feat/c1/demo` is deleted.
- Given deleting `feat/c1/demo` fails, when the sweep reaps `demo`, then the watch entry is retained, the remaining refs are not deleted, and the next sweep retries.
- Given a branch `feat/c7/demo` exists that is not a sealed position, when the sweep reaps `demo`, then it is not deleted, because deletion uses only the sealed positions list.
- Given `demo` is parked, when park reconciliation runs, then no child branch is deleted, as today.

### Done When
- [ ] A sweep test records the deletion argv and asserts explicit branch names only, each child deleted with its expected tip, in the order worktree, children, refs.
- [ ] Stack teardown deletes `refs/conductor/<slug>/positions` and `refs/conductor/<slug>/publication` by explicit name once every child is deleted, and the shared cleanup list that park uses includes neither, with unit tests.
- [ ] A reclaim test with a closed-unmerged leaf asserts no child branch deletion.

## Story 12: Every new GitHub write is guarded under the feature's committed ownership

**Requirement:** Scope outcome 8; ADR decision 13

As an operator, I want the new stack and retarget operations to pass the same ownership boundary as every other feature write, so that the engine can only build its own stack, and only from its own members.

### Acceptance Criteria

#### Happy Path
- Given the operator owns `demo` and the leaf ref exists, when the engine calls `stack.create` with the record's members #c1, #c3 and #500, then the operation is authorized and runs `gh api --method POST repos/jstoup111/ai-conductor/stacks`.
- Given the record's stack number, when the engine calls `stack.add` or `stack.read` for that number, then the operation is authorized.
- Given the operator owns `demo`, when the engine calls `pull-request.retarget` on #500 with base `feat/c3/demo`, then the operation is authorized and changes only the base.

#### Negative Paths
- Given a `stack.create` payload that includes a PR number not recorded for `demo`, when it is submitted, then it is refused with `invalid-payload` and no GitHub call is made.
- Given a `pull-request.retarget` payload whose base is not one of `demo`'s member branches, when it is submitted, then it is refused with `invalid-payload`.
- Given `demo`'s committed owner is another operator, when any stack or retarget operation is submitted, then it is refused with `other-owner`.
- Given the leaf ref `feat/daemon-demo` exists neither locally nor on `origin`, when a child PR create or a child push is submitted, then it is refused with `invalid-target`.
- Given the record does not list position 3, when an agent pushes `feat/c3/demo` or binds a PR to it through `conduct github-operation`, then the operation is refused and nothing reaches GitHub.
- Given a `pull-request.edit` request carrying a base field, when it is decoded, then the field is rejected, and no edit can change a PR's base.
- Given a `stack.add` for a stack number other than the record's, when it is submitted, then it is refused with `invalid-target`.
- Given any FINISH publication, when the recorded gh argv is inspected, then no merge, auto-merge or ruleset call appears.

### Done When
- [ ] Registry, decoder and mutation-policy tests cover each new operation's authorized and refused cases with the refusal reasons above.
- [ ] The static GitHub-invocation audit passes with the new operations, and a test asserts no `merge` or ruleset argv in a stacked FINISH run.
