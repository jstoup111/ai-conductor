# Implementation Plan: Routed audit fixes run on the leaf and fold onto their owners once, before publish (#3653)

**Date:** 2026-11-08
**Design:** `.docs/decisions/architecture-review-2026-11-08-late-gate-fixes-restack-the-whole-stack-every-repa.md` (technical track, no PRD)
**Stories:** .docs/stories/late-gate-fixes-restack-the-whole-stack-every-repa.md
**Conflict check:** Clean as of 2026-11-08 (`.docs/conflicts/2026-11-08-late-gate-fixes-restack-the-whole-stack-every-repa.md`)

## Summary

A stacked feature's routed `audit` rounds now build every host's fix on the leaf. The engine stamps
each fix commit with `Round:` and `Owner:`, and the rounds restack nothing. The FINISH `rebase` step
then runs one `fold` restack, which places each fix on its owning child. The fold must leave the leaf
tree byte-identical, and every changed child is re-validated once before publication. Restack spend
is attributed per round and per fold on the event spine, in OTel, and in the shipped record. The
plan has 28 tasks. The operator chose single-PR delivery and declined a split.

## Technical Approach

- **Configuration** (`src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`).
  `StackedPrsConfig` gains `fold_routed_fixes?: boolean`, read through one helper,
  `foldRoutedFixesOn(config)`, which defaults to `true`. `validateStackedPrsBlock` rejects a
  non-boolean value.
- **Durable state** (`src/conductor/src/engine/routing/route-types.ts`,
  `src/conductor/src/engine/routing/route-record-store.ts`). These are additive optional fields.
  - `RouteRecord.execution?: 'leaf'` is valid only on `kind: 'audit'`.
  - `RouteRecord.placements?: Record<ChildId, HostPlacement>`, where `HostPlacement = {state:
    'deferred' | 'placed', leafEntryTip, exitTip?}`.
  - `RepairMarker.execution?: 'leaf'`.
  - `HostEntry.pinnedBase` keeps meaning the host's closure, so the stack-preflight
    hand-moved-closure check (`src/conductor/src/engine/restack/stack-preflight.ts`) is unchanged.
  - The parser rejects `execution` on any kind other than `audit`, and rejects a placement whose
    child is not a host of the record.
- **Execution mode is frozen at admission.** `admitRound` (`routing/round-admission.ts`) writes
  `execution: 'leaf'` into the record and the marker when the round is `audit` and
  `foldRoutedFixesOn` holds. Every later reader takes the mode from the record or the marker, never
  from config.
- **Leaf execution.**
  - `enterHostRegion` (`routing/host-region-entry.ts`) resolves its target through
    `resolveHostEntryTarget`. Under `execution: 'leaf'` that target is the leaf branch, while
    `resolveExecutionChild` still returns host k.
  - At entry it writes `placements[k] = {state: 'deferred', leafEntryTip: <leaf HEAD>}`, then calls
    `writeFrozenBlocks` on the leaf's plan copy.
  - The repair obligation's `branch` is the leaf. The `routed-repair` review base in
    `build-review-inputs.ts` reads `leafEntryTip` instead of `pinnedBase`.
  - `settleRoutedBuildClaim` (`routing/prerequisite-claim.ts`) refuses a claim on a leaf-executed
    host as an ordinary failed attempt.
  - `runStackCommitGuard` (`stack-commit-guard-cli.ts`) admits the leaf and refuses the host's own
    branch.
- **Stamping** (`round-stamp-cli.ts`, `git-hook-assets.ts`).
  - Under a leaf-executed marker on the leaf, `runRoundStamp` replaces any `Round:`/`Owner:` with
    the marker's values. The owner is `c<k>`, or `leaf` for a leaf host.
  - A new `round-stamp --verify <msgfile>` mode is called from the commit-msg hook, after the
    repository's chained hooks. It exits non-zero unless the final message carries exactly the
    marker's trailers.
  - Any read failure under a leaf-executed marker exits non-zero, and the hook no longer swallows
    that exit with `|| true`.
- **Deferred exit.** `requestRoutedExit` (`routing/routed-exit.ts`) handles a leaf-executed host in
  one CAS through `writeRoutingTransaction`. It writes the host `done` and deletes the marker. If
  the range `(leafEntryTip, HEAD]` is non-empty, it also writes `placements[k].exitTip = HEAD`;
  otherwise it removes `placements[k]`. It never calls `runRestack`, and it does not acknowledge a
  queue entry for the child.
- **Base-refresh deferral.** A new predicate, `deferredPlacementsExist` (`routing/round-admission.ts`),
  is true while any route record holds a `deferred` placement. Only the base-refresh deferral sites
  and the completion guard use it:
  - the conductor `rebase` step's stacked base refresh;
  - `daemon-rekick.ts`;
  - the stack preflight base-refresh follow-on;
  - `restack-recovery.ts`'s follow-on;
  - `Conductor.completeRun`'s routed-work check.

  `routedRoundOpen` itself is unchanged, because it also gates the routed leaf return and resume
  (`conductor.ts`), which must still restore whole-feature state while placements are deferred.
- **The fold plan** (new `src/conductor/src/engine/restack/fold-plan.ts`).
  - `collectFoldSet` reads every deferred placement and lists each boundary range's first-parent
    commits. It validates `Round:`/`Owner:` against the range's host, and refuses merges and
    mismatches as `fold-owner-invalid`.
  - `placeFoldCommits` handles each commit in leaf order:
    - a frozen-block append becomes a block re-materialization on the placement child, using the
      rem-block merge in `remediation-append.ts`;
    - a commit that started empty is placed whole;
    - any other commit is split by path, then hunk. Each part is probed with `merge-tree
      --write-tree --merge-base c^1 <child accumulated tree> <part>` from the placement child
      upward, and lands on the lowest child that accepts it cleanly, or else on the leaf.
  - A host with no non-empty part on its placement child yields `fold-misrouted`.
  - The plan is a typed `FoldPlan` (ADR domain types).
- **The fold restack** (`restack/restack-plan.ts`, `restack/restack-executor.ts`,
  `restack/restack-ownership.ts`, `restack/restack-transition.ts`, `src/conductor/src/types/restack.ts`).
  - `RestackCause` gains `'fold'`. The journal carries the `FoldPlan` and every affected route
    record's old and new values.
  - `planRestackRanges` extends each target child's own range with its placed commits, which carry
    `Folded-from: <sha>`, and drops the folded source commits from the leaf range.
  - Owned paths include the placed paths.
  - Before the move, the executor compares the staged leaf tree with the pre-fold leaf tree, and
    refuses `fold-tree-mismatch` if they differ.
  - The `applied` transaction does four things:
    - marks placements `placed`;
    - records the fold's leaf tree in the record's `leafReturn` field;
    - writes the revalidation generation;
    - charges one cascade per target child.
- **Remapping.** Every non-fold restack whose range includes the leaf while a deferred placement
  exists carries those records. In its `applied` transaction it rewrites `leafEntryTip`/`exitTip`
  through the journal's old-to-new commit map, and refuses `fold-boundary-lost` for a tip with no
  image.
- **The FINISH `rebase` step** (`Conductor.runRebaseStepBody`, `conductor.ts`).
  - When every round is closed, the queue is empty, no marker exists, and a deferred placement
    exists, it runs `runRestack({cause: 'fold'})`. That happens before the interactive `noop`
    return and, in daemon mode, after the stack preflight.
  - When the queue is non-empty, it calls `admitQueuedRevalidation` and navigates to the admitted
    child's region, as `continueRoutedHostExit` does.
  - `establishChildPrs` (`finish-publication-production.ts`) refuses needs-human while any
    placement is `deferred`.
- **The fold-mode leaf return.** `returnToLeaf` gains `mode: 'fold'`. When the leaf tip's tree
  equals the fold-recorded tree, it skips `restageLeafGates` and navigates to `rebase`; otherwise
  it re-pends the leaf gates as today.
- **Fold-produced revalidation.** In a revalidate round whose queue generation a fold wrote, a
  verified `blocked-by-prerequisite` claim halts `fold-prerequisite-missing` instead of rerouting.
- **Spine and OTel** (`types/events.ts`, `event-persister.ts`, `step-runners.ts`, `rebase.ts`,
  `restack/restack-resolver.ts`, `otel/span-manager.ts`, `otel/metrics.ts`).
  - New event `fold_planned`. `restack_planned` gains `roundId?`.
  - `ResolutionContext` gains `restack {opId, cause, roundId?}`. It is threaded to the
    `resolveRebaseConflict` dispatch's `executionContext`, then onto `provider_attempt.restack`.
  - The span manager sets `conductor.restack.op_id`, `conductor.restack.cause` and
    `conductor.round`. The metrics recorder adds the bounded `restack_cause` dimension to the
    dispatch and step cost dimensions.
- **Shipped record** (`shipped-record.ts`). A stacked record gains `## Restack`, written after
  `## Children` when that block is present, otherwise after `## Time`. It has one row per `roundId`
  and per fold or base-refresh `opId`, from the persisted events, plus `unattributed`. `kpi-report.ts`
  keeps reading only `## Cost`.
- **Local patterns.**
  - **Route-record writes:** mirror `abandonOperatorRound` in `routing/operator-round.ts`, which
    issues one `writeRoutingTransaction` with `update-record` and `delete-marker`.
  - **Restack refusals:** use `emitRestackRefused` with a new reason literal, plus the existing
    needs-human halt path in `restack/restack-conflict-halt.ts`.
  - **Real-git fixtures:** follow `test/engine/routing/*.realgit.test.ts`, which builds a
    three-child stack with closure refs.

## Prerequisites

None. #3598's adapted-path acceptance (#3667) and #3605's sole-round close are on main.

The commit-msg hook text change is classified as `hook wiring` by the self-host release gate. The
implementation PR carries the waiver or migration block that the gate requires.

