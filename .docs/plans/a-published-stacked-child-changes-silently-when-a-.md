# Implementation Plan: A routed fix refreshes a published stack and tells the reviewer what changed (#3269)

**Date:** 2026-11-01
**Stories:** .docs/stories/a-published-stacked-child-changes-silently-when-a-.md
**Conflict check:** Blocking conflicts resolved as of 2026-11-01 (.docs/conflicts/a-published-stacked-child-changes-silently-when-a-.md)

## Summary

Make a routed fix the first engine write into a published stack. The restack records moved tips in a durable ledger, FINISH pushes them under a narrowed tip guard, then posts one guarded comment per routed fix. A landing reopens the finished feature so FINISH can run. 26 tasks in three slices. Source: jstoup111/ai-conductor#3269.

## Technical Approach

- **Governing decision:** `adr-2026-11-01-routed-fix-refreshes-a-published-stack` D1 to D11.
- **Ledger:** new module `src/conductor/src/engine/stack-refresh-ledger.ts`, ref `refs/conductor/<slug>/refresh`. Blob shape: `{version:1, members:{<branch>:{position, publishedTip, recordedTip, pr}}, rounds:[{roundId, kind, host, marker}], aboveOwed:[{pr, marker, hostPr, newTip}], posted:[<marker>]}`. `publishedTip` is the pushed receipt when the entry is first made and survives until that entry's push; it is what lets the own-diff check see the last published diff after a receipt moves. A member is push-pending while `recordedTip` differs from its pushed receipt. A comment is owed while its marker is absent from `posted`. Local pattern: `cascadeUpdateLines` in `restack/cascade-cap.ts` and the queue lines in `appliedTransactionLines`: a JSON blob journaled first so recovery re-renders the same lines, CAS inside the `applied` transaction.
- **Guard:** `guardPublishedStackWrite` gains one arm, reached only through a typed `PublishedStackRefreshAuthorization` that `executeRemoteGit` passes through. Only the FINISH refresh effect constructs one.
- **FINISH:** `PublicationSnapshot` gains `stackRefresh`: `not-applicable`, `push-pending`, `comments-owed`, `settled`, or `unreadable`. `nextFinishPublicationTransition` selects `refresh_published_members` right after the `keep` check, and `post_routed_comments` just before `record_outcome`. Follow the existing effect shape around `establishChildPrs` in `finish-publication-production.ts`, with `operationsForTarget` for a per-member runner.
- **Comments:** hidden markers `<!-- conductor:routed-fix:<roundId>:<pr> -->` and `<!-- conductor:routed-refresh:<newTip>:<pr> -->`. `upsertComment` is not used, because it creates on lookup failure.
- **Own diff:** `git patch-id --stable` over `git diff <old parent tip> <publishedTip>` against `git diff <new parent tip> <recordedTip>`, exported from `rewrite-map.ts` beside `patchIdFor`.
- **Sequencing:** Slice 1 and Slice 2 are dark, because route admission, `stack land` and the routed exit all still refuse a published stack until Slice 3 (D11).

### Every `publishedStackRefusal` caller

| Caller | After this plan | Task |
| --- | --- | --- |
| `routing/round-admission.ts` `admitRound` | tip preflight instead of refusal | 19 |
| `conductor.ts` `planRemediation` routing arm | tip preflight instead of refusal | 19 |
| `conductor.ts` `admitRoutedTasklessKickback` | tip preflight instead of refusal | 19 |
| `routing/operator-round.ts` `checkOpenOperatorRound`, origin `land` | tip preflight instead of refusal | 20 |
| `routing/operator-round.ts` `checkOpenOperatorRound`, origin `rewind` | stays refused | 26 |
| `routing/routed-exit.ts` `requestRoutedExit` | lifted | 25 |
| `restack/stack-preflight.ts` built arm of a routed round | lifted | 25 |
| `restack/stack-preflight.ts` raw post-closure commits with no open round | stays refused, halt names `stack land` | 26 |
| `restack/stack-preflight.ts` `suppressFollowOn` paths | stay: a base-refresh follow-on stays suppressed | 25 |
| `restack/restack-recovery.ts` applied journal follow-on | stays: a base-refresh follow-on is suppressed, a routed applied journal completes | 25 |
| `conductor.ts` `runRebaseStepBody` | stays skipped | 26 |
| `daemon-rekick.ts` base refresh | stays skipped | 26 |
| `ci-fix.ts` inline predicate and `autoresolve.ts` escalation | stay | 26 |

## Prerequisites

None. Every prerequisite issue has shipped.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Refresh ledger, guard arm and FINISH push | 1, 2, 3, 4, 5, 6, 7, 8, 9 |
| 2 | Routed-fix comments and audit events | 10, 11, 12, 13, 14, 15, 16, 17, 18 |
| 3 | Freeze lift, landing and reopen | 19, 20, 21, 22, 23, 24, 25, 26 |

## Tasks

