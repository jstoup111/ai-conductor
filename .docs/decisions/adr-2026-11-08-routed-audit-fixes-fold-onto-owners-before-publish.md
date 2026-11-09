# ADR: Routed audit fixes run on the leaf and fold onto their owners once, before publish

**Date:** 2026-11-08
**Status:** APPROVED
**Deciders:** operator (James Stoup)

## Context

#3653. In a stacked feature, the whole-feature gates (`prd_audit`, `architecture_review_as_built`,
`manual_test`, post-region custom steps) open routed `audit` rounds. Each round builds every fix on its
host child. If the host is not the leaf and it committed, its routed exit restacks every child above
it (`adr-2026-10-12-routed-whole-feature-repair` decision 13). Each restacked closed child whose gates
went stale is then re-validated in its own `revalidate` round, and a fix made there restacks again
(decision 14). The gem_miner feature `web-game-where-a-player-mines-gems-sells-them-upgr` (L tier,
five children) spent $68.55 on 33 restack resolver runs, 27% of its $253.90, over four audit rounds,
and parked overnight on restack halts. The fixes themselves were small. The cost came from placing
each round's fixes low and propagating them up the stack every round.

Operator constraints: at publish, every fix must be in the PR of the child that owns its code, and
the existing routing machinery (owners, hosts, rounds, receipts) is reused, not unwound.

`adr-2026-10-12-routed-whole-feature-repair` rejected "fix on the leaf, then sink the commits down"
(its Option C) for four reasons:
1. the owning child never builds or tests the fix;
2. the leaf holds every child's code, so it cannot detect a missing prerequisite;
3. it adds a second history transformation beside the journaled replay;
4. it violates "recorded before mutation".

This ADR adopts a form of that option and answers each objection (decisions 7 to 10).

**Verified facts at the spec base** (`1afb534ca6`; engine paths under `src/conductor/src/engine/`):
- **Per-host exits restack.** `requestRoutedExit` (`routing/routed-exit.ts`) calls
  `runRestack({cause: 'feature-repair', routed})` for every non-leaf host whose tip moved past its
  closure. `queueInvalidation` (`restack/restack-transition.ts`) queues each moved closed child, and
  `consumeLowestQueued` (`routing/revalidation-queue.ts`) turns each queued child into a `revalidate`
  round.
- **The leaf host never restacks.** `requestRoutedExit` returns before the restack for a leaf host.
- **Publication only checks.** `establishChildPrs` (`finish-publication-production.ts`) reads the
  closure refs, verifies ancestry (`verifyChildChainToLeaf`) and pushes. It neither restacks nor
  re-validates.
- **The FINISH `rebase` step.** On a stacked feature, `runRebaseStepBody` (`conductor.ts`) runs the stack
  preflight, then a `base-refresh` restack. It refuses with `deferred-base-refresh` while a round is
  open. It does not read the revalidation queue: a queued child is reached through the selector's
  `queue` parking and the shared admission helper.
- **Identical leaf trees keep leaf verdicts.** In `applyRestackTransition`, `outcomeFor` diffs the
  leaf's old and new tips. An empty diff, after rem-block normalization, is `kind: 'noop'`, so no
  leaf verdict is invalidated (`restack/restack-transition.ts`).
- **The leaf return re-pends regardless.** `returnToLeaf` calls `restageLeafGates`
  (`routing/routed-exit.ts`), which re-pends every whole-feature gate whatever the leaf's tree.
- **Plans are one file per feature.** A stacked feature has one plan file, `.docs/plans/<slug>.md`,
  read at the same path on each child's branch (`conductor.ts` host plans; `remediation-append.ts`
  `git show <branch>:<path>`). The leaf holds a copy.
