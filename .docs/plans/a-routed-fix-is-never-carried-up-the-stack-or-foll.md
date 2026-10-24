# Implementation Plan: Carry a routed fix up the stack and re-validate the children above

**Date:** 2026-10-23
**Design:** .docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md
**Stories:** .docs/stories/a-routed-fix-is-never-carried-up-the-stack-or-foll.md
**Conflict check:** Clean as of 2026-10-23 (.docs/conflicts/a-routed-fix-is-never-carried-up-the-stack-or-foll.md)
**Scope-exception:** Operator decision 2026-10-23 during #3212 DECIDE: deliver spec D (ADR decisions 13–15, decision 16's queue outbox and the routing flag flip) as one spec of 43 tasks in three stacked slices rather than re-splitting it, because every slice short of the flip ships dark and a separate spec would only add a merge boundary between the exit restack and the queue that consumes it.

## Summary

This is spec D, the last of four for `adr-2026-10-12-routed-whole-feature-repair` (decision 18).
- A routed host leaves its round through one journaled `feature-repair` exit restack, or through a
  no-commit compare-and-swap when its tip still equals its closure.
- The round moves from host to host in the recorded order, then returns to the leaf, whose
  whole-feature gates re-run under their existing caps.
- Every restack queues the closed children whose gates it invalidated. They are re-validated
  bottom-up in `revalidate` rounds and acknowledged by compare-and-swap.
- A base refresh waits while re-validation is pending.
- `stacked_prs.route_whole_feature_fixes` defaults to `true`.

The plan has 43 tasks in three stacked slices of 14, 13 and 16.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Exit restack | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 |
| 2 | Progression, replay merge and return to the leaf | 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27 |
| 3 | Re-validation queue and go-live | 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43 |

## Technical Approach

Governing review: `.docs/decisions/architecture-review-2026-10-23-a-routed-fix-is-never-carried-up-the-stack-or-foll.md`
(conditions C1–C13). Conflict resolutions and plan-carried assumptions A-2 to A-9 are in
`.docs/conflicts/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`. Paths below are under
`src/conductor/src/engine/`.

- **The exit restack (slice 1).**
  - `restack/restack-journal.ts` gains a `routed` block (`roundId`, `host`, the route record's,
    marker's and queue's old blobs, and the precomputed new blobs) and an `invalidation` list.
    `recordRoutedApplyPlan` writes the new blobs into the journal by compare-and-swap at `synced`,
    after the invalidation set is journalled (C8). Recovery reuses them, so a recovered `applied`
    is byte-identical to an uninterrupted one.
  - One `appliedTransactionLines` builder in `restack/restack-executor.ts` serves feature-repair,
    base refresh and recovery's `synced`→`applied` path (C1). It emits the cascade lines, the
    journal state line, and, for a routed journal, the lines from `routedAppliedLines` in
    `routing/route-record-store.ts`: marker delete, host `restacked` with its outbox event, and,
    from slice 3, the queue generation.
  - The route-record fence becomes one predicate, `routingFenceOpen`, shared by
    `writeRoutingTransaction` and `host-region-entry.ts`. Only the open journal's own `applied`
    lines, identified by its `opId`, pass a non-terminal journal (C2).
  - New `routing/routed-exit.ts` holds `hostNoOpEvidence` and `requestRoutedExit`. Tip equality
    with the closure selects the no-commit exit (one compare-and-swap: host `done`, marker
    deleted). Otherwise it compare-and-swaps the host to `built`, drains the route outbox and runs
    `runRestack` with `cause: 'feature-repair'` and a `routed` option whose origins are the host
    plus `coOrigins`.
  - Callers: the `build_review` region-exit branch in `conductor.ts` for a `routed-host` execution
    child (in place of `advanceChildRegion`), and the `built` arms of `runStackPreflight` and
    `reconcileRounds`.
  - *Pattern:* spec B's `admitRound` marker transaction and spec C's `rerouteRound`: one
    `update-ref --stdin`, explicit old values, the outbox entry in the same blob, a `cas-failed`
    result never retried blindly. *Allowed variation:* which refs the lines name.
- **Progression and the replay merge (slice 2).**
  - New `routing/rem-block-merge.ts` `unionRemBlocks` reuses `parsePlanTaskBlocks`
    (`plan-task-parse.ts`). It is called before the resolver in `restack-executor.ts`'s conflict
    path, inside `checkPathOwnership` (`restack-ownership.ts`), and in the replay-proof comparison
    (`restack-transition.ts`) to normalise inherited rem blocks. The union is gated on
    `routingEligible`.
  - *Pattern:* `upperChildHaltRecordTree` in `restack-replay.ts`, a temporary-index tree build that
    never touches the worktree.
  - `selectNextHost` in `routed-exit.ts` orders the child hosts, then the queue, then the leaf host,
    then the leaf gates. `reconcileRounds` gains the `restacked`, `done` and `rerouted` arms, and
    the round reaches `closed` under C8's rule.
  - `SelectorInput.routedParking` restricts selection to one child's `CHILD_REGION_STEPS`, or holds
    back leaf gates and FINISH. `conductor.ts` sets it only when `routingEligible`.
  - `returnToLeaf` switches through `switchToChild` and records `leafReturn` in the round before it
    closes it. The leaf gates are then re-pended through the leaf's conduct-state batch. The
    kickback ledger is untouched.
- **The re-validation queue (slice 3).**
  - `RevalidationQueueEntry` becomes `{child, position, closureSha, gates, replay {oldParent,
    newParent}, state: 'queued'}`, and its parser fails closed (C4). New
    `routing/revalidation-queue.ts` holds `mergeQueueGeneration`, `consumeLowestQueued` and
    `acknowledgeQueueEntry`.
  - `applyRestackTransition` reports the closed-child invalidation set, counting a missing or
    unreadable verdict as invalidated. The skip rule needs `classifyReplayGateInvalidation` to
    preserve every gate and each preserved verdict to be present and fresh (C3).
  - `appliedTransactionLines` writes the merged generation only when `routingEligible` (C5).
  - Consumption has its own entry in `runStackPreflight` after `reconcileRounds`, and is the queue
    arm of `selectNextHost` (C12). It creates a `revalidate` round with `nextRoundId`, sets the
    marker before any mutation, and `enterHostRegion`'s `revalidate` arm restages only the entry's
    gates, once per generation (C6).
  - Review bases come from new `revalidation` and `revalidation-fix` `ChildBaseResolution` kinds in
    `child-cursor.ts`, carried as `baseKind` in `build-review-inputs.ts` (C4).
  - `routedRoundOpen` parses the queue: open when it has entries or is unreadable. Both follow-on
    paths defer the base refresh under `suppressFollowOn`. The preflight path defers before REKICK is consumed; the recovery path re-arms REKICK before deleting the journal (C13, A1).
  - The queue's outbox drains through `drainRoutingOutboxes`, and the drained empty queue ref is
    deleted (C12).
  - `engine/config.ts` flips the default.

**Fixture.** Tests use the stories' three-child stack:
- slug `demo`, with closed `feat/c1/demo` (task `T1`, `src/a.ts`) and `feat/c2/demo` (task `T2`,
  `src/b.ts` importing `parseA`), and the leaf `feat/daemon-demo`;
- round `r1`, the marker `refs/conductor/demo/repairing` and the queue `refs/conductor/demo/revalidate`.

Real-git tests commit `.ai-conductor/config.yml` with routing on before building a routed resume.

**Obligations widened from earlier specs (C9).** These ADRs are not in this change set, so they get
no table row. The tasks that satisfy them:
- reopened-task D8: Task 21;
- no-op escalation D2: Task 11;
- publication D11's routed-exit refusal: Task 14.

**Assumptions carried from the conflict check:**
- A-2 (queue drain fenced): Task 41;
- A-3 (aborted `prepared` record deleted): Task 33;
- A-4 (verify-green mode emitted): Task 34;
- A-7 (inherited rem blocks normalised): Task 18;
- A-9 (no kickback from a `revalidate` round): Task 33.

## Prerequisites