### Task 1: Refresh ledger schema and store
**Story:** Story 2
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `stack-refresh-ledger.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `stack-refresh-ledger.ts`: the ref name, a parser that rejects unknown versions and malformed members, a reader returning `absent`, `ledger`, or `unreadable`, a line builder that merges a restack's moves and a round into the prior blob, and `refreshPendingState`. Add the ref to `routingTeardownRefNames`.
4. Verify GREEN and commit: "feat(stack): refresh ledger store".

**Done when:**
- [test] `readRefreshLedger` returns `absent` with no ref, `ledger` for a valid blob, and `unreadable` for a malformed blob or an unknown `version`, as asserted in `stack-refresh-ledger.test.ts`.
- [test] The merge builder given a second round over a pending ledger keeps both rounds, keeps each still-pending member's original `publishedTip`, and sets each moved member's `recordedTip` to the latest tip.
- [test] The merge builder given a member whose pushed receipt already equals its `recordedTip` sets `publishedTip` from the current pushed receipt.
- [test] `routingTeardownRefNames` includes `refs/conductor/<slug>/refresh`, so teardown deletes it with the other routing refs.

**Files:** src/conductor/src/engine/stack-refresh-ledger.ts; src/conductor/src/engine/routing/routing-refs.ts; src/conductor/test/engine/stack-refresh-ledger.test.ts

### Task 2: The routed exit restack writes the ledger in its applied transaction
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing real-git tests in `restack-executor-refresh.realgit.test.ts` for every Done-when check below, seeding a publication record and calling `runRestack` with routed options directly.
2. Verify RED.
3. Implement: journal the ledger blob beside `routeNew` and `queueNew`, and append its CAS line in `appliedTransactionLines`, only when a routed restack runs with an active publication record. Follow `cascadeUpdateLines`: the blob is journaled first, and the builder is re-rendered unchanged by recovery.
4. Verify GREEN and commit: "feat(restack): record moved tips for a published stack".

**Done when:**
- [test] A real-git routed restack with host 1 on a published three-member stack leaves `refs/conductor/<slug>/refresh` whose `recordedTip` for the host, every closed child above it, and the leaf each equals that branch's local tip, and whose `rounds` holds the round as owing the host a comment.
- [test] A second real-git routed restack before any FINISH leaves both rounds in the ledger as owing comments, with neither marker in `posted`, and each moved member's `recordedTip` equal to its latest local tip.
- [test] A real-git routed restack with no publication record creates no `refs/conductor/<slug>/refresh` ref.

**Files:** src/conductor/src/engine/restack/restack-executor.ts; src/conductor/src/engine/stack-refresh-ledger.ts; src/conductor/test/engine/restack/restack-executor-refresh.realgit.test.ts

### Task 3: Recovery and a changed ledger ref keep the ledger exact
**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 2

**Steps:**
1. Write failing real-git tests in `restack-executor-refresh.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: render the journaled ledger blob in the recovery path and add the ledger ref to `changedRoutedAppliedRef`.
4. Verify GREEN and commit: "fix(restack): recover the refresh ledger with its restack".

**Done when:**
- [test] A real-git crash injected before the `applied` write, recovered through `recoverRestackJournal`, leaves a ledger blob byte-identical to an uninterrupted run, with no entry lost or doubled.
- [test] A real-git run whose ledger ref changed under the transaction halts through `haltRestack` with `stack-ref-changed` naming `refs/conductor/<slug>/refresh`, and no branch or `closed/c<N>` ref moves.

**Files:** src/conductor/src/engine/restack/restack-executor.ts; src/conductor/src/engine/restack/restack-recovery.ts; src/conductor/test/engine/restack/restack-executor-refresh.realgit.test.ts

### Task 4: A leaf host records its tip, and rounds with no change record nothing
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing real-git tests in `routed-exit.realgit.test.ts` for every Done-when check below, calling `requestRoutedExit` with a seeded publication record.
2. Verify RED.
3. Implement: extend the leaf-host settling CAS in `requestRoutedExit` with the ledger line when the leaf moved since the round's `entry.pinnedBase` head on a published stack.
4. Verify GREEN and commit: "feat(routing): record a leaf host's tip for a published stack".

**Done when:**
- [test] A published stack's leaf host with commits settles through `requestRoutedExit` with the host `done` and the ledger recording the leaf's new tip and the round as owing a comment, both moved by one `update-ref --stdin` transaction, as asserted by forcing that transaction to fail and observing neither ref moved.
- [test] A routed host that exits with no commit through `requestRoutedExit`'s no-commit path adds no ledger entry and no owed comment.
- [test] An operator round closed by `stack land --abandon` adds no ledger entry and no owed comment.

**Files:** src/conductor/src/engine/routing/routed-exit.ts; src/conductor/test/engine/routing/routed-exit.realgit.test.ts

### Task 5: The tip guard allows a rewrite to a recorded tip for FINISH only
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `stack-tip-guard.test.ts` for every Done-when check below, through a mocked process boundary.
2. Verify RED.
3. Implement `PublishedStackRefreshAuthorization`, an opaque type constructed only by `authorizePublishedStackRefresh` in `stack-refresh-ledger.ts`. `executeRemoteGit` passes it to `guardPublishedStackPushes`, which reads the ledger. The guard allows a non-fast-forward only with that authorization, all tips matching, and `merge-base --is-ancestor <recordedTip> <source>`.
4. Verify GREEN and commit: "feat(stack): guard arm for a recorded restack tip".

**Done when:**
- [test] `guardPublishedStackWrite` with `PublishedStackRefreshAuthorization`, every remote tip equal to its receipt, and the ledger's `recordedTip` an ancestor of a non-fast-forward source returns allow, and `executeRemoteGit` runs the push with `--force-with-lease=<ref>:<pushed receipt>`.
- [test] `guardPublishedStackWrite` given a fast-forward of the pushed receipt with no authorization returns allow, as it does today.

**Files:** src/conductor/src/engine/stack-tip-guard.ts; src/conductor/src/engine/remote-git-operations.ts; src/conductor/src/engine/stack-refresh-ledger.ts; src/conductor/test/engine/stack-tip-guard.test.ts

