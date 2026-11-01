**Status:** Accepted

# Stories: A routed fix refreshes a published stack and tells the reviewer what changed (#3269)

Technical track (no PRD). Sources: the scope boundary in `.docs/track/a-published-stacked-child-changes-silently-when-a-.md` and `adr-2026-11-01-routed-fix-refreshes-a-published-stack`.

## Story 1: Routed work opens on a published stack only when the stack is reachable

As an operator, I want a routed round to open on a published stack only when its tips are intact, so that a fix is never built against a stack it cannot reach.

### Acceptance Criteria

#### Happy Path
- Given a published stack whose every remote tip equals its pushed receipt and no member has a recorded `lastSeen`, when `ai-conductor stack land --slug <slug> --child <k> --reason "<why>"` runs, then the operator round opens and no `published-stack` refusal is emitted.
- Given the same intact published stack, when a whole-feature audit routes an admitted fix, then route admission admits the round and no `published-stack` refusal is emitted.
- Given the same intact published stack, when a taskless kickback is routed, then its admission admits the round and no `published-stack` refusal is emitted.

#### Negative Paths
- Given a published stack where one member's remote tip differs from its pushed receipt, when `stack land` runs, then it refuses, the refusal names that member and #3268, and no route record, lease, or park remains.
- Given a published stack where one member has a recorded `lastSeen` because it merged or closed, when an audit routes a fix, then admission refuses naming that member and #3268, and no round id is allocated.
- Given the remote cannot be read during the tip check, when admission runs, then it refuses with a retryable reason and treats the unknown tips as not matching.
- Given `stacked_prs.route_whole_feature_fixes` is off on a published stack, when `stack land` runs, then it refuses with the existing `routing-off` reason.

### Done When
- [ ] Tests for route admission, `checkOpenOperatorRound`, the planned-remediation routing arm and taskless kickback admission each cover an intact published stack and a mismatched one.
- [ ] A refused admission leaves no new `refs/conductor/<slug>/routes/` ref in a real-git test.

## Story 2: A routed fix records what it moved on a published stack

As the engine, I want every tip a routed fix moves on a published stack recorded durably, so that FINISH can tell an engine rewrite from anything else.

### Acceptance Criteria

#### Happy Path
- Given a routed round on a published stack with host `k`, when its exit restack applies, then `refs/conductor/<slug>/refresh` records the new tip of `k`, of every closed child above it, and of the leaf, plus the round as owing the host a comment.
- Given a published stack and a leaf host, when the host settles with commits and no restack, then the ledger records the leaf's new tip and the round as owing a comment, in the same ref transaction as the settle.
- Given a second routed round before FINISH runs, when its exit restack applies, then the ledger keeps both rounds as owing comments and each moved member holds the latest recorded tip.

#### Negative Paths
- Given a crash after the restack journal reaches `applied` writing, when journal recovery re-renders the transaction, then the ledger holds the same entries as an uninterrupted run and no entry is lost or doubled.
- Given the ledger ref changed under the restack's transaction, when the `applied` write fails, then the restack halts `stack-ref-changed` naming the ledger ref and no member ref moves.
- Given an unpublished stack, when a routed exit restack applies, then no refresh ledger ref is created.
- Given a routed round that exits with no commit, when it settles, then the ledger gains no entry and no comment is owed.
- Given an operator round that is abandoned, when it closes, then the ledger gains no entry and no comment is owed.

### Done When
- [ ] A real-git test reads the ledger blob after an applied restack and asserts every moved member's recorded tip equals its local branch tip.
- [ ] A real-git recovery test crashes before the `applied` write and asserts the recovered ledger equals the uninterrupted one.

## Story 3: Only FINISH can rewrite a published member, and only to a recorded tip

As a reviewer, I want the engine's rewrite of my PR limited to recorded restack tips, so that nothing else can overwrite what I am reviewing.

### Acceptance Criteria

#### Happy Path
- Given every member's remote tip matches its receipt and the ledger's recorded tip is an ancestor of the source, when FINISH's refresh pushes a non-fast-forward to that member, then the guard allows it with `--force-with-lease` at the pushed receipt.
- Given a fast-forward of the pushed receipt, when any caller pushes to a published member, then the guard allows it as it does today.

#### Negative Paths
- Given a non-fast-forward with the ledger's recorded tip as an ancestor, when a caller without FINISH's refresh authorization pushes, then the guard refuses `stack-tip-mismatch` and the remote does not move.
- Given FINISH's refresh authorization and a source that does not descend from the ledger's recorded tip, when the push runs, then the guard refuses and the remote does not move.
- Given FINISH's refresh authorization and one other member whose remote tip differs from its receipt, when the push runs, then the guard refuses naming that member and the remote does not move.
- Given the ledger is unreadable, when FINISH's refresh pushes a non-fast-forward, then the guard refuses and the remote does not move.
- Given a remote that moved between the guard's check and the push, when the push runs, then the lease rejects it and the receipt does not advance.

### Done When
- [ ] `stack-tip-guard` tests cover each refused combination through a mocked process boundary and assert the push never reaches it.
- [ ] A test proves the halt-record leaf push is refused on a rewritten leaf with a pending ledger.

