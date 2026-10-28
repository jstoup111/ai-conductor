**Status:** Accepted

# Stories: Build, charge and review a routed fix on the child that hosts it (#3211)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/a-routed-fix-cannot-be-built-charged-and-reviewed-.md`
  (spec C of the four-spec split #2944, #3210, #3211, #3212);
- `adr-2026-10-12-routed-whole-feature-repair` (decisions 5 and 9–12);
- the findings and conditions of
  `architecture-review-2026-10-15-a-routed-fix-cannot-be-built-charged-and-reviewed-`.

Scope outcomes (from jstoup111/ai-conductor#3211):
1. Built on the host: a placed fix is appended, built and reviewed on the host child's own branch,
   and the host's region re-runs.
2. Plan stays valid: routed remediation tasks carry their child in committed text, and the plan
   stays valid after every routed append.
3. Budgets stay feature-wide: prd_audit and as-built laps and growth keep their per-feature
   meaning, and a round settles exactly once, at the host's dispatch, including after a crash or a
   worktree recreation.
4. Verified reroute: a builder's claim that a prerequisite lives in a later child moves the fix
   only when the engine verifies it; a test failure is never treated as "cannot host".
5. N=1 features remediate exactly as today.

Terms used below:
- **Routing on:** `stacked_prs.route_whole_feature_fixes` resolves to `true`, which is the default.
  A project that sets it `false` gets exactly the behavior from before this spec in every story below.
- **Three-child stack:** a stacked feature with slug `demo`, routing on, and positions `1`, `2`
  and `3`.
  - `feat/c1/demo` is closed at `refs/conductor/demo/closed/c1`, owns task `T1` and file `src/a.ts`.
  - `feat/c2/demo` is closed at `closed/c2`, owns task `T2` and adds file `src/b.ts`, which exports
    `parseB`.
  - The leaf `feat/daemon-demo` (position 3) owns task `T3`.
  - The sealed plan has 12 authored tasks.
- **Round `r1`:** a route record `refs/conductor/demo/routes/r1` admitted by spec B's marker
  transaction. Its frozen allocation holds `rem-prd-audit-T1` for host 1, and the marker
  `refs/conductor/demo/repairing` names host 1 and `r1`.
- **Region entry:** the engine entering the round's current host's region, in the order the
  architecture review's condition 2 fixes.
- **Host progression, exits and re-validation** are #3212. In this spec only the round's current
  host is entered, and that host may be the leaf.

## Story 1: The host's region re-runs with the fix appended on its own branch

**Requirement:** Scope outcome 1; ADR decision 9

As a reviewer of child 1's PR, I want the fix and its plan entry committed on child 1's branch and
child 1's gates re-run, so that child 1's PR is green with its own fix.

### Acceptance Criteria

#### Happy Path
- Given round `r1` with host 1 `admitted`, when region entry runs, then the worktree is on `feat/c1/demo` and child 1's `acceptance_specs`, `build`, `test_suite` and `build_review` are restaged pending.
- Given round `r1` region entry, when the frozen blocks are written, then each block in the feature plan on `feat/c1/demo` is byte-identical to its frozen body, carries `**Child:** 1` and `**Round:** r1`, and the append commit carries a `Round: r1` trailer.
- Given round `r1` region entry, when it completes, then host 1 is `repairing` in the route record, and that transition happened only after the append commit exists.
- Given round `r1` region entry, when it begins, then host 1's base is pinned in the route record as the `closed/c1` SHA before any branch switch or commit.
- Given a round whose only host is the leaf, when region entry runs, then the leaf's frozen blocks are written on `feat/daemon-demo` and the pinned base is the leaf tip read before the append commit.
- Given an audit round whose every routed task for host 1, frozen rem ids and restaged bound ids alike, is already evidence-complete on child 1's tree after region entry, when the no-op guard runs, then the feature halts with outcome `derived-already-complete` on its halt record and no build is dispatched.
- Given round `r1` admitted and region entry run, when the events are read, then exactly one `kickback` event and one leaf rewind exist for the round, and region entry emitted neither.

#### Negative Paths
- Given region entry is replayed after a crash, when a block with the same id and an identical canonical body already exists, then it is accepted and nothing is appended or committed.
- Given region entry, when a block with the same id but a different body exists on `feat/c1/demo`, then the feature halts needs-human naming the id, no commit is made, and no `-2` ordinal id appears.
- Given region entry, when the append commit is refused by a pre-commit hook, then the feature halts, host 1 stays `admitted`, and no later region step is dispatched.
- Given the worktree has an uncommitted file, when region entry tries to switch to `feat/c1/demo`, then it is refused naming that file, and host 1 stays `admitted`.
- Given region entry would write a rem id that is not in the round's frozen allocation, when the write runs, then it is refused and nothing is appended.
- Given a crash after the append commit and before host 1 is `repairing`, when the feature resumes, then each frozen rem id appears exactly once on `feat/c1/demo` and host 1 ends `repairing`.
- Given a crash after the base pin and before the switch, when the feature resumes, then the recorded pin is reused unchanged.
- Given host 1 already `repairing` for `r1`, when the feature resumes in host 1's region, then child 1's region steps are not restaged again and nothing is appended.
- Given host 1 already `repairing` for `r1` and the worktree checked out on another branch, when the feature resumes, then the worktree is switched to `feat/c1/demo` before any dispatch.
- Given round `r1` region entry where authored `T1` is complete and frozen `rem-prd-audit-T1` is pending, when the no-op guard runs, then it does not halt.
- Given an N=1 feature, when a remediation block's title drifted from a prior lap, then today's `-2` ordinal renaming still applies.

### Done When
- [ ] Tests assert the host-region restage happens once per `(roundId, host)`, the exact frozen-block bytes, the `Round:` trailer on the append commit, and the order pin, switch, append, `repairing`.
- [ ] A crash-injection test across the pin, the append commit and the `repairing` transition converges to one route record, one marker and no duplicated `### Task rem-` header.
- [ ] A test asserts a leaf-only round pins the pre-append leaf tip.

## Story 2: Routed tasks carry their child in committed text, and the plan stays valid

**Requirement:** Scope outcome 2; ADR decisions 4 and 9

As an operator, I want every routed task's child recorded in committed text and every commit on the
host stamped with its round, so that membership survives a worktree recreation and the plan never
mints a duplicate id.

### Acceptance Criteria

#### Happy Path
- Given host 1 `repairing` for `r1`, when any commit is made on `feat/c1/demo`, then the commit hook adds `Round: r1` beside the engine-stamped `Task:` trailer.
- Given a recreated worktree with no `engine-state.json`, when membership of `rem-prd-audit-T1` is checked, then it resolves to child 1 from the committed `**Child:** 1` line.
- Given rem blocks already on `feat/c1/demo` and on the leaf, when a new round allocates work for `T1` and `T3`, then no rem id or ordinal is minted twice across the plans of the stack.
- Given a recreated worktree whose child holds rem blocks of route round `r1`, when seal rotation is evaluated, then the ids in `r1`'s frozen allocation count as engine-recorded appends and rotation is permitted.
- Given round `r1` routes owner-1 task `T1` to host 2, when `conduct task done T1` runs on `feat/c2/demo`, then it succeeds and marks `T1` done in the flat task status through host 2's execution projection.
- Given round `r1` routes `T1` to host 2, when a commit on `feat/c2/demo` carries `Task: T1`, then the membership hook accepts it.

#### Negative Paths
- Given no marker, or a commit on a branch other than the marker's host branch, when the commit hook runs, then no `Round:` trailer is added and the message equals today's output.
- Given a commit message that already carries `Round: r1`, when the hook runs, then the message keeps exactly one `Round:` trailer.
- Given an N=1 feature, when a commit goes through the installed hook under a recording git shim, then no command names `refs/conductor/demo/routes`, `repairing` or `revalidate`, and the message equals today's output.
- Given the `appendedRemediationTaskChildren` cache disagrees with the committed `Child:` line, when membership is checked, then it follows the `Child:` line and the rebuilt cache matches it.
- Given a rem task with neither a committed `Child:` line nor a cache entry, when a commit names it, then the commit is refused as unreadable membership.
- Given a rem id in neither the recorded appends nor any route record's frozen allocation, when seal rotation is evaluated, then rotation is refused.
- Given round `r1` routes `T1` to host 2, when a commit on `feat/c2/demo` carries `Task: T3`, then the membership hook refuses it naming `T3`.

### Done When
- [ ] Tests assert `Round:` stamping on and off the host branch, single-trailer idempotency, and the N=1 shim recording no routing ref.
- [ ] Tests assert `Child:`-line membership after a worktree recreation and the fail-closed case.
- [ ] Tests assert stack-wide rem id uniqueness, frozen-id seal rotation, and execution-projection acceptance and refusal in both the hook and `task-cli`.

## Story 3: A routed pass proves the host's acceptance specs green without re-proving RED

**Requirement:** Scope outcome 1; ADR decision 9

As an operator, I want a routed pass to run the host's existing acceptance specs green, so that a
worktree recreation or an older child never blocks a repair on missing RED evidence.

### Acceptance Criteria

#### Happy Path
- Given routing on and child 1 closing with a RED marker, when `closeChild` runs, then `refs/conductor/demo/red/c1` is created pointing at a blob holding the digest of child 1's RED evidence.
- Given host 1's routed pass passes verify-green, when the event log is read, then the `acceptance_red` event has `state` `satisfied` and `mode` `verify-green`, never a fresh RED proof or a waiver.
- Given host 1's routed pass with a present RED marker that has no provenance (a legacy marker), when `acceptance_specs` runs, then verify-green runs and the legacy marker is not a refusal.
- Given host 1's routed pass with `.pipeline/children/1/acceptance-specs-red.json` absent after a worktree recreation, when `acceptance_specs` runs, then it runs child 1's existing specs in verify-green mode and reads the digest from `red/c1`.
- Given a child closed before this change with no `red/c1` ref, when its routed pass runs acceptance on passing specs, then the step completes without a refusal.

#### Negative Paths
- Given host 1's routed pass, when `acceptance_specs` runs, then the RED self-heal is never invoked and no `missing` RED refusal is recorded.
- Given host 1's routed pass, when one of child 1's existing acceptance specs fails, then `acceptance_specs` fails for host 1's region and is not re-run as a RED self-heal.
- Given `red/c1` already exists with the same digest because a closure is resumed after a crash, when `closeChild` runs again, then it succeeds and the blob is unchanged.
- Given `red/c1` already exists with a different digest, when `closeChild` runs, then it is refused and the existing blob is unchanged.
- Given routing off, when `closeChild` runs, then no `red/c<k>` ref is written.
- Given a child with no owned criteria and so no RED marker, when it closes, then no `red/c<k>` ref is written, and its later routed pass runs verify-green without a refusal.
- Given host 1's routed pass with a present RED marker whose digest differs from `red/c1`, when `acceptance_specs` runs, then the step fails naming the digest mismatch.
- Given an N=1 feature, when `acceptance_specs` runs, then today's RED lifecycle applies unchanged.
- Given a routed pass whose host is the leaf, which never closes and so has no `red/c<leaf>` ref, when `acceptance_specs` runs, then verify-green is not invoked, the ordinary `acceptance_specs` step runs for the leaf, and its completion is judged by the ordinary predicate rather than by a verify-green record.

### Done When
- [ ] Tests assert `closeChild` writes `red/c<k>` only with routing on and a RED marker, accepts a same-digest blob on resume, and refuses a different one.
- [ ] Tests assert the `acceptance_red` event's `verify-green` mode, the legacy-marker case and the digest-mismatch failure.
- [ ] Tests assert verify-green with a missing marker, with no `red/c1` ref, and on a failing spec, and that the self-heal is never called in a routed pass.

## Story 4: A round is charged once, durably, whichever child hosts it

**Requirement:** Scope outcome 3; ADR decision 10

As an operator, I want the repair budgets to keep their per-feature meaning, so that routing never
grants extra laps or growth, and a crash never double-charges or refunds.

### Acceptance Criteria

#### Happy Path
- Given a round with 1 new rem task for host 1 and 1 for the leaf, when host 1's BUILD dispatch occurs, then before the provider is dispatched one `prd_audit` lap and growth 2 are charged in the route record's receipt with a settlement id, and the flat ledger records them under that id.
- Given that settled round, when a later BUILD dispatch for the round's current host occurs, then only an acknowledgement is recorded, and the ledger's laps and growth are unchanged.
- Given one round admitting a `prd_audit` FIXABLE and an as-built REMEDIABLE, when host 1 dispatches, then one lap is charged to each gate and their growth once, in one settlement.
- Given a stacked feature's first ledger record, when growth is read, then `authored` is stored as 12 from the sealed plan, and it stays 12 after rem blocks exist only on child 1's plan.
- Given a stacked feature with an audit round sealed at 12 authored tasks and a revalidate round, when growth is read, then `authored` is 12: a revalidate round seals no denominator, and one recorded as `0` before this rule is ignored rather than refused.
- Given rem blocks pending only on child 1's plan, when growth is read before settlement, then the pending-task exclusion takes those ids from the frozen allocation.
- Given a worktree recreated after settlement, when the feature resumes, then settled laps, growth and taskless counters are rebuilt from the round receipts, and the ledger has no `pendingRepair` field.
- Given a worktree recreated while an as-built round is open, when as-built runs again, then its prior-findings input includes the pending findings read from the route record.
- Given a routed round, when its life from admission to settlement is traced, then the receipt settlement is the only durable `prd_audit` lap charge.

#### Negative Paths
- Given a crash after the settlement compare-and-swap and before the ledger write, when the feature resumes and dispatches, then the ledger is reconciled by settlement id and the lap is charged exactly once.
- Given a crash before the settlement compare-and-swap, when host 1 dispatches again, then the round is charged exactly once.
- Given the `prd_audit` lap cap already used, when round `r1` reaches host 1's dispatch, then settlement is refused, the receipt stays unsettled, the allocation stays pending, no provider is dispatched, and the feature halts with HALT.class `kickback-cap`.
- Given that cap halt, when the flat feature ledger is read, then it holds typed `laps` cap evidence for `prd_audit` with a halt generation, and child 1's ledger holds none.
- Given that cap halt, when the operator runs `kickback-budget raise --gate prd_audit` and the feature resumes, then the same receipt settles on the same frozen tasks, and no new route record or rem id is written.
- Given a joined round, when the as-built lap cap or the effective growth cap is exhausted while the `prd_audit` lap is available, then neither gate is charged and no provider is dispatched.
- Given a malformed route record or receipt, when settlement reads it, then the budget is treated as exhausted and the feature halts.
- Given the current host is child 1, when child 2's BUILD dispatch tries to settle, then settlement is refused and nothing is written.
- Given two settlement attempts for the same round racing to the compare-and-swap, when both complete, then exactly one charge and one settlement id are recorded, and the loser records an acknowledgement.
- Given the settlement compare-and-swap loses to an outbox drain that changed the record without settling it, when settlement re-reads, then it retries the whole operation rather than acknowledging, and halts needs-human naming the round after 3 failed attempts.
- Given a restack journal opens between the settlement read and its compare-and-swap, when the transaction runs, then nothing is charged and the feature halts.
- Given a stored `authored` of `0` against a sealed plan with 12 authored tasks, when growth is read, then it fails closed rather than re-deriving.
- Given `kickback-budget raise --gate prd_audit` while host 1 is the execution child, when it runs, then the raise is written to the flat feature ledger and child 1's ledger is unchanged.
- Given an N=1 feature, when it remediates, then the existing growth and settlement behaviour passes unchanged.

### Done When
- [ ] Tests assert single settlement across dispatches, races and crashes on either side of the commit point.
- [ ] Tests assert cap refusal before settlement, resume on the same frozen tasks after a raise, and fail-closed handling of a malformed record and a stored `0`.
- [ ] Tests assert the ledger rebuild after recreation and the route-record as-built prior findings.

## Story 5: Taskless and FAIL-only rounds are charged at admission, before any routing ref exists

**Requirement:** Scope outcomes 1 and 3; ADR decisions 3 and 10

As an operator, I want a routed `manual_test` FAIL charged only to its own counter and a routed
custom-step kickback charged exactly as today, so that taskless repairs stay bounded and a cap halt
leaves nothing behind.

### Acceptance Criteria

#### Happy Path
- Given a three-child stack, when a standalone `manual_test` FAIL is routed to child 2, then only the `manual_test` counter is charged, in the round receipt, and no `prd_audit` or as-built charge is made.
- Given a three-child stack, when a validation-group join whose only failure is `manual_test` is routed, then it is charged the same way and its FAIL rows ride the host's retry hint.
- Given a three-child stack, when a post-region custom step `lint-docs` kicks back and is routed to child 1, then no task is appended, today's durable tree-keyed kickback counter for the re-opened gate is bumped once, and the round receipt echoes that charge under `lint-docs` without charging it again.
- Given a taskless round is admitted, when its admission is traced, then the counter bump, then the round's single `kickback` event, then the cap check occur in that order.
- Given a taskless round is admitted, when the caller returns from admission, then it emits no second `kickback` event for the round.
- Given a worktree recreated after a taskless round, when the feature resumes, then the `manual_test` counter is rebuilt from the round receipts.

#### Negative Paths
- Given the `manual_test` counter at `MAX_KICKBACKS_PER_GATE`, when a stacked FAIL is admitted, then the feature halts with today's exhausted self-heal reason, and neither a route record nor `refs/conductor/demo/repairing` exists.
- Given the re-opened gate's kickback counter at `MAX_KICKBACKS_PER_GATE` on the current tree, when `lint-docs` kicks back again, then the feature halts with today's `kickback ping-pong` reason and no route record exists.
- Given a `manual_test` taskless round, when its charge is recorded, then no gate entry in the kickback ledger changes.
- Given an N=1 feature, when `manual_test` FAILs or a custom step kicks back, then today's `manual_test` self-heal counter and today's durable custom-step kickback ledger apply unchanged.

### Done When
- [ ] Tests assert the ordered bump, event, cap check, and the absence of any routing ref after a cap halt.
- [ ] Tests assert standalone FAIL and FAIL-only join rounds charge only the `manual_test` counter in the receipt, and a custom-step round keeps today's ledger bump with a receipt echo.

## Story 6: Repair obligations resolve on the host's branch

**Requirement:** Scope outcome 3; ADR decision 11

As an operator, I want a reopened task resolved only by commits made on the child that repairs it,
so that old trailers never close a routed repair and a reroute never strands it.

### Acceptance Criteria

#### Happy Path
- Given an `existing-task` repair of `T1` hosted by child 1 in a round without FAIL rows, when region entry runs, then the obligation's boundary is `feat/c1/demo` at its tip on entry with a tree-hash baseline, and `T1` is restaged before child 1's BUILD dispatch.
- Given that obligation, when a commit with `Task: T1` lands on `feat/c1/demo` after the boundary, then `T1` resolves.
- Given that obligation, when the task-status rows are restored from trailers while the leaf is checked out, then `T1`'s row is restored from the trailer on `feat/c1/demo`.
- Given a recreated worktree with no `engine-state.json` while host 1 is `repairing`, when the feature resumes, then the obligation is rebuilt from the route record with the same branch, boundary and admission key.
- Given an N=1 feature, when an obligation is admitted, then it carries no branch, and resolution behaves as today.

#### Negative Paths
- Given that obligation, when a pre-boundary commit with `Task: T1` exists on `feat/c1/demo`, then it does not resolve `T1`.
- Given that obligation, when a commit with `Task: T1` lands on the leaf, then it does not resolve the obligation.
- Given a crash between obligation admission and restage, when the feature resumes, then the admission key `(roundId, findingId, taskIds)` reuses the same obligation, and exactly one exists.
- Given a mixed round with FAIL rows and an `existing-task` gap on `T2`, when region entry runs, then the obligation is admitted but `T2` is not restaged.
- Given a route record whose `existing-task` item has no bound task ids, when it is read, then it is rejected as malformed and the feature halts.
- Given an obligation boundary on `feat/c1/demo` rewritten by a restack, when trailers are read, then the rewrite is followed and only post-boundary commits resolve `T1`.
- Given an obligation record whose branch is not a valid branch name, when it is parsed, then it is rejected.

### Done When
- [ ] Tests assert branch-bound boundaries, the round-keyed admission key, rebuild from the route record, and N=1 parity.
- [ ] A real-git test asserts per-branch trailer resolution and per-row restore on the host branch.
- [ ] Tests assert mixed-round existing-task gaps are admitted without a restage, and non-mixed ones are restaged.

## Story 7: The host's review grades only the repair, under its own allowance

**Requirement:** Scope outcome 1; ADR decision 12

As an operator, I want a routed repair reviewed on its own diff without spending the child's
exhausted review budget, so that a well-reviewed child is not re-litigated and does not halt for
lack of allowance.

### Acceptance Criteria

#### Happy Path
- Given host 1 `repairing`, when `build_review` runs, then its base kind is `routed-repair`, its base is the pinned `closed/c1` SHA, and only commits made after that base are graded.
- Given host 1's routed pass, when testQuality materialises pre-change content, then it restores from the same pinned base as the review.
- Given host 1's routed pass at child 1's cumulative `build_review` bound, when `build_review` fails, then the round's `routedRepairCredit` grants one more lap and the feature does not halt.
- Given the credit was granted, when the event log is read, then the `routed_repair_phase` event for `repairing` carries `credit: true`.

#### Negative Paths
- Given host 1 already used its `routedRepairCredit`, when `build_review` fails again, then the feature halts needs-human with a reason naming child 1.
- Given child 1's parent closure moves after region entry, when the routed pass's `build_review` runs, then its base is unchanged.
- Given a `feature-repair` restack while a round is open, when refunds are computed, then no convergence refund is granted.
- Given the credit was granted, when child 1's ledger is read, then `convergenceCreditReceipts` and its other per-child caps are unchanged.
- Given an N=1 feature or a non-routed child pass, when `build_review` runs, then today's base kinds apply.

### Done When
- [ ] Tests assert the `routed-repair` base from the single child-base producer, its stability, and testQuality using the same base.
- [ ] Tests assert the credit grant, its event flag, its single use, and that `feature-repair` never refunds.

## Story 8: A builder's missing-prerequisite claim moves the fix only when verified

**Requirement:** Scope outcome 4; ADR decision 5

As an operator, I want a builder's claim that it needs a later child's code checked before the fix
moves, so that a bad fix is never disguised as a placement problem.

### Acceptance Criteria

#### Happy Path
- Given host 1 mid-repair with two builder commits stamped `Round: r1`, when the builder returns `blocked-by-prerequisite` with symbols `parseB` naming child 2, and `parseB` is absent at `closed/c1` and present at `closed/c2`, then one transaction pins the rejected tip, resets `feat/c1/demo` to `closed/c1`, moves the marker to child 2, records the fallback and re-targets the open obligations.
- Given that verified reroute, when the worktree sync completes, then the checked-out tree equals `closed/c1`, host 1 is `rerouted`, child 2 is `admitted`, and child 2's region entry writes the same rem ids and bodies with `**Child:** 2`.
- Given that verified reroute, when the round's receipt is read, then no lap or growth was charged a second time.
- Given that verified reroute, when the event log is read, then one `remediation_rerouted` event names the round, child 1 and child 2.
- Given that verified reroute, when `refs/conductor/demo/rejected/r1/1` is read, then it equals the pre-reroute `feat/c1/demo` tip.
- Given host 2 claims `src/c.ts` is missing and names the leaf, when the claim is verified against the leaf tip, then the host moves to the leaf.
- Given host 1 whose only commits past `closed/c1` are stamped `Round: r1` or are halt-record-only, when a verified claim arrives, then the reroute proceeds.
- Given an operator commit made through the hook on `feat/c1/demo` while the marker names host 1, when a verified reroute resets the branch, then that commit stays reachable at `rejected/r1/1` and the `remediation_rerouted` event names that ref.

#### Negative Paths
- Given host 1, when the builder claims `parseB` is missing but `parseB` is present at `closed/c1`, then the claim is rejected, the attempt counts against child 1's region caps, and the host stays 1.
- Given host 2, when the builder names child 1, then the claim is refused because child 1 is not above the host, and no ref moves.
- Given a verified claim naming child 2, when child 2's closure holds `parseB` but lacks another prerequisite input of the work order, then the claim is rejected and counts as a failed attempt.
- Given host 1's branch holds an unstamped operator commit past `closed/c1`, when a verified claim arrives, then the reroute is refused needs-human naming that commit and nothing is reset.
- Given a restack journal that is not terminal, when a verified claim arrives, then the reroute is refused needs-human and no ref moves.
- Given the destination child is not `pending`, when a verified claim names it, then the reroute is refused needs-human and no ref moves.
- Given the reroute transaction, when another writer changes the marker or the host branch between read and write, then nothing moves and the feature halts needs-human naming the round.
- Given a crash after the reroute transaction and before the worktree sync, when the feature resumes, then the sync completes before any admission or dispatch and the tree ends at `closed/c1`.
- Given the worktree sync fails, when the feature resumes, then the round stays `reroute-moved` and no admission or dispatch happens until the sync succeeds.
- Given a round already rerouted from child 1 to child 2, when child 2's builder makes a verified claim naming the leaf, then the host becomes the leaf, and a later claim from the leaf is refused.
- Given a routed build returns a malformed structured result, when it is handled, then it counts as a failed attempt on the host region's caps.
- Given a routed build returns a `blocked-by-prerequisite` claim whose `child` is a string, or an integer outside 1 to `MAX_CHILD_ID`, when it is handled, then the claim is malformed, and the provider schema the dispatch requested rejects the same claim.
- Given a routed build returns no structured result, when it is handled, then no claim is made and the build is processed as today.
- Given an N=1 feature or a non-routed build, when the builder is dispatched, then no structured result is requested.

### Done When
- [ ] Tests assert verified, unverified, malformed and absent claims, the upward-only rule, and the refusals on unstamped commits, an open journal and a non-pending destination.
- [ ] A test asserts the claim parser accepts exactly the claims the requested provider schema accepts.
- [ ] A test injects a concurrent marker or branch write into the reroute transaction and asserts nothing moves.
- [ ] Tests assert crash recovery from `reroute-moved`, no second charge, and the merged allocation on the destination.

## Story 9: Every new routing write is fenced by the restack journal, and N=1 is untouched

**Requirement:** Scope outcome 5; ADR decisions 6 and 17

As an operator, I want every write this spec adds to refuse while a restack is in flight, and N=1
features to never read a routing ref, so that a restack and a repair never interleave and existing
features are unaffected.

### Acceptance Criteria

#### Happy Path
- Given no restack journal or a terminal one, when region entry, settlement and the reroute run, then each writes through the single fenced routing transaction carrying a `verify` of the journal ref.
- Given an N=1 feature with routing on, when a full remediation lap runs under a recording git shim, then no git command names `routes`, `repairing` or `revalidate`.
- Given routing off on a three-child stack, when a whole-feature gate fails, then remediation behaves exactly as before this spec.

#### Negative Paths
- Given a restack journal in state `moved`, when region entry, settlement or the reroute tries to write, then each is refused and `routes/r1` stays at its prior blob.
- Given a restack journal created between a writer's read and its transaction, when the transaction runs, then it fails on the journal `verify` and nothing is written.
- Given a fixture that writes a `routes/` ref outside the route-record store, when the structural check runs, then it fails.

### Done When
- [ ] Tests assert the journal refusal for every writer this spec adds, and the in-transaction `verify` race.
- [ ] The N=1 golden test and the routing-off parity test pass with this spec's code paths present.