### Task 6: Every other rewrite stays refused
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 5

**Steps:**
1. Write failing tests in `stack-tip-guard.test.ts` and `halt-record.test.ts` for every Done-when check below, asserting through a mocked process boundary that a refused call never reaches it.
2. Verify RED.
3. Implement any refusal the tests expose, keeping the guard's existing mismatch reporting.
4. Verify GREEN and commit: "test(stack): refused published rewrites".

**Done when:**
- [test] A non-fast-forward with the ledger's recorded tip as an ancestor and no authorization is refused `stack-tip-mismatch`, and the mocked push is never called, so the remote does not move.
- [test] With authorization, a source that does not descend from the ledger's `recordedTip` is refused and the mocked push is never called, so the remote does not move.
- [test] With authorization and one other member whose remote tip differs from its receipt, the refusal names that member and the mocked push is never called, so the remote does not move.
- [test] With authorization and an unreadable ledger the guard refuses and the mocked push is never called; with a remote that moved after the check, a rejected lease reports failure and the pushed receipt ref does not advance.
- [test] `halt-record.ts`'s leaf push on a rewritten leaf with a pending ledger is refused with `stack-tip-mismatch` and emits `halt_record_push_failed`.

**Files:** src/conductor/src/engine/stack-tip-guard.ts; src/conductor/test/engine/stack-tip-guard.test.ts; src/conductor/test/engine/halt-record.test.ts

### Task 7: FINISH selects the refresh first
**Story:** Story 5
**Type:** infrastructure
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `finish-publication-refresh.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `stackRefresh` on `PublicationSnapshot`, observed from the ledger and the pushed receipts, and `refresh_published_members` in `nextFinishPublicationTransition` and its transition validator. An `unreadable` ledger selects the transition, whose effect halts `needs-human`.
4. Verify GREEN and commit: "feat(finish): select the published member refresh".

**Done when:**
- [test] `nextFinishPublicationTransition` returns `refresh_published_members` for `stackRefresh: push-pending` even when the snapshot would otherwise select `establish_pr`.
- [test] `nextFinishPublicationTransition` never returns `refresh_published_members` or `establish_child_prs` for a snapshot with `stackRefresh: settled` and every publication dimension valid, so no pull request is created after a refresh.
- [test] `nextFinishPublicationTransition` returns `record_outcome` for `intent.outcome: keep`, and the observed `stackRefresh` is `not-applicable` when no ledger ref exists.

**Files:** src/conductor/src/engine/finish-publication.ts; src/conductor/src/engine/finish-publication-production.ts; src/conductor/test/engine/finish-publication-refresh.test.ts

### Task 8: FINISH pushes moved members bottom up
**Story:** Story 5
**Type:** happy-path
**Dependencies:** Tasks 5, 7

**Steps:**
1. Write failing real-git tests with a bare remote in `finish-publication-refresh.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the `refresh_published_members` effect in `finish-publication-production.ts`: build the authorization, push each push-pending member by position with the leaf last through `executeRemoteGit`, and emit `stack_member_refreshed`. Add the `stack_member_refreshed` variant to `types/events.ts`, register it in `event-sinks.ts` with `persist: true`, and add it to the persister's de-duplicating set.
4. Verify GREEN and commit: "feat(finish): refresh moved published members".

**Done when:**
- [test] A real-git three-member refresh through the `refresh_published_members` effect pushes members in ascending position with the leaf last, and `git log` on the bare remote shows each member's parent tip is an ancestor of the next member's tip, a linear history.
- [test] After that refresh, each member's bare-remote tip and `refs/conductor/<slug>/pushed/<branch>` both equal its ledger `recordedTip`.
- [test] `.pipeline/events.jsonl` holds exactly one `stack_member_refreshed` event per moved member carrying `pr`, `oldTip` and `newTip`, and a member whose tip did not move gets no push and no event.
- [test] `round-admission-published.test.ts` and `operator-round-predicates.test.ts` pass unmodified at the end of this slice, proving the freeze still refuses a published stack.

**Files:** src/conductor/src/engine/finish-publication-production.ts; src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/event-persister.ts; src/conductor/test/engine/finish-publication-refresh.realgit.test.ts

### Task 9: The refresh resumes, halts, and never runs before FINISH
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Task 8

**Steps:**
1. Write failing real-git tests in `finish-publication-refresh.realgit.test.ts` for every Done-when check below, and one conductor test for the gate-failure case.
2. Verify RED.
3. Implement resume by comparing each member's pushed receipt with its `recordedTip`, adopt a completed push intent through `adoptCompletedPushIntent`, and map a guard refusal to `haltStackTipDiverged`.
4. Verify GREEN and commit: "fix(finish): resume a published member refresh".

**Done when:**
- [test] A real-git crash after the second of four pushes, then a re-run of the effect, pushes only the remaining two members, counted through the remote-git adapter.
- [test] A real-git crash after a push reached the remote but before its receipt was recorded, then a re-run, adopts the push intent through `adoptCompletedPushIntent` and does not push that member again.
- [test] A guard refusal during the refresh writes a `stack-tip-diverged` HALT naming the member through `haltStackTipDiverged`, and the members already pushed keep their `refs/conductor/<slug>/pushed/<branch>` values.
- [test] A conductor run whose leaf gate fails after a routed round stops before `finish`, and the bare remote's tips are unchanged with no `executeRemoteGit` push recorded.