## Story 4: A landing reopens a finished feature so FINISH runs again

As an operator, I want a landing on a published stack to reach FINISH without manual cleanup, so that a declared landing actually gets validated and published.

### Acceptance Criteria

#### Happy Path
- Given a finished feature with an open PR, when `stack land` opens a round on its published stack, then `finish-choice` and DONE are removed from its worktree.
- Given a feature marked processed and completed with an active publication record, an open routed round and no park, when the daemon scans its backlog, then the feature is dispatched.
- Given a feature marked processed and completed with an active publication record, a closed round, an unpushed ledger entry and no park, when the daemon scans its backlog, then the feature is dispatched.
- Given a routed round on a published stack, when the worktree returns to the leaf, then the leaf gates and `finish` are all pending, their prior verdicts no longer satisfy them, and `rebase` keeps its prior state and verdict.
- Given the reopened run finishes, when FINISH records its outcome, then the feature is marked processed again and is watched by the mergeable sweep.

#### Negative Paths
- Given a processed feature whose ledger holds nothing unpushed or unposted and whose rounds are closed, when the daemon scans, then the feature is not dispatched again.
- Given a reopened feature that is still parked by `stack land`, when the daemon scans, then the feature is not dispatched until the park is released.
- Given a processed feature with no worktree, when the daemon scans, then the feature is not dispatched and the existing shipped dedup skip is reported.
- Given a routed round on an unpublished stack, when the worktree returns to the leaf, then `finish` keeps its prior state exactly as it does today.
- Given `stack land` is refused, when the command exits, then `finish-choice` and DONE are unchanged.
- Given a reopened run reaches its re-pended gates on a published stack, when `rebase` would be selected, then it is not dispatched and no stale-verdict HALT is written.

### Done When
- [ ] A daemon backlog test covers open-round, pending-ledger, drained-ledger, parked and no-worktree cases for a processed slug.
- [ ] A test proves a daemon that completed the slug earlier in the same process dispatches it after reopening.

## Story 5: FINISH refreshes moved members and can resume

As a reviewer, I want the stack updated bottom up once the leaf gates pass, so that I only ever see validated work and a crash cannot strand the stack.

### Acceptance Criteria

#### Happy Path
- Given a ledger with unpushed tips and passing leaf gates, when FINISH runs, then it pushes the moved members bottom up with the leaf last, before any other publication transition.
- Given each push succeeds, when the refresh finishes, then each member's pushed receipt equals its recorded tip and one `stack_member_refreshed` event per member is persisted with its PR, old tip and new tip.
- Given a member whose tip did not move, when the refresh runs, then that member gets no push and no event.

#### Negative Paths
- Given a crash after the second of four pushes, when FINISH resumes, then only the remaining members are pushed and the first two are not pushed again.
- Given a crash after a push reached the remote but before its receipt was recorded, when FINISH resumes, then the push intent is adopted and that member is not pushed again.
- Given a guard refusal during the refresh, when FINISH handles it, then the feature halts `stack-tip-diverged` naming the member, and the members already pushed keep their receipts.
- Given a leaf gate fails after a routed round, when the run stops before FINISH, then no member is pushed and the remote is unchanged.
- Given the refresh is complete, when FINISH continues, then `establish_child_prs` is not selected and no pull request is created.

### Done When
- [ ] A transition-selector test asserts `refresh_published_members` is selected before `establish_pr` while an unpushed tip exists, and never after the ledger has none.
- [ ] A real-git test with a bare remote refreshes a three-member stack and asserts every remote tip, every receipt, and a linear history between the members.

## Story 6: Only a child whose reviewable diff changed gets a comment

As a reviewer, I want a comment only where there is something new to review, so that a fix does not spam every PR above it.

### Acceptance Criteria

#### Happy Path
- Given a routed fix on host `k`, when FINISH posts comments, then the host's PR gets a comment.
- Given a child above the host whose patch id over its last published diff differs from its new diff, when FINISH posts comments, then that child's PR gets a comment linking the host PR.
- Given a child above the host that was only rebased, when FINISH posts comments, then its PR gets no comment and the host comment names it as rebased with no diff change.

#### Negative Paths
- Given a member whose tip did not move, when FINISH posts comments, then its PR gets no comment.
- Given an unpublished stack with a routed fix, when FINISH runs, then no routed-fix comment is posted.
- Given a single-PR feature with remediation, when FINISH runs, then no routed-fix comment is posted.
- Given a patch id that cannot be computed for a child above the host, when FINISH posts comments, then FINISH retries and does not treat that child as unchanged.

### Done When
- [ ] A real-git test covers a clean-replay child and a conflict-resolved child, asserting only the second is owed a comment.
- [ ] A test asserts no `pull-request.comment.create` reaches the operation runner for unchanged, unpublished and single-PR cases.

## Story 7: A comment says what changed and why

As a reviewer, I want each comment to carry the finding and the routing decision, so that I can judge whether my approval still stands.

### Acceptance Criteria