- **Commit stamping.** `round-stamp` (`round-stamp-cli.ts`) stamps `Round: <roundId>` only when the
  current branch is the marker's host branch, and it skips a message that already has a `Round:`
  trailer. `Task:` is telemetry only (#773). No commit records an owner or child.
- **Replay.**
  - Ordinary commits replay with one `merge-tree --write-tree --merge-base c^1 <acc> c` each.
  - Merges are classified first: ancestry-only merges are dropped, and Q-carried merges replay only
    their hand resolution (`restack/restack-replay.ts`, `restack/restack-ownership.ts`).
  - Commits that started empty are kept.
  - A child's own range is `oldParent..oldTip` on the first parent (`restack/restack-plan.ts`).
    Planners have no hook to inject commits.
- **The interactive rebase step.** With no daemon, the step records a `noop` and returns before
  any stack preflight or restack (`conductor.ts`, `runRebaseStepBody`).
- **Stamping fails open.** `round-stamp` exits successfully when a marker or message read fails,
  and the hook calls it with `|| true` (`round-stamp-cli.ts`, `git-hook-assets.ts`).
- **Resolver dispatches are unattributed.**
  - `resolveRebaseConflict` (`step-runners.ts`) dispatches with no execution context.
    `ProviderAttemptEvent` (`types/events.ts`) carries no restack or round identity. The OTel span
    manager attributes a context-free attempt only through `soleOpenLifecycleSpan`
    (`otel/span-manager.ts`).
  - `restack_planned` and `restack_applied` carry `opId` and `cause`, but no round.

## Options Considered

### Option A: Owner-stamped fixes on the leaf, folded once before publish (chosen)
- **Pros:**
  - Rounds restack nothing, so restack and re-validation run once per publish.
  - Routing stays the authority on placement.
  - Each of the earlier ADR's four objections is answered by machinery.
- **Cons:**
  - A prerequisite a fix lacks at its owner surfaces at fold time, not during the round.
  - Hunk placement is new planning logic.

### Option B: Owner-hosted repair, one restack at round close, re-validation deferred to publish
- **Pros:** the earlier ADR stays intact, and there is no new history transformation.
- **Cons:** restacks still grow with the number of rounds, so #3653's first outcome is not met.

### Option C: Stack late (one branch, split into children at publish)
- **Pros:** the largest saving.
- **Cons:** it unwinds the per-child build regions and the routing investment, which the operator
  ruled out.

## Decision

1. **Scope.**
   - **Where it applies.** All three must hold:
     - an `audit` round;
     - a stacked feature with `routingEligible`;
     - `stacked_prs.fold_routed_fixes`, a new boolean that defaults to `true`.
   - **What it leaves alone.** `operator` and `revalidate` rounds keep owner-branch execution as
     written. N=1 features read or write nothing here, and the #3019 golden suite stays
     byte-identical.
   - **The flag is frozen per round.** Each audit round's execution mode is recorded at admission
     and never re-read from config. With the flag `false`, newly admitted rounds behave exactly as
     today.
   - **Deferred fixes are never stranded.** The fold (decision 7) runs whenever deferred placements
     exist, whatever the flag currently says.

2. **Routing stays the authority, and the host is the placement floor.**
   - **Unchanged:** owner derivation, residue routing, `selectHost`, host order, the frozen
     allocation, receipts and settlement (`adr-2026-10-12-routed-whole-feature-repair` decisions 2,
     3, 4 and 10).
   - **The placement child.** The child `selectHost` picks for an item is its **placement child**.
     No part of a fix is ever placed below it.
   - **No prerequisite reroutes during the round.** A leaf-executed host refuses
     `blocked-by-prerequisite` claims (decision 5 of that ADR) as an ordinary failed build attempt,
     because every path exists on the leaf. A prerequisite the placement child lacks is detected at
     fold time instead (decision 9).

3. **A leaf-executed host builds on the leaf branch.**
   - **What admission records.** The route record carries `execution: 'leaf'` for the round, so
     every host in it is leaf-executed, and the repair marker carries
     `{host, roundId, execution: 'leaf'}`.
   - **Per-host placement.** The record keeps a per-host placement entry `{state, leafEntryTip,
     exitTip}` beside the existing host states. `HostEntry.pinnedBase` stays the host's closure.
   - **Region entry** keeps the leaf checked out. It then:
     - restages host k's region (`acceptance_specs`, `build`, `test_suite`, `build_review`) in host
       k's child state;
     - writes the frozen blocks into the leaf's copy of the plan;
     - seeds task status, as decision 9 of that ADR does today.
   - **`build_review`** grades the repair diff against a base pinned at the leaf tip at entry
     (`baseKind: routed-repair`).
   - **Repair obligations** carry `branch: <leaf>` (decision 11 of that ADR).
   - **Order.** Hosts run in today's ascending order. Leaf-hosted items still run last.
   - **The host's closure is recorded separately.** The entry records two values:
     - the host's closure SHA, in the existing `pinnedBase`, which the hand-moved-closure check
       still compares against `closed/c<k>`;
     - the leaf entry tip, in the placement entry, which is the `build_review` base and the start
       of the boundary range.
   - **The stack-commit guard follows the execution branch.** While the marker carries
     `execution: 'leaf'`, the guard admits tracked commits on the leaf. It refuses them on the
     host's own branch and on every other child, and its recovery text names the leaf.
     - An operator commit on the leaf during the host's region lies inside the boundary range, so
       it is stamped and folded as that host's work.

4. **The engine stamps every leaf-executed commit with its owner.**
   - **The stamp.** While the marker carries `execution: 'leaf'` and the leaf is checked out, the
     prepare-commit-msg path (`round-stamp`) stamps both trailers, replacing any value already in
     the message:
     - `Round: <roundId>`;
     - `Owner: c<k>`, with the marker's host as k, or `Owner: leaf` for a leaf host.
   - **No builder can forge them.** A builder-supplied `Owner:` or `Round:` is overwritten.
   - **Stamping fails closed.** While the marker carries `execution: 'leaf'`, the commit-msg hook
     rejects a commit on the leaf unless its final message carries exactly the marker's `Round:`
     and `Owner:`. It checks after the repository's own chained hook has run. A stamp or read
     failure rejects the commit rather than passing it through.
   - **Commit 0.** The frozen-block append commit made at region entry is stamped the same way.
   - **Boundaries, not trailers, define a host's work.** The route record pins each leaf-executed
     host's entry tip at region entry and its exit tip at the deferred exit (decision 5). The
     host's work is the leaf's first-parent commits in `(entryTip, exitTip]`.
   - **What the trailer is.** `Owner:` is a cross-check and the per-fix visibility record. It is
     machinery-owned, unlike `Task:`.

5. **A leaf-executed host's routed exit restacks nothing.**
   - **The exit.** When the region passes, one compare-and-swap marks the host `done` with
     `placement: 'deferred'`, records its exit tip, and deletes the marker. No restack is requested
     and no queue generation is written.
   - **A leaf host is not deferred.** Its fixes already sit in the leaf's PR, so it exits `done` as
     today.
   - **Deferred only with commits.** A leaf-executed host whose boundary range is empty exits
     `done` with no placement. A host that committed only its frozen blocks is still `deferred`,
     because the blocks must reach the host's plan copy.
   - **No queue acknowledgement.** A leaf-executed host's exit does not acknowledge a queue entry
     for its child, because the child's own branch did not re-run. That entry is consumed as a
     `revalidate` round in the existing order.
   - **What follows.** The routing continuation then goes to the next host, the queue, the leaf host
     or the leaf return, as today.
   - **The leaf return re-pends the whole-feature gates as today,** because the leaf tip moved.
     Further rounds repeat this without any restack.

6. **The fold runs in the FINISH `rebase` step, before the base refresh, in every mode.**
   - **Precondition.** All of these hold:
     - every route record is `closed`;
     - the revalidation queue is empty;
     - no marker exists;
     - at least one host is `deferred`.
   - **Interactive runs too.** It runs before the step's interactive `noop` return, so interactive
     runs fold as well. In daemon mode it runs after the stack preflight.
   - **The fold set** F is the union of every `deferred` host's boundary range (decision 4).
   - **Then:** the step runs one restack with the new cause `fold`. If the fold queued children
     (decision 9), the base refresh is deferred with the existing `restack_refused` reason
     `deferred-base-refresh`.
   - **No deferred host** leaves the step's behaviour exactly as today.
   - **The base refresh waits for the fold.** While any host is `deferred`, a base refresh requested
     by FINISH or a daemon re-kick moves no ref. It emits `restack_refused` with reason
     `deferred-base-refresh` and runs after the fold, extending the routed ADR's decision 7
     deferral test.
   - **Publication fails closed.** `establishChildPrs` refuses, halting needs-human, while any host
     is still `deferred`. No entry point can publish unfolded fixes.

7. **The fold plan is computed and journaled before any ref moves.**
   - **Validation.** Each commit in F must carry exactly the `Round:` and `Owner:` of the host whose
     boundary range contains it. A mismatch, a missing trailer, or a merge commit inside a boundary
     range halts needs-human with reason `fold-owner-invalid`. The halt names the commit and the
     host, and nothing moves. Builders on the leaf do not merge, and base refresh is deferred while
     rounds are open.
   - **Commits outside every boundary range stay on the leaf.** These are the leaf's own build,
     leaf-host fixes, operator commits and halt records.
   - **Placement,** commit by commit in leaf order:
     - **Frozen-block appends** are re-materialized on the placement child's copy of the plan
       through the deterministic block merge of decision 9 of that ADR. They are never hunk-split.
     - **A commit that started empty,** such as a `tdd` evidence commit, is placed whole on the
       placement child and kept empty.
     - **Every other commit** is placed path by path, then hunk by hunk. Each hunk goes to the
       lowest child, at or above the placement child, whose accumulated tree accepts it through
       three-way merge-tree. A hunk only the leaf accepts stays on the leaf. A raised part records
       the reason `introduced-above-owner`. It is an adaptation of code that a higher child owns.
   - **A host whose work all lands above it was misrouted.** For each deferred host, at least one
     non-empty part of its boundary range must be placed on its placement child. Otherwise the fold
     halts needs-human with reason `fold-misrouted`, naming the host, its finding ids and the
     children that accepted its hunks. Nothing moves. Routing's owner choice is never silently
     overridden.
   - **Placed commits.** One source commit becomes at most one placed commit per child. Each keeps
     the source's author and message and adds `Folded-from: <sha>`. The journal records every
     source-to-placed correspondence for evidence translation and recovery.
   - **The journal.** The plan is written to the restack journal (cause `fold`) before any staging
     ref exists. It records each source commit, its owner, its placement child, and each placed
     part's child, paths and reason. This answers objection 4.

8. **The fold reuses the journaled replay and moves in one transaction.**
   - **Mechanics.**
     - Placed commits extend each target child's own range.
     - Children above a target are replayed by the existing per-commit executor.
     - The leaf's range is its own commits minus F.
   - **Conflicts** go to the existing resolver (`adr-2026-10-10-stacked-restack-journaled-replay`
     decision 6). Each child is replayed at most once per fold. No second history transformation
     exists, which answers objection 3.
   - **Path ownership.** A target child's owned paths are its own paths plus the paths placed into
     it. The leaf's owned paths are its own paths.
     A resolved tip may also carry adapted paths under #3598's rule (restack ADR decision 3, as
     amended 2026-11-07). Those adaptations re-open the child's feature-scoped reviews, which fold
     re-validation runs anyway (decision 9).
   - **Cascades.** Each target child is charged one cascade, cause `fold`. A fold never refunds.
   - **The move.** Branches and closure refs move in one `update-ref --stdin` transaction, as today.
     The journal carries every affected route record's old and new values. The same `applied`
     transaction marks each folded host `placement: 'placed'`, so a folded host never enters a
     later fold set.