## Tasks

### Task 1: `stacked_prs.fold_routed_fixes` is a validated boolean that defaults on
**Story:** Story 8
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts` for each Done-when check.
2. Verify RED.
3. Add `fold_routed_fixes?: boolean` to `StackedPrsConfig`, add it to the `stacked_prs` known-key list, validate it in `validateStackedPrsBlock`, and export `foldRoutedFixesOn(config)` returning `config.stacked_prs?.fold_routed_fixes !== false`.
4. Verify GREEN and commit.

**Done when:**
- [test] `foldRoutedFixesOn` returns `true` for a config with no `stacked_prs.fold_routed_fixes` key and `false` for `fold_routed_fixes: false`.
- [test] `validateStackedPrsBlock` rejects `fold_routed_fixes: "yes"` with an error message containing `stacked_prs.fold_routed_fixes`.

**Files likely touched:**
- `src/conductor/src/types/config.ts` — `StackedPrsConfig.fold_routed_fixes`
- `src/conductor/src/engine/config.ts` — known key, validation, `foldRoutedFixesOn`
- `src/conductor/test/engine/config.test.ts` — config tests

**Dependencies:** none

### Task 2: Route records and markers carry execution mode and per-host placement
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/route-record-store.test.ts` for each Done-when check.
2. Verify RED.
3. Add `execution?: 'leaf'` and `placements?: Readonly<Record<ChildId, HostPlacement>>` to `RouteRecord`, `HostPlacement {state: 'deferred' | 'placed'; leafEntryTip: CommitSha; exitTip?: CommitSha}`, and `execution?: 'leaf'` to `RepairMarker`; extend the record and marker parsers in `route-record-store.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] A record with `kind: 'audit'`, `execution: 'leaf'` and `placements: {1: {state: 'deferred', leafEntryTip}}` round-trips through the route-record store's write and read unchanged.
- [test] The record parser refuses a record with `kind: 'operator'` or `kind: 'revalidate'` carrying `execution: 'leaf'`, and refuses a placement keyed by a child that is not in `hosts`.
- [test] A marker blob `{host, roundId, execution: 'leaf'}` parses with `execution` preserved, and a marker without the field parses with `execution` undefined.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-types.ts` — new fields and `HostPlacement`
- `src/conductor/src/engine/routing/route-record-store.ts` — parse and validate
- `src/conductor/test/engine/routing/route-record-store.test.ts` — store tests

**Dependencies:** none

### Task 3: Audit admission freezes leaf execution into the record and marker
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-admission.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Pass `foldRoutedFixesOn(config)` from `Conductor.planRemediation` into `createRouteRecord`/`admitRound`; write `execution: 'leaf'` on the record and marker for `audit` rounds only; operator rounds (`openOperatorRound`) and revalidate admission (`admitQueuedRevalidation`) never write it.
4. Verify GREEN and commit.

**Done when:**
- [test] `admitRound` for an `audit` round with `fold_routed_fixes` unset writes `execution: 'leaf'` on both the stored route record and the `refs/conductor/<slug>/repairing` marker blob.
- [test] `admitRound` for an `audit` round with `fold_routed_fixes: false` writes no `execution` field on the record or the marker.
- [test] `openOperatorRound` and `admitQueuedRevalidation` with `fold_routed_fixes` unset and with it `false` write no `execution` field on their records or markers.
- [test] For a `prd_audit` FIXABLE finding bound to a child 1 task, the admitted record's item names child 1 as both `owner` and `host`, and `git symbolic-ref HEAD` still names the leaf branch after admission.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — execution field at admission
- `src/conductor/src/engine/conductor.ts` — pass the setting from `planRemediation`
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — admission tests

**Dependencies:** Tasks 1, 2

### Task 4: A leaf-executed host's region entry stays on the leaf and records its placement
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` for each Done-when check, using the existing three-child fixture.
2. Verify RED.
3. In `resolveHostEntryTarget`, return the leaf branch when the record carries `execution: 'leaf'`; in `enterHostRegion`, write `placements[k] = {state: 'deferred', leafEntryTip}` in the same CAS that marks the host `repairing`, keep `pinHostEntry`'s `pinnedBase` as the host closure, and write the frozen blocks to the leaf's plan copy; read the mode only from the record.
4. Verify GREEN and commit.

**Done when:**
- [test] `enterHostRegion` for host 1 of a leaf-executed audit round leaves `git symbolic-ref HEAD` at the leaf branch, commits the frozen rem blocks to the leaf's copy of the fixture plan file, and leaves child 1's `acceptance_specs`, `build`, `test_suite` and `build_review` `pending` in child 1's region state.
- [test] After that entry the stored record shows host 1 `repairing`, `placements[1].leafEntryTip` equal to the leaf HEAD before the block commit, and `entry.pinnedBase` equal to `refs/conductor/demo/closed/c1`.
- [test] Re-running `enterHostRegion` after the block commit appends no second block and switches no branch.
- [test] With the record's `execution: 'leaf'` and the config later set to `fold_routed_fixes: false`, `enterHostRegion` still keeps the leaf checked out.
- [test] For a record with no `execution` field, including an `operator` round on closed child 1 and a `revalidate` round for queued child 1, `enterHostRegion` switches the worktree to `feat/c1/demo` and writes no `placements` entry.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — leaf target, placement write
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — entry tests

**Dependencies:** Task 3

### Task 5: Leaf-executed hosts review against the leaf entry tip and resolve obligations on the leaf
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/host-region-entry.obligation.test.ts` and `src/conductor/test/engine/build-review-inputs.test.ts` (add the routed case beside existing base-kind tests) for each Done-when check.
2. Verify RED.
3. Set the routed obligation `branch` to the leaf and `head` to `leafEntryTip` for a leaf-executed host; in the `routed-repair` arm of `build-review-inputs.ts`, use `placements[host].leafEntryTip` as the base when the record carries `execution: 'leaf'`.
4. Verify GREEN and commit.

**Done when:**
- [test] For a leaf-executed host 1 with an `existing-task` item for T1, a leaf commit with `Task: T1` after region entry resolves the obligation, whose stored `branch` is the leaf branch.
- [test] The `routed-repair` review base resolved for leaf-executed host 1 equals `placements[1].leafEntryTip`, so the graded diff contains only commits after region entry and none of child 1's pre-closure commits.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — obligation branch and head
- `src/conductor/src/engine/build-review-inputs.ts` — routed-repair base
- `src/conductor/test/engine/routing/host-region-entry.obligation.test.ts` — obligation test
- `src/conductor/test/engine/build-review-inputs.test.ts` — base test

**Dependencies:** Task 4

### Task 6: The round stamp writes `Round:` and `Owner:` on the leaf and overwrites builder values
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-hook-assets-round-stamp.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. In `runRoundStamp`, when the marker carries `execution: 'leaf'` and the current branch is the leaf, replace any existing `Round:` and `Owner:` trailers with the marker's round and `c<host>` (or `leaf` when the host is the leaf); keep today's behaviour for markers without `execution`.
4. Verify GREEN and commit.

**Done when:**
- [test] With a leaf-executed marker for host 1, a commit on the leaf produces a message whose trailers are exactly one `Round: <roundId>` and one `Owner: c1`.
- [test] With that marker, a commit message pre-written with `Owner: c3` and `Round: r9` ends with `Owner: c1` and the marker's `Round:`, with no `c3` or `r9` trailer left.
- [test] With a leaf-executed marker whose host is the leaf, a commit on the leaf carries `Owner: leaf`; with no marker, or with an `operator` or `revalidate` round marker, a commit carries no `Owner:` trailer, and the existing round-stamp tests for those cases pass unchanged.
- [test] The frozen-block commit written by `enterHostRegion` for leaf-executed host 1, and a plain `git commit` of a tracked file made on the leaf during host 1's region, each carry the marker's `Round:` and `Owner: c1`.

**Files likely touched:**
- `src/conductor/src/engine/round-stamp-cli.ts` — leaf stamping with replace
- `src/conductor/test/engine/git-hook-assets-round-stamp.realgit.test.ts` — stamp tests

**Dependencies:** Tasks 2, 4

### Task 7: The commit-msg hook rejects a leaf commit without the marker's trailers
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-hook-assets-round-stamp.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Add `round-stamp --verify <msgfile>` to `detectRoundStampCommand`/`runRoundStamp`: under a leaf-executed marker on the leaf, exit 1 unless the message has exactly the marker's `Round:` and `Owner:`, and exit 1 on any marker or message read failure; elsewhere exit 0. Call it from the commit-msg hook in `git-hook-assets.ts` after the chained repository hook, without `|| true`, and stop swallowing a non-zero `round-stamp` exit in prepare-commit-msg only under a leaf-executed marker.
4. Verify GREEN and commit.

**Done when:**
- [test] With a leaf-executed marker, a repository commit-msg hook that strips `Owner:` makes `git commit` on the leaf exit non-zero, and no commit is created.
- [test] With a leaf-executed marker whose blob is unreadable, `git commit` on the leaf exits non-zero, and no commit is created.
- [test] With no marker, `round-stamp --verify` exits 0, and a commit on any branch succeeds as today.

**Files likely touched:**
- `src/conductor/src/engine/round-stamp-cli.ts` — `--verify` mode
- `src/conductor/src/engine/git-hook-assets.ts` — commit-msg invocation
- `src/conductor/test/engine/git-hook-assets-round-stamp.realgit.test.ts` — hook tests

**Dependencies:** Task 6

### Task 8: The stack-commit guard admits the leaf and refuses the host branch under leaf execution
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-commit-guard.hook.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. In `runStackCommitGuard`, when the marker carries `execution: 'leaf'`, treat the leaf as the execution branch: admit tracked commits there, and refuse them on the host's own branch and other children with recovery text naming the leaf branch.
4. Verify GREEN and commit.