**Files:** src/conductor/src/engine/finish-publication-production.ts; src/conductor/test/engine/finish-publication-refresh.realgit.test.ts; src/conductor/test/engine/conductor-finish-publication.test.ts

### Task 10: Decide which children above a host changed their own diff
**Story:** Story 6
**Type:** happy-path
**Dependencies:** Task 8

**Steps:**
1. Write failing real-git tests in `routed-fix-targets.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Export `rangePatchId` from `rewrite-map.ts`. Implement `routedCommentTargets` in `stack-refresh-ledger.ts`: a host target for every round, and a member-above target when a moved member's patch id differs. For position 1 the old and new parent is the merge base with the stack's base branch. Compute these when `post_routed_comments` first runs, from the ledger's `publishedTip` and `recordedTip`, and CAS them into `aboveOwed`, naming each rebase-only member for the host comment.
4. Verify GREEN and commit: "feat(stack): own-diff targets for routed comments".

**Done when:**
- [test] `routedCommentTargets` returns a host target for the round's host PR in a real-git routed fix.
- [test] A real-git child above the host with a resolved replay conflict, whose patch id over its last published diff differs from its new diff, is returned as a member-above target whose `hostPr` is the host's PR.
- [test] A real-git child above the host that replayed cleanly is not a target, and it is listed as rebase-only for the host comment.
- [test] A real-git patch-id failure for a child above the host makes `routedCommentTargets` return a retryable failure, and the child is neither a target nor listed as rebase-only.

**Files:** src/conductor/src/engine/rewrite-map.ts; src/conductor/src/engine/stack-refresh-ledger.ts; src/conductor/test/engine/routed-fix-targets.realgit.test.ts

### Task 11: Unchanged, unpublished and single-PR features get no comment
**Story:** Story 6
**Type:** negative-path
**Dependencies:** Task 10

**Steps:**
1. Write failing tests in `routed-fix-comments.test.ts` for every Done-when check below, through a mocked operation runner.
2. Verify RED.
3. Implement any missing condition in `routedCommentTargets` or the snapshot's `stackRefresh`.
4. Verify GREEN and commit: "test(stack): routed comment exclusions".

**Done when:**
- [test] `routedCommentTargets` returns no target for a member whose `recordedTip` equals its `publishedTip`, and `pull-request.comment.create` never reaches the mocked runner for its PR.
- [test] A FINISH snapshot on an unpublished stack with a routed fix observes `stackRefresh: not-applicable`, `post_routed_comments` is not selected, and `pull-request.comment.create` never reaches the mocked runner.
- [test] A FINISH snapshot on a single-PR feature with remediation observes `stackRefresh: not-applicable`, `post_routed_comments` is not selected, and `pull-request.comment.create` never reaches the mocked runner.

**Files:** src/conductor/src/engine/stack-refresh-ledger.ts; src/conductor/test/engine/routed-fix-comments.test.ts

### Task 12: Render the host comment for audit rounds
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 10

**Steps:**
1. Write failing tests in `routed-fix-comment-body.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `renderHostComment` in a new `routed-fix-comment.ts`, reading `items[]`, `allocation[host].retryHint` and `pendingAsBuiltFindings` from the route record, and commit subjects from `git log <publishedTip>..<recordedTip>`.
4. Verify GREEN and commit: "feat(stack): host comment for routed audit fixes".

**Done when:**
- [test] `renderHostComment` for an audit round yields a body listing the commits new since the last push by subject, each finding id with its placement reason, the rationale when one exists, and the host's `retryHint`.
- [test] `renderHostComment` for a round with a `pendingAsBuiltFindings` entry yields a body containing that entry's `summary` and `governingClause`.
- [test] `renderHostComment` lists each rebase-only member by PR number as rebased with no diff change, and the body contains exactly one marker.

**Files:** src/conductor/src/engine/routed-fix-comment.ts; src/conductor/test/engine/routed-fix-comment-body.test.ts

### Task 13: Render operator, revalidate and member-above comments
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Task 12

**Steps:**
1. Write failing tests in `routed-fix-comment-body.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the operator and revalidate arms with an exhaustive switch on the round `kind`, add `renderMemberAboveComment`, omit an empty rationale line, and make an unreadable route record a retryable result. Strip any marker form from finding text before rendering.
4. Verify GREEN and commit: "feat(stack): operator and member comments".

**Done when:**
- [test] `renderHostComment` for an operator round yields a body with the commits new since the last push, `operator.reason`, and the operator's identity.
- [test] `renderHostComment` for a revalidate round yields a body saying a re-validation repair landed there and naming the gate.
- [test] `renderMemberAboveComment` yields a body saying the diff changed while carrying that fix with a link to the host PR, and exactly one marker.
- [test] An unreadable route record makes `renderHostComment` return a retryable result and no body, so no comment with an empty reason can post; an item with only a placement code renders its finding id and code with no rationale line.
- [test] Finding text containing `<!-- conductor:routed-fix:` renders a body with exactly one marker, for this round and PR.

**Files:** src/conductor/src/engine/routed-fix-comment.ts; src/conductor/test/engine/routed-fix-comment-body.test.ts

### Task 14: FINISH posts owed comments before recording its outcome
**Story:** Story 8
**Type:** happy-path
**Dependencies:** Tasks 11, 13

**Steps:**
1. Write failing tests in `routed-fix-comments.test.ts` for every Done-when check below, through a mocked operation boundary.
2. Verify RED.
3. Implement `post_routed_comments` in `nextFinishPublicationTransition` and its effect: read the receipt, then scan the PR's comments for the marker through the runner bound to that PR, then create, then CAS the marker into `posted`. Do not use `upsertComment`.
4. Verify GREEN and commit: "feat(finish): post routed comments once".

**Done when:**
- [test] After every push, the `post_routed_comments` effect calls `pull-request.comment.create` exactly once per owed marker and CAS-writes each marker into the ledger's `posted`.
- [test] `nextFinishPublicationTransition` returns `post_routed_comments` for `stackRefresh: comments-owed` and never `record_outcome`, so every receipt is recorded before `record_outcome` runs.
- [test] One FINISH refreshing two routed rounds with different hosts creates one comment per host, each body naming its own round.
- [test] For a host with one clean-replay and one conflict-resolved child above it, the `post_routed_comments` effect creates a comment on the host's PR and on the conflict-resolved child's PR linking the host PR, creates none on the clean-replay child's PR, and the host comment body names the clean-replay child as rebased with no diff change.

**Files:** src/conductor/src/engine/finish-publication.ts; src/conductor/src/engine/finish-publication-production.ts; src/conductor/test/engine/routed-fix-comments.test.ts

### Task 15: A comment survives a crash and a failed lookup
**Story:** Story 8
**Type:** negative-path
**Dependencies:** Task 14

**Steps:**
1. Write failing tests in `routed-fix-comments.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the failed-lookup retry result and the marker-found path that records the receipt with no create.
4. Verify GREEN and commit: "fix(finish): one comment across crash and lookup failure".