#### Happy Path
- Given an audit round, when the host comment is rendered, then it lists the commits new since the last push by subject, each finding id with its placement reason and rationale when one exists, and the host's retry hint.
- Given an as-built finding in the round's pending findings, when the host comment is rendered, then it includes that finding's summary and governing clause.
- Given an operator round, when the host comment is rendered, then it includes the commits new since the last push, the operator's reason, and the operator.
- Given a revalidate round that committed a repair on its host, when the host comment is rendered, then it says a re-validation repair landed there and names the gate.
- Given a child above the host with a changed diff, when its comment is rendered, then it says its diff changed while carrying that fix and links the host PR.

#### Negative Paths
- Given a route record that cannot be read for an owed comment, when FINISH renders it, then FINISH retries and posts no comment with an empty reason.
- Given a round item with only a placement code and no rationale, when the host comment is rendered, then it shows the finding id and placement code and leaves out an empty rationale line.
- Given finding text that contains the comment's hidden marker form, when the comment is rendered, then exactly one marker for this round and PR appears in the body.

### Done When
- [ ] Tests render the comment body for audit, as-built, operator and revalidate rounds and assert the listed content in the body.
- [ ] The rendered body contains exactly one marker in every test.

## Story 8: A comment posts once, across resume and retry

As a reviewer, I want one comment per routed fix however many times the engine retries, so that the PR thread stays trustworthy.

### Acceptance Criteria

#### Happy Path
- Given every push has succeeded, when `post_routed_comments` runs, then each owed comment is created once and its receipt is recorded in the ledger before `record_outcome` runs.
- Given a crash after a comment was created and before its receipt was recorded, when FINISH resumes, then the marker scan finds the comment, the receipt is recorded, and no second comment is created.
- Given two routed rounds with different hosts refreshed by one FINISH, when comments post, then each host gets one comment and each comment names its own round.

#### Negative Paths
- Given the comment lookup fails, when `post_routed_comments` runs, then no comment is created and the lookup is retried.
- Given a comment create fails, when attempts reach the bound, then FINISH halts `needs-human` naming the PR, records no outcome, and keeps the receipts already written.
- Given a comment is still owed after a halt is cleared, when FINISH resumes, then no member is pushed again and only the owed comment is posted.
- Given an earlier FINISH already recorded a comment receipt, when FINISH runs again for a later round, then the earlier comment is not posted again.
- Given a push failed earlier in the run, when FINISH stops, then no comment is posted for that refresh.

### Done When
- [ ] A test replays FINISH after each crash point and asserts exactly one create per marker through the mocked operation boundary.
- [ ] A test asserts `record_outcome` is not selected while the ledger owes a comment.

## Story 9: Comments and refreshes reach the guarded path and the audit trail

As an operator, I want every comment authorized and recorded, so that a routed refresh can be audited like any other engine write.

### Acceptance Criteria

#### Happy Path
- Given an owed comment on member PR `n`, when it posts, then it goes through `executeGithubOperation` as `pull-request.comment.create` with a runner bound to PR `n`.
- Given a comment posted, when the run's events are read, then `.pipeline/events.jsonl` holds one `stack_member_comment_posted` event with the PR, round and marker.
- Given a push and a comment replayed after recovery, when events persist, then each `eventId` is persisted once.

#### Negative Paths
- Given the owner gate refuses the comment on PR `n`, when it posts, then a `github_operation_refused` event is persisted, no comment is created, and FINISH follows the bounded failure path.
- Given a runner bound to a different PR, when the comment posts, then the operation is refused and no comment is created.
- Given the event emitter throws while recording a posted comment, when FINISH continues, then the receipt still prevents a second comment.

### Done When
- [ ] `github-invocation-audit` passes with the new caller.
- [ ] `event-sinks.ts` registers both new event types, and a persister test proves a replayed `eventId` de-duplicates.

## Story 10: Everything else on a published stack stays frozen

As an operator, I want the freeze lifted only for routed work, so that this write path does not widen into a general refresh.

### Acceptance Criteria

#### Happy Path
- Given a published stack with no open round, when the FINISH base refresh runs, then it skips the rebase and moves no ref, as it does today.
- Given a published stack with a routed exit whose journal has a base-refresh follow-on, when recovery settles it, then the follow-on is suppressed and no member moves onto the new base.
- Given an unpublished stack or a single-PR feature, when any flow in this change runs, then its refs, pushes and comments match today's behavior.

#### Negative Paths
- Given a published stack with raw post-closure commits and no open operator round, when stack preflight runs, then it halts `needs-human` and, if the tip check passes, names `stack land` as the recovery.
- Given a published stack whose tip check fails with raw post-closure commits, when stack preflight runs, then it halts naming the member and #3268.
- Given a published stack, when `rewind --child` runs, then it refuses `published-stack` naming #3268.
- Given a published stack, when sweep ci-fix or autoresolve would push, then each keeps refusing or escalating as it does today.
- Given a published stack, when a re-kick base refresh runs, then it moves no ref.

### Done When
- [ ] Existing published-stack tests for rewind, ci-fix, autoresolve, re-kick and the FINISH rebase pass unchanged.
- [ ] An N=1 test asserts no refresh ref is created and no refresh transition is selected.