9. **Leaf-tree identity accepts the fold, and every changed child re-validates once.**
   - **Identity.** Before the move transaction, the new leaf tree must equal the pre-fold leaf tree.
     - **A mismatch moves nothing.** It halts needs-human with `restack_refused` reason
       `fold-tree-mismatch`, naming each differing path and the F commits that touched it.
     - **A match keeps the leaf's whole-feature verdicts,** through the existing `noop` transition.
   - **Re-validation.**
     - **The queue.** The `applied` transaction writes one revalidation generation holding every
       non-leaf child whose tree changed: each target and each child above it.
     - **Admission.** The step then admits the lowest queued child through the shared admission
       helper, in the same run.
     - **The rounds.** The `revalidate` rounds are unchanged. Each runs acceptance verify-green,
       `test_suite` and `build_review` on the child's own branch. This answers objections 1 and 2.
     - **A failure** is an ordinary kickback in that child's region, under its caps. Its fix exits
       through the existing `feature-repair` restack.
   - **Missing prerequisites.** In a revalidate round whose generation a fold produced, a
     `blocked-by-prerequisite` claim verified by that ADR's decision 5 checks halts needs-human
     instead of rerouting. The halt names:
     - the folded fix (`Folded-from`);
     - the child that cannot hold it;
     - the child holding the prerequisite.

     So no fix is silently left in a higher PR.