**Done when:**
- [test] A replay after a crash between the create and the receipt finds the marker in the scan, writes the marker to `posted`, and makes no second `pull-request.comment.create` call.
- [test] A failed comment lookup makes no `pull-request.comment.create` call and returns a retry result, and the next attempt scans again.
- [test] A later FINISH with a new round does not create a comment for a marker already in `posted`.
- [test] A retryable result from `routedCommentTargets` or `renderHostComment` makes FINISH retry: the `post_routed_comments` effect creates no comment, and its next attempt computes the target and body again.

**Files:** src/conductor/src/engine/finish-publication-production.ts; src/conductor/test/engine/routed-fix-comments.test.ts

### Task 16: Comment failures stop FINISH without pushing again
**Story:** Story 8
**Type:** negative-path
**Dependencies:** Task 15

**Steps:**
1. Write failing tests in `routed-fix-comments.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the per-FINISH attempt bound of 3 and the `needs-human` halt naming the PR.
4. Verify GREEN and commit: "feat(finish): bound routed comment attempts".

**Done when:**
- [test] A `pull-request.comment.create` failing through 3 attempts writes a `needs-human` HALT naming the PR, records no `finish-choice` outcome, and leaves earlier markers in `posted`.
- [test] A FINISH resumed after that halt clears makes no `executeRemoteGit` push and posts only the owed comment.
- [test] A FINISH whose refresh push failed makes no `pull-request.comment.create` call for that refresh.

**Files:** src/conductor/src/engine/finish-publication-production.ts; src/conductor/test/engine/routed-fix-comments.test.ts

### Task 17: Comments go through the guarded operation path
**Story:** Story 9
**Type:** happy-path
**Dependencies:** Task 14

**Steps:**
1. Write failing tests in `routed-fix-comments.test.ts` for every Done-when check below.
2. Verify RED.
3. Bind each post to `operationsForTarget({kind:'pull-request',number:member.pr})` and call `executeGithubOperation`. Add the new caller to `github-invocation-audit.ts` where it enumerates the comment operation's callers.
4. Verify GREEN and commit: "feat(finish): guarded routed comments".

**Done when:**
- [test] An owed comment on member PR `n` reaches `executeGithubOperation` as `pull-request.comment.create` with a runner from `operationsForTarget` bound to PR `n`.
- [test] An owner-gate refusal on PR `n` persists a `github_operation_refused` event, creates no comment, and counts as a failed attempt on the bounded failure path.
- [test] A runner bound to a different PR returns a refused result and creates no comment.
- [test] `github-invocation-audit` passes with the new caller.

**Files:** src/conductor/src/engine/finish-publication-production.ts; src/conductor/src/engine/github-invocation-audit.ts; src/conductor/test/engine/routed-fix-comments.test.ts

### Task 18: Posted comments reach the spine once
**Story:** Story 9
**Type:** infrastructure
**Dependencies:** Task 17

**Steps:**
1. Write failing tests in `event-sinks.test.ts`, `event-persister.test.ts` and `routed-fix-comments.test.ts` for every Done-when check below.
2. Verify RED.
3. Add the `stack_member_comment_posted` variant, register it, add it to the persister's de-duplicating set, and emit it after the receipt with a deterministic `eventId` derived from the marker. An emitter failure is logged and does not fail the effect.
4. Verify GREEN and commit: "feat(events): routed comment audit event".

**Done when:**
- [test] A posted comment leaves one `stack_member_comment_posted` line in `.pipeline/events.jsonl` with the PR, round and marker.
- [test] `event-sinks.ts` registers `stack_member_refreshed` and `stack_member_comment_posted` with `persist: true`, and `EventPersister` persists a replayed `eventId` of each only once.
- [test] An emitter that throws after a comment leaves the marker in `posted`, and a replay makes no second `pull-request.comment.create` call.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/event-persister.ts; src/conductor/src/engine/finish-publication-production.ts; src/conductor/test/engine/event-sinks.test.ts; src/conductor/test/engine/event-persister.test.ts; src/conductor/test/engine/routed-fix-comments.test.ts

### Task 19: Route admission replaces the refusal with a tip preflight
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Tasks 9, 16, 18

**Steps:**
1. Write failing tests in `round-admission-published.test.ts` and `conductor-routing-published.test.ts` for every Done-when check below, updating the prior refusal tests to the new expectation.
2. Verify RED.
3. Implement `publishedStackTipPreflight` in `stack-publication.ts`, returning `not-published`, `intact`, a `refused` naming the member and #3268, or `unreadable`. It runs one `ls-remote` for all members and reads `lastSeen`. Replace the refusal in `admitRound`, `planRemediation`'s routing arm, and `admitRoutedTasklessKickback`.
4. Verify GREEN and commit: "feat(routing): admit routed rounds on an intact published stack".

**Done when:**
- [test] `admitRound` on an intact published stack admits the round and emits no `restack_refused` with reason `published-stack`.
- [test] `planRemediation`'s routing arm with a whole-feature audit's admitted fix on an intact published stack opens a round and emits no `published-stack` refusal, and `admitRoutedTasklessKickback` on the same stack admits with no such refusal.
- [test] `publishedStackTipPreflight` on a member with a recorded `lastSeen` refuses naming that member and #3268, and `admitRound` then allocates no round id and leaves no `refs/conductor/<slug>/routes/` ref in a real-git test.
- [test] `publishedStackTipPreflight` with a failing `ls-remote` returns `unreadable`, and `admitRound` refuses with a retryable reason, treating the unknown tips as not matching.

**Files:** src/conductor/src/engine/stack-publication.ts; src/conductor/src/engine/routing/round-admission.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/routing/round-admission-published.test.ts; src/conductor/test/engine/conductor-routing-published.test.ts

### Task 20: `stack land` opens on an intact published stack
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 19

**Steps:**
1. Write failing tests in `operator-round-predicates.test.ts` and `operator-round-open.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Pass the origin into `checkOpenOperatorRound` and call `publishedStackTipPreflight` for origin `land`, keeping the routing-setting check before it.
4. Verify GREEN and commit: "feat(routing): land on an intact published stack".