**Done when:**
- [test] With a leaf-executed marker for host 1, a tracked commit on `feat/daemon-demo` exits 0 and the commit exists.
- [test] With that marker, a tracked commit on `feat/c1/demo` is refused, and the refusal text contains `feat/daemon-demo`.
- [test] With a marker without `execution`, the existing refusal for a tracked commit on `feat/daemon-demo` naming `feat/c1/demo` is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/stack-commit-guard-cli.ts` — execution-branch rule
- `src/conductor/test/engine/stack-commit-guard.hook.realgit.test.ts` — guard tests

**Dependencies:** Task 2

### Task 9: A leaf-executed host's prerequisite claim is a failed attempt, not a reroute
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. In `settleRoutedBuildClaim`, when the record carries `execution: 'leaf'`, return the ordinary failed-attempt result without calling `verifyPrerequisiteClaim` or `rerouteRound`.
4. Verify GREEN and commit.

**Done when:**
- [test] For leaf-executed host 1, a builder result `blocked-by-prerequisite` naming child 3 settles as a failed build attempt, `rerouteRound` is not called, and the stored record still has host 1 `repairing` and no `fallback` entry.
- [test] For a round without `execution`, the same claim still reaches `verifyPrerequisiteClaim`, as the existing reroute test asserts.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — leaf-executed refusal
- `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — claim tests

**Dependencies:** Task 2

### Task 10: A leaf-executed host exits deferred without a restack
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. In `requestRoutedExit`, for a host of a leaf-executed record (not the leaf), issue one `writeRoutingTransaction`: `update-record` with the host `done`, plus `placements[k].exitTip = HEAD` when `(leafEntryTip, HEAD]` is non-empty, or with `placements[k]` removed when it is empty; and `delete-marker`. Do not call `runRestack`, and do not acknowledge a queue entry. The leaf host keeps today's arm.
4. Verify GREEN and commit.

**Done when:**
- [test] After a commit in host 1's range, `requestRoutedExit` stores host 1 `done` with `placements[1] = {state: 'deferred', leafEntryTip, exitTip: <leaf HEAD>}`, deletes the marker, the injected `runRestack` spy is never called, and no `restack_planned` event is persisted.
- [test] For host 2 with no commit after its `leafEntryTip`, the exit stores host 2 `done` with no `placements[2]` entry.
- [test] For host 2 whose only commit is the frozen-block append, the exit stores `placements[2].state` `deferred`.
- [test] With a queue entry for child 1 present before host 1's exit, the queue ref is unchanged after the exit, and `admitQueuedRevalidation` then admits a `revalidate` round for child 1 whose entry target is `feat/c1/demo`.
- [test] For a leaf host in a leaf-executed round, the exit stores the leaf `done` with no placement entry.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — deferred exit arm
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` — exit tests

**Dependencies:** Task 4

### Task 11: The conductor runs a multi-host audit round on the leaf with no restack
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write a failing real-git conductor test in `src/conductor/test/engine/routing/conductor-routed-leaf-execution.realgit.test.ts` driving `Conductor` with a stubbed step runner through a round with hosts 1, 3 and the leaf.
2. Verify RED.
3. Make `continueRoutedHostExit` and the routing continuation follow a deferred exit to the next host on the leaf without a branch switch, and return to the leaf through `returnToLeaf`'s existing re-pend.
4. Verify GREEN and commit.

**Done when:**
- [test] Through `Conductor` loop dispatch, hosts 1, 3 and the leaf each dispatch `build` while `feat/daemon-demo` is checked out, in that order, and `.pipeline/events.jsonl` contains no `restack_planned` line before the round's record reads `closed`.
- [test] After the round closes, `prd_audit`, `architecture_review_as_built` and `manual_test` are `pending` on the leaf once, and the stored record shows hosts 1 and 3 `deferred`.
- [test] With an open leaf-executed round, the stack preflight runs no automatic `feature-repair` restack, and no `restack_planned` line is appended.
- [test] Across four consecutive leaf-executed audit rounds driven through `Conductor` before the gates converge, no `restack_planned` line with `cause: 'feature-repair'` is appended.
- [test] With `fold_routed_fixes: false`, the same round's host 1 `build` dispatches while `feat/c1/demo` is checked out, and its exit appends a `restack_planned` line with `cause: 'feature-repair'`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — routed continuation on the leaf
- `src/conductor/test/engine/routing/conductor-routed-leaf-execution.realgit.test.ts` — conductor test

**Dependencies:** Tasks 5, 8, 10

### Task 12: Base refresh and completion wait while any host is deferred
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/round-admission.realgit.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts` and `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Add `deferredPlacementsExist(worktree, slug)` beside `routedRoundOpen` in `round-admission.ts`, true when any route record has a placement with `state: 'deferred'`. Call it, in addition to `routedRoundOpen`, at the base-refresh deferral sites: `daemon-rekick.ts`, the stacked base refresh in `Conductor.runRebaseStepBody`, the stack preflight's base-refresh follow-on, and `restack-recovery.ts`'s `base-refresh` follow-on. Also call it in the routed-work check of `Conductor.completeRun`. Leave `routedRoundOpen` and its leaf-return and resume callers unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `deferredPlacementsExist` returns `true` for a stack whose only route record is `closed` but holds `placements[1].state` `deferred`, and `false` once that placement reads `placed`, while `routedRoundOpen` returns `false` in both cases.
- [test] A daemon re-kick with that deferred placement emits `restack_refused` with reason `deferred-base-refresh`, moves no ref, and keeps the re-kick sentinel.
- [test] A daemon re-kick with no deferred placement, no open round and an empty queue runs its `base-refresh` restack as today.
- [test] With a deferred placement and a closed round, the routed leaf return still restores whole-feature state and dispatches `manual_test`, and `Conductor.completeRun` returns `false` without writing terminal state.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — `deferredPlacementsExist`
- `src/conductor/src/engine/daemon-rekick.ts` — base-refresh deferral
- `src/conductor/src/engine/restack/stack-preflight.ts` — base-refresh follow-on deferral
- `src/conductor/src/engine/restack/restack-recovery.ts` — follow-on deferral
- `src/conductor/src/engine/conductor.ts` — rebase-step and completion checks
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — predicate test
- `src/conductor/test/engine/daemon-rekick.test.ts` — re-kick test
- `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` — leaf-return and completion test

**Dependencies:** Task 2

### Task 13: The fold set is collected from deferred boundary ranges and validated
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/fold-plan.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Create `src/conductor/src/engine/restack/fold-plan.ts` with `collectFoldSet({worktree, slug, git})`: for each route record placement `deferred`, list `rev-list --first-parent --reverse leafEntryTip..exitTip`, and require each commit to be a non-merge carrying exactly the range host's `Round:` and `Owner:`; otherwise return `{kind: 'refused', reason: 'fold-owner-invalid', commit, host}`.
4. Verify GREEN and commit.

**Done when:**
- [test] `collectFoldSet` returns host 1's and host 3's range commits in leaf order, and excludes leaf commits outside every range: the leaf's own build commit, an operator commit, and a halt-record commit.
- [test] A range commit carrying `Owner: c2` inside host 1's range returns `fold-owner-invalid` naming that commit's SHA and host 1.
- [test] A merge commit inside host 1's range returns `fold-owner-invalid` naming the merge SHA.
- [test] A placement already `placed`, a leaf host, and a host whose exit left no placement entry each contribute no commits, and an operator commit made inside host 1's range is returned among host 1's commits.

**Files likely touched:**
- `src/conductor/src/engine/restack/fold-plan.ts` — `collectFoldSet`
- `src/conductor/test/engine/restack/fold-plan.realgit.test.ts` — collection tests

**Dependencies:** Task 2

### Task 14: Fold placement puts each part on the lowest accepting child at or above its owner
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/fold-plan.realgit.test.ts` for each Done-when check, using the identity and ten-players fixture from the stories.
2. Verify RED.
3. Add `placeFoldCommits` to `fold-plan.ts`: frozen-block append commits become block re-materializations on the placement child through the rem-block merge used by `writeFrozenBlocks`; commits that started empty are placed whole; other commits are split per path, then per hunk, and each part is probed with `merge-tree --write-tree --merge-base` from the placement child upward, landing on the lowest clean child (else the leaf) with reason `owner` or `introduced-above-owner`. Return a typed `FoldPlan`.
4. Verify GREEN and commit.

**Done when:**
- [test] For host 1's commit editing `src/server/identity.ts` and `tests/load/ten-players.ts`, `placeFoldCommits` returns a part on child 1 with paths `[src/server/identity.ts]` and reason `owner`, and a part on child 3 with paths `[tests/load/ten-players.ts]` and reason `introduced-above-owner`.
- [test] An empty `tdd` evidence commit in host 1's range is placed whole on child 1, as one part with no paths.
- [test] Host 1's frozen-block append commit is placed on child 1 as a block re-materialization carrying the same `(roundId, id)` block bodies, not a hunk part.

**Files likely touched:**
- `src/conductor/src/engine/restack/fold-plan.ts` — `placeFoldCommits`, `FoldPlan`
- `src/conductor/test/engine/restack/fold-plan.realgit.test.ts` — placement tests

**Dependencies:** Task 13

### Task 15: A host whose work all lands above it halts as misrouted
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/fold-plan.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. After placement, for each deferred host require at least one non-empty part on its placement child; otherwise return `{kind: 'refused', reason: 'fold-misrouted', host, findingIds, acceptingChildren}`, using the finding ids from the route record items hosted there.
4. Verify GREEN and commit.

**Done when:**
- [test] When host 2's only commit edits a file that only child 4's tree accepts, the plan returns `fold-misrouted` naming host 2, its finding ids from the route record, and `acceptingChildren: [4]`.
- [test] When every deferred host has a non-empty part on its placement child, no refusal is returned.

