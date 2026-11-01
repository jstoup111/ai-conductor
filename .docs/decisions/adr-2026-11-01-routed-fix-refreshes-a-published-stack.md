# ADR: A routed fix refreshes a published stack at FINISH and tells the reviewer what changed

**Date:** 2026-11-01
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #3269

## Context

`adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 11 freezes a published stack:
every restack producer refuses, and the tip guard allows only a fast-forward of the recorded pushed
tip. #3269 asked for a PR comment when a routed fix changes a published child, but under the freeze
no routed fix can reach one. #3268 (`stack adopt`, server-side rebase acceptance) is itself deferred
until a post-publication write path exists, and #3270, the other candidate, was dropped on
2026-10-31. So this decision is that first write path, plus the comment.

Verified facts that shape the design:

- **A restack rewrites what it carries.** Ranges above the highest origin replay with `commit-tree`
  (`restack/restack-replay.ts`), so their new SHAs cannot fast-forward. `stack-tip-guard.ts` refuses
  them even when every tip matches, and `forcePushWithExpectedLease` goes through the same guard.
- **GitHub's documented flow for a lower-layer edit is the same shape.** It is `gh stack rebase
  --upstack` then `gh stack push`, which "uses `--force-with-lease`" per branch and "is not atomic".
  "A stack must have a linear history between its branches before it can merge."
  ([managing stacked PRs](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/managing-stacked-pull-requests),
  [CLI reference](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands))
- **A finished feature cannot run again.** FINISH writes `finish-choice` and DONE, the daemon marks
  the slug processed and completed (`daemon-runner.ts`, `daemon.ts`, `daemon-backlog.ts`), and nothing
  clears `.daemon/processed/<slug>`. `restageLeafGates` does not re-pend `finish`, so a run that
  re-enters converges with the old outcome.
- **SHIP audits run before FINISH publishes.** The realistic trigger on a published stack is
  therefore `ai-conductor stack land`, a reviewer's change landed through an operator round, not an
  automatic audit round.
- **No comment on a member PR exists today, and `upsertComment` cannot be reused.** It creates a new
  comment when its lookup fails (`pr-labels.ts`), which is a duplicate on retry.
- **The guarded path has no success audit.** `github_operation_refused` covers refusals only.

## Options Considered

### Option A: Verified refresh with the existing replay restack (chosen)
Keep the restack. Record each moved tip durably, and let the guard accept a non-fast-forward only for
a recorded tip.
- **Pros:** reuses restack, revalidation and the lease; matches GitHub's documented flow; keeps the
  stack linear.
- **Cons:** narrows decision 11; members above get new SHAs.

### Option B: Merge-forward carry
Merge each child into the one above, so every push stays a fast-forward and the guard is untouched.
- **Pros:** no relaxation of decision 11.
- **Cons:** GitHub refuses to merge a non-linear stack, so this would need a rebase before merge
  anyway. It also adds a second carry mechanism. Rejected.

### Option C: Close and republish members
- **Pros:** no rewrite exception.
- **Cons:** loses approvals and review threads, which is what #3269 exists to protect. Rejected.

### Push timing: round close, or FINISH (chosen)
Round close comes before the re-pended leaf gates, so a later gate failure would mean a second
force-push and a second comment, and a second publisher would need its own lock (publication ADR A7).
FINISH comes after those gates, is already the sole publisher for a slug, and already resumes per
member.

### Comment targets: every moved tip, or only a changed diff (chosen)
A rebase-only child's reviewable diff is unchanged, so commenting on it posts noise on every child
above a fix. The host comment names those children instead, so their SHA change is still explained.

## Decision

1. **Only routed work passes the freeze, after a tip preflight.** Route admission, the taskless
   kickback admission, `planRemediation`'s routing arm, `stack land`, the routed exit, and the routed
   arm of stack preflight and journal recovery stop refusing on an active publication record. At
   admission, one `ls-remote` must show every member's remote tip equal to its pushed receipt and no
   member with a recorded `lastSeen`; otherwise admission refuses and names the member and #3268, so a
   round is never built against a stack it cannot reach. Off `stacked_prs.route_whole_feature_fixes`,
   the refusal stands.
2. **A refresh ledger is the only evidence for a rewrite.** `refs/conductor/<slug>/refresh` holds a
   versioned JSON blob, CAS-written: per member branch, the tip the restack recorded, and per routed
   round, the comments owed and posted. It is written only with an active publication record, inside
   the restack's `applied` transaction and journaled first as the revalidation queue is, so recovery
   re-renders it and `stack-ref-changed` covers it. A leaf host, which settles with no restack, writes
   it in that settling CAS. Teardown deletes it with the other routing refs.
3. **The guard gains one narrow rewrite arm.** A non-fast-forward of a published member is allowed
   only when the caller passes FINISH's refresh authorization, every member tip matches its receipt,
   and the ledger's recorded tip for that branch is an ancestor of the source. The push stays
   `--force-with-lease` at the pushed receipt. Every other caller stays fast-forward only, including
   the halt-record leaf push and `forcePushWithExpectedLease` with no authorization.
4. **A landing on a published stack reopens the feature, with no new marker.** Opening the round
   sweeps `finish-choice` and DONE. Leaf return re-pends `finish` on a published stack and leaves `rebase` and its verdict untouched, because the base refresh stays frozen and that step would write no verdict, which a re-pended gate would halt on. The backlog and
   claims skip of a processed or completed slug gives way when the publication record is active, the
   worktree is present, nothing is parked, and either a routed round is open or the ledger is pending.
   Both inputs are durable Git state the daemon already reads. FINISH then marks the slug processed
   again as usual.
5. **FINISH refreshes members before anything else.** A new transition, `refresh_published_members`,
   is selected ahead of `establish_pr` while the ledger holds an unpushed tip. It pushes bottom up,
   leaf last, through `executeRemoteGit`, so each push writes its intent and advances its receipt.
   Resume skips a member whose receipt already equals the recorded tip. A refusal halts
   `stack-tip-diverged`, naming the member. The existing `assemble_stack` path re-checks the stack
   afterwards. `establish_child_prs` and `pushChildClosure` stay create-only.
6. **Who gets a comment.** The host of each routed round gets one. A member above gets one only when
   its own diff changed: `git patch-id --stable` over its last published diff (pushed parent tip to
   pushed tip) differs from its new diff (new parent tip to new tip), reusing `rewrite-map.ts`. A
   rebase-only member, a member whose tip did not move, an unpublished child, a single-PR feature, and
   an abandoned round's host get none.
7. **What a comment says.** The host comment has what changed (the commits new since the last push,
   by subject), why (the finding and the routing decision), and the rebase-only members above it. For
   an audit round the why comes from `items[]` (finding id, placement reason, rationale) and
   `allocation[host].retryHint`, plus `pendingAsBuiltFindings` where it joins; for an operator round,
   from `operator.reason` and the operator. A revalidate round names the gate. The route record is
   retained until teardown, so FINISH reads it directly. The comment above a host says its diff
   changed when carrying that fix, and links the host PR.
8. **Each comment posts once.** A hidden marker keys it: `routed-fix:<roundId>:<pr>` for a host,
   `routed-refresh:<newTip>:<pr>` for a member above. A new transition, `post_routed_comments`, runs
   after every push and before `record_outcome`, which cannot complete with a comment owed. It reads
   the ledger receipt, then scans the PR's comments for the marker, and only then creates. A failed
   lookup is a retry and never creates. Attempts are bounded per FINISH, then the step halts
   `needs-human` naming the PR. A retry re-pushes nothing.
9. **Comments use the guarded path and the spine.** Each post is `pull-request.comment.create` through
   `executeGithubOperation` with a runner bound to that member's PR. Two new `ConductorEvent` variants
   carry the audit: `stack_member_refreshed` and `stack_member_comment_posted`, with deterministic
   `eventId`s so a replay de-duplicates, registered in `event-sinks.ts` and the persister.
10. **Everything else stays frozen.** Non-routed `feature-repair`, the FINISH base refresh, re-kick,
    sweep ci-fix, autoresolve, and `rewind --child` all keep refusing or skipping. A routed exit's
    base-refresh follow-on stays suppressed. `stack adopt` and server-side rebase acceptance stay with
    #3268.
11. **One spec, three slices, with the freeze lifted last.** The slices are the ledger, guard arm and
    FINISH refresh; then comments and events; then the freeze lift, the reopen and `stack land`. Until
    the last slice nothing can write a ledger entry on a published stack, so earlier slices change no
    production behavior.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | GitHub's documented way to update a stack after a lower-layer edit is a per-branch `--force-with-lease` push of the rebased branches (managing-stacked-PRs and CLI reference pages, read 2026-11-01) | verified | 95% | yes | The refresh would need a different publication mechanism | not required |
| A2 | A member PR keeps its native stack membership through a force-with-lease head update. The docs describe the flow but `/rest/pulls/stacks` does not address head changes | inferred | 85% | yes | Stack membership would need re-adding; `assemble_stack` re-checks validity, so this costs a new repair path rather than wrong code on GitHub | APPROVED by operator 2026-11-01 |
| A3 | Re-dispatching a completed slug needs changes only to the backlog processed skip, `claims.isCompleted`, the re-kick skip, the DONE and `finish-choice` sweep, and the `finish` re-pend, with no other completion guard in the way | inferred | 75% | yes | More reopen sites to change, found at plan review or build; the design still holds | APPROVED by operator 2026-11-01 |
| A4 | The issue's "operation audit" is satisfied by the guarded operation path plus the new spine events, since no success audit exists today (`github-operations.ts` emits refusals only) | unverified | 70% | yes | A separate success-audit record would be owed | APPROVED by operator 2026-11-01 |
| A5 | Automatic audit rounds on a published stack are rare, because SHIP audits run before FINISH publishes | inferred | 80% | no | Only more traffic through the same path | not required |
| A6 | `git patch-id --stable` treats a rebase-only member as unchanged unless the parent's change alters its context lines | inferred | 85% | no | An occasional extra comment, never a missed change to the diff's content | not required |
| A7 | Closed route records stay readable until teardown: the only `delete-record` is a prepared-phase abort, and other deletion is in teardown (`routing/round-admission.ts`, `routing/routing-refs.ts`) | verified | 90% | yes | Comment text would have to be copied into the ledger | not required |
| A8 | Publication ADR A7 holds: FINISH is exclusive per slug, so the refresh needs no new lock | inferred | 90% | yes | The refresh would need its own lock | APPROVED by operator 2026-11-01 |

## Consequences

### Positive
- A reviewer's change can land on a published stack without a manual runbook, and #3268 gains the
  write path it was waiting for.
- A reviewer sees exactly one explanation per routed fix, and only where the reviewable diff changed.

### Negative
- Decision 11's "a rewrite is refused even when every tip matches" now has one exception, and engine
  force-pushes reach branches reviewers are looking at. Whether an approval is dismissed follows the
  repository's branch protection, not this engine.
- The push is not atomic. A crash mid-refresh leaves the stack non-linear on GitHub until FINISH
  resumes; GitHub will not merge it in that state.
- A published member's PR body keeps its original diffstat, because only creation renders it. The
  shipped record's findings are also not refreshed.
- A reviewer's direct push to a member still halts `stack-tip-diverged` until #3268.

### Follow-up Actions
- [ ] #3268 respecs on this write path.
- [ ] File an intake for refreshing a published member's body diffstat after a refresh.