**Done when:**
- [test] `ai-conductor stack land --slug <slug> --child <k> --reason "<why>"` through `stack-land-cli.ts` on an intact published stack opens the operator round and emits no `published-stack` refusal.
- [test] `stack land` on a published stack with one mismatched member exits non-zero naming that member and #3268, and a real-git check finds no new route record, lease, or park marker.
- [test] `stack land` with `stacked_prs.route_whole_feature_fixes` off on a published stack refuses with `routing-off`.

**Files:** src/conductor/src/engine/routing/operator-round.ts; src/conductor/src/engine/stack-land-cli.ts; src/conductor/test/engine/routing/operator-round-predicates.test.ts; src/conductor/test/engine/routing/operator-round-open.realgit.test.ts

### Task 21: A landing clears the finished markers
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 20

**Steps:**
1. Write failing tests in `operator-round-open.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. In `openOperatorRound`, after the round is written and only with an active publication record, remove `.pipeline/finish-choice` and `.pipeline/DONE`.
4. Verify GREEN and commit: "feat(routing): a published landing reopens the feature".

**Done when:**
- [test] A successful `stack land` on a finished feature's published stack removes `.pipeline/finish-choice` and `.pipeline/DONE` through `openOperatorRound`.
- [test] A refused `stack land` leaves `.pipeline/finish-choice` and `.pipeline/DONE` byte-identical.
- [test] `openOperatorRound` on an unpublished stack does not remove either file.

**Files:** src/conductor/src/engine/routing/operator-round.ts; src/conductor/test/engine/routing/operator-round-open.realgit.test.ts

### Task 22: Leaf return re-pends finish, but not rebase, on a published stack
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 19

**Steps:**
1. Write failing tests in `routed-exit.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. In `restageLeafGates`, read the publication record: when active, add `finish` to the gates and filter out `rebase`.
4. Verify GREEN and commit: "feat(routing): re-pend finish on a published leaf return".

**Done when:**
- [test] `returnToLeaf` on a published stack leaves the leaf gates and `finish` pending in `conduct-state.json`, with each verdict `satisfied: false`.
- [test] `returnToLeaf` on a published stack leaves the `rebase` state and verdict byte-identical, and a following conductor run does not dispatch `rebase` and writes no stale-verdict HALT.
- [test] `returnToLeaf` on an unpublished stack leaves `finish` in its prior state and re-pends `rebase` as it does today.

**Files:** src/conductor/src/engine/routing/routed-exit.ts; src/conductor/test/engine/routing/routed-exit.realgit.test.ts

### Task 23: The daemon dispatches a reopened feature
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 21