**Files likely touched:**
- `src/conductor/src/engine/restack/fold-plan.ts` — misrouted check
- `src/conductor/test/engine/restack/fold-plan.realgit.test.ts` — misrouted tests

**Dependencies:** Task 14

### Task 16: The `fold` restack replays placed commits through the journaled executor
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-fold.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Add `'fold'` to `RestackCause`. Make `runRestack({cause: 'fold'})` call `collectFoldSet` and `placeFoldCommits`, journal the `FoldPlan` before any staging ref exists, and have `planRestackRanges` extend each target child's own range with its placed commits (author and message preserved, `Folded-from: <sha>` appended) and drop folded source commits from the leaf range. Extend owned paths with placed paths in `restack-ownership.ts`. Make every switch over `RestackCause` exhaustive.
4. Verify GREEN and commit.

**Done when:**
- [test] After an applied fold on the three-child fixture, `feat/c1/demo`, `feat/c3/demo` and their `refs/conductor/demo/closed/c<k>` refs point at new tips whose placed commits keep the source commit's author, subject and body, and append `Folded-from: <source sha>`.
- [test] After the fold, `git log feat/daemon-demo` contains no folded source SHA, and still contains the leaf's own build commit.
- [test] The restack journal read before the move transaction holds the `FoldPlan` with each source SHA, owner, placement child and parts.
- [test] A fold whose journal exists but whose move did not run recovers to either every ref moved or every ref at its pre-fold value.

**Files likely touched:**
- `src/conductor/src/types/restack.ts` — `'fold'` cause
- `src/conductor/src/engine/restack/restack-plan.ts` — placed ranges and leaf drop set
- `src/conductor/src/engine/restack/restack-executor.ts` — fold planning and journal
- `src/conductor/src/engine/restack/restack-ownership.ts` — placed owned paths
- `src/conductor/test/engine/restack/restack-fold.realgit.test.ts` — fold executor tests

**Dependencies:** Tasks 14, 15

### Task 17: A fold that would change the leaf tree moves nothing
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-fold.realgit.test.ts` for each Done-when check, injecting a resolver result that alters `src/server/identity.ts`.
2. Verify RED.
3. Before the move transaction, compare the staged leaf tip's tree with the pre-fold leaf tip's tree; on mismatch, emit `restack_refused` with reason `fold-tree-mismatch`, and write a needs-human halt through the existing `restack/restack-conflict-halt.ts` path naming each differing path and the fold-set commits that touched it.
4. Verify GREEN and commit.

**Done when:**
- [test] With the injected resolver change, `restack_refused` carries reason `fold-tree-mismatch`, the HALT text names `src/server/identity.ts` and the source SHA that touched it, and every branch and closure ref equals its pre-fold value.
- [test] With an unresolvable conflict replaying child 4, the fold halts as the existing unresolved restack conflict naming child 4, and no ref moves.
- [test] With child 1 at its cascade cap, the fold halts with the existing cap evidence naming child 1, and no restack journal ref is created.
- [test] A `fold-misrouted` or `fold-owner-invalid` plan result makes `runRestack({cause: 'fold'})` write a needs-human HALT naming that result's host and commit or finding ids, and for `fold-misrouted` its accepting children, and every branch and closure ref equals its pre-fold value.
- [test] With an identical staged leaf tree and no plan refusal, the move transaction runs, `feat/c1/demo` moves to its placed tip, and no `.pipeline/HALT` is written.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — leaf-tree identity check
- `src/conductor/test/engine/restack/restack-fold.realgit.test.ts` — refusal tests

**Dependencies:** Task 16

### Task 18: The fold's `applied` transaction marks placements, queues changed children and charges cascades
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-fold.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Carry every affected route record's old and new values in the fold journal. In the `applied` transaction, write each folded placement `placed`, record the fold's new leaf tree in the record's `leafReturn` field, write one revalidation generation listing every non-leaf child whose tree changed, and charge one cascade per target child on the `cascades` ref.
4. Verify GREEN and commit.

**Done when:**
- [test] After a fold that placed parts on children 1 and 3 of a five-child fixture, the stored route records show those placements `placed`, and the revalidation queue generation lists exactly children 1, 2, 3 and 4.
- [test] The `cascades` ref shows children 1 and 3 each incremented by one after the fold, and no other child changed.
- [test] A second `runRestack({cause: 'fold'})` after that apply plans nothing and emits no `restack_planned` line.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — applied transaction writes
- `src/conductor/src/engine/restack/restack-transition.ts` — queue generation for fold
- `src/conductor/test/engine/restack/restack-fold.realgit.test.ts` — applied tests

**Dependencies:** Task 16

### Task 19: Other restacks remap deferred boundary tips through their commit map
**Story:** Story 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-fold-remap.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. For every non-fold restack whose ranges include the leaf while any placement is `deferred`, carry those route records in the journal and, in the `applied` transaction, rewrite `leafEntryTip` and `exitTip` through the journal's old-to-new commit map; when a tip has no image, refuse with `restack_refused` reason `fold-boundary-lost` and a needs-human halt naming the host, before any ref moves.
4. Verify GREEN and commit.

**Done when:**
- [test] After an operator round's `feature-repair` restack on child 2 replays the leaf, the stored `placements[1].leafEntryTip` and `exitTip` equal the replayed images of the original tips, and `collectFoldSet` returns exactly host 1's replayed commits, for which `placeFoldCommits` returns the same child, paths and reason per part as on the fixture without that restack.
- [test] When that restack drops host 1's exit-tip commit as empty, it emits `restack_refused` with reason `fold-boundary-lost`, the HALT names host 1, and every ref equals its pre-restack value.
- [test] When the `applied` transaction loses the route record compare-and-swap, the restack rolls back and writes the existing contested-writer HALT, and `placements[1]` is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — remap in applied transaction
- `src/conductor/test/engine/restack/restack-fold-remap.realgit.test.ts` — remap tests

**Dependencies:** Tasks 12, 16

### Task 20: The FINISH `rebase` step folds, then admits the queue in the same run, in every mode
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-rebase-fold.realgit.test.ts` for each Done-when check, driving `Conductor` through the `rebase` step.
2. Verify RED.
3. In `Conductor.runRebaseStepBody`, before the interactive `noop` return and (daemon) after `stackPreflight`, run `runRestack({cause: 'fold'})` when every route record is closed, the queue is empty, no marker exists and a placement is `deferred`; if the queue is then non-empty, call `admitQueuedRevalidation` and navigate to the admitted child's `acceptance_specs` as `continueRoutedHostExit` does.
4. Verify GREEN and commit.

**Done when:**
- [test] Through `Conductor` dispatch of the `rebase` step with hosts deferred from rounds r1 to r4, exactly one `restack_planned` line with `cause: 'fold'` is appended, `feat/c1/demo` then holds the `src/server/identity.ts` change and `feat/c3/demo` the `tests/load/ten-players.ts` change, and the next dispatched step is child 1's `acceptance_specs` on `feat/c1/demo`.
- [test] With `daemon` unset and a deferred placement, the `rebase` step still runs the fold before recording its `noop` outcome.
- [test] With no deferred placement, the `rebase` step appends no `cause: 'fold'` line, and its base-refresh behaviour matches the existing stacked rebase-step test.
- [test] Driving that run until the queue drains with every gate passing appends exactly one `child_revalidated` line per child 1, 2, 3 and 4 for the fold's generation, and while the queue is non-empty the `rebase` step emits `restack_refused` `deferred-base-refresh`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — fold trigger and queue admission in `runRebaseStepBody`
- `src/conductor/test/engine/conductor-rebase-fold.realgit.test.ts` — rebase-step tests

**Dependencies:** Tasks 12, 18

### Task 21: Publication refuses while any host is deferred
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-child-divergence.test.ts` for each Done-when check.
2. Verify RED.
3. At the start of `establishChildPrs`, read the route records; if any placement is `deferred`, return a needs-human refusal naming each deferred host and round, before any push or PR creation.
4. Verify GREEN and commit.

**Done when:**
- [test] With `placements[1].state` `deferred`, `establishChildPrs` returns a needs-human refusal naming host 1 and its round, and the injected push and `pull-request.create` operations are never called.
- [test] With every placement `placed`, `establishChildPrs` proceeds to `pushChildClosure` for each child, as the existing publication test asserts.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — deferred-placement refusal
- `src/conductor/test/engine/finish-publication-child-divergence.test.ts` — refusal tests

**Dependencies:** Task 2

### Task 22: The fold-mode leaf return keeps verified leaf verdicts and navigates to `rebase`
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Add `mode: 'fold'` to `returnToLeaf`, selected when the drained queue generation was written by a fold. When the leaf tip's tree equals the tree recorded by the fold's `applied` transaction, skip `restageLeafGates` and navigate to `rebase`; otherwise re-pend the leaf gates as today. `abandon` mode is unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] After a fold and a queue drain with no re-validation commit, `prd_audit`, `architecture_review_as_built` and `manual_test` keep their satisfied verdicts, and the next dispatched step is `rebase`, which then runs the deferred base refresh and reaches `establishChildPrs`, which pushes `feat/c1/demo` and `feat/c3/demo` containing the `Folded-from` commits and creates a draft PR for each child.
- [test] After a fold whose child 2 re-validation committed a fix that moved the leaf tree, those three gates read `pending` on the leaf.
- [test] When a new audit round opened by those re-run gates closes, the next `rebase` step's fold set holds only that round's deferred hosts.
- [test] An abandoned `operator` round still returns through `abandon` mode and re-pends no whole-feature gate, as the existing abandon test asserts.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — `returnToLeaf` fold mode
- `src/conductor/src/engine/conductor.ts` — navigation to `rebase`
- `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` — leaf-return tests

**Dependencies:** Tasks 18, 20

### Task 23: A verified prerequisite claim during fold re-validation halts naming the fix and both children
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. In `settleRoutedBuildClaim`, for a `revalidate` round whose queue generation was written by a fold, run `verifyPrerequisiteClaim`; when it verifies, write a needs-human halt with reason `fold-prerequisite-missing` naming the `Folded-from` source SHA on the child's branch, the revalidated child and the claimed child, and do not call `rerouteRound`. An unverified claim stays an ordinary failed attempt under the child's region caps.
4. Verify GREEN and commit.

**Done when:**
- [test] In child 1's fold-produced revalidate round, a verified claim naming child 3 writes a needs-human HALT whose text contains the `Folded-from` SHA, `child 1` and `child 3`, and `rerouteRound` is not called.
- [test] In that round, an unverified claim counts one failed build attempt on child 1, and no HALT is written.
- [test] In a revalidate round not produced by a fold, a verified claim still reroutes, as the existing reroute test asserts.
- [test] A failing `test_suite` in child 1's fold-produced revalidate round records a kickback in child 1's region, and the fix commit's exit appends `restack_planned` with `cause: 'feature-repair'` originating at child 1.
- [test] When child 2 exhausts its region caps in a fold-produced revalidate round, the existing cap HALT names child 2, and `establishChildPrs` is never called.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — fold-produced halt
- `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — claim tests