10. **The fold return keeps verified leaf verdicts.**
    - **Verdicts.** When the queue drains after a fold, `returnToLeaf` runs in `fold` mode.
      - If the leaf tip's tree equals the tree recorded in the fold's `applied` transaction, no
        whole-feature gate is re-pended.
      - Otherwise, because a re-validation repair moved the leaf, the gates re-pend as today. Any new
        audit round runs on the leaf again, and a later `rebase` step folds again, bounded by the
        whole-feature lap caps.
    - **Navigation** resumes at the `rebase` step. With no host still `deferred`, the step runs the
      deferred base refresh, and publication runs unchanged.

11. **The spine and OTel carry the fold and restack spend.**
    - **Restack events.** `RestackCause` gains `fold`. `restack_planned` gains an optional
      `roundId` for routed restacks.
    - **A new `fold_planned` event.** It carries `{opId, commits: [{sha, roundId, owner, placements:
      [{child, paths, reason}]}]}`, so the placement of every fix is visible.
    - **Resolver attribution.** The restack resolver's dispatch carries an execution context, and
      `provider_attempt` gains an optional `restack: {opId, cause, roundId?}`.
    - **OTel, the authoritative measurement source.**
      - Resolver spans carry `conductor.restack.op_id`, `conductor.restack.cause` and
        `conductor.round`.
      - The feature step cost and token metrics gain the bounded dimension `restack_cause`. A round
        id is never a metric label.
    - **Shipped record.** A stacked feature's record gains an additive `## Restack` block, derived
      from the same events. It has one row per round and per fold or base-refresh operation, giving
      resolver runs and cost, plus an `unattributed` row.
    - **No new channel.** No new file or channel is added, per the event-spine rule.