**Steps:**
1. Write failing tests in `daemon-backlog.test.ts` and `daemon-rekick.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `publishedFeatureReopened` in `stack-refresh-ledger.ts`: active publication record, a present worktree, no park, and an open routed round or an undrained ledger. Consult it before the `isProcessed` skip in `daemon-backlog.ts`, before the `claims.isCompleted` skip in `daemon.ts` with a `reopen` method on `work-claims.ts`, and in the re-kick processed skip.
4. Verify GREEN and commit: "feat(daemon): dispatch a reopened published feature".

**Done when:**
- [test] The daemon backlog dispatches a processed, completed slug with an active publication record, an open routed round, and no park.
- [test] The daemon backlog dispatches a processed, completed slug with a closed round and an unpushed ledger entry.
- [test] The daemon backlog does not dispatch a processed slug with a drained ledger and closed rounds, nor a parked one until the park is released.
- [test] The daemon backlog does not dispatch a processed slug with no worktree, and reports the existing shipped dedup skip.
- [test] A daemon process that completed a slug earlier dispatches it after `publishedFeatureReopened` becomes true, through `claims.isCompleted` and the `reopen` method on `work-claims.ts`.

**Files:** src/conductor/src/engine/stack-refresh-ledger.ts; src/conductor/src/engine/daemon-backlog.ts; src/conductor/src/engine/daemon.ts; src/conductor/src/engine/work-claims.ts; src/conductor/src/engine/daemon-rekick.ts; src/conductor/test/engine/daemon-backlog.test.ts; src/conductor/test/engine/daemon-rekick.test.ts

### Task 24: A reopened run finishes and is watched again
**Story:** Story 4
**Type:** infrastructure
**Dependencies:** Tasks 22, 23, 25

**Steps:**
1. Write a failing real-git test in `published-stack-landing.realgit.test.ts` for every Done-when check below, driven from `stack land` with a bare remote and a stubbed provider for the gate dispatches.
2. Verify RED.
3. Implement what the test exposes in the run terminal path in `daemon-runner.ts`, including `markProcessed` and `enrollWatch` on a second completion.
4. Verify GREEN and commit: "feat(daemon): complete a reopened published feature".

**Done when:**
- [test] A real-git landing through `stack land --child 1`, `stack land --done`, the routed exit, the leaf gates and FINISH leaves every bare-remote member tip equal to its local tip, and one host comment on the mocked operation boundary.
- [test] That run ends with `.daemon/processed/<slug>` written again through `markProcessed` and the slug enrolled by `enrollWatch` in the mergeable sweep, and the daemon's next backlog scan does not dispatch it.

**Files:** src/conductor/src/engine/daemon-runner.ts; src/conductor/test/engine/published-stack-landing.realgit.test.ts

### Task 25: The routed exit and its recovery pass the freeze, and nothing else does
**Story:** Story 10
**Type:** happy-path
**Dependencies:** Task 19

**Steps:**
1. Write failing real-git tests in `routed-exit.realgit.test.ts` and `restack-recovery-refusals.realgit.test.ts` for every Done-when check below, updating the prior refusal tests to the new expectation.
2. Verify RED.
3. Remove the refusal in `requestRoutedExit` and the routed `built` arm of stack preflight. In recovery, complete a routed applied journal and keep suppressing a base-refresh follow-on.
4. Verify GREEN and commit: "feat(routing): routed exit on a published stack".

**Done when:**
- [test] `requestRoutedExit` on a published stack runs the exit restack, records moved tips in the ledger, and a bare remote's tips are unchanged.
- [test] `recoverRestackJournal` settling a routed exit journal with a base-refresh follow-on on a published stack suppresses the follow-on, and no member moves onto the new base.
- [test] The existing routing and N=1 parity golden suites pass unmodified for an unpublished stack and a single-PR feature, pinning their refs, pushes and comments to today's behavior, and those runs create no `refs/conductor/<slug>/refresh` ref, select no `refresh_published_members` transition, and post no comment.
- [test] A parametrized test runs every flow this change touches (`admitRound`, `stack land`, `requestRoutedExit`, `recoverRestackJournal` with a base-refresh follow-on, `returnToLeaf`, FINISH transition selection, and the daemon backlog scan) on an unpublished stack and a single-PR feature, and asserts each flow's refs, pushes and comments equal the same fixture's snapshot with the publication check disabled, with `stack land` on a single-PR feature refusing `not-stacked` as it does today.

**Files:** src/conductor/src/engine/routing/routed-exit.ts; src/conductor/src/engine/restack/stack-preflight.ts; src/conductor/src/engine/restack/restack-recovery.ts; src/conductor/test/engine/routing/routed-exit.realgit.test.ts; src/conductor/test/engine/restack/restack-recovery-refusals.realgit.test.ts

### Task 26: Every other published-stack path stays frozen
**Story:** Story 10
**Type:** negative-path
**Dependencies:** Tasks 20, 25

**Steps:**
1. Write failing tests in `stack-preflight-unlanded.realgit.test.ts` and `rewind.test.ts` for the changed halt wording and for rewind, and confirm the existing published-stack tests are unchanged.
2. Verify RED.
3. In stack preflight's raw post-closure arm, run `publishedStackTipPreflight` and name `stack land` when intact, or the member and #3268 when not. Keep `checkOpenOperatorRound`'s refusal for origin `rewind`.
4. Verify GREEN and commit: "feat(routing): published stack recovery names stack land".

**Done when:**
- [test] Stack preflight with raw post-closure commits, no open round, and an intact published stack halts `needs-human` with text naming `ai-conductor stack land`.
- [test] Stack preflight with raw post-closure commits and a failing tip check halts naming the member and #3268.
- [test] `rewind --child` on a published stack exits non-zero naming `published-stack` and #3268 through `checkOpenOperatorRound` with origin `rewind`.
- [test] `stacked-finish-rebase.test.ts`'s FINISH base-refresh case, the re-kick base-refresh case, and the ci-fix and autoresolve published-stack cases pass unmodified, each moving no ref.

**Files:** src/conductor/src/engine/restack/stack-preflight.ts; src/conductor/src/engine/routing/operator-round.ts; src/conductor/test/engine/restack/stack-preflight-unlanded.realgit.test.ts; src/conductor/test/engine/rewind.test.ts

## Task Dependency Graph

Slice 1: 1 to 2, 3; 1 to 4; 1 to 5, 6; 1 to 7; 5 and 7 to 8, 9.
Slice 2: 8 to 10; 10 to 11; 10 to 12, 13; 11 and 13 to 14; 14 to 15, 16; 14 to 17, 18.
Slice 3: 9, 16 and 18 to 19; 19 to 20, 21; 19 to 22; 21 to 23; 19 to 25; 20 and 25 to 26; 22, 23 and 25 to 24.

## Integration Points

- After Task 9: FINISH can refresh a stack whose ledger was seeded by a real restack.
- After Task 18: FINISH also posts comments and audit events.
- After Task 24: a landing runs through a published stack end to end from `stack land`.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D1 | task | task-19, task-20 | `publishedStackTipPreflight` on a member with a recorded `lastSeen` refuses naming that member and #3268 |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D2 | task | task-2, task-3 | leaves `refs/conductor/<slug>/refresh` whose `recordedTip` for the host |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D3 | task | task-5, task-6 | `guardPublishedStackWrite` with `PublishedStackRefreshAuthorization` |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D4 | task | task-21, task-22, task-23 | The daemon backlog dispatches a processed, completed slug |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D5 | task | task-7, task-8, task-9 | pushes members in ascending position with the leaf last |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D6 | task | task-10, task-11 | `routedCommentTargets` returns a host target |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D7 | task | task-12, task-13 | `renderHostComment` for an audit round yields a body listing the commits new since the last push |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D8 | task | task-14, task-15, task-16 | writes the marker to `posted`, and makes no second `pull-request.comment.create` call |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D9 | task | task-17, task-18 | reaches `executeGithubOperation` as `pull-request.comment.create` |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D10 | task | task-25, task-26 | `rewind --child` on a published stack exits non-zero naming `published-stack` and #3268 |
| adr-2026-11-01-routed-fix-refreshes-a-published-stack#D11 | task | task-8 | pass unmodified at the end of this slice, proving the freeze still refuses a published stack |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D1 | no-change | none | Durable child state still decides stack publication. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D2 | no-change | none | The publication record's schema is unchanged; the ledger is a separate ref. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D3 | no-change | none | The two publication transitions are unchanged; two others are added under the new ADR. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D4 | no-change | none | `establish_child_prs` and `pushChildClosure` stay create-only. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D5 | no-change | none | `assemble_stack` is unchanged. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D6 | no-change | none | Member bodies are not re-rendered, as the new ADR records. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D7 | no-change | none | The ready flip is unchanged. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D8 | no-change | none | Required-check contracts are unchanged. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D9 | no-change | none | Only the leaf merge ships the feature. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D10 | no-change | none | Non-leaf lifecycle observation is unchanged. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D11 | task | task-5, task-6, task-26 | With authorization, a source that does not descend from the ledger's `recordedTip` is refused |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D12 | no-change | none | Teardown's proof is unchanged; it deletes the ledger through the routing ref list. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D13 | no-change | none | New writes use the existing guarded boundary. |
| adr-2026-10-17-stacked-feature-publication-as-native-stack#D14 | no-change | none | New events extend the existing union. |
| adr-2026-10-12-routed-whole-feature-repair#D1 | no-change | none | Routing entry and classification are unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Owner derivation is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | Residue routing is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | no-change | none | Host movement is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | Prerequisite claims are unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | no-change | none | The route record is read, not reshaped. |
| adr-2026-10-12-routed-whole-feature-repair#D7 | no-change | none | Admission order is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D8 | no-change | none | The cursor is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | no-change | none | Routed task appending is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | no-change | none | The round receipt is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Repair obligations are unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The host's `build_review` is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-25 | `requestRoutedExit` on a published stack runs the exit restack |
| adr-2026-10-12-routed-whole-feature-repair#D14 | no-change | none | The re-validation queue is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-22 | `returnToLeaf` on a published stack leaves the leaf gates and `finish` pending |
| adr-2026-10-12-routed-whole-feature-repair#D16 | no-change | none | The outbox is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D17 | task | task-25 | parity golden suites pass unmodified |
| adr-2026-10-12-routed-whole-feature-repair#D18 | no-change | none | The flag is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D1 | no-change | none | The operator route kind is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D2 | no-change | none | The dispatch lease is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D3 | no-change | none | The owned park is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D4 | task | task-20 | opens the operator round and emits no `published-stack` refusal |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D5 | task | task-21 | removes `.pipeline/finish-choice` and `.pipeline/DONE` through `openOperatorRound` |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D6 | no-change | none | The commit guard is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D7 | no-change | none | Branch tip checks are unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D8 | task | task-26 | halts `needs-human` with text naming `ai-conductor stack land` |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D9 | no-change | none | `stack land --done` is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D10 | no-change | none | Operator halt clearing is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D11 | task | task-26 | `rewind --child` on a published stack exits non-zero |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D12 | no-change | none | Operator rounds still charge no gate budget. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D13 | task | task-4 | closed by `stack land --abandon` adds no ledger entry |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D14 | no-change | none | `stack owners` is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D15 | no-change | none | The ownership skill is unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D16 | no-change | none | Operator-round events are unchanged. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D17 | no-change | none | N=1 and routing-off parity hold through the unchanged predicate order. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D18 | no-change | none | Shipped guidance is not part of this change. |
| adr-2026-10-24-operator-route-round-for-closed-stacked-children#D19 | no-change | none | That spec's delivery shape is a past decision. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
- [x] No documentation task is included