**Dependencies:** Task 18

### Task 24: `stack rounds` shows placements, and close preserves them
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-rounds-inspect.realgit.test.ts` and `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. In `describeRoutingRounds` and `renderRoutingRounds`, add each host's execution mode and placement state. In `checkRoundSupersession`, treat a `done` host with a `deferred` placement as settled; `supersedeRound` writes no change to `placements`.
4. Verify GREEN and commit.

**Done when:**
- [test] `ai-conductor stack rounds --slug demo` output for round r2 with host 1 `deferred` contains host 1 with `execution leaf` and `placement deferred`.
- [test] `stack rounds --close r2 --reason x` on a sole round whose only unsettled host is `deferred` succeeds, the stored record still has `placements[1].state` `deferred`, and a following `rebase` step dispatch appends a `restack_planned` line with `cause: 'fold'`.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — listing and close predicate
- `src/conductor/test/engine/stack-rounds-inspect.realgit.test.ts` — listing test
- `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` — close test

**Dependencies:** Tasks 2, 20

### Task 25: Restack resolver attempts and folds are attributed on the spine and in OTel
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-fold.realgit.test.ts`, `src/conductor/test/engine/otel/span-manager.test.ts` and `src/conductor/test/engine/otel/metrics.test.ts` for each Done-when check.
2. Verify RED.
3. Add `fold_planned {opId, commits: [{sha, roundId, owner, placements: [{child, paths, reason}]}]}` and `restack_planned.roundId?` to `ConductorEvent`. Add `restack?: {opId, cause, roundId?}` to `ProviderAttemptEvent`, and to `ResolutionContext` in `rebase.ts`. Pass it from the executor through `resolveRestackConflict` to `resolveRebaseConflict`, which dispatches with an `executionContext` carrying it. In the span manager, set `conductor.restack.op_id`, `conductor.restack.cause` and `conductor.round`. In metrics, add `restack_cause` to the dispatch and step-cost dimension keys, never a round or opId label.
4. Verify GREEN and commit.

**Done when:**
- [test] A fold whose replay invokes the injected resolver persists a `provider_attempt` line with `restack.opId` equal to that fold's `restack_planned.opId` and `restack.cause` `fold`, plus one `fold_planned` line listing each source SHA with its round and owner, and each placed part's child, paths and reason.
- [test] A routed `feature-repair` restack in round r5 persists `restack_planned` with `roundId: 'r5'` and a resolver `provider_attempt` whose `restack` is `{opId: <that restack's opId>, cause: 'feature-repair', roundId: 'r5'}`.
- [test] `SpanManager.onProviderAttempt` for that attempt sets `conductor.restack.op_id`, `conductor.restack.cause` and `conductor.round` on the resolver span.
- [test] The metrics recorder emits a step-cost data point with attribute `restack_cause` `fold`, and no data point attribute key contains `round` or `op_id`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — `fold_planned`, `roundId`, `restack` field
- `src/conductor/src/engine/rebase.ts` — `ResolutionContext.restack`
- `src/conductor/src/engine/restack/restack-resolver.ts` — pass restack identity
- `src/conductor/src/engine/restack/restack-executor.ts` — emit `fold_planned` and pass identity
- `src/conductor/src/engine/step-runners.ts` — resolver dispatch execution context
- `src/conductor/src/engine/otel/span-manager.ts` — span attributes
- `src/conductor/src/engine/otel/metrics.ts` — `restack_cause` dimension
- `src/conductor/test/engine/restack/restack-fold.realgit.test.ts` — event tests
- `src/conductor/test/engine/otel/span-manager.test.ts` — span test
- `src/conductor/test/engine/otel/metrics.test.ts` — metrics test

**Dependencies:** Task 16

### Task 26: The shipped record carries a `## Restack` block for stacked features
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/shipped-record.test.ts` and `src/conductor/test/engine/kpi-report.test.ts` for each Done-when check.
2. Verify RED.
3. Add `appendRestackSection(content, events)` to `shipped-record.ts`. For a stacked feature, it renders `## Restack` with one row per `roundId` and per fold or base-refresh `opId`, each giving resolver runs and summed `costUsd` from `provider_attempt` lines whose `step` is `rebase`, plus an `unattributed` row for attempts with no `restack` field. It is placed after `## Children` when present, otherwise after `## Time`. Call it from the existing FINISH shipped-record writer. N=1 features get no block.
4. Verify GREEN and commit.

**Done when:**
- [test] For a stacked feature with two fold resolver attempts ($0.50, $1.00), one round r5 `feature-repair` attempt ($0.40), one base-refresh attempt ($0.10) and one legacy attempt ($0.25), the `## Restack` block has a fold row (2 runs, $1.50), an `r5` row (1, $0.40), a base-refresh row (1, $0.10) and an `unattributed` row (1, $0.25), and the rows sum to $2.25.
- [test] A stacked feature with no `rebase` attempts gets a `## Restack` block showing 0 runs and $0.00, placed immediately after `## Time` when there is no `## Children` block, and immediately after `## Children` when there is one.
- [test] An N=1 feature's shipped record is byte-identical to the existing golden rendering and contains no `## Restack` heading.
- [test] `kpi-report` cost for a record carrying a `## Restack` block equals the value parsed from its `## Cost` block alone.

**Files likely touched:**
- `src/conductor/src/engine/shipped-record.ts` — `## Restack` block
- `src/conductor/test/engine/shipped-record.test.ts` — block tests
- `src/conductor/test/engine/kpi-report.test.ts` — kpi parity test

**Dependencies:** Task 25

### Task 27: The hand-moved-closure check keeps comparing the host closure under leaf execution
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/stack-preflight-leaf-host.realgit.test.ts` for each Done-when check.
2. Verify RED.
3. Ensure the stack preflight's routed-host closure check compares `refs/conductor/<slug>/closed/c<host>` with `entry.pinnedBase` (the host closure) and never with `placements[host].leafEntryTip`.
4. Verify GREEN and commit.

**Done when:**
- [test] With leaf-executed host 1 `repairing`, the leaf HEAD past `leafEntryTip`, and `closed/c1` equal to `entry.pinnedBase`, `runStackPreflight` writes no HALT and returns a continuing result.
- [test] With that host and `closed/c1` moved by hand to another commit, `runStackPreflight` halts needs-human naming `refs/conductor/demo/closed/c1`, its value and the pinned value.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — closure comparison under leaf execution
- `src/conductor/test/engine/restack/stack-preflight-leaf-host.realgit.test.ts` — preflight tests

**Dependencies:** Task 4

### Task 28: Deferred placements fold regardless of the current setting, and N=1 stays untouched
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-rebase-fold.realgit.test.ts` and `src/conductor/test/engine/n1-golden-routing-guard.test.ts` for each Done-when check.
2. Verify RED.
3. Make the `rebase` step's fold trigger read only route-record placements, never `foldRoutedFixesOn`; extend the N=1 routing guard's recorded-argv assertion to the `fold` cause.
4. Verify GREEN and commit.

**Done when:**
- [test] With host 1 `deferred` from a round admitted while the setting was on, and the config then set to `fold_routed_fixes: false`, the `rebase` step still appends a `restack_planned` line with `cause: 'fold'`.
- [test] For an N=1 feature driven through the `rebase` step, the `PATH`-shimmed `git` in the N=1 routing guard records no argv touching any `refs/conductor/<slug>/` ref, including routes, `repairing`, `revalidate` and restack journal refs, no `restack_planned` line with `cause: 'fold'` is appended, and the existing N=1 golden rendering tests pass byte-identical.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — fold trigger reads placements only
- `src/conductor/test/engine/conductor-rebase-fold.realgit.test.ts` — setting-flip test
- `src/conductor/test/engine/n1-golden-routing-guard.test.ts` — N=1 guard

**Dependencies:** Task 20

## Integration Points

- **After Task 11:** a leaf-executed audit round runs end to end through `Conductor` with no restack.
- **After Task 20:** the FINISH `rebase` step folds and admits re-validation through `Conductor`.
- **After Task 22:** the fold-mode leaf return hands back to `rebase`, and publication (Task 21)
  then runs with every fix in its owner's branch.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D1 | task | task-1, task-3 | `admitRound` for an `audit` round with `fold_routed_fixes: false` writes no `execution` field on the record or the marker |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D2 | task | task-9 | `rerouteRound` is not called, and the stored record still has host 1 `repairing` and no `fallback` entry |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D3 | task | task-4, task-5, task-8 | leaves `git symbolic-ref HEAD` at the leaf branch, commits the frozen rem blocks to the leaf's copy of the fixture plan file |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D4 | task | task-6, task-7 | a commit on the leaf produces a message whose trailers are exactly one `Round: <roundId>` and one `Owner: c1` |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D5 | task | task-10 | the injected `runRestack` spy is never called, and no `restack_planned` event is persisted |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D6 | task | task-12, task-20, task-21 | exactly one `restack_planned` line with `cause: 'fold'` is appended |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D7 | task | task-13, task-14, task-15 | returns `fold-misrouted` naming host 2, its finding ids from the route record, and `acceptingChildren: [4]` |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D8 | task | task-16, task-18 | placed commits keep the source commit's author, subject and body, and append `Folded-from: <source sha>` |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D9 | task | task-17, task-18, task-23 | `restack_refused` carries reason `fold-tree-mismatch` |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D10 | task | task-22 | the next dispatched step is `rebase`, which then runs the deferred base refresh |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D11 | task | task-25, task-26 | persists a `provider_attempt` line with `restack.opId` equal to that fold's `restack_planned.opId` |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D12 | task | task-19 | it emits `restack_refused` with reason `fold-boundary-lost`, the HALT names host 1 |
| adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish#D13 | task | task-24 | the stored record still has `placements[1].state` `deferred` |
| adr-2026-10-12-routed-whole-feature-repair#D1 | existing | none | Routing eligibility and classification-first entry are `routingEligible` and `resolveStackedRoute` in `Conductor.planRemediation` (`src/conductor/src/engine/conductor.ts`); unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | existing | none | Task-bound owner derivation is `deriveTaskBoundOwner` in `src/conductor/src/engine/routing/owner-derivation.ts`; unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | existing | none | Residue routing is `runResidueRoutingCall` in `src/conductor/src/engine/routing/residue-routing-call.ts`; unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | task | task-4 | the stored record shows host 1 `repairing`, `placements[1].leafEntryTip` equal to the leaf HEAD before the block commit |
| adr-2026-10-12-routed-whole-feature-repair#D5 | task | task-9, task-23 | writes a needs-human HALT whose text contains the `Folded-from` SHA, `child 1` and `child 3`, and `rerouteRound` is not called |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-2, task-24 | round-trips through the route-record store's write and read unchanged |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-8, task-12 | `deferredPlacementsExist` returns `true` for a stack whose only route record is `closed` but holds `placements[1].state` `deferred` |
| adr-2026-10-12-routed-whole-feature-repair#D8 | existing | none | `resolveExecutionChild` in `src/conductor/src/engine/routing/execution-child.ts` stays the one resolver and returns host k under leaf execution. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | task | task-4, task-5 | resolves the obligation, whose stored `branch` is the leaf branch |
| adr-2026-10-12-routed-whole-feature-repair#D10 | existing | none | Receipt settlement is unchanged in `src/conductor/src/engine/routing/round-receipt.ts`. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | task | task-5 | resolves the obligation, whose stored `branch` is the leaf branch |
| adr-2026-10-12-routed-whole-feature-repair#D12 | task | task-5 | the graded diff contains only commits after region entry and none of child 1's pre-closure commits |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-10, task-11 | the injected `runRestack` spy is never called, and no `restack_planned` event is persisted |
| adr-2026-10-12-routed-whole-feature-repair#D14 | task | task-18 | the revalidation queue generation lists exactly children 1, 2, 3 and 4 |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-22 | keep their satisfied verdicts, and the next dispatched step is `rebase` |
| adr-2026-10-12-routed-whole-feature-repair#D16 | existing | none | Routing events still ride the route-record outbox drained by `drainRoutingOutbox`; `fold_planned` is a restack event emitted directly, like `restack_planned`. |
| adr-2026-10-12-routed-whole-feature-repair#D17 | existing | none | `routingEligible` is false for a flat cursor, so N=1 never reaches admission, stamping or the fold; `n1-golden-routing-guard.test.ts` keeps guarding the route refs. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | existing | none | `routingSettingOn` reads `stacked_prs.route_whole_feature_fixes`; unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | existing | none | Only `hasDurableChildState` features enter `runRestack`; the fold cause is reachable only from routed placements. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | existing | none | `planRestackRanges` range computation is unchanged for non-fold causes in `src/conductor/src/engine/restack/restack-plan.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | task | task-16, task-17 | every branch and closure ref equals its pre-fold value |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | task | task-16 | The restack journal read before the move transaction holds the `FoldPlan` |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | existing | none | The single `update-ref --stdin` move and worktree sync are `restack-move.ts` and `syncRestackedWorktree`; unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-17 | the fold halts as the existing unresolved restack conflict naming child 4, and no ref moves |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | existing | none | `runStackPreflight` stays the one shared preflight in `src/conductor/src/engine/restack/stack-preflight.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | existing | none | Verdict transitions stay `applyRestackTransition`; an identical leaf tree yields its existing `noop` outcome. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | task | task-20 | the `rebase` step still runs the fold before recording its `noop` outcome |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | task | task-18 | The `cascades` ref shows children 1 and 3 each incremented by one after the fold |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | existing | none | Expected-SHA leases in `push-lease.ts` are unchanged; the fold pushes nothing. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-25 | plus one `fold_planned` line listing each source SHA with its round and owner |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | existing | none | The proof-obligation suites for replay and move remain; the fold adds its own real-git suites rather than changing them. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-rem-S1.4: Add task 11's Conductor-level test. It drives hosts 1, 3 and the leaf through a leaf-executed audit round on feat/daemon-demo and asserts no restack_planned line appears before the round closes. Land it after the S1.9 leaf-placement fix.
**Gate:** prd-audit
**Rationale:** Approved ADR adr-2026-11-08 and plan task 11 specify this. Task-status marks task 11 completed, but its Conductor-level test is absent. This is conforming test drift with no architectural decision needed, so it goes to BUILD under task 11.
**Criterion:** S1.4
**Parent task:** 11
**Done when:**
- [test] S1.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S1.4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S1.5: Add task 11's tests. Cover four consecutive leaf-executed rounds with no feature-repair restack_planned line, the suppression of preflight while a round is open, and the owner-branch path when fold_routed_fixes is false.
**Gate:** prd-audit
**Rationale:** Plan task 11 specifies the four-round test, but the test is absent even though task-status marks the task completed. This is conforming test drift, so it goes to BUILD.
**Criterion:** S1.5
**Parent task:** 11
**Done when:**
- [test] S1.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S1.5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S1.9: Stop creating a placement for the leaf host (host-region-entry.ts:580-588), and exempt the leaf before the deferred branch (routed-exit.ts:381-396). Add task 10's test that a leaf host exits done with no placement entry.
**Gate:** prd-audit
**Rationale:** ADR D5 and task 10's done-when require a leaf host to exit with no placement entry. host-region-entry.ts and routed-exit.ts lack a leaf special case. This is conforming implementation drift, so it goes to BUILD.
**Criterion:** S1.9
**Parent task:** 10
**Done when:**
- [test] S1.9 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S1.9 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S1.16: Wire collectFoldSet and placeFoldCommits into a production fold restack so that in-range operator commits are folded (task 16).
**Gate:** prd-audit
**Rationale:** Plan task 16 specifies the fold restack that folds in-range operator commits. The planner functions exist, but production code never calls them. This is conforming implementation drift, so it goes to BUILD.
**Criterion:** S1.16
**Parent task:** 16
**Done when:**
- [test] S1.16 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S1.16 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S2.5: Make round-stamp --verify fail closed on an unreadable leaf marker blob (round-stamp-cli.ts:74) and on a git execution error (:114). Add task 7's realgit test that a leaf commit with an unreadable marker is rejected and not created.
**Gate:** prd-audit
**Rationale:** ADR D4 and task 7's done-when require verification to reject an unreadable leaf marker. round-stamp-cli.ts:74 returns 0 before the verify check. This is conforming implementation drift, so it goes to BUILD.
**Criterion:** S2.5
**Parent task:** 7
**Done when:**
- [test] S2.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S2.5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S2.7: Restore the no-marker contract: round-stamp --verify exits 0 when no marker exists, and the commit-msg hook permits unrelated commits. Rework the git-hook-assets-round-stamp realgit test to assert no-marker success and leaf-marker rejection as separate cases.
**Gate:** prd-audit
**Rationale:** Task 7's done-when keeps no-marker commits succeeding as they do today. The rewritten hook test drops that coverage, and the unconditional hook rejects whenever the launcher fails. The fix restores the planned behavior and its coverage, so it goes to BUILD.
**Criterion:** S2.7
**Parent task:** 7
**Done when:**
- [test] S2.7 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S2.7 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.1: Make the FINISH rebase step run a fold restack through collectFoldSet and placeFoldCommits when deferred placements exist, placing identity.ts on child 1 and ten-players.ts on child 3.
**Gate:** prd-audit
**Rationale:** ADR D6 and plan task 20 require the rebase step to run the fold. conductor.ts only defers the base refresh, so it goes to BUILD.
**Criterion:** S3.1
**Parent task:** 20
**Done when:**
- [test] S3.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.2: Implement fold replay that appends `Folded-from: <source sha>` and preserves the source commit's author, subject and body.
**Gate:** prd-audit
**Rationale:** ADR D8 and task 16 specify fold replay with a Folded-from trailer, and no such replay exists. This is conforming implementation drift, so it goes to BUILD.
**Criterion:** S3.2
**Parent task:** 16
**Done when:**
- [test] S3.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.3: Implement the fold move transaction. Move the child branches and closure refs to their placed tips, and remove the folded source commits from the leaf.
**Gate:** prd-audit
**Rationale:** Task 16 specifies the fold move of the leaf, the child branches and the closure refs, and no move exists. This goes to BUILD.
**Criterion:** S3.3
**Parent task:** 16
**Done when:**
- [test] S3.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.4: Add the fold_planned event to the ConductorEvent union. Emit it from the fold restack with each source SHA, its round and owner, and each part's child, paths and reason.
**Gate:** prd-audit
**Rationale:** ADR D11 and task 25 specify the fold_planned event, which is absent. This is conforming spine-extension work, so it goes to BUILD.
**Criterion:** S3.4
**Parent task:** 25
**Done when:**
- [test] S3.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.5: Replay empty tdd evidence commits whole on their owner child during the fold.
**Gate:** prd-audit
**Rationale:** Task 16 requires empty evidence commits to be replayed whole. The planner handles them, but no replay exists, so this goes to BUILD.
**Criterion:** S3.5
**Parent task:** 16
**Done when:**
- [test] S3.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.6: Have the rebase step gather the deferred ranges from every round into a single fold restack.
**Gate:** prd-audit
**Rationale:** Task 20 requires the rebase step to plan one fold across rounds, and that is absent. This goes to BUILD.
**Criterion:** S3.6
**Parent task:** 20
**Done when:**
- [test] S3.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.6 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.7: Implement the fold's applied transaction, which moves folded placements to 'placed' in the route records.
**Gate:** prd-audit
**Rationale:** Task 18 specifies the applied transaction that marks placements placed. No code writes that state, so this goes to BUILD.
**Criterion:** S3.7
**Parent task:** 18
**Done when:**
- [test] S3.7 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.7 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.8: Make the applied fold leave out-of-range leaf, operator and halt-record commits on the leaf, and assert this in task 16's tests.
**Gate:** prd-audit
**Rationale:** Task 16 requires out-of-range commits to stay on the leaf after an applied fold. No fold applies, so this goes to BUILD.
**Criterion:** S3.8
**Parent task:** 16
**Done when:**
- [test] S3.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.10: Make the refusal in finish-publication-production.ts:980 name the deferred host and its round. Add task 21's test that push and pull-request.create are never called.
**Gate:** prd-audit
**Rationale:** Task 21 requires the publication refusal to name the deferred host and its round. The current detail names neither, so this goes to BUILD.
**Criterion:** S3.10
**Parent task:** 21
**Done when:**
- [test] S3.10 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.10 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.11: Run the fold in every rebase-step mode, including before the noop return in conductor.ts when daemon is unset.
**Gate:** prd-audit
**Rationale:** Task 20 requires the fold to run in every mode. conductor.ts:17777 returns the interactive noop first, so this goes to BUILD.
**Criterion:** S3.11
**Parent task:** 20
**Done when:**
- [test] S3.11 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.11 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S3.12: Extend the restack journal to cause 'fold' with the FoldPlan: each source SHA, owner, placement child and parts. Make recovery end with every ref moved or every ref at its pre-fold value.
**Gate:** prd-audit
**Rationale:** ADR D8 and task 16 specify a fold journal and its recovery, and both are absent. This goes to BUILD.
**Criterion:** S3.12
**Parent task:** 16
**Done when:**
- [test] S3.12 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S3.12 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.1: Add a per-host check to the fold plan that the host's placement child receives a non-empty part. Refuse with fold-misrouted when it does not.
**Gate:** prd-audit
**Rationale:** ADR D7 and task 15 require a check that each host's placement child receives a part, and that check is absent. This goes to BUILD.
**Criterion:** S4.1
**Parent task:** 15
**Done when:**
- [test] S4.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.2: Compare the staged leaf tree for equality before the fold move transaction runs.
**Gate:** prd-audit
**Rationale:** ADR D9 and task 17 specify the staged-leaf-tree comparison, which is absent. This goes to BUILD.
**Criterion:** S4.2
**Parent task:** 17
**Done when:**
- [test] S4.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.3: Add 'fold-misrouted' to the FoldPlan refusal reasons, carrying the host, its finding ids from the route record, and acceptingChildren.
**Gate:** prd-audit
**Rationale:** Task 15 specifies the fold-misrouted refusal, which is absent from fold-plan.ts. This goes to BUILD.
**Criterion:** S4.3
**Parent task:** 15
**Done when:**
- [test] S4.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.4: Make runRestack({cause:'fold'}) turn a fold-owner-invalid plan result into a needs-human HALT naming the host and the commit, with no ref moved.
**Gate:** prd-audit
**Rationale:** Task 17 requires a fold-owner-invalid result to become a needs-human HALT, and no caller does that. This goes to BUILD.
**Criterion:** S4.4
**Parent task:** 17
**Done when:**
- [test] S4.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.5: Surface the merge-commit fold-owner-invalid refusal as a needs-human HALT naming the merge SHA.
**Gate:** prd-audit
**Rationale:** Task 17 requires the merge-commit refusal to surface as a halt, and it does not. This goes to BUILD.
**Criterion:** S4.5
**Parent task:** 17
**Done when:**
- [test] S4.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.6: Add the 'fold-tree-mismatch' restack refusal reason, with a HALT naming the changed path and the source SHA that touched it.
**Gate:** prd-audit
**Rationale:** ADR D9 and task 17 specify fold-tree-mismatch, which is absent. This goes to BUILD.
**Criterion:** S4.6
**Parent task:** 17
**Done when:**
- [test] S4.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.6 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.7: Route an unresolvable fold replay conflict through the existing unresolved-restack-conflict halt, naming the child and moving no ref.
**Gate:** prd-audit
**Rationale:** Task 17 requires fold conflicts to use the existing unresolved-conflict halt. No fold replay exists, so this goes to BUILD.
**Criterion:** S4.7
**Parent task:** 17
**Done when:**
- [test] S4.7 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.7 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S4.8: Check the cascade caps of fold targets before writing the fold restack journal, and halt with the existing cap evidence.
**Gate:** prd-audit
**Rationale:** Task 17 requires a cascade-cap check before the journal is written, and that check is absent. This goes to BUILD.
**Criterion:** S4.8
**Parent task:** 17
**Done when:**
- [test] S4.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S4.8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S5.1: Have the fold's applied transaction enqueue a revalidation generation for the changed children and their descendants.
**Gate:** prd-audit
**Rationale:** Task 18 specifies the queue generation for the fold's applied transaction, which is absent. This goes to BUILD.
**Criterion:** S5.1
**Parent task:** 18
**Done when:**
- [test] S5.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S5.1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S5.2: Admit the fold's revalidation queue in the same rebase-step run.
**Gate:** prd-audit
**Rationale:** Task 20 specifies same-run queue admission after a fold, which is absent. This goes to BUILD.
**Criterion:** S5.2
**Parent task:** 20
**Done when:**
- [test] S5.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S5.2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S5.3: Emit child_revalidated for each child in the fold generation as the queue drains, and refuse deferred-base-refresh while the queue is non-empty.
**Gate:** prd-audit
**Rationale:** Task 20 specifies child_revalidated events per child in the fold's generation, which are absent. This goes to BUILD.
**Criterion:** S5.3
**Parent task:** 20
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S5.3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S5.4: Handle kickbacks and exits in fold-produced revalidate rounds as child-region feature-repair originating at that child.
**Gate:** prd-audit
**Rationale:** Task 23 specifies kickback and exit handling in fold-produced rounds, which is absent. This goes to BUILD.
**Criterion:** S5.4
**Parent task:** 23
**Done when:**
- [test] S5.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S5.4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S5.5: Make a verified prerequisite claim in a fold-produced revalidate round write a HALT naming the Folded-from SHA and both children, without calling rerouteRound (prerequisite-claim.ts).
**Gate:** prd-audit
**Rationale:** ADR D9 and task 23 require a verified claim in fold revalidation to halt. prerequisite-claim.ts reroutes instead, so this goes to BUILD.
**Criterion:** S5.5
**Parent task:** 23
**Done when:**
- [test] S5.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S5.5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S5.6: Add task 23's test that region-cap exhaustion in fold-produced revalidation writes the existing cap HALT and never calls establishChildPrs.
**Gate:** prd-audit
**Rationale:** Task 23 requires proof of the cap halt in fold revalidation, which is absent. This goes to BUILD.
**Criterion:** S5.6
**Parent task:** 23
**Done when:**
- [test] S5.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S5.6 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S6.1: Add the fold returnToLeaf mode in routed-exit.ts. Keep satisfied whole-feature verdicts when the leaf tree is unchanged, and navigate to rebase.
**Gate:** prd-audit
**Rationale:** ADR D10 and task 22 specify the fold returnToLeaf mode, which is absent. This goes to BUILD.
**Criterion:** S6.1
**Parent task:** 22
**Done when:**
- [test] S6.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S6.1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S6.2: Drive fold, queue drain, rebase, then establishChildPrs, so that the child PRs contain the Folded-from commits.
**Gate:** prd-audit
**Rationale:** Task 22 requires an end-to-end fold that reaches publication, which is absent. This goes to BUILD.
**Criterion:** S6.2
**Parent task:** 22
**Done when:**
- [test] S6.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S6.2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S6.3: Re-pend prd_audit, architecture_review_as_built and manual_test when fold revalidation changed the leaf tree.
**Gate:** prd-audit
**Rationale:** Task 22 requires gates to re-pend after a fold-produced leaf change, and that is absent. This goes to BUILD.
**Criterion:** S6.3
**Parent task:** 22
**Done when:**
- [test] S6.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S6.3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S6.4: Make a later fold collect only the new round's deferred hosts and exclude placements already placed.
**Gate:** prd-audit
**Rationale:** Task 22 requires a second fold to exclude placed hosts, and that is absent. This goes to BUILD.
**Criterion:** S6.4
**Parent task:** 22
**Done when:**
- [test] S6.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S6.4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.1: Add restack context {opId, cause, roundId} to provider_attempt for resolver attempts, including fold opIds.
**Gate:** prd-audit
**Rationale:** ADR D11 and task 25 specify restack context on provider_attempt, which is absent. This goes to BUILD.
**Criterion:** S7.1
**Parent task:** 25
**Done when:**
- [test] S7.1 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.2: Add roundId to restack_planned, and add restack attribution to resolver provider_attempt lines.
**Gate:** prd-audit
**Rationale:** Task 25 specifies restack_planned.roundId and resolver attribution, which are absent. This goes to BUILD.
**Criterion:** S7.2
**Parent task:** 25
**Done when:**
- [test] S7.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.3: Set conductor.restack.op_id, conductor.restack.cause and conductor.round on resolver spans in SpanManager. Add a bounded restack_cause metric attribute, with no round or op_id keys.
**Gate:** prd-audit
**Rationale:** Task 25 specifies the span attributes and the bounded metric dimension, which are absent. This goes to BUILD.
**Criterion:** S7.3
**Parent task:** 25
**Done when:**
- [test] S7.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.4: Add the `## Restack` block to the shipped-record writer for stacked features.
**Gate:** prd-audit
**Rationale:** Task 26 specifies the shipped-record Restack block, which is absent. This goes to BUILD.
**Criterion:** S7.4
**Parent task:** 26
**Done when:**
- [test] S7.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.5: Render fold, per-round, base-refresh and unattributed rows in the Restack block, summing to the total restack cost.
**Gate:** prd-audit
**Rationale:** Task 26 specifies the Restack rows, including an unattributed row, and they are absent. This goes to BUILD.
**Criterion:** S7.5
**Parent task:** 26
**Done when:**
- [test] S7.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.8: Always write the Restack block for stacked features, including the 0 runs / $0.00 case, and never for N=1.
**Gate:** prd-audit
**Rationale:** Task 26 requires the block for every stacked feature, including one at zero cost. It is absent, so this goes to BUILD.
**Criterion:** S7.8
**Parent task:** 26
**Done when:**
- [test] S7.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.9: Place the Restack block immediately after `## Children`, or after `## Time` when there is no Children block.
**Gate:** prd-audit
**Rationale:** Task 26 specifies where the block is placed, and the block is absent. This goes to BUILD.
**Criterion:** S7.9
**Parent task:** 26
**Done when:**
- [test] S7.9 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.9 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S7.10: Add the kpi-report test showing that cost for a record with a Restack block equals the value parsed from `## Cost` alone.
**Gate:** prd-audit
**Rationale:** Task 26 plans a kpi-report test for this, and the test is absent. This goes to BUILD.
**Criterion:** S7.10
**Parent task:** 26
**Done when:**
- [test] S7.10 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S7.10 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S8.6: Make the rebase-step fold run for existing deferred placements whatever the current fold_routed_fixes value. Add task 28's test.
**Gate:** prd-audit
**Rationale:** Task 28 requires deferred placements to fold even after the setting is turned off. No fold exists, so this goes to BUILD.
**Criterion:** S8.6
**Parent task:** 28
**Done when:**
- [test] S8.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S8.6 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S8.8: Render each host's execution mode and placement state in the stack-rounds-cli.ts output.
**Gate:** prd-audit
**Rationale:** ADR D13 and task 24 specify execution and placement output, which is absent from stack-rounds-cli.ts. This goes to BUILD.
**Criterion:** S8.8
**Parent task:** 24
**Done when:**
- [test] S8.8 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S8.8 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S8.9: Preserve deferred placements on `stack rounds --close`, and fold them on the next rebase-step dispatch.
**Gate:** prd-audit
**Rationale:** Task 24 requires close to preserve deferred placements and the next rebase to fold them. This goes to BUILD.
**Criterion:** S8.9
**Parent task:** 24
**Done when:**
- [test] S8.9 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S8.9 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S9.2: Remap every deferred placement's leafEntryTip and exitTip through the restack commit map in the applied transaction.
**Gate:** prd-audit
**Rationale:** ADR D12 and task 19 specify boundary remapping, which is absent. This goes to BUILD.
**Criterion:** S9.2
**Parent task:** 19
**Done when:**
- [test] S9.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S9.2 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S9.3: Add task 19's test that collectFoldSet and placeFoldCommits return the same parts after a remapping feature-repair restack.
**Gate:** prd-audit
**Rationale:** Task 19 requires proof that collect and place results are stable after a remap. This goes to BUILD.
**Criterion:** S9.3
**Parent task:** 19
**Done when:**
- [test] S9.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S9.3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S9.4: Let the deferred base refresh run once the fold has left no deferred placements.
**Gate:** prd-audit
**Rationale:** Task 22 requires the deferred base refresh to run after a fold clears deferral. No fold exists, so this goes to BUILD.
**Criterion:** S9.4
**Parent task:** 22
**Done when:**
- [test] S9.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S9.4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S9.5: Add the fold-boundary-lost refusal for a restack that drops a deferred host's exit-tip commit. It halts naming the host and leaves every ref at its pre-restack value.
**Gate:** prd-audit
**Rationale:** Task 19 specifies fold-boundary-lost, which is absent. This goes to BUILD.
**Criterion:** S9.5
**Parent task:** 19
**Done when:**
- [test] S9.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S9.5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-S9.6: Include route records in the restack applied transaction's compare-and-swap. If it loses, roll back and write the contested-writer HALT.
**Gate:** prd-audit
**Rationale:** Task 19 requires route records in the applied CAS, and they are absent. This goes to BUILD.
**Criterion:** S9.6
**Parent task:** 19
**Done when:**
- [test] S9.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-S9.6 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-1: Call collectFoldSet from the fold restack planner that the FINISH rebase step reaches.
**Gate:** as-built
**Rationale:** collectFoldSet has no production caller. The approved ADR decides the behavior, and tasks 13, 16 and 20 admit the wiring. This is conforming drift.
**Parent task:** 13
**Governing clause:** Task 13
**Done when:**
- Task 13 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-1 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-2: Call placeFoldCommits from the fold restack planner that the FINISH rebase step reaches.
**Gate:** as-built
**Rationale:** placeFoldCommits has no production caller. Tasks 14, 16 and 20 admit the wiring. This is conforming drift.
**Parent task:** 14
**Governing clause:** Task 14
**Done when:**
- Task 14 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-2 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-3: Dispatch the fold from the rebase step in conductor.ts, before the interactive noop return (:17777) and before the deferred base-refresh refusal (:17857).
**Gate:** as-built
**Rationale:** ADR D6 requires FINISH to dispatch the fold, and it does not. Task 20 admits the fix.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 6
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 6 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-3 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-4: Probe placements in fold-plan.ts against accumulated placement trees instead of the reloaded branch tips. Add the per-host non-empty check with a fold-misrouted refusal carrying finding ids and accepting children.
**Gate:** as-built
**Rationale:** ADR D7 requires accumulated placement trees and the fold-misrouted check, and both are missing. Tasks 14 and 15 admit the fix.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 7
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 7 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-4 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-5: Add cause 'fold' to the restack types and journal, with the FoldPlan's source-to-placement correspondence. In restack-executor.ts, apply the fold atomically: remove source commits, keep author and message with Folded-from, charge targets, and mark placements placed.
**Gate:** as-built
**Rationale:** ADR D8's journaled fold replay is absent. Tasks 16 and 18 admit it.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 8
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 8 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-5 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-6: Add the fold leaf-tree equality guard with fold-tree-mismatch, and the queue generation for children a fold changed. Add the halt for a verified prerequisite claim during fold revalidation, naming Folded-from and both children.
**Gate:** as-built
**Rationale:** ADR D9's fold acceptance and revalidation integration are absent. Tasks 17, 18 and 23 admit them.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 9
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 9 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-6 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-7: Add the fold returnToLeaf mode in routed-exit.ts with a recorded fold-tree comparison. Keep satisfied whole-feature verdicts and navigate to rebase.
**Gate:** as-built
**Rationale:** ADR D10's fold return mode is absent. Task 22 admits it.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 10
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 10 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-7 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-8: Add the fold cause, restack_planned.roundId, fold_planned, and restack context on provider_attempt. Add the span attributes, the bounded restack_cause metric dimension, and the shipped-record Restack block.
**Gate:** as-built
**Rationale:** ADR D11's restack attribution is missing across all of its consumers. Tasks 25 and 26 admit it.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 11
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 11 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-8 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-9: Represent every deferred route record in the restack journal, remap leafEntryTip and exitTip through the commit map, and refuse with fold-boundary-lost when an exit-tip commit is dropped.
**Gate:** as-built
**Rationale:** ADR D12's boundary preservation is missing. Task 19 admits it.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 12
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 12 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-9 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-10: Render each host's execution mode and deferred or placed state in stack-rounds-cli.ts.
**Gate:** as-built
**Rationale:** ADR D13's round inspection omits execution and placement. Task 24 admits the fix.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 13
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 13 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-10 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-11: Make round-stamp --verify reject an unreadable marker and git execution errors for leaf-executed work, while keeping success when no marker exists.
**Gate:** as-built
**Rationale:** ADR D4 requires verification to fail closed, and round-stamp-cli.ts fails open. Task 7 admits the fix.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 4
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 4 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-11 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-12: Persist the leaf entry boundary placement before committing frozen blocks (host-region-entry.ts:515-585), and on the derived-complete return (:566). In routed-exit.ts, stop treating a missing boundary as unchanged so block-only work is folded.
**Gate:** as-built
**Rationale:** ADR D4 requires the leaf entry boundary to be durable before any mutation. Tasks 4 and 10 own region entry and exit placement, so they admit this ordering fix.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 4
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 4 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-12 is committed and its targeted tests pass.

### Task rem-as-built-rem-asb-13: Exempt the leaf host from placement creation and from deferred retention, so leaf-only fixes do not block completion or publication.
**Gate:** as-built
**Rationale:** ADR D5 says the actual leaf host is not deferred, but the code defers it. Task 10's done-when admits the fix.
**Governing clause:** adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 5
**Done when:**
- adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish decision 5 is satisfied by this task.
- The repair for task rem-as-built-rem-asb-13 is committed and its targeted tests pass.