12. **Deferred placements survive every other restack.**
    - **The scope.** These restacks can replay the leaf while a host is `deferred`:
      - an operator round's `feature-repair`;
      - a queued child's `revalidate` fix;
      - a recovery.
    - **The remap.** Each such restack's journal carries the old and new values of every route
      record that has a `deferred` host. Its `applied` transaction rewrites each deferred host's
      entry and exit tips through the journal's exact old-to-new commit map.
    - **A tip with no image** halts needs-human with reason `fold-boundary-lost`, naming the host.
      This happens when the endpoint commit was dropped as empty or flattened, and nothing moves.

13. **Operator round tooling shows and preserves placements.**
    - **Listing.** `ai-conductor stack rounds --slug <slug>` lists each host's execution mode and
      placement (`deferred`, `placed` or none).
    - **Closing.** `stack rounds --close` treats a `deferred` host as settled, like `done`, and never
      clears its placement. A closed round's deferred hosts are still folded, and publication still
      refuses until they are.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Host k's region state, gate verdict stamping (`routedRound`) and task-status seeding work while the leaf branch is checked out, given an execution-child resolver that returns host k and a host entry target that returns the leaf | inferred | 75% | yes | Region entry would need a per-child state redesign; the plan grows | APPROVED by operator 2026-11-08 |
| A2 | A restack whose new leaf tree equals the old one yields a `noop` transition that invalidates no leaf verdict | verified | 95% | yes | Leaf gates would re-run after every fold | n/a |
| A3 | Frozen rem-block append commits re-materialize on the placement child's plan copy through the existing deterministic block merge, independent of other owners' blocks already on the leaf | inferred | 80% | yes | Plan-file appends would conflict at fold and need their own placement rule | APPROVED by operator 2026-11-08 |
| A4 | Giving the restack resolver an execution context lets the OTel span manager attribute its attempts, both in the FINISH rebase span and out of band in preflight | inferred | 70% | yes | OTel restack attribution would need a span-manager change beyond attribute setting | APPROVED by operator 2026-11-08 |
| A5 | Placing each hunk at the lowest child that accepts it, never below the placement child, removes most restack conflicts | inferred | 70% | no | Savings smaller than projected; correctness unaffected (decision 9 identity) | n/a |

## Consequences

### Positive
- Audit rounds restack nothing. Restack and re-validation run once per publish, plus only a
  re-validation repair's own cascade.
- Each fix reaches its placement child's PR, and its placement is visible in `Owner:` and
  `Folded-from:` trailers and in `fold_planned`.
- Restack spend is measurable per round and per fold, in OTel and in the shipped record.

### Negative
- A fix that only works because of a higher child's code is found at fold time, so the feature
  pays a re-validation repair late, or halts.
- During rounds, host-scoped gates judge the fix against the whole feature, not against the
  placement child alone, until the fold re-validates.
- One more restack cause and one more history-planning stage need maintaining.

### Follow-up Actions
- [ ] Close #3628 as superseded once this spec merges: no multi-host restack remains in audit rounds.
- [ ] #3599 and #3598 still apply to the fold's single restack.