- Specs A (#2944), B (#3210) and C (#3211) are on main. Together they provide:
  - the route types and parsers;
  - `writeRoutingTransaction` and its branch, pin and marker ops;
  - `admitRound`, `reconcileRounds` and `enterHostRegion`;
  - `verifyGreenAcceptance`, `routedRepairCredit` and `resolveExecutionChild`;
  - the cursor's `coOrigins`, `foreignRoundChildren` and `revalidating` fields;
  - `publishedStackRefusal`;
  - the setting, still defaulting to `false`.

## Task Dependency Graph

```text
Slice 1
1 ─┬─ 2 ─ 3 ─ 4 ─┬─ 5
   │             └─ 7 ─┬─ 9
   │                   ├─ 10
   │                   ├─ 12 ─ 13
   │                   └─ 14
6 ─ 8 ─ 11 (8 after 3, 6 ; 9 after 8)
Slice 2
15 ─ 16 ─ 17 ; 15 ─ 18
19 ─ 20 ─ 21 ─ 22 (19 after 7 ; 22 after 8)
23 ─ 24 (24 after 21)
25 ─ 26 (25 after 20) ; 27 (after 9)
Slice 3
28 ─ 29 ─ 30 ─ 31 ─ 32 (31 after 4 ; 32 after 8)
31 ─ 33 ─ 34 ─ 35 ─ 36 ─ 37 ─ 38 (33 after 19, 25)
28 ─ 39 ─ 40 ; 28 ─ 41 (41 after 3)
42 (after 33, 39) ; 43 (after 36, 41)
```

## Integration Points

- After Task 9: a routed host whose region passes leaves through the exit restack, and the fix is on every child above it.
- After Task 25: a settled round returns the worktree to the leaf and re-pends the leaf gates.
- After Task 36: a restack's queued child is re-validated and acknowledged before the leaf gates run.
- After Task 42: every stacked feature routes by default.

## Architecture Obligation Coverage

Three APPROVED ADRs carry 2026-10-23 #3212 amendment notes in this change set, so each of their decisions has one row.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | existing | none | `routingEligible` in `src/conductor/src/engine/routing/route-types.ts` (shipped with #3219) already requires durable child state plus the setting; this spec flips only the setting's default (Task 42). |
| adr-2026-10-12-routed-whole-feature-repair#D2 | existing | none | Mechanical owner derivation shipped with #3243 in `src/conductor/src/engine/routing/owner-derivation.ts` (`deriveTaskBoundOwner`); this spec consumes its owners unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | existing | none | The residue-routing judgement shipped with #3243 in `src/conductor/src/engine/routing/residue-routing-call.ts` (`resolveResidueOwner`); this spec does not change classification. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | task | task-25 | the recording runner shows the `leafReturn` write before the `phase: 'closed'` write |
| adr-2026-10-12-routed-whole-feature-repair#D5 | existing | none | `verifyPrerequisiteClaim` in `src/conductor/src/engine/routing/prerequisite-claim.ts` (shipped with #3211) moves a host upward only on a verified claim; this spec settles a `rerouted` host through Tasks 19 and 21 without changing the claim. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-2, task-20, task-21, task-25, task-7 | returns `restack-journal-open` |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-10, task-33, task-39, task-40 | runs host 1's exit restack, host 1 ends `restacked` |
| adr-2026-10-12-routed-whole-feature-repair#D8 | task | task-34, task-24 | a `revalidating` execution child with no `revalidate` round is refused |
| adr-2026-10-12-routed-whole-feature-repair#D9 | task | task-16, task-17, task-18 | with the resolver spy recording zero calls |
| adr-2026-10-12-routed-whole-feature-repair#D10 | task | task-34 | no receipt is settled, no `prd_audit` or as-built lap and no growth is charged |
| adr-2026-10-12-routed-whole-feature-repair#D11 | task | task-24, task-26 | are `pending` in the leaf's conduct state |
| adr-2026-10-12-routed-whole-feature-repair#D12 | task | task-35, task-37, task-34 | returns `{kind: 'revalidation', sha: <entry newParent>}` |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-7, task-8, task-9, task-10, task-11, task-12, task-14, task-19, task-22, task-4, task-32, task-13 | marks host 1 `built`, then runs a `feature-repair` restack |
| adr-2026-10-12-routed-whole-feature-repair#D14 | task | task-31, task-29, task-30, task-32, task-33, task-36, task-37, task-38, task-34, task-28 | the queue's next generation holds one child-2 entry |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-26, task-23, task-24, task-25, task-27 | are `pending` in the leaf's conduct state |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-41, task-43, task-32, task-36 | holds it exactly once after a second drain |
| adr-2026-10-12-routed-whole-feature-repair#D17 | task | task-43, task-24 | the N=1 golden routing guard passes with the new default |
| adr-2026-10-12-routed-whole-feature-repair#D18 | task | task-42, task-6, task-19, task-2, task-14 | resolves `stacked_prs.route_whole_feature_fixes` to `true` |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | existing | none | `runStackPreflight` returns `no-stack` without durable child state, and N=1 rebases stay on `performRebase` in `src/conductor/src/engine/rebase.ts`; no task here changes that split. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | existing | none | Range computation is `planRestackRanges` in `src/conductor/src/engine/restack/restack-plan.ts`; the routed exit supplies only its origin set (Task 7) and leaves range planning unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | task | task-18 | returns accepted when the plan differs only by inherited `rem-*` blocks |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | task | task-4, task-1, task-5, task-10 | only inside the single `update-ref --stdin` transaction that sets the journal `applied` |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | task | task-10 | keep their prior values, host 1 is `built` |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-16, task-17 | with the resolver spy recording zero calls |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | task | task-40, task-10, task-33 | the REKICK sentinel file still exists |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | task | task-30, task-31 | makes `queueInvalidation` return child 2 |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | task | task-7, task-12, task-39, task-40 | whose `originatingChildren` is `[1]` |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | task | task-12, task-13 | increments the `cascades` count for child 1 and for child 2 by one each |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | existing | none | Lease-guarded pushes live in `src/conductor/src/engine/remote-git-operations.ts`, and `routingTeardownRefNames` in `src/conductor/src/engine/routing/routing-refs.ts` already deletes the marker and `revalidationQueueRefFor` by explicit name; this spec pushes nothing. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-39, task-40 | emits one `restack_refused` with reason `deferred-base-refresh` |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | task | task-43 | the N=1 golden routing guard passes with the new default |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D1 | existing | none | Per-finding classification is the shipped closed-schema path in `src/conductor/src/engine/as-built-routing.ts`; this spec does not classify findings. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D2 | no-change | none | The fail-closed as-built report parser governs reading an as-built report; this spec reads no as-built report and changes no parsing. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D3 | existing | none | The bounded route to BUILD and its stacked routing (#2944 note) shipped with specs A and B in `as-built-routing.ts`; this spec only exits the host the route admitted. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D4 | existing | none | The as-built lap is charged once per round by spec C's receipt (`settleRoundAtDispatch` in `src/conductor/src/engine/routing/round-receipt.ts`); re-pending the leaf gates charges nothing (Task 26). |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D5 | existing | none | The single appender remains `src/conductor/src/engine/remediation-append.ts`; this spec appends no rem block, it only merges appended ones on replay. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | no-change | none | Classification and remediation-outcome events are emitted where findings are classified and appended; this spec classifies and appends nothing, and its only new event, `child_revalidated`, belongs to the routed ADR's decision 16. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D7 | existing | none | Pending as-built findings are durable in the route record's `pendingAsBuiltFindings` (`src/conductor/src/engine/routing/route-types.ts`, shipped with #3210); the exits copy the record forward unchanged. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D8 | no-change | none | The fallback-not-preemption ordering and the consolidated `manual_test` priority are decided at admission (`round-router.ts`); exits and re-validation never reorder routes. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D9 | task | task-8, task-11 | not the no-commit exit |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given round `r1` where host 1 committed a fix on `feat/c1/demo` and child 1's region passes, when region exit runs, then host 1 is marked `built` and an exit restack originating at child 1 replays children 2 and 3, and `closeChild` is never called. | 7, 9 | "marks host 1 `built`, then runs a `feature-repair` restack" | diff-local |
| Story 1 happy: Given that exit restack, when its branches and closures move, then `closed/c1` points at host 1's repaired tip, and children 2 and 3 are replayed onto it. | 7 | "`closed/c1` points at host 1's repaired tip" | diff-local |
| Story 1 happy: Given that exit restack, when it reaches `applied`, then one ref transaction charges one cascade on child 1, deletes the marker, marks host 1 `restacked` in `r1`, and sets the journal `applied`. | 4 | "only inside the single `update-ref --stdin` transaction that sets the journal `applied`" | diff-local |
| Story 1 happy: Given that exit restack, when the events are read, then every `restack_applied` event carries cause `feature-repair` and one `routed_repair_phase` event reports host 1 `restacked`. | 9 | "exactly one `routed_repair_phase` event reports host 1 with phase `restacked`" | diff-local |
| Story 1 happy: Given host 1's route-record outbox holds an undrained event when the exit restack is requested, when the restack starts, then the outbox is drained before the restack journal is created. | 7 | "shows the outbox removal on `routes/r1` before the journal create" | diff-local |
| Story 1 negative: Given a crash after host 1 is `built` and before a restack journal exists, when the feature resumes, then the stack preflight runs host 1's exit restack itself, host 1 ends `restacked`, and a second preflight creates no journal. | 10 | "runs host 1's exit restack, host 1 ends `restacked`, and a second `runStackPreflight` creates no journal ref" | diff-local |
| Story 1 negative: Given a crash between the restack's `synced` and `applied` states, when recovery completes it, then the marker is deleted and host 1 is `restacked`, and the resulting refs are byte-identical to an uninterrupted run. | 4 | "byte-identical to the uninterrupted run" | diff-local |
| Story 1 negative: Given the exit restack's move verification fails and the restack rolls back, when its state is read, then the marker, the route record and `closed/c1` are unchanged, host 1 is still `built`, and the feature halts needs-human naming the failed check. | 10 | "keep their prior values, host 1 is `built`" | diff-local |
| Story 1 negative: Given that rollback halt is still live, when the stack preflight runs, then it returns `halted` and does not request the exit restack again. | 10 | "returns `halted`, and `requestRoutedExit` is not called" | diff-local |
| Story 1 negative: Given a concurrent writer changed `routes/r1` after the exit restack's journal was created, when `applied` is attempted, then the transaction fails, and recovery halts needs-human naming `refs/conductor/demo/routes/r1` without retrying. | 5 | "detail naming `refs/conductor/demo/routes/r1`" | diff-local |
| Story 1 negative: Given an exit restack's journal is not terminal, when any other routing writer tries to change `routes/r1` or the marker, then it is refused with `restack-journal-open`, and only the restack's own `applied` transaction writes them. | 2, 3 | "returns `restack-journal-open`" | diff-local |
| Story 1 negative: Given the outbox drain fails, when the exit is requested, then no restack journal is created and host 1 stays `built`. | 7 | "no journal ref exists, and host 1 stays `built`" | diff-local |
| Story 2 happy: Given an `existing-task` repair of `T1` hosted by child 1 that appended no block, when the build makes no commit and region exit runs, then no restack is requested, and one compare-and-swap marks host 1 `done` and deletes the marker. | 8 | "marks host 1 `done` and deletes `refs/conductor/demo/repairing`, with no `built` write and no journal create" | diff-local |
| Story 2 happy: Given host 1 at region exit, when the no-op evidence is read, then it reports whether host 1's checked-out HEAD moved from the pinned entry base and whether its tree differs from the pinned entry tree. | 6 | "`headMoved: true, treeDiffers: false`" | diff-local |
| Story 2 happy: Given host 1 carries only a routed `manual_test` FAIL and its build commits nothing, when region exit runs, then host 1 takes the no-commit exit, the leaf's next `manual_test` PASS is refused by the anti-whitewash check because the leaf HEAD did not move, and the existing no-op escalation handles it. | 11 | "refused by the whitewash guard" | diff-local |
| Story 2 negative: Given host 1's tree equals its entry tree but its tip differs from `closed/c1`, when region exit runs, then the host exits through the exit restack, not the no-commit exit. | 8 | "not the no-commit exit" | diff-local |
| Story 2 negative: Given a stale marker old value, when the no-commit compare-and-swap runs, then it fails, host 1 stays `repairing`, the marker is kept, and no `built` write was made. | 8 | "returns `cas-failed`, host 1 stays `repairing`" | diff-local |
| Story 2 negative: Given host 1 has no pinned entry baseline in the route record, when the no-op evidence is read, then it fails closed with an error naming host 1, and no exit is taken. | 6, 8 | "no `update-ref` marking host 1 `done` or `built`, and no restack journal ref is created" | diff-local |
| Story 2 negative: Given host 1 already `restacked`, when an exit is requested again, then nothing is written and no restack journal is created. | 8 | "returns `noop`, the recording runner shows no `update-ref`" | diff-local |
| Story 3 happy: Given an operator committed unstamped work on closed child 2 during round `r1`, when host 1's exit restack is planned, then its origins are children 1 and 2, and `applied` charges one cascade on each. | 12 | "increments the `cascades` count for child 1 and for child 2 by one each" | diff-local |
| Story 3 negative: Given child 2's post-closure commits carry a `Round:` stamp of a different round, when host 1's exit restack is planned, then it halts needs-human naming child 2 and creates no journal. | 12 | "with detail naming child 2, and no journal ref exists" | diff-local |
| Story 3 negative: Given an origin set that does not include host 1, when the exit restack is planned, then it halts needs-human naming child 1 and creates no journal. | 12 | "with detail naming child 1, and no journal ref exists" | diff-local |
| Story 3 negative: Given child 1 has reached `MAX_RESTACK_CASCADES_PER_CHILD`, when host 1's exit restack is planned, then it halts needs-human with a `cascade-cap` HALT naming child 1, the marker stays set, and the halt detail names the runbook section `Routed repair halted on the cascade cap`. | 13 | "whose detail contains `Routed repair halted on the cascade cap`" | diff-local |
| Story 3 negative: Given the feature's stack is already published, when host 1's exit is requested, then it halts needs-human with `published-stack` naming child 1, no restack journal is created, and no branch or closure ref moves. | 14 | "`restack refused (published-stack) child 1`" | diff-local |
| Story 4 happy: Given child 2 and the leaf both appended distinct `rem-*` blocks to `.docs/plans/demo.md`, when a restack replays them, then the plan holds the authored body followed by every block once, in id order, and the conflict resolver is not invoked. | 16 | "with the resolver spy recording zero calls" | diff-local |
| Story 4 happy: Given the same base and the two sides swapped, when the union is computed, then the result is byte-identical. | 15 | "yields a byte-identical `merged` text" | diff-local |
| Story 4 happy: Given child 2's replay differs from its old contribution only by `rem-*` blocks inherited from its new parent, when the restack checks child 2's path ownership, then the plan path is accepted. | 18 | "returns accepted when the plan differs only by inherited `rem-*` blocks" | diff-local |
| Story 4 happy: Given child 2's replay differs from its old contribution only by inherited `rem-*` blocks, when replay proof is computed, then the replay is proven unchanged. | 18 | "is exactly `unchanged` (the `replay.kind` that `gate-invalidation.ts` treats as proven)" | diff-local |
| Story 4 negative: Given the two sides hold the same rem id with different bodies, when the restack replays the plan, then it halts needs-human naming that rem id, and no ref moves. | 16 | "whose detail names the rem id" | diff-local |
| Story 4 negative: Given the leaf edited the authored body of `T3` in the plan that child 2 replays, when the conflict is not only appended blocks, then the existing resolver is invoked once. | 17 | "the resolver spy records exactly one call" | diff-local |
| Story 4 negative: Given one side appends a `rem-*` block and also deletes another `rem-*` block, when the restack replays the plan, then the union merge declines and the existing resolver is invoked once. | 17 | "`unionRemBlocks` returns `declined`" | diff-local |
| Story 4 negative: Given an N=1 feature, when a rebase conflicts on its plan, then today's conflict handling runs unchanged. | 17 | "the N=1 plan-conflict rebase records the same resolver calls and outcome" | diff-local |
| Story 4 negative: Given routing is off for a stacked feature, when a restack replays a plan conflict of appended `rem-*` blocks, then the union merge is not applied and today's conflict handling runs unchanged. | 17 | "with routing off, the append-only rem conflict reaches the resolver" | diff-local |
| Story 5 happy: Given a round with hosts 1 and 2 pending in that order and host 1 `restacked`, when the loop continues, then the round's current host becomes child 2 and child 2 is admitted. | 20 | "writes `currentHostIndex: 1` and host 2 `admitted`" | diff-local |
| Story 5 happy: Given a round whose child hosts are all `restacked`, `done` or `rerouted`, whose leaf host is pending, and the queue is empty, when the loop continues, then the leaf host is admitted. | 19, 20 | "writes the leaf host `admitted`" | diff-local |
| Story 5 happy: Given a round whose every host, including the leaf host, is `restacked`, `done` or `rerouted`, when the last host settles, then the round is marked `closed`. | 20, 25 | "writes `phase: 'closed'` in that same compare-and-swap" | diff-local |
| Story 5 happy: Given a round's leaf host region passes, when region exit runs, then one compare-and-swap marks the leaf host `done` and deletes the marker, and no restack is requested. | 22 | "marks the leaf host `done` and deletes `refs/conductor/demo/repairing`, and the `runRestack` spy records zero calls" | diff-local |
| Story 5 negative: Given a crash after host 1 is `restacked` and before child 2 is admitted, when the feature resumes, then child 2 is admitted once, and no restack or admission is repeated. | 21 | "writes exactly one admission for host 2 and no admission write for host 1 or any other host" | diff-local |
| Story 5 negative: Given a host marked `rerouted`, when the next host is selected, then that host is never selected again. | 19, 21 | "a `rerouted` host is never admitted again" | diff-local |
| Story 5 negative: Given a round with a leaf host still pending, when the child hosts are all settled, then the round is not `closed`. | 20 | "leaves `phase: 'open'`" | diff-local |
| Story 5 negative: Given the round's current host is child 1 and still `repairing`, when reconciliation runs on resume, then the loop returns to child 1's region and the current host does not advance. | 21 | "returns host 1's region and `currentHostIndex` is unchanged" | diff-local |
| Story 6 happy: Given a round's last host has settled, no other round is open and the queue is empty, when the loop continues, then the worktree is switched to `feat/daemon-demo`, the switch is recorded in the round's route record, the round is `closed`, and the leaf gates are set pending. | 25, 26 | "HEAD is `feat/daemon-demo`, `routes/r1` carries `leafReturn`" | diff-local |
| Story 6 happy: Given the leaf gates are re-pended after a routed round, when the kickback ledger is read, then every lap count and cap is unchanged. | 26 | "so every lap count and cap is unchanged" | diff-local |
| Story 6 happy: Given a routed fix changed a file under `.docs/specs/`, when the leaf gates re-run, then the prior `prd_audit` PASS is void and `prd_audit` re-runs. | 26 | "returns `prd_audit` rather than treating its prior PASS verdict as satisfied" | diff-local |
| Story 6 happy: Given `manual_test` recorded a FAIL at the leaf's old HEAD, when the fix reaches the leaf through the exit restack, then the anti-whitewash check accepts the next PASS. | 27 | "accepts the `manual_test` PASS recorded at the leaf's post-restack HEAD" | diff-local |
| Story 6 negative: Given a marker names child 1, when the loop selects the next step, then only child 1's region steps can be selected, and no leaf gate, no step of another child and no custom step is dispatched, even when pending. | 23, 24 | "never `prd_audit`, `architecture_review_as_built`, `manual_test`, a custom step or another child's step" | diff-local |
| Story 6 negative: Given a marker names the leaf as host, when the loop selects the next step, then only the leaf's region steps can be selected, and no leaf gate is dispatched. | 23, 24 | "with `routedParking` `leaf-host`" | diff-local |
| Story 6 negative: Given a crash after the worktree switched to the leaf and before the switch was recorded, when the feature resumes, then the switch is recorded without a second checkout before the round is `closed`, and no leaf step is dispatched until then. | 25 | "resume records `leafReturn` with no second `switch` command" | diff-local |
| Story 6 negative: Given no marker and no open round but child 2 queued, when the loop selects the next step, then no leaf gate, no post-region custom step and no FINISH or publication step is dispatched. | 24 | "no post-region custom step, no FINISH step and no publication step" | diff-local |
| Story 6 negative: Given no marker, no open round and no queued child, when the loop selects the next step, then the decision is the same as before this spec. | 24 | "the selected step equals the pre-change selector's choice" | diff-local |
| Story 6 negative: Given an N=1 feature, when the loop selects the next step, then no marker or queue ref is read. | 24 | "records no command naming `repairing` or `revalidate`" | diff-local |
| Story 7 happy: Given host 1's exit restack moved closed child 2 and invalidated child 2's `test_suite`, when `applied` commits, then the queue's next generation holds one entry for child 2 with its new closure SHA, its position, its invalidated gates and its old and new replay parent. | 31 | "the queue's next generation holds one child-2 entry" | diff-local |
| Story 7 happy: Given a base-refresh restack, or a repair caused by an operator commit on a closed child, when its `applied` transaction commits, then every moved closed child with an invalidated gate is queued in that same transaction. | 31 | "each queue every moved closed child with an invalidated gate" | diff-local |
| Story 7 happy: Given a restack moved closed child 2 whose verdict files are missing or unreadable, when the queue is written, then child 2 is queued. | 30, 31 | "a restack moving child 2 with missing verdict files" | diff-local |
| Story 7 happy: Given a delta that changes the signature of `parseA` in `src/a.ts`, a file child 2 does not own, when the restack moves child 2, then child 2 is queued because its `test_suite` is invalidated. | 30, 31 | "in a file child 2 does not own, makes `queueInvalidation` return child 2 with `test_suite`" | diff-local |
| Story 7 happy: Given a restack whose replay of child 2 is proven unchanged and which leaves each of child 2's region gate verdicts present and fresh, when the queue is written, then child 2 is not queued. | 30, 31 | "writes no child-2 entry" | diff-local |
| Story 7 happy: Given children 4 and 2 are queued by two restacks of a five-position stack, when the queue is read, then the entries are ordered child 2 then child 4. | 29 | "yields entries ordered child 2 then child 4" | diff-local |
| Story 7 happy: Given child 1 was queued when it became host 1, when host 1's exit restack's `applied` commits, then child 1's own queue entry is removed in that transaction and a `child_revalidated` event with outcome `fixed` is recorded for child 1. | 32 | "with outcome `fixed`" | diff-local |
| Story 7 happy: Given child 1 was queued when it became host 1, when host 1 takes the no-commit exit, then child 1's own queue entry is removed in that compare-and-swap and a `child_revalidated` event with outcome `passed` is recorded for child 1. | 32 | "with outcome `passed`" | diff-local |
| Story 7 negative: Given two restacks each queue child 2, the first invalidating `test_suite` and the second only `build_review`, when the generations merge, then exactly one child-2 entry remains, with the newest closure SHA and gates `test_suite` and `build_review`. | 29 | "yields exactly one child-2 entry with the newer `closureSha`" | diff-local |
| Story 7 negative: Given recovery completes a restack from `synced`, when it writes the queue, then the queue is byte-identical to the uninterrupted run. | 31 | "the recovered restack's queue blob is byte-identical to the uninterrupted run" | diff-local |
| Story 7 negative: Given a concurrent writer changed the queue after the restack journal was created, when `applied` is attempted, then it fails, and recovery halts needs-human naming `refs/conductor/demo/revalidate`. | 31 | "naming `refs/conductor/demo/revalidate`" | diff-local |
| Story 7 negative: Given routing is off for a stacked feature, when a restack moves closed children, then no queue ref is written. | 31 | "with routing off, no command names `refs/conductor/demo/revalidate`" | diff-local |
| Story 7 negative: Given a restack rolls back, when its state is read, then the queue is unchanged. | 31 | "after a rollback, and after a restack that moves only the leaf" | diff-local |
| Story 7 negative: Given a restack that moves only the leaf, when `applied` commits, then the queue's generation and entries are unchanged. | 31 | "(generation and entries unchanged)" | diff-local |
| Story 7 negative: Given a queue blob with a duplicate child, entries out of position order, or an abbreviated SHA, when it is read, then it is reported unreadable and no partial generation is used. | 28 | "`readRevalidationQueue` reports `unreadable` and no partial generation is used" | diff-local |
| Story 8 happy: Given child 2 is the lowest queued child, no marker exists and no round has a pending child host, when the stack preflight runs, then a `revalidate` round for child 2 is created and the marker names child 2, before any branch or worktree change. | 33 | "shows the marker write before any `switch`, `checkout` or branch update" | diff-local |
| Story 8 happy: Given that `revalidate` round, when child 2's region is entered, then only the gates in child 2's entry are re-pended, acceptance runs in verify-green mode against child 2's existing specs, and child 2's other region steps keep their status. | 34 | "sets only `test_suite` and `acceptance_specs` to `pending`" | diff-local |
| Story 8 happy: Given that `revalidate` round, when its budgets are read, then no `prd_audit` or as-built lap and no growth were charged, and child 2 holds one routed-repair credit for the round. | 34 | "holds `routedRepairCredit` for the round" | diff-local |
| Story 8 happy: Given child 2's `build_review` runs in a `revalidate` round, when its base is resolved, then child 2's replayed contribution is graded against the new parent recorded in its queue entry. | 35 | "returns `{kind: 'revalidation', sha: <entry newParent>}`" | diff-local |
| Story 8 happy: Given child 2's re-validation passes with no new commits, each required gate verdict is fresh, and another queue entry or another open round remains, when region exit runs, then one transaction removes child 2's entry, closes the round, deletes the marker and records a `child_revalidated` event with outcome `passed`. | 36 | "removes child 2's entry, closes `routes/r2`, deletes the marker" | diff-local |
| Story 8 happy: Given child 2 is the last queued entry and no other round is open, when its PASS acknowledgement commits, then the transaction removes child 2's entry, deletes the marker and records the `child_revalidated` event, the `revalidate` round stays open, and the round is `closed` only after the switch to `feat/daemon-demo` is recorded in it. | 36 | "while `routes/r2` stays `open`" | diff-local |
| Story 8 happy: Given children 2 and 4 are queued, when re-validation runs, then child 4's round starts only after child 2's entry is acknowledged. | 33 | "no round for child 4 exists until child 2's entry is acknowledged" | diff-local |
| Story 8 happy: Given a round whose leaf host is still pending and whose child hosts are settled, when the queue holds child 2, then child 2 is re-validated before the leaf host is admitted. | 33 | "the leaf host stays `pending`" | diff-local |
| Story 8 negative: Given a newer generation replaced child 2's entry while child 2 was being validated, when the PASS acknowledgement is attempted, then the compare-and-swap fails and child 2 stays queued. | 36 | "with a newer generation, the compare-and-swap fails and child 2 is still queued" | diff-local |
| Story 8 negative: Given child 2's closure moved during validation, when the PASS acknowledgement is attempted, then it fails, and the entry, the round and the marker stay pending. | 36 | "with `closed/c2` moved, it fails" | diff-local |
| Story 8 negative: Given a queued child and no `revalidate` round for it, when region entry is attempted for that child, then it is refused, and no region step is dispatched. | 34 | "is refused, and the dispatch spy records no region step" | diff-local |
| Story 8 negative: Given the same `revalidate` round is entered again after a crash, when region entry runs, then child 2's region is not restaged a second time. | 34 | "restages nothing" | diff-local |
| Story 8 negative: Given a crash after child 2's `revalidate` record is created in phase `prepared` and before its marker is set, when the feature resumes, then that record is aborted, nothing was mutated, and child 2 stays queued. | 33 | "resume deletes the `prepared` record" | diff-local |
| Story 8 negative: Given child 2's `revalidate` round dispatches BUILD after a failing gate, when the dispatch runs, then no round receipt is settled and no lap or growth is charged. | 34 | "no receipt is settled" | diff-local |
| Story 9 happy: Given child 2's re-validation fails `test_suite` and child 2's region then fixes it with a commit, when region exit runs, then the fix leaves through an exit restack originating at child 2, and child 2's entry is removed only in that restack's `applied` transaction with outcome `fixed`. | 37 | "child 2's entry is removed only in that restack's `applied` transaction" | diff-local |
| Story 9 happy: Given a fix made during re-validation, when `build_review` grades it, then it is graded against child 2's tip pinned at region entry, not against child 2's whole contribution. | 37 | "returns `{kind: 'revalidation-fix', sha: <entry pinnedBase>}`" | diff-local |
| Story 9 negative: Given child 2's re-validation keeps failing, when child 2's region caps are exhausted, then the feature halts needs-human naming child 2, and child 2 stays queued. | 37 | "the queue still holds child 2's entry" | diff-local |
| Story 9 negative: Given four queued children whose re-validations each fix and restack, when the driven loop runs, then it terminates within `MAX_RESTACK_CASCADES_PER_CHILD` per origin and each child's region caps. | 38 | "every child's cascade count stays at or below `MAX_RESTACK_CASCADES_PER_CHILD`" | diff-local |
| Story 10 happy: Given a base refresh is requested while the queue holds child 2, when the stack preflight runs, then no ref moves, a `restack_refused` event with reason `deferred-base-refresh` is recorded, and the request is retained. | 39 | "emits one `restack_refused` with reason `deferred-base-refresh`" | diff-local |
| Story 10 happy: Given an automatic repair whose base-refresh follow-on is due and whose `applied` transaction queued child 2, when the follow-on would run, in the preflight or in recovery, then it is suppressed, a `restack_refused` event with reason `deferred-base-refresh` is recorded, the repair journal becomes terminal, and the base-refresh request is retained. | 40 | "the REKICK sentinel file still exists" | diff-local |
| Story 10 happy: Given the queue then drains and no round is open, when the next stack preflight runs, then the retained base refresh runs. | 39 | "runs a `base-refresh` restack" | diff-local |
| Story 10 negative: Given the queue ref exists with no entries, when the deferral check runs, then the base refresh is not deferred. | 39 | "a due base refresh is not deferred" | diff-local |
| Story 10 negative: Given the queue ref is unreadable, when the deferral check runs, then the base refresh is deferred. | 39 | "with an unreadable queue ref it is deferred" | diff-local |
| Story 10 negative: Given the queue ref has no entries and an empty outbox, when its last event is drained, then the queue ref is deleted in that same compare-and-swap. | 41 | "deletes `refs/conductor/demo/revalidate` in the same compare-and-swap" | diff-local |
| Story 11 happy: Given a project config with no `stacked_prs.route_whole_feature_fixes` key, when the config is loaded, then the setting resolves to `true`. | 42 | "with the key absent and with the `stacked_prs` block absent" | diff-local |
| Story 11 happy: Given a project config that sets `stacked_prs.route_whole_feature_fixes: false`, when the config is loaded, then it resolves to `false`, and a stacked feature remediates exactly as before this spec. | 42 | "with the key set `false`, `loadConfig` resolves `false`" | diff-local |
| Story 11 happy: Given child 2 is re-validated, when `events.jsonl` is read, then it holds one `child_revalidated` event naming child 2, the generation, the closure SHA and an outcome of `passed` or `fixed`. | 43 | "holds exactly one `child_revalidated` event naming child 2" | diff-local |
| Story 11 negative: Given a crash between the queue transaction that records child 2's outcome and the outbox drain, when the stack preflight runs, then the `child_revalidated` event is delivered once. | 41 | "holds it exactly once after a second drain" | diff-local |
| Story 11 negative: Given the same `child_revalidated` event is delivered twice, when the persister writes it, then `events.jsonl` holds it once. | 43 | "writes it once to `.pipeline/events.jsonl`" | diff-local |
| Story 11 negative: Given an N=1 feature with routing on by default, when it remediates, then no `routes`, `repairing` or `revalidate` ref is read or written. | 43 | "records no git command naming `routes`, `repairing` or `revalidate`" | diff-local |

## Tasks

### Task 1: The restack journal carries the routed refs and their precomputed new values
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-journal.test.ts`:
   - a journal carrying a `routed` block `{roundId, host, routeOld, markerOld, queueOld?, routeNew?, queueNew?}` and an `invalidation` list of `{child, gates}`;
   - malformed routed blocks;
   - `recordRoutedApplyPlan` against a journal in `synced` and against a journal changed since the read.
2. Verify RED.
3. Implement in `src/conductor/src/engine/restack/restack-journal.ts`:
   - add the optional `routed` and `invalidation` fields to `RestackJournalDraft`, with closed parsing in `readRestackJournal` (full SHAs only, a valid `RoundId`, a `ChildId` host);
   - add `recordRoutedApplyPlan(worktree, journal, {routeNew, queueNew?, invalidation})`. It is legal only in state `synced`, and writes by compare-and-swap on the journal blob.
4. Verify GREEN, commit.

**Done when:**
- [test] `readRestackJournal` returns a journal whose `routed` block (round `r1`, host 1, `routeOld`, `markerOld`, `routeNew`) and `invalidation` list round-trip byte-identical through write then read.
- [test] `readRestackJournal` reports the journal unreadable when the `routed` block has host 0, an abbreviated `routeOld`, or round id `x1`.
- [test] `recordRoutedApplyPlan` writes `routeNew` into a `synced` journal by compare-and-swap, and returns `stale` without writing when the journal blob changed after the read or the journal is not `synced`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-journal.ts` — routed block, invalidation list, `recordRoutedApplyPlan`
- `src/conductor/test/engine/restack/restack-journal.test.ts` — parser and CAS tests

**Dependencies:** none

### Task 2: One fence predicate lets only the open journal's own applied transaction write routing refs
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/route-writers-journal.realgit.test.ts`:
   - a journal at `synced` owned by opId `op-1`;
   - `writeRoutingTransaction` attempting an `update-record` on `routes/r1` and an `update-marker`;
   - the restack's own `routedAppliedLines` request carrying `op-1`, and one carrying `op-2`;
   - `enterHostRegion` with the same journal.
2. Verify RED.
3. Implement `routingFenceOpen(journal, ownerOpId?)` in `src/conductor/src/engine/routing/route-record-store.ts`:
   - it returns open only for a missing journal, an `aborted` journal, an `applied` journal without a follow-on, or, when `ownerOpId` equals the journal's `opId`, a journal at `synced`;
   - `writeRoutingTransaction` (which never passes an owner) and `host-region-entry.ts`'s `terminalJournal` both call it.
4. Verify GREEN, commit.

**Done when:**
- [test] with the journal at `synced`, `writeRoutingTransaction` with an `update-record` on `routes/r1` or an `update-marker` op returns `restack-journal-open`, and `routes/r1` and `refs/conductor/demo/repairing` keep their prior blobs.
- [test] `routingFenceOpen` returns open for owner `op-1` against the `synced` journal owned by `op-1`, and closed for owner `op-2` and for no owner.
- [test] `enterHostRegion` refuses with the journal at `synced`, through the same `routingFenceOpen` predicate (spy records one call), and writes no routing ref.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — `routingFenceOpen`
- `src/conductor/src/engine/routing/host-region-entry.ts` — `terminalJournal` delegates to it
- `src/conductor/test/engine/routing/route-writers-journal.realgit.test.ts` — fence tests

**Dependencies:** Task 1

### Task 3: The route store renders the routed applied lines, including the marker delete
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/route-record-store.test.ts`:
   - `routedAppliedLines` for a journal whose `routed` block names `r1` and host 1;
   - a `delete-marker` op through `writeRoutingTransaction`;
   - a stale `markerOld`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/routing/route-record-store.ts`:
   - `routedRecordAfterExit(stored, host, outcome)`, which applies `transitionHost` to `restacked` or `done` with its `routed_repair_phase` outbox event;
   - `routedAppliedLines(slug, journal, ownerOpId)`, which returns `update <routes/rN> <routeNew> <routeOld>` and `delete <repairing> <markerOld>` only when `routingFenceOpen` admits the owner;
   - a `delete-marker {old}` op in `RoutingTransactionOp`.
4. Verify GREEN, commit.

**Done when:**
- [test] `routedAppliedLines` for a `synced` journal owned by `op-1` returns exactly an `update refs/conductor/demo/routes/r1 <routeNew> <routeOld>` line and a `delete refs/conductor/demo/repairing <markerOld>` line, and returns `refused` for owner `op-2`.
- [test] `routedRecordAfterExit` marks host 1 `restacked` and appends one `routed_repair_phase` outbox event naming host 1 and phase `restacked`.
- [test] a `delete-marker` op with a stale old blob makes `writeRoutingTransaction` return `cas-failed`, leaving the marker ref at its prior blob.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — `routedAppliedLines`, `routedRecordAfterExit`, `delete-marker` op
- `src/conductor/test/engine/routing/route-record-store.test.ts` — line-builder tests

**Dependencies:** Task 2

### Task 4: One applied-transaction builder serves repair, base refresh and recovery
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-applied-routed.realgit.test.ts`, using a recording `GitRunner`:
   - a routed `feature-repair` restack of host 1 run to completion;
   - the same restack interrupted at `synced`, then completed by `recoverRestackJournal`;
   - a `base-refresh` restack.
2. Verify RED.
3. Implement `appliedTransactionLines(journal)` in `src/conductor/src/engine/restack/restack-executor.ts`:
   - it emits the cascade lines for every origin (`cascadeUpdateLines`), the routed lines (`routedAppliedLines`) when the journal has a `routed` block, and the `applied` journal state line;
   - `runRestack` calls `recordRoutedApplyPlan` after `synced`, then writes these lines in one `update-ref --stdin`;
   - `transitionAppliedWithCascade` and the base-refresh `transitionState` call site are replaced by it, as is `restack-recovery.ts`'s `synced`→`applied` path, which reuses the journalled `routeNew`.
4. Verify GREEN, commit.

**Done when:**
- [test] the recording runner shows the marker deletion, the `routes/r1` update marking host 1 `restacked` and the child-1 cascade increment only inside the single `update-ref --stdin` transaction that sets the journal `applied`, on the normal path and on the recovery path.
- [test] after recovery completes the interrupted restack, the marker ref is absent, host 1 is `restacked` in `routes/r1`, and `routes/r1`, `cascades`, `closed/c1` and every child branch ref are byte-identical to the uninterrupted run.
- [test] the `base-refresh` restack's applied transaction is produced by `appliedTransactionLines` (spy records one call) and contains no `routes`, `repairing` or `revalidate` line.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — `appliedTransactionLines`, routed apply plan
- `src/conductor/src/engine/restack/restack-recovery.ts` — `synced`→`applied` uses the builder
- `src/conductor/test/engine/restack/restack-applied-routed.realgit.test.ts` — builder tests

**Dependencies:** Task 3

### Task 5: A failed routed applied transaction halts naming the ref and never retries
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/restack/restack-applied-routed.realgit.test.ts`. A raw `git update-ref` changes `refs/conductor/demo/routes/r1` after the exit restack's journal is created, then `applied` is attempted on the normal path and on recovery.
2. Verify RED.
3. Implement in `restack-executor.ts` and `restack-recovery.ts`: a failed `applied` transaction whose journal has a `routed` block re-reads each routed old value. The first ref whose live value differs from the journal's is named in a needs-human HALT. The journal stays at `synced`, and the step is not retried within the dispatch.
4. Verify GREEN, commit.

**Done when:**
- [test] the `applied` transaction fails and `.pipeline/HALT` is `needs-human` with detail naming `refs/conductor/demo/routes/r1`, on the normal path and on recovery.
- [test] the recording runner shows exactly one `applied` `update-ref --stdin` attempt per path, and the journal stays at `synced`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — routed applied failure halt
- `src/conductor/src/engine/restack/restack-recovery.ts` — same halt on recovery
- `src/conductor/test/engine/restack/restack-applied-routed.realgit.test.ts` — concurrent-writer test

**Dependencies:** Task 4

### Task 6: Host no-op evidence compares the host with its pinned entry baseline
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.test.ts`:
   - host 1 whose route record has `entry {host: 1, pinnedBase, tree}`, with HEAD unchanged;
   - the same host with HEAD moved and the tree unchanged;
   - the same host with a changed tree;
   - a record with no `entry`.
2. Verify RED.
3. Implement `hostNoOpEvidence(worktree, slug, stored, host)` in new `src/conductor/src/engine/routing/routed-exit.ts`. It returns `{headMoved, treeDiffers, tipEqualsClosure}` from `rev-parse HEAD`, `HEAD^{tree}` and the host's `closed/c<k>`, and fails closed when `entry` is absent or names another host.
4. Verify GREEN, commit.

**Done when:**
- [test] `hostNoOpEvidence` returns `headMoved: false, treeDiffers: false` for an unchanged host, `headMoved: true, treeDiffers: false` for a moved HEAD with the entry tree, and `treeDiffers: true` for a changed tree.
- [test] `hostNoOpEvidence` returns an `unavailable` result whose detail names host 1 when the route record has no `entry`, and writes no ref.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — new module, `hostNoOpEvidence`
- `src/conductor/test/engine/routing/routed-exit.test.ts` — evidence tests

**Dependencies:** none

### Task 7: A passing host is marked built and requests one exit restack after draining its outbox
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`:
   - round `r1` with host 1 `repairing` and a committed fix on `feat/c1/demo`;
   - an undrained outbox entry on `routes/r1`;
   - a persister that throws.
2. Verify RED.
3. Implement `requestRoutedExit` in `src/conductor/src/engine/routing/routed-exit.ts`, with a closed result union `noop`, `no-commit-done`, `restacked` or `halted`:
   - when the tip differs from `closed/c1`, it compare-and-swaps host 1 `repairing`→`built`, then drains `routes/r1`'s outbox with `drainOutbox`;
   - only then does it call `runRestack({cause: 'feature-repair', routed: {roundId, host, coOrigins}})`, which journals the `routed` block;
   - extend `RunRestackOptions` with `routed`, and route its origin set to `plan.originating`.
4. Verify GREEN, commit.

**Done when:**
- [test] `requestRoutedExit` marks host 1 `built`, then runs a `feature-repair` restack whose journal `routed` block names `r1` and host 1, and whose `originatingChildren` is `[1]`.
- [test] after that restack, `closed/c1` points at host 1's repaired tip, and `feat/c2/demo` and `feat/daemon-demo` each contain that tip as an ancestor.
- [test] with an undrained outbox entry, the recording runner shows the outbox removal on `routes/r1` before the journal create on `refs/conductor/demo/restack/journal`.
- [test] when the persister throws, `requestRoutedExit` returns `halted` with detail naming the outbox, no journal ref exists, and host 1 stays `built`.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — `requestRoutedExit`
- `src/conductor/src/engine/restack/restack-executor.ts` — `RunRestackOptions.routed`
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — exit tests

**Dependencies:** Tasks 4, 6

### Task 8: A host whose tip equals its closure leaves through one no-commit compare-and-swap
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`:
   - an `existing-task` repair of `T1` on host 1 that appended no block and committed nothing;
   - host 1 with its entry tree but its tip differing from `closed/c1`;
   - a marker blob changed between the read and the write;
   - host 1 already `restacked`.
2. Verify RED.
3. Implement the no-commit arm of `requestRoutedExit`:
   - when `hostNoOpEvidence` reports `tipEqualsClosure`, one `writeRoutingTransaction` carries an `update-record` marking the host `done` and a `delete-marker`;
   - tree equality alone never selects it;
   - a host already `restacked` or `done` returns `noop` without any write.
4. Verify GREEN, commit.

**Done when:**
- [test] for the no-commit repair, the recording runner shows one `update-ref --stdin` transaction that marks host 1 `done` and deletes `refs/conductor/demo/repairing`, with no `built` write and no journal create.
- [test] with the entry tree but a tip differing from `closed/c1`, `requestRoutedExit` takes the exit restack (host 1 `built`, a `feature-repair` journal created), not the no-commit exit.
- [test] with a stale marker old value, the no-commit transaction returns `cas-failed`, host 1 stays `repairing`, the marker ref is unchanged, and no `built` write occurred.
- [test] with host 1 already `restacked`, `requestRoutedExit` returns `noop`, the recording runner shows no `update-ref`, and no journal ref exists.
- [test] with the route record lacking host 1's `entry`, `requestRoutedExit` fails closed with an error naming host 1, the recording runner shows no `update-ref` marking host 1 `done` or `built`, and no restack journal ref is created.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — no-commit exit and no-op re-request
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — no-commit tests

**Dependencies:** Tasks 3, 6

### Task 9: The routed host's region exit runs the exit instead of closing the child
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing conductor-level test in `src/conductor/test/engine/routing/conductor-routed-exit.test.ts`. A routed resume reaches `build_review` PASS for host 1 with every `CHILD_REGION_STEPS` step done, with spies on `advanceChildRegion`, `closeChild` and the event emitter.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`: in the `build_review` region-exit branch, when `resolveExecutionChild` returns `source: 'routed-host'`, call `requestRoutedExit` instead of `advanceChildRegion`, then drain the routing outboxes. Halt through `haltChildRegionRefusal` on a `halted` result.
4. Verify GREEN, commit.

**Done when:**
- [test] the conductor calls `requestRoutedExit` once for host 1, and records no call to `advanceChildRegion` or `closeChild`.
- [test] after the exit, every `restack_applied` event in `.pipeline/events.jsonl` carries cause `feature-repair`, and exactly one `routed_repair_phase` event reports host 1 with phase `restacked`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — routed region-exit branch
- `src/conductor/test/engine/routing/conductor-routed-exit.test.ts` — conductor-level test

**Dependencies:** Tasks 7, 8

### Task 10: The preflight resumes a host left built exactly once, and never after a rollback halt
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` and `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`:
   - host 1 `built` with no journal;
   - a second preflight after it completes;
   - an exit restack whose post-move verification fails;
   - a preflight while that rollback HALT is live.
2. Verify RED.
3. Implement:
   - a `built` arm in `reconcileRounds` (`src/conductor/src/engine/routing/round-admission.ts`) that returns `{kind: 'resume-exit', roundId, host}`;
   - `runStackPreflight` calls `requestRoutedExit` with the `built` compare-and-swap skipped, after journal recovery and the live-HALT check, and returns `halted` while a HALT is live;
   - routed lines are written only by `appliedTransactionLines`, so a rollback leaves them untouched.
4. Verify GREEN, commit.

**Done when:**
- [test] with host 1 `built` and no journal, `runStackPreflight` runs host 1's exit restack, host 1 ends `restacked`, and a second `runStackPreflight` creates no journal ref (recording runner shows no journal create).
- [test] when the exit restack's verification fails and rolls back, the marker, `routes/r1` and `closed/c1` keep their prior values, host 1 is `built`, and `.pipeline/HALT` is `needs-human` with detail naming the failed check.
- [test] with that rollback HALT live, `runStackPreflight` returns `halted`, and `requestRoutedExit` is not called (spy count 0).

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — `built` arm
- `src/conductor/src/engine/restack/stack-preflight.ts` — resume-exit arm
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — preflight tests
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — rollback test

**Dependencies:** Task 7

### Task 11: A taskless host that commits nothing takes the no-commit exit, and the leaf PASS is refused
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`. Host 1 carries only a routed `manual_test` FAIL; its build commits nothing; then the leaf's `manual_test` reports PASS at the unchanged leaf HEAD.
2. Verify RED.
3. Implement: the no-commit arm (Task 8) is chosen by tip equality alone, so the taskless host exits `done`. Confirm that the existing `manual_test` whitewash guard in `artifacts.ts` refuses the PASS at the unchanged leaf HEAD, and that the existing no-op escalation (`adr-2026-07-13-kickback-build-no-op-escalation` decision 2) handles it. Change only what the test proves missing.
4. Verify GREEN, commit.

**Done when:**
- [test] host 1 carrying only a routed `manual_test` FAIL with no commit ends `done` through the no-commit transaction, and no restack journal is created.
- [test] the next leaf `manual_test` PASS at the unchanged leaf HEAD is refused by the whitewash guard, and the feature reaches the existing no-op escalation outcome instead of `manual_test` passing.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — taskless host arm, if needed
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — taskless host test

**Dependencies:** Task 8

### Task 12: The exit restack takes unstamped co-origins and halts on a foreign round or a missing host origin
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`:
   - an unstamped operator commit on closed child 2 during `r1`;
   - child 2's post-closure commits stamped `Round: r9`;
   - a routed option whose origins exclude host 1.
2. Verify RED.
3. Implement in `requestRoutedExit` and `runRestack`'s routed planning:
   - the origins are the host plus the cursor's `coOrigins`;
   - a non-empty `foreignRoundChildren` halts needs-human naming the child before any journal;
   - an origin set without the host halts needs-human naming the host before any journal;
   - `appliedTransactionLines` charges one cascade per origin.
4. Verify GREEN, commit.

**Done when:**
- [test] with the unstamped commit on child 2, the exit restack journal's `originatingChildren` is `[1, 2]`, and `applied` increments the `cascades` count for child 1 and for child 2 by one each.
- [test] with child 2 stamped `Round: r9`, the exit halts `needs-human` with detail naming child 2, and no journal ref exists.
- [test] with an origin set excluding host 1, planning halts `needs-human` with detail naming child 1, and no journal ref exists.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — co-origin planning
- `src/conductor/src/engine/restack/restack-executor.ts` — routed origin checks
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — co-origin tests

**Dependencies:** Task 7

### Task 13: A routed exit at the cascade cap halts, keeps the marker and names the runbook section
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`, with child 1 at `MAX_RESTACK_CASCADES_PER_CHILD` cascades and an exit requested. Add a runbook-heading test in `src/conductor/test/engine/routing/routed-exit-runbook.test.ts` that reads `docs/runbooks/stalled-or-stuck-feature.md`.
2. Verify RED.
3. Implement:
   - in `runRestack`'s cap check for a routed journal, write the `cascade-cap` HALT through `haltRestack` naming child 1, with detail that includes the line `Runbook: Routed repair halted on the cascade cap`;
   - the halt leaves the marker set;
   - add a `### Routed repair halted on the cascade cap` section to the runbook. It covers symptom, diagnosis and recovery through `kickback-budget raise --gate restack`, and says that slices merged before the flag flip route without re-validation.
4. Verify GREEN, commit.

**Done when:**
- [test] the exit writes a `needs-human` HALT beginning `restack refused (cascade-cap) child 1` whose detail contains `Routed repair halted on the cascade cap`, no journal ref exists, and `refs/conductor/demo/repairing` still names host 1.
- [test] the runbook-heading test finds a `### Routed repair halted on the cascade cap` heading in `docs/runbooks/stalled-or-stuck-feature.md`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — routed cap halt detail
- `docs/runbooks/stalled-or-stuck-feature.md` — cascade-cap section named by the halt
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — cap halt test
- `src/conductor/test/engine/routing/routed-exit-runbook.test.ts` — heading test

**Dependencies:** Task 12

### Task 14: A routed exit on a published stack refuses before any journal
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`. A publication record exists for `demo`, and host 1's tip differs from `closed/c1` when the exit is requested.
2. Verify RED.
3. Implement in `requestRoutedExit`: before the `built` compare-and-swap, call `publishedStackRefusal`. On refusal, call `haltRestack(worktree, 'published-stack', events, {child: host})` and return `halted`.
4. Verify GREEN, commit.

**Done when:**
- [test] the exit writes a `needs-human` HALT beginning `restack refused (published-stack) child 1`, and no journal ref exists.
- [test] `feat/c1/demo`, `feat/c2/demo`, `feat/daemon-demo`, `closed/c1` and `closed/c2` keep their prior SHAs, and host 1 is still `repairing`.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — published-stack refusal
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — published test

**Dependencies:** Task 7

### Task 15: Appended rem blocks union by id, symmetrically, and refuse a body mismatch
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/rem-block-merge.test.ts`. Each case gives a base plan and two sides:
   - each side appends a distinct `rem-*` block;
   - the same inputs with the sides swapped;
   - both sides hold `rem-prd-audit-T1` with different bodies;
   - one side edits `T3`'s authored body;
   - one side appends a block and deletes another.
2. Verify RED.
3. Implement `unionRemBlocks(base, ours, theirs)` in new `src/conductor/src/engine/routing/rem-block-merge.ts` using `parsePlanTaskBlocks` from `plan-task-parse.ts`:
   - it returns `merged` (the authored body followed by every `rem-*` block once, in id order), `body-mismatch {remId}`, or `declined`;
   - `declined` covers any change outside appended `rem-*` blocks, including a deleted block.
4. Verify GREEN, commit.

**Done when:**
- [test] for two distinct appended blocks, `unionRemBlocks` returns `merged` whose text is the authored body followed by each block once in id order.
- [test] swapping `ours` and `theirs` yields a byte-identical `merged` text.
- [test] the same rem id with different bodies returns `body-mismatch` naming that rem id; an authored-body edit, or an append plus a deletion, returns `declined`.

**Files likely touched:**
- `src/conductor/src/engine/routing/rem-block-merge.ts` — new module, `unionRemBlocks`
- `src/conductor/test/engine/routing/rem-block-merge.test.ts` — union tests

**Dependencies:** none

### Task 16: A restack merges append-only plan conflicts without the resolver, and halts on a body mismatch
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-rem-union.realgit.test.ts` with routing on:
   - child 2 and the leaf each appended a distinct `rem-*` block to the fixture plan `.docs/plans/<feature>.md`, and a `feature-repair` restack replays them;
   - the same restack where both sides hold one rem id with different bodies.
2. Verify RED.
3. Implement in `src/conductor/src/engine/restack/restack-executor.ts`'s conflict path, before `resolveRestackConflict`:
   - when `routingEligible` holds and the only conflicted path is the plan, compute `unionRemBlocks` over base, parent and child;
   - on `merged`, build the commit through a temporary index, following the `upperChildHaltRecordTree` pattern in `restack-replay.ts` (never the worktree), and continue the replay;
   - on `body-mismatch`, abort the journal and halt needs-human naming the rem id.
4. Verify GREEN, commit.

**Done when:**
- [test] the append-only restack applies with the resolver spy recording zero calls, and the replayed fixture plan `.docs/plans/<feature>.md` holds the authored body followed by both blocks once in id order.
- [test] the body-mismatch restack writes a `needs-human` HALT whose detail names the rem id, and every child branch and closure ref keeps its prior SHA.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — union step before the resolver
- `src/conductor/test/engine/restack/restack-rem-union.realgit.test.ts` — replay tests

**Dependencies:** Task 15

### Task 17: Every plan conflict that is not append-only keeps today's resolver path
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-rem-union.realgit.test.ts`:
   - the leaf edits `T3`'s authored body in the plan that child 2 replays;
   - one side appends a rem block and deletes another;
   - an N=1 feature whose rebase conflicts on its plan;
   - routing off (`stacked_prs.route_whole_feature_fixes: false`) with an append-only rem conflict.
2. Verify RED.
3. Implement: `declined`, an N=1 feature (which never reaches the restack) and `routingEligible` false all fall through to `resolveRestackConflict` unchanged.
4. Verify GREEN, commit.

**Done when:**
- [test] for the authored-body edit and for the append-plus-delete conflict, the resolver spy records exactly one call and `unionRemBlocks` returns `declined`.
- [test] with routing off, the append-only rem conflict reaches the resolver (one call), and `unionRemBlocks` is not called (spy count 0).
- [test] the N=1 plan-conflict rebase records the same resolver calls and outcome as the existing `performRebase` fixture, and `unionRemBlocks` is not called.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — eligibility gate on the union
- `src/conductor/test/engine/restack/restack-rem-union.realgit.test.ts` — decline tests

**Dependencies:** Task 16

### Task 18: Inherited rem blocks pass path ownership and keep a replay proven unchanged
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-ownership.realgit.test.ts` and `src/conductor/test/engine/restack/restack-transition.test.ts`. Child 2's replay differs from its old contribution only by `rem-*` blocks its new parent appended.
2. Verify RED.
3. Implement `stripInheritedRemBlocks(plan, parentPlan)` in `src/conductor/src/engine/routing/rem-block-merge.ts`:
   - `checkPathOwnership` (`restack-ownership.ts`) excludes the plan path when only inherited blocks differ;
   - the replay-proof comparison in `restack-transition.ts` (`outcomeFor` and `compareReplayTree`) normalises both sides with it, only when `routingEligible` holds.
4. Verify GREEN, commit.

**Done when:**
- [test] `checkPathOwnership` for child 2 returns accepted when the plan differs only by inherited `rem-*` blocks.
- [test] the replay-proof outcome for child 2 is exactly `unchanged` (the `replay.kind` that `gate-invalidation.ts` treats as proven) when its only difference is inherited `rem-*` blocks, so `wouldInvalidate` for child 2 is empty.

**Files likely touched:**
- `src/conductor/src/engine/routing/rem-block-merge.ts` — `stripInheritedRemBlocks`
- `src/conductor/src/engine/restack/restack-ownership.ts` — ownership exclusion
- `src/conductor/src/engine/restack/restack-transition.ts` — replay-proof normalisation
- `src/conductor/test/engine/restack/restack-ownership.realgit.test.ts` — ownership test
- `src/conductor/test/engine/restack/restack-transition.test.ts` — proof test

**Dependencies:** Task 15

### Task 19: The next host is selected in recorded order: child hosts, the queue, then the leaf host
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing table tests in `src/conductor/test/engine/routing/host-progression.test.ts` over route-record fixtures:
   - hosts 1 and 2 pending with host 1 `restacked`;
   - child hosts all settled, the leaf host pending, and the queue empty;
   - the same with a non-empty queue;
   - a `rerouted` host;
   - every host settled.
2. Verify RED.
3. Implement `selectNextHost(record, queue)` in `src/conductor/src/engine/routing/routed-exit.ts`:
   - it returns `child-host {host, index}` for the next `pending` child host in `currentHostIndex` order;
   - else `queue` when the queue has entries;
   - else `leaf-host` when the leaf host is pending;
   - else `settled`;
   - a `rerouted`, `restacked` or `done` host is never returned;
   - the switch over host states is exhaustive (added to `routing-exhaustive-switch.test.ts`).
4. Verify GREEN, commit.

**Done when:**
- [test] `selectNextHost` returns `child-host` 2 at index 1 when host 1 is `restacked` and host 2 is pending.
- [test] `selectNextHost` returns `leaf-host` when every child host is `restacked`, `done` or `rerouted`, the leaf host is pending and the queue is empty, and returns `queue` when the queue holds an entry.
- [test] `selectNextHost` never returns a `rerouted` host in any fixture, and returns `settled` when every host including the leaf host is settled.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — `selectNextHost`
- `src/conductor/test/engine/routing/host-progression.test.ts` — selection table tests
- `src/conductor/test/structural/routing-exhaustive-switch.test.ts` — new switch registered

**Dependencies:** Task 7

### Task 20: The round advances its current host and closes only after its last host settles
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/host-progression.test.ts`:
   - `advanceRound` after host 1 `restacked` with host 2 pending;
   - all hosts settled with another round open;
   - all child hosts settled with the leaf host pending;
   - every host settled, no other round open, and child 2 queued.
2. Verify RED.
3. Implement `advanceRound(stored, next)` in `src/conductor/src/engine/routing/routed-exit.ts`:
   - it writes through `writeRoutingTransaction` an `update-record` that sets `currentHostIndex` and admits the next child host;
   - when `selectNextHost` is `settled` and another round is open or the queue has entries, it sets `phase: 'closed'` in the same compare-and-swap;
   - it never closes while any host, including the leaf host, is pending.
4. Verify GREEN, commit.

**Done when:**
- [test] after host 1 `restacked`, `advanceRound` writes `currentHostIndex: 1` and host 2 `admitted` in one compare-and-swap on `routes/r1`.
- [test] with every host settled and another round open, `advanceRound` writes `phase: 'closed'` in that same compare-and-swap.
- [test] with all child hosts settled and the leaf host pending, `advanceRound` leaves `phase: 'open'` and `currentHostIndex` on the leaf host.
- [test] with every child host settled, the leaf host pending and the queue empty, `advanceRound` writes the leaf host `admitted` and the marker naming the leaf host in one compare-and-swap.
- [test] with every host including the leaf host settled, no other round open and child 2 queued, `advanceRound` writes `phase: 'closed'` with no `leafReturn` in that same compare-and-swap, before any queue consumption.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — `advanceRound`
- `src/conductor/test/engine/routing/host-progression.test.ts` — advance tests

**Dependencies:** Task 19

### Task 21: Reconciliation follows the record after restacked, done and rerouted hosts, without repeating writes
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts`:
   - a crash after host 1 `restacked` and before host 2 is admitted;
   - host 1 still `repairing` as the current host;
   - a `rerouted` host;
   - the resume repeated.
2. Verify RED.
3. Implement the `restacked`, `done` and `rerouted` arms of `reconcileRounds` in `src/conductor/src/engine/routing/round-admission.ts`:
   - they call `advanceRound` from the record and return `navigate-host` for the admitted host;
   - the `repairing` current host keeps today's `navigate-leaf-to-build` return to its own region;
   - a reopened task under the routed host keeps its binding (reopened-task D8, widened by C9).
4. Verify GREEN, commit.

**Done when:**
- [test] after the injected crash, the first resume makes zero `runRestack` calls, creates no restack journal, writes exactly one admission for host 2 and no admission write for host 1 or any other host, and a second resume performs no `update-ref` (recording runner) and no restack.
- [test] with host 1 `repairing` as the current host, `reconcileRounds` returns host 1's region and `currentHostIndex` is unchanged.
- [test] a `rerouted` host is never admitted again across two resumes.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — reconcile arms
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — resume tests

**Dependencies:** Task 20

### Task 22: The leaf host's exit is one compare-and-swap with no restack
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`: round `r1` whose leaf host region passes.
2. Verify RED.
3. Implement the leaf arm of `requestRoutedExit`: for the leaf host, one `writeRoutingTransaction` marks the leaf host `done` and deletes the marker. `runRestack` is never called. The conductor's region-exit branch accepts the leaf host.
4. Verify GREEN, commit.

**Done when:**
- [test] the leaf host exit writes one `update-ref --stdin` transaction that marks the leaf host `done` and deletes `refs/conductor/demo/repairing`, and the `runRestack` spy records zero calls.
- [test] the conductor's `build_review` region exit for the leaf host calls `requestRoutedExit` once and records no `advanceChildRegion` call.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — leaf host exit
- `src/conductor/src/engine/conductor.ts` — leaf-host region exit
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — leaf exit test

**Dependencies:** Tasks 8, 21

### Task 23: The selector parks on the marked host's region steps
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/selector.test.ts`:
   - `routedParking: {kind: 'child', child: 1}` with pending leaf gates, a pending child-2 step and a pending custom step;
   - `routedParking: {kind: 'leaf-host'}`;
   - `routedParking: {kind: 'queue'}`;
   - no `routedParking`.
2. Verify RED.
3. Implement `SelectorInput.routedParking` in `src/conductor/src/engine/selector.ts`:
   - `child` and `leaf-host` restrict selection to `CHILD_REGION_STEPS`;
   - `queue` excludes every step after `build_review`, which includes the leaf gates, post-region custom steps and FINISH;
   - absent means the decision is unchanged.
4. Verify GREEN, commit.

**Done when:**
- [test] with `routedParking` `child` 1, `selectNextGate` returns only a `CHILD_REGION_STEPS` step and never `prd_audit`, `architecture_review_as_built`, `manual_test`, a custom step or another child's step, even when those are pending.
- [test] with `routedParking` `leaf-host`, `selectNextGate` returns only a `CHILD_REGION_STEPS` step, and never a leaf gate.
- [test] with `routedParking` `queue`, `selectNextGate` never returns a leaf gate, a post-region custom step or `finish`; with no `routedParking`, its decisions equal the existing selector fixtures.

**Files likely touched:**
- `src/conductor/src/engine/selector.ts` — `routedParking`
- `src/conductor/test/engine/selector.test.ts` — parking tests

**Dependencies:** none

### Task 24: The conductor sets parking from the marker and the queue, only for an eligible feature
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-parking.test.ts`:
   - a marker naming child 1;
   - a marker naming the leaf host;
   - no marker and no open round, but child 2 queued;
   - an empty routing state;
   - an N=1 feature under a recording git shim.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts` at the `selectNextGate` call site, only when `routingEligible`:
   - read the marker and the queue, and set `routedParking` to `child`, `leaf-host` or `queue`;
   - skip the reads entirely for an ineligible feature.
4. Verify GREEN, commit.

**Done when:**
- [test] with a marker naming child 1, the loop dispatches only child 1's region steps; with a marker naming the leaf host, only the leaf's region steps; the dispatch spy records no leaf gate in either case.
- [test] with no marker and no open round but child 2 queued, the dispatch spy records no leaf gate, no post-region custom step, no FINISH step and no publication step.
- [test] with an empty routing state, the selected step equals the pre-change selector's choice; for an N=1 feature, the recording git shim records no command naming `repairing` or `revalidate`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — parking input
- `src/conductor/test/engine/routing/conductor-routed-parking.test.ts` — conductor parking tests

**Dependencies:** Tasks 21, 23

### Task 25: The return to the leaf is recorded in the round before the round closes
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/return-to-leaf.realgit.test.ts`:
   - round `r1` whose last host settled, with no other round open and the queue empty;
   - a crash after the `switchToChild` to `feat/daemon-demo` and before the record write.
2. Verify RED.
3. Implement:
   - add `RouteRecord.leafReturn {branch, head}` to `src/conductor/src/engine/routing/route-types.ts`, with closed parsing;
   - add `returnToLeaf(stored)` to `src/conductor/src/engine/routing/routed-exit.ts`. It switches to the leaf through `switchToChild` only when HEAD is not already `feat/daemon-demo`, records `leafReturn` by compare-and-swap, and only then writes `phase: 'closed'`;
   - `advanceRound`'s `settled` arm calls it when no other round is open and the queue is empty.
4. Verify GREEN, commit.

**Done when:**
- [test] after the last host settles, HEAD is `feat/daemon-demo`, `routes/r1` carries `leafReturn` naming `feat/daemon-demo`, and the recording runner shows the `leafReturn` write before the `phase: 'closed'` write.
- [test] after the injected crash, resume records `leafReturn` with no second `switch` command (recording runner), then closes the round, and the dispatch spy records no leaf step before the close.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-types.ts` — `leafReturn`
- `src/conductor/src/engine/routing/routed-exit.ts` — `returnToLeaf`
- `src/conductor/test/engine/routing/return-to-leaf.realgit.test.ts` — return tests

**Dependencies:** Task 20

### Task 26: After the return, the leaf gates are re-pended under unchanged caps
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/return-to-leaf.realgit.test.ts`:
   - the leaf gates all `done` before the round;
   - a routed fix that changed a fixture spec `.docs/specs/<feature>.md`;
   - a kickback ledger snapshot taken before the return.
2. Verify RED.
3. Implement `rependLeafGates` in `returnToLeaf`. After `closed`, it sets `prd_audit`, `architecture_review_as_built`, `manual_test` and each post-region custom step to `pending` in the leaf's conduct state through one `applyBatch`, and writes nothing to the kickback ledger.
4. Verify GREEN, commit.

**Done when:**
- [test] after the round closes, `prd_audit`, `architecture_review_as_built`, `manual_test` and each configured post-region custom step are `pending` in the leaf's conduct state.
- [test] the kickback ledger file after the return is byte-identical to the snapshot taken before it, so every lap count and cap is unchanged.
- [test] with a fixture spec `.docs/specs/<feature>.md` changed by the fix, the next `selectNextGate` returns `prd_audit` rather than treating its prior PASS verdict as satisfied, and `prd_audit` is dispatched.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — leaf gate re-pend
- `src/conductor/test/engine/routing/return-to-leaf.realgit.test.ts` — re-pend tests

**Dependencies:** Task 25

### Task 27: A fix carried to the leaf lets the next manual-test PASS through the whitewash guard
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/routing/return-to-leaf.realgit.test.ts`. `manual_test` recorded a FAIL at the leaf's old HEAD, host 1's exit restack replays the leaf, and then `manual_test` reports PASS.
2. Verify RED.
3. Implement: the exit restack moves the leaf tip, so the existing `manual_test` whitewash guard in `artifacts.ts` sees a new HEAD. Change only what the test proves missing, for example the guard reading the pre-restack HEAD.
4. Verify GREEN, commit.

**Done when:**
- [test] the whitewash guard accepts the `manual_test` PASS recorded at the leaf's post-restack HEAD after a FAIL at the old HEAD, and `manual_test` is marked `done`.
- [test] the same PASS at the old leaf HEAD (no exit restack) is still refused by the guard.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — whitewash guard, if the test proves a gap
- `src/conductor/test/engine/routing/return-to-leaf.realgit.test.ts` — whitewash test

**Dependencies:** Task 9

### Task 28: The queue entry is typed by closure, position, gates and replay parents, and its parser fails closed
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/route-types.test.ts`:
   - a queue blob with entries for children 2 and 4 carrying `position`, `closureSha`, `gates`, `replay {oldParent, newParent}` and `state: 'queued'`;
   - a blob that lists child 2 twice;
   - a blob with entries out of position order;
   - a blob with an abbreviated `closureSha`;
   - a blob with an unknown gate or state.
2. Verify RED.
3. Implement in `src/conductor/src/engine/routing/route-types.ts`:
   - `RevalidationQueueEntry {child, position, closureSha, gates: readonly RegionGate[], replay: {oldParent, newParent}, state: 'queued'}`, where `RegionGate` is `typeof CHILD_REGION_STEPS[number]`;
   - `parseRevalidationQueueRecord` returns undefined on a duplicate child, a non-ascending position, any abbreviated SHA, an unknown gate or a state other than `queued`;
   - replace `round-admission.ts`'s hard-coded queue ref string with `revalidationQueueRefFor`.
4. Verify GREEN, commit.

**Done when:**
- [test] `parseRevalidationQueueRecord` returns entries for children 2 and 4, in that order, with every field of the extended shape, for a well-formed blob.
- [test] `parseRevalidationQueueRecord` returns undefined for a duplicate child 2, for entries ordered child 4 then child 2, for an abbreviated `closureSha` and for a gate outside `CHILD_REGION_STEPS`, so `readRevalidationQueue` reports `unreadable` and no partial generation is used.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-types.ts` — typed entry and parser
- `src/conductor/src/engine/routing/round-admission.ts` — queue ref builder
- `src/conductor/test/engine/routing/route-types.test.ts` — parser tests

**Dependencies:** none

### Task 29: A new generation merges by child, keeping the newest closure and the union of gates
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/revalidation-queue.test.ts`:
   - a queued child 2 with `test_suite`, merged with a new child-2 entry for only `build_review` at a newer closure;
   - children 4 and 2 produced by two generations of a five-position stack;
   - a host's own entry removed by the merge.
2. Verify RED.
3. Implement `mergeQueueGeneration(current, produced, {acknowledge?: ChildId})` in new `src/conductor/src/engine/routing/revalidation-queue.ts`:
   - it returns the next generation (`generation + 1`) with one entry per child, keeping the newest `closureSha` and replay tuple and the union of `gates`;
   - entries are ordered by `position`;
   - the `acknowledge` child's entry is dropped.
4. Verify GREEN, commit.

**Done when:**
- [test] merging the second child-2 entry yields exactly one child-2 entry with the newer `closureSha`, the newer replay tuple and gates `test_suite` and `build_review`.
- [test] merging children 4 and 2 yields entries ordered child 2 then child 4, and the generation is the prior generation plus one.
- [test] merging with `acknowledge: 1` drops child 1's entry and keeps every other entry unchanged.

**Files likely touched:**
- `src/conductor/src/engine/routing/revalidation-queue.ts` — new module, `mergeQueueGeneration`
- `src/conductor/test/engine/routing/revalidation-queue.test.ts` — merge tests

**Dependencies:** Task 28

### Task 30: The transition reports which closed children must re-run which gates
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-transition.test.ts`:
   - a restack that moved child 2 and changed `parseA`'s signature in `src/a.ts`;
   - child 2 with missing verdict files;
   - child 2 with an unreadable verdict;
   - a replay of child 2 proven unchanged, with every region verdict present and fresh;
   - a replay proven unchanged but with a stale `build_review` verdict.
2. Verify RED.
3. Implement `queueInvalidation` in `src/conductor/src/engine/restack/restack-transition.ts`:
   - for each moved closed child, it returns `{child, position, closureSha, gates, replay}`;
   - a missing or unreadable verdict counts as invalidated;
   - a child is skipped only when `classifyReplayGateInvalidation` preserves every region gate and each preserved verdict is present, readable and fresh under its own existing freshness check;
   - `runRestack` journals the set through `recordRoutedApplyPlan` before computing `queueNew`.
4. Verify GREEN, commit.

**Done when:**
- [test] the `parseA` signature change, in a file child 2 does not own, makes `queueInvalidation` return child 2 with `test_suite` among its gates.
- [test] missing verdict files and an unreadable verdict each make `queueInvalidation` return child 2.
- [test] a proven-unchanged replay with every region verdict present and fresh omits child 2; the same replay with a stale `build_review` verdict returns child 2 with `build_review`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-transition.ts` — `queueInvalidation`
- `src/conductor/src/engine/restack/restack-executor.ts` — journal the set before `queueNew`
- `src/conductor/test/engine/restack/restack-transition.test.ts` — invalidation tests

**Dependencies:** Task 29

### Task 31: Every restack's applied transaction writes the merged queue generation, and only then
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-queue-production.realgit.test.ts`, using a recording `GitRunner`:
   - host 1's exit restack moving child 2 with `test_suite` invalidated;
   - a `base-refresh` restack;
   - an operator-commit `feature-repair` restack;
   - a restack interrupted at `synced`, then recovered;
   - a restack that rolls back;
   - a restack that moves only the leaf;
   - routing off;
   - a raw `git update-ref` changing the queue after the journal is created.
2. Verify RED.
3. Implement:
   - `appliedTransactionLines` adds `update refs/conductor/demo/revalidate <queueNew> <queueOld>` (or a create from zero) when `routingEligible` holds and the merged generation differs from the current one;
   - the journal records `queueOld` at creation and `queueNew` at `synced`;
   - a failed applied transaction on the queue ref halts needs-human naming it (Task 5's path).
4. Verify GREEN, commit.

**Done when:**
- [test] after host 1's exit restack, the queue's next generation holds one child-2 entry with its new closure SHA, position 2, gates including `test_suite`, and its old and new replay parent; the recording runner shows the queue write only inside the `applied` transaction.
- [test] the `base-refresh` and operator-commit `feature-repair` restacks each queue every moved closed child with an invalidated gate, writing the queue only inside their own `applied` transaction, and the recovered restack's queue blob is byte-identical to the uninterrupted run.
- [test] with routing off, no command names `refs/conductor/demo/revalidate`; after a rollback, and after a restack that moves only the leaf, the queue ref keeps its prior blob (generation and entries unchanged).
- [test] after the concurrent queue change, `applied` fails, and recovery writes a `needs-human` HALT naming `refs/conductor/demo/revalidate`.
- [test] a restack moving child 2 with missing verdict files, and one changing `parseA`'s signature, each write a generation holding child 2 (with `test_suite` for the latter), while a proven-unchanged replay with every verdict present and fresh writes no child-2 entry.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — queue lines in `appliedTransactionLines`
- `src/conductor/src/engine/restack/restack-recovery.ts` — journalled `queueNew` reuse
- `src/conductor/test/engine/restack/restack-queue-production.realgit.test.ts` — production tests

**Dependencies:** Tasks 4, 30

### Task 32: A host's exit acknowledges its own queue entry and records the outcome
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`:
   - child 1 queued when it became host 1, leaving through the exit restack;
   - child 1 queued, leaving through the no-commit exit.
2. Verify RED.
3. Implement:
   - `appliedTransactionLines` merges with `acknowledge: host` and appends a `child_revalidated` outcome `fixed` event to the queue outbox;
   - the no-commit transaction adds the queue compare-and-swap dropping the host's entry, with a `child_revalidated` outcome `passed` outbox event, through a new `update-queue {previous, next}` op in `writeRoutingTransaction`.
4. Verify GREEN, commit.

**Done when:**
- [test] after host 1's exit restack `applied`, the queue holds no child-1 entry, that removal happened in the `applied` transaction, and the queue outbox holds one `child_revalidated` event for child 1 with outcome `fixed`.
- [test] after host 1's no-commit exit, the queue holds no child-1 entry, removed in the same compare-and-swap that marked host 1 `done`, and the queue outbox holds one `child_revalidated` event for child 1 with outcome `passed`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — host acknowledgement in applied lines
- `src/conductor/src/engine/routing/route-record-store.ts` — `update-queue` op
- `src/conductor/src/engine/routing/routed-exit.ts` — no-commit acknowledgement
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — acknowledgement tests

**Dependencies:** Tasks 8, 31

### Task 33: The lowest queued child becomes a revalidate round, marker first, before any region entry
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/revalidate-round.realgit.test.ts`:
   - child 2 queued, with no marker and no round holding a pending child host, through `runStackPreflight`;
   - children 2 and 4 queued;
   - an audit round whose child hosts settled and whose leaf host is pending, with child 2 queued;
   - a crash after the `revalidate` record is created in `prepared` and before the marker.
2. Verify RED.
3. Implement `consumeLowestQueued` in `src/conductor/src/engine/routing/revalidation-queue.ts`:
   - it allocates `nextRoundId`, creates a `revalidate` record in `prepared` for `entries[0]`, then sets the marker and opens the round in one transaction;
   - it records no `kickback` event;
   - `runStackPreflight` calls it after `reconcileRounds` when no marker exists, no route record has a pending child host, and the queue has entries;
   - `selectNextHost`'s `queue` arm calls it before the leaf host is admitted;
   - `reconcileRounds`' existing `prepared` arm deletes an unmarked record.
4. Verify GREEN, commit.

**Done when:**
- [test] the preflight creates `routes/r2` of kind `revalidate` for child 2 and the marker names child 2 and `r2`, and the recording runner shows the marker write before any `switch`, `checkout` or branch update.
- [test] with children 2 and 4 queued, no round for child 4 exists until child 2's entry is acknowledged.
- [test] with the audit round's leaf host pending and child 2 queued, child 2's `revalidate` round is created and the leaf host stays `pending`.
- [test] after the crash between the `prepared` record and the marker, resume deletes the `prepared` record, no branch or worktree change happened, and child 2 is still queued.

**Files likely touched:**
- `src/conductor/src/engine/routing/revalidation-queue.ts` — `consumeLowestQueued`
- `src/conductor/src/engine/restack/stack-preflight.ts` — standalone consumption entry
- `src/conductor/src/engine/routing/routed-exit.ts` — queue arm of the return order
- `src/conductor/test/engine/routing/revalidate-round.realgit.test.ts` — consumption tests

**Dependencies:** Tasks 19, 25, 31

### Task 34: A revalidate region restages only its queued gates, once, with no lap and one credit
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts`:
   - `enterHostRegion` for child 2's `revalidate` round whose entry gates are `test_suite` and `acceptance_specs`;
   - a second entry after a crash;
   - a `revalidating` execution child with no `revalidate` round;
   - a BUILD dispatch after a failing gate in the round, with the ledger and receipt read.
2. Verify RED.
3. Implement the `revalidate` arm of `restageHostRegion` in `src/conductor/src/engine/routing/host-region-entry.ts`:
   - it sets only the entry's gates `pending`, keyed by `(roundId, generation)` so it runs once;
   - routed acceptance runs `verifyGreenAcceptance` with `mode: verify-green`;
   - it grants `routedRepairCredit` for the round and settles no receipt (`settleRoundAtDispatch` returns early for kind `revalidate`);
   - `enterHostRegion` refuses a `revalidating` source with no marker naming a `revalidate` round.
4. Verify GREEN, commit.

**Done when:**
- [test] entering child 2's `revalidate` region sets only `test_suite` and `acceptance_specs` to `pending`, leaves `build` and `build_review` at their prior status, and acceptance runs `verifyGreenAcceptance` against child 2's existing specs, emitting `acceptance_red` with `mode` `verify-green`.
- [test] a second entry of the same round and generation restages nothing (state store spy records no batch).
- [test] a `revalidating` execution child with no `revalidate` round is refused, and the dispatch spy records no region step.
- [test] after a BUILD dispatch in the round, no receipt is settled, no `prd_audit` or as-built lap and no growth is charged, and child 2's ledger holds `routedRepairCredit` for the round.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — revalidate arm
- `src/conductor/src/engine/routing/round-receipt.ts` — no settlement for revalidate rounds
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — revalidate entry tests

**Dependencies:** Task 33

### Task 35: The revalidation review base grades the replayed contribution against the new parent
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/child-cursor.test.ts` and `src/conductor/test/engine/build-review-inputs.routed.test.ts`. Child 2's `revalidate` round is open, and its queue entry carries `replay {oldParent, newParent}`.
2. Verify RED.
3. Implement:
   - a `revalidation` kind of `ChildBaseResolution` in `src/conductor/src/engine/child-cursor.ts`. `resolveChildBase` checks the round kind and returns the entry's `newParent` for a `revalidate` round with no fix yet;
   - `baseKind: 'revalidation'` in `src/conductor/src/engine/build-review-inputs.ts`, carried into testQuality materialisation.
4. Verify GREEN, commit.

**Done when:**
- [test] `resolveChildBase` for child 2 in its `revalidate` round returns `{kind: 'revalidation', sha: <entry newParent>}`.
- [test] `build_review` inputs for child 2 carry `baseKind: 'revalidation'` and the same SHA as the testQuality base.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts` — `revalidation` base kind
- `src/conductor/src/engine/build-review-inputs.ts` — `baseKind`
- `src/conductor/test/engine/child-cursor.test.ts` — base test
- `src/conductor/test/engine/build-review-inputs.routed.test.ts` — inputs test

**Dependencies:** Task 34

### Task 36: A fresh PASS acknowledges the entry in one transaction, guarded by generation and closure
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/revalidate-round.realgit.test.ts`:
   - child 2's re-validation PASS with no commits and fresh verdicts while child 4 is still queued;
   - the same PASS as the last entry with no other round open;
   - a newer generation replacing child 2's entry during validation;
   - `closed/c2` moved during validation.
2. Verify RED.
3. Implement `acknowledgeQueueEntry` in `src/conductor/src/engine/routing/revalidation-queue.ts`, called from `requestRoutedExit`'s no-commit arm for a `revalidate` round:
   - one `writeRoutingTransaction` compare-and-swaps the queue on `(generation, closureSha)`, after each required gate's verdict passes its existing freshness check;
   - it removes the entry, deletes the marker, appends `child_revalidated` outcome `passed` to the queue outbox, and closes the round;
   - when the queue becomes empty and no other round is open, it leaves the round `open` for `returnToLeaf` (C8).
4. Verify GREEN, commit.

**Done when:**
- [test] with child 4 still queued, the recording runner shows one `update-ref --stdin` transaction that removes child 2's entry, closes `routes/r2`, deletes the marker and appends one `child_revalidated` event with outcome `passed`.
- [test] as the last entry with no other round open, the transaction removes the entry, deletes the marker and appends the event, while `routes/r2` stays `open`; the round becomes `closed` only after `returnToLeaf` records `leafReturn` naming `feat/daemon-demo` in it.
- [test] with a newer generation, the compare-and-swap fails and child 2 is still queued; with `closed/c2` moved, it fails, and the entry, `routes/r2` and the marker are unchanged.

**Files likely touched:**
- `src/conductor/src/engine/routing/revalidation-queue.ts` — `acknowledgeQueueEntry`
- `src/conductor/src/engine/routing/routed-exit.ts` — revalidate exit
- `src/conductor/test/engine/routing/revalidate-round.realgit.test.ts` — acknowledgement tests

**Dependencies:** Task 35

### Task 37: A failing re-validation is fixed on the child's own branch and leaves through its own exit
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/revalidate-round.realgit.test.ts`:
   - child 2's `test_suite` fails, then a commit on `feat/c2/demo` fixes it;
   - `build_review` grading that fix;
   - child 2's region caps exhausted by repeated failures.
2. Verify RED.
3. Implement:
   - in a `revalidate` round, a passing region with a commit takes `requestRoutedExit`'s restack arm originating at child 2, and `appliedTransactionLines` acknowledges child 2 with outcome `fixed`;
   - `resolveChildBase` returns `revalidation-fix` with the tip pinned in the route record's `entry` at region entry;
   - cap exhaustion keeps today's region-cap halt naming child 2 and leaves the entry queued.
4. Verify GREEN, commit.

**Done when:**
- [test] after the fix, the exit restack's journal names origin child 2, and child 2's entry is removed only in that restack's `applied` transaction, with one `child_revalidated` event of outcome `fixed`.
- [test] `resolveChildBase` returns `{kind: 'revalidation-fix', sha: <entry pinnedBase>}`, and the `build_review` inputs carry that SHA, not the closure's parent.
- [test] with child 2's region caps exhausted, `.pipeline/HALT` is `needs-human` naming child 2, and the queue still holds child 2's entry.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — revalidate fix exit
- `src/conductor/src/engine/child-cursor.ts` — `revalidation-fix` kind
- `src/conductor/src/engine/build-review-inputs.ts` — `baseKind`
- `src/conductor/test/engine/routing/revalidate-round.realgit.test.ts` — failure path tests

**Dependencies:** Task 36

### Task 38: Re-validation of four children that each fix and restack terminates
**Story:** 9
**Type:** negative-path

**Steps:**
1. Write a failing driven-loop test in `src/conductor/test/engine/routing/revalidation-termination.test.ts`. Four queued children each fail once, fix and restack, under a scripted provider.
2. Verify RED.
3. Implement whatever the test proves missing in the bound: `checkCascadeCap` per origin, the region caps, and dedup in `mergeQueueGeneration`.
4. Verify GREEN, commit.

**Done when:**
- [test] the driven loop halts or converges within a step budget derived from `MAX_RESTACK_CASCADES_PER_CHILD` times the number of origins plus each child's region caps, and every child's cascade count stays at or below `MAX_RESTACK_CASCADES_PER_CHILD`.
- [test] the queue never holds two entries for the same child in any generation observed during the run.

**Files likely touched:**
- `src/conductor/test/engine/routing/revalidation-termination.test.ts` — driven-loop test

**Dependencies:** Task 37

### Task 39: A requested base refresh is deferred while the queue has entries
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-routing.test.ts`:
   - a base refresh requested while the queue holds child 2;
   - a queue ref with zero entries;
   - an unreadable queue ref;
   - the queue drained with no open round.
2. Verify RED.
3. Implement in `src/conductor/src/engine/routing/round-admission.ts`: `routedRoundOpen` parses the queue through `readRevalidationQueue`. It is open when the queue has entries or is unreadable, and not open for a parsed queue with zero entries. The preflight's existing deferral emits `deferred-base-refresh` and returns `clear`, leaving REKICK unconsumed.
4. Verify GREEN, commit.

**Done when:**
- [test] with child 2 queued and a base refresh due, the preflight moves no ref, emits one `restack_refused` with reason `deferred-base-refresh`, and does not call `consumeRekick`.
- [test] with a zero-entry queue ref and every route record `closed`, a due base refresh is not deferred (`routedRoundOpen` returns false and a `base-refresh` restack runs); with an unreadable queue ref it is deferred with `deferred-base-refresh`.
- [test] after the queue drains with no open round, the next preflight with the retained base refresh runs a `base-refresh` restack.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — queue-aware `routedRoundOpen`
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — deferral tests

**Dependencies:** Task 28

### Task 40: The follow-on base refresh of an automatic repair is suppressed when the repair queued a child
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-deferral.realgit.test.ts`:
   - an operator-commit repair with a base-refresh follow-on whose `applied` transaction queued child 2, through the preflight path;
   - the same repair interrupted at `applied` with a follow-on, then recovered;
   - with no queued child and no open round, a follow-on that runs exactly as today.
2. Verify RED.
3. Implement (operator decision 2026-10-23: re-arm on deferral; today's consume-before-journal ordering on the normal path is unchanged):
   - in `src/conductor/src/engine/restack/stack-preflight.ts`, after the repair applies and before the existing `consumeRekick` call, check `routedRoundOpen`. When it is open, call `recoverRestackJournal` with `suppressFollowOn: true`, emit `deferred-base-refresh`, and return without calling `consumeRekick`;
   - add an optional `rearmRekick` to the preflight options and forward it to `recoverRestackJournal`. In `src/conductor/src/engine/restack/restack-recovery.ts`'s `applied`-with-follow-on row, check `routedRoundOpen` before `runRestack`. When it is open, call `rearmRekick` first, then suppress the follow-on (deleting the journal) and emit `deferred-base-refresh`. Writing the sentinel before the journal is deleted means a crash between the two leaves both, and the next preflight defers again;
   - in `src/conductor/src/daemon-cli.ts`, pass a `rearmRekick` that writes the `.pipeline/REKICK` sentinel (the same `rekickPath` its `consumeRekick` unlinks).
4. Verify GREEN, commit.

**Done when:**
- [test] on the preflight path, no `base-refresh` restack runs, the repair journal ref is deleted, one `restack_refused` with reason `deferred-base-refresh` is emitted, and the REKICK sentinel file still exists.
- [test] on the preflight path, `consumeRekick` is never called.
- [test] on the recovery path, no `base-refresh` restack runs, one `restack_refused` with reason `deferred-base-refresh` is emitted, the repair journal ref is deleted, `rearmRekick` is called before that deletion (recorded call order), and the REKICK sentinel file exists after recovery.
- [test] with no queued child and no open round, the follow-on `base-refresh` restack runs and `consumeRekick` is called once, after the journal names the follow-on and before the `base-refresh` restack, as today.
- [test] the daemon resume wiring in `daemon-cli.ts` passes a `rearmRekick` that writes `.pipeline/REKICK` in the feature worktree.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — follow-on deferral before `consumeRekick`, `rearmRekick` option
- `src/conductor/src/engine/restack/restack-recovery.ts` — recovery follow-on deferral that re-arms REKICK first
- `src/conductor/src/daemon-cli.ts` — `rearmRekick` wiring
- `src/conductor/test/engine/restack/restack-deferral.realgit.test.ts` — follow-on tests

**Dependencies:** Task 39

### Task 41: The queue outbox drains at least once, and an empty drained queue ref is deleted
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/route-outbox.test.ts`:
   - a queue with no entries and one outbox event;
   - a crash after the queue transaction that recorded child 2's outcome and before the drain;
   - the same event persisted twice;
   - a drain attempted while a restack journal is at `synced`.
2. Verify RED.
3. Implement `drainQueueOutbox` in `src/conductor/src/engine/routing/route-record-store.ts`, called from `drainRoutingOutboxes`:
   - it persists the head event, then compare-and-swaps the queue without it;
   - when that leaves no entries and no outbox, it deletes the ref in the same compare-and-swap;
   - it goes through `writeRoutingTransaction`, so a non-terminal journal refuses it (A-2).
4. Verify GREEN, commit.

**Done when:**
- [test] draining the last event of a queue with no entries deletes `refs/conductor/demo/revalidate` in the same compare-and-swap that removes the event.
- [test] after the injected crash, the next `runStackPreflight` persists the `child_revalidated` event, and `.pipeline/events.jsonl` holds it exactly once after a second drain.
- [test] with the journal at `synced`, `drainQueueOutbox` returns `restack-journal-open` and the queue ref keeps its prior blob.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — `drainQueueOutbox`
- `src/conductor/test/engine/routing/route-outbox.test.ts` — queue outbox tests

**Dependencies:** Tasks 3, 28

### Task 42: Routing is on by default for stacked features, and an explicit false opts out
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts` and `src/conductor/test/engine/remediation-routing.test.ts`:
   - a config with no `stacked_prs.route_whole_feature_fixes` key;
   - a config with no `stacked_prs` block;
   - a config setting it `false` on a three-child stack whose whole-feature gate fails.
2. Verify RED.
3. Implement in `src/conductor/src/engine/config.ts`: both default sites set `route_whole_feature_fixes` to `true`. The implementation PR declares `Release-Disposition: note`, `Release-Category: Changed`, `Release-Semver: minor` (C10). This task writes no `CHANGELOG.md`.
4. Verify GREEN, commit.

**Done when:**
- [test] `loadConfig` resolves `stacked_prs.route_whole_feature_fixes` to `true` with the key absent and with the `stacked_prs` block absent, and `routingSettingOn` returns true for both.
- [test] with the key set `false`, `loadConfig` resolves `false`, and the three-child stack's remediation records no command naming `routes`, `repairing` or `revalidate` and the same leaf rewind as the routing-off fixture.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — default `true`
- `src/conductor/test/engine/config.test.ts` — default tests
- `src/conductor/test/engine/remediation-routing.test.ts` — opt-out parity

**Dependencies:** Tasks 33, 39

### Task 43: Each re-validation outcome is one typed event on the spine, and N=1 stays untouched
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/route-outbox.test.ts` and `src/conductor/test/engine/n1-golden-routing-guard.test.ts`:
   - `childRevalidatedEvent` for child 2;
   - the persister given the same `child_revalidated` event twice;
   - the N=1 golden lap with no `stacked_prs` key.
2. Verify RED.
3. Implement:
   - `child_revalidated.outcome` becomes the closed union of `passed` and `fixed` in `src/conductor/src/types/events.ts`, and `childRevalidatedEvent(child, generation, closureSha, outcome)` goes in `src/conductor/src/engine/routing/routing-events.ts`. Every queue outbox write uses it;
   - add the exhaustive outcome switch to `routing-exhaustive-switch.test.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] after child 2 is re-validated, `.pipeline/events.jsonl` holds exactly one `child_revalidated` event naming child 2, the queue generation, the closure SHA and outcome `passed` or `fixed`.
- [test] the persister given the same `child_revalidated` `eventId` twice writes it once to `.pipeline/events.jsonl`.
- [test] the N=1 golden routing guard passes with the new default: an N=1 remediation with no `stacked_prs` key records no git command naming `routes`, `repairing` or `revalidate`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — typed outcome
- `src/conductor/src/engine/routing/routing-events.ts` — `childRevalidatedEvent`
- `src/conductor/test/engine/routing/route-outbox.test.ts` — event tests
- `src/conductor/test/engine/n1-golden-routing-guard.test.ts` — default-on guard
- `src/conductor/test/structural/routing-exhaustive-switch.test.ts` — outcome switch

**Dependencies:** Tasks 36, 41

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic, and no task depends on a later slice
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-rem-1: Apply inherited rem-* block normalization in restack-transition.ts outcomeFor/queueInvalidation and classifyReplayGateInvalidation, with a fixture test proving child 2's replay outcome is `unchanged` and wouldInvalidate is empty
**Gate:** prd-audit
**Rationale:** Implementation gap inside approved Task 18: only restack-ownership.ts strips inherited rem-* blocks; restack-transition.ts outcomeFor/queueInvalidation and classifyReplayGateInvalidation still compare raw plans, so the replay proof is not `unchanged`. No architectural decision needed.
**Criterion:** S4.4
**Parent task:** 18
**Done when:**
- [test] S4.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-2: Call advanceRound (via round reconciliation) from the conductor's in-loop routed exit after requestRoutedExit settles a host, and add advanceRound tests for the currentHostIndex+admitted single CAS
**Gate:** prd-audit
**Rationale:** advanceRound exists but is only reached from runStackPreflight; the in-loop routed exit (conductor.ts ~15261-15295) re-resolves the cursor without advancing the round. Task 20 admits wiring and testing advanceRound; approved ADR is authoritative.
**Criterion:** S5.1
**Parent task:** 20
**Done when:**
- [test] S5.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-3: Test advanceRound admits the leaf host with marker in one CAS when child hosts are settled and queue is empty, reached from the in-loop exit path
**Gate:** prd-audit
**Rationale:** Same defect as S5.1: next-host/leaf-host admission happens only from preflight. Covered by Task 20's leaf-host admission done-whens.
**Criterion:** S5.2
**Parent task:** 20
**Done when:**
- [test] S5.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-4: Implement and test advanceRound closure rules: close in the same CAS when every host settled and another round open, or when queue has entries (no leafReturn); keep open on leaf host otherwise
**Gate:** prd-audit
**Rationale:** Round closure is unreachable from the in-loop exit and untested. Task 20 specifies closure semantics (closed in same CAS when another round is open or queue non-empty before consumption; otherwise stay open for leaf return).
**Criterion:** S5.3
**Parent task:** 20
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-5: Reach returnToLeaf from the in-loop exit path, perform it only when no other round is open, record leafReturn before close, and re-pend prd_audit/architecture_review_as_built/manual_test plus configured post-region custom steps; add Task 25/26 tests
**Gate:** prd-audit
**Rationale:** returnToLeaf is reachable only from preflight, ignores other open rounds and omits configured post-region custom steps. Tasks 25 and 26 admit the full return/re-pend behavior.
**Criterion:** S6.1
**Parent task:** 25
**Done when:**
- [test] S6.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-6: In routed-exit.ts no-commit branch, remove the host's queue entry and append child_revalidated `passed` in the same CAS that marks the host done regardless of round kind; test it
**Gate:** prd-audit
**Rationale:** The no-commit exit acknowledges the queue entry only for revalidate rounds; Task 32 requires the host's own entry be removed in the same CAS that marks it done with a child_revalidated `passed` event for any round kind.
**Criterion:** S7.8
**Parent task:** 32
**Done when:**
- [test] S7.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-6 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-7: Make acknowledgeQueueEntry close routes/r2 in the ack transaction unless the queue empties AND no other round is open; test both branches per Task 36
**Gate:** prd-audit
**Rationale:** acknowledgeQueueEntry's closure decision checks only queue length, not other open rounds, contrary to Task 36's last-entry exception.
**Criterion:** S8.5
**Parent task:** 36
**Done when:**
- [test] S8.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-7 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-8: Pin queue generation (blob identity) and closed/cN at revalidate admission and CAS against them in acknowledgeQueueEntry; test newer-generation and moved closed/c2 failures leave entry, route and marker unchanged
**Gate:** prd-audit
**Rationale:** acknowledgeQueueEntry CASes against a freshly re-read generation rather than the one pinned at admission; Task 36 requires generation and closure guards so a newer generation fails the CAS.
**Criterion:** S8.9
**Parent task:** 36
**Done when:**
- [test] S8.9 is satisfied by this task.
- The repair for task rem-prd-audit-rem-8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-9: In stack-preflight.ts evaluate the due base refresh deferral (emit restack_refused deferred-base-refresh) before or alongside queue consumption; add Task 39's three tests
**Gate:** prd-audit
**Rationale:** Verified in stack-preflight.ts: consumeLowestQueued returns navigate-host before the baseRefreshDue && routedRoundOpen check, so no deferred-base-refresh is emitted. Task 39 admits reordering and tests.
**Criterion:** S10.1
**Parent task:** 39
**Done when:**
- [test] S10.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-9 is committed and its targeted tests pass.

### Task rem-as-built-rem-10: Propagate the exit's typed failure (with existing HALT) from routed-exit.ts instead of collapsing to 'halted', and skip haltChildRegionRefusal when a HALT already exists; test cascade-cap, publication, foreign-round and changed-ref details survive
**Gate:** as-built
**Rationale:** Conforming fix under ADR D13: the conductor's exit handler overwrites detailed HALTs via haltChildRegionRefusal. Tasks 9/13/14/12/5 require the originating HALT (cascade-cap runbook, publication, foreign-round, changed-ref) survive.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 13
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 13 is satisfied by this task.
- The repair for task rem-as-built-rem-10 is committed and its targeted tests pass.

### Task rem-as-built-rem-11: Remove the leaf-target exclusion before requestRoutedExit in conductor.ts for routed leaf hosts, and test the leaf host region exit calls requestRoutedExit once with no advanceChildRegion
**Gate:** as-built
**Rationale:** conductor.ts excludes leaf targets before requestRoutedExit, making the leaf-host exit unreachable; Task 22's second done-when requires the region exit for the leaf host call requestRoutedExit once.
**Parent task:** 22
**Governing clause:** Task 22
**Done when:**
- Task 22 is satisfied by this task.
- The repair for task rem-as-built-rem-11 is committed and its targeted tests pass.

### Task rem-as-built-rem-12: Implement D6 in routed-exit.ts: close settled round (no leafReturn) when queue has entries or another round is open; leaf-return only when queue empty and no other round open
**Gate:** as-built
**Rationale:** ADR D6 distinction (close before queue consumption vs record final leaf return) is approved; code leaves settled rounds open when queue has entries and always leaf-returns. Implementation drift within Tasks 20/25.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 6
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 6 is satisfied by this task.
- The repair for task rem-as-built-rem-12 is committed and its targeted tests pass.

### Task rem-as-built-rem-13: Re-pend configured post-region custom steps with the three leaf gates and invalidate their prior satisfied verdicts so selectNextGate dispatches prd_audit; add Task 26 tests including byte-identical kickback ledger
**Gate:** as-built
**Rationale:** Task 26 requires configured post-region custom steps re-pended and prior PASS verdicts not treated as satisfied; current code hardcodes three gates and retains verdicts accepted by selector.ts.
**Parent task:** 26
**Governing clause:** Task 26
**Done when:**
- Task 26 is satisfied by this task.
- The repair for task rem-as-built-rem-13 is committed and its targeted tests pass.

### Task rem-as-built-rem-14: In returnToLeaf restage leaf gates before writing phase closed, fail closed on state-read/mutation errors, and make resume re-run restaging for a recorded leafReturn on an open round; add injected-crash test
**Gate:** as-built
**Rationale:** ADR D15 crash-safety: round is closed before leaf gates are restaged and failures are ignored, losing the obligation on resume. Tasks 25/26 admit ordering restaging before close and failing closed.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 15
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 15 is satisfied by this task.
- The repair for task rem-as-built-rem-14 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg3-s4-4: In restack-transition.ts, normalize inherited rem-* plan blocks before compareReplayTree (so a plan-only conflict cannot yield 'unproved'), and restrict the fallback relevant-path set to child-owned paths rather than oldTip..newSha. Add a fixture test where child 2 and its new parent both append rem blocks and the parent also changes code, asserting the replay outcome is 'unchanged' and wouldInvalidate is empty
**Gate:** prd-audit
**Rationale:** Conforming implementation gap within approved scope (verified by audit evidence, ~90%): normalizedReplayComparison in restack-transition.ts only normalizes a 'changed' compareReplayTree result. When both child 2 and its new parent appended rem-* plan blocks, merge-tree conflicts and returns 'unproved', which skips normalization. The fallback path set also includes the parent's own code changes. Task rem-prd-audit-rem-1 admits the repair, and no architectural decision is needed.
**Criterion:** S4.4
**Parent task:** rem-prd-audit-rem-1
**Done when:**
- [test] S4.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg3-s4-4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg3-s6-1: In conductor.ts, after a routed exit whose reconciliation records leafReturn, rebind state/persistedStateSnapshot/stateStore to the leaf via activateChildRegionState (or reload from disk) before selecting the next gate. Add Task 25/26 tests proving the re-pended prd_audit/architecture_review_as_built/manual_test and post-region custom steps are pending in memory and the next state write raises no CAS mismatch
**Gate:** prd-audit
**Rationale:** Conforming wiring defect (verified ~90%). In the in-loop exit, returnToLeaf re-pends gates on disk, but the conductor keeps its in-memory state, persistedStateSnapshot and stateStore bound to the previous host's child store. Task rem-prd-audit-rem-5 (Tasks 25/26) admits rebinding and the missing tests.
**Criterion:** S6.1
**Parent task:** rem-prd-audit-rem-5
**Done when:**
- [test] S6.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg3-s6-1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg3-s6-8: In conductor.ts/selector.ts, when routing parking (a marker, an open round or a non-empty queue) excludes every gate, return a parked/consume-queue decision instead of 'done': no .pipeline/DONE and no loop_converged. Ensure no leaf gate dispatches via the linear index while the queue is non-empty. Add Task 24 tests: child 2 queued with no marker records no leaf gate, no post-region custom step, no FINISH or publication step, and no DONE
**Gate:** prd-audit
**Rationale:** Verified at conductor.ts: reconciled.kind 'deferred' sets i = indexOf('prd_audit') - 1. This lets the linear loop dispatch a leaf gate past the parking-aware selector. A fully parked selector returns 'done', which writes DONE. Task 24 admits correct parking behavior. This needs no decision.
**Criterion:** S6.8
**Parent task:** 24
**Done when:**
- [test] S6.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg3-s6-8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg3-s7-8: In revalidation-queue.ts acknowledgeQueueEntry (or the routed-exit.ts no-commit branch), close the round only when its kind is 'revalidate' and no host remains pending. For an audit round, mark the host done, remove its entry and append child_revalidated 'passed' in one CAS while leaving the round open. Add a test of an audit round with queued host 1 and pending later hosts, asserting the round stays open and the next host is admitted
**Gate:** prd-audit
**Rationale:** Verified in revalidation-queue.ts: acknowledgeQueueEntry writes phase 'closed' unless leavesRoundOpen, without regard to round kind. An audit round whose queued host 1 exits with no commit is therefore closed while later hosts are still pending. Task rem-prd-audit-rem-6 admits the fix.
**Criterion:** S7.8
**Parent task:** rem-prd-audit-rem-6
**Done when:**
- [test] S7.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg3-s7-8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg3-s8-8: In the conductor.ts routed-exit branch, when reconcileRounds returns 'deferred' because advanceRound yielded to the queue, call consumeLowestQueued (marker first) and enter the resulting revalidate host region instead of jumping to prd_audit. Add the Task 33 test: with the audit round's leaf host pending and child 2 queued, child 2's revalidate round is created in the same run and the leaf host stays pending
**Gate:** prd-audit
**Rationale:** Verified: consumeLowestQueued is called only from stack-preflight.ts, and the in-loop 'deferred' branch jumps to prd_audit. Task 33 requires that the lowest queued child becomes a revalidate round. That requires calling it from the in-loop path too.
**Criterion:** S8.8
**Parent task:** 33
**Done when:**
- [test] S8.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg3-s8-8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg3-s8-11: In conductor.ts enterRoutedHostRegion, add a host admission guard: a 'revalidating' execution child is admitted only when a marker names an open 'revalidate' round for that child. Otherwise refuse, or consume the queue first, and dispatch no region step. Add the Task 34 test: a revalidating child with no revalidate round is refused and the dispatch spy records no region step
**Gate:** prd-audit
**Rationale:** The audit cites code paths (child-cursor.ts:454, conductor.ts:7612/824) showing that a 'revalidating' source enters the region without a revalidate round (~85%). Task 34 explicitly requires that refusal, so this is conforming BUILD work.
**Criterion:** S8.11
**Parent task:** 34
**Done when:**
- [test] S8.11 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg3-s8-11 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-vg3-s11-2: In the conductor.ts build_review region-exit guard, restore the leaf exclusion for non-routed sources: admit leaf targets only when the execution source is 'routed-host', so an ordinary cursor leaf proceeds to whole-feature gates without advanceChildRegion/closeChild. Add a regression test: a routing-off stacked leaf completing its region records no advanceChildRegion and no closeChild call
**Gate:** prd-audit
**Rationale:** Verified: the build_review region-exit guard in conductor.ts now gates only on activeChildRequiresClosure. An ordinary cursor leaf therefore falls through to advanceChildRegion/closeChild. The rem-as-built-rem-11 repair overreached its approved scope (routed leaf hosts only), so the guard must be narrowed.
**Criterion:** S11.2
**Parent task:** rem-as-built-rem-11
**Done when:**
- [test] S11.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-vg3-s11-2 is committed and its targeted tests pass.

### Task rem-as-built-rem-vg3-ab-1: In revalidation-queue.ts acknowledgeQueueEntry, include a 'verify refs/conductor/<slug>/closed/c<host> <closureSha>' op in the same writeRoutingTransaction (add a verify-ref op kind if absent), so a closure change makes the whole update-ref --stdin fail. Add the Task 36 test: moving closed/c2 between the read and the transaction leaves the entry, routes/r2 and the marker unchanged
**Gate:** as-built
**Rationale:** Verified in revalidation-queue.ts: the closed/cN rev-parse check runs before writeRoutingTransaction, whose ops cover only the record, marker and queue. Task 36 requires the CAS to fail when closed/c2 moves, so the closure ref must join the transaction.
**Parent task:** 36
**Governing clause:** Task 36
**Done when:**
- Task 36 is satisfied by this task.
- The repair for task rem-as-built-rem-vg3-ab-1 is committed and its targeted tests pass.

### Task rem-as-built-rem-vg3-ab-2: In conductor.ts, remove 'deferred' from the routed-exit branch condition that jumps to prd_audit. Route 'deferred' through queue consumption or the parking-aware selector, and jump to whole-feature gates only on 'none'/'aborted' with an empty queue and no open round. Add a test that a deferred reconciliation never dispatches prd_audit while a queue entry exists
**Gate:** as-built
**Rationale:** This is the same defect as S6.8/S8.8, verified in conductor.ts: 'deferred' jumps to prd_audit. ADR decision 13 is approved and authoritative, so this is conforming implementation work. This task is the guard against the branch's reintroduction, distinct from the S8.8 queue-consumption wiring.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 13
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 13 is satisfied by this task.
- The repair for task rem-as-built-rem-vg3-ab-2 is committed and its targeted tests pass.

### Task rem-as-built-rem-vg3-ab-3: Add a conductor.ts test pairing both leaf cases: a routed leaf host's build_review region exit calls requestRoutedExit once with no advanceChildRegion, and a cursor-selected leaf calls neither requestRoutedExit nor advanceChildRegion/closeChild. Adjust the guard so both pass
**Gate:** as-built
**Rationale:** Same root cause as S11.2, verified in conductor.ts. Task 22 governs the routed leaf exit only. Ordinary leaves must keep their exclusion from closure and advancement. This task adds the routed-leaf positive test to pair with the S11.2 regression.
**Parent task:** 22
**Governing clause:** Task 22
**Done when:**
- Task 22 is satisfied by this task.
- The repair for task rem-as-built-rem-vg3-ab-3 is committed and its targeted tests pass.
