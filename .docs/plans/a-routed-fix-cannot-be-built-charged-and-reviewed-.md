# Implementation Plan: Build, charge and review a routed fix on the child that hosts it

**Date:** 2026-10-15
**Design:** .docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md
**Stories:** .docs/stories/a-routed-fix-cannot-be-built-charged-and-reviewed-.md
**Conflict check:** Clean as of 2026-10-15 (.docs/conflicts/a-routed-fix-cannot-be-built-charged-and-reviewed-.md)
**Scope-exception:** Operator decision 2026-10-15 during #3211 DECIDE: deliver spec C (ADR decisions 5 and 9–12 for the routed-repair pass, plus the items spec B moved here) as one spec of 34 tasks rather than splitting it, because a split leaves the first half building a host with nothing charged.

## Summary

This is spec C of four for `adr-2026-10-12-routed-whole-feature-repair` (decision 18).
- It enters a routed host's region and writes the frozen rem blocks on the host's own branch.
- It stamps and checks membership by round and child.
- It proves the host's acceptance specs green.
- It charges each round exactly once at the host's BUILD dispatch.
- It binds repair obligations to the host's branch.
- It grades the repair against a pinned base under a per-round credit.
- It moves a round upward only on a verified builder claim.

Routing stays dark behind `stacked_prs.route_whole_feature_fixes` (default `false`). The plan has 34
tasks. Ids 33, 39, 47–50, 52–70, 72 and 74 continue the design-time numbering; ids 200–202 and 204–207 are new to this spec.

## Technical Approach

Governing review: `.docs/decisions/architecture-review-2026-10-15-a-routed-fix-cannot-be-built-charged-and-reviewed-.md`
(findings F1–F17, conflict resolutions B1–B3, D1–D7 and R1–R4). Paths below are under `src/conductor/src/engine/`.

- **Record shape first (Task 200).** `routing/route-types.ts` replaces the opaque `RoundReceipt` with
  a typed receipt and adds the fields everything else reads:
  - the typed receipt holds per-gate `laps`, declared `growth`, `taskless` counters, an optional
    `settlementId`, per-host `acks`, and `echo` entries for custom-step charges;
  - per-host `entry {pinnedBase, tree}`;
  - per-item `taskIds` (existing-task items) and `obligation {branch, head, tree}`;
  - a record-level `fallback[]` and `reroute` phase payload.

  The closed parser maps `{}` to unsettled-empty and fails closed on everything else.
- **One fenced writer (Task 201).** `writeRoutingTransaction` in `routing/route-record-store.ts`
  gains the ops `update-branch`, `create-pin` and `update-marker`. Every write in this spec goes
  through it, so the journal `verify` line rides every transaction.
  - *Pattern:* spec B's `admitRound` marker transaction. Keep one `update-ref --stdin`, explicit old
    values, the outbox entry in the same blob, and a `cas-failed` result that is never retried
    blindly.
  - *Allowed variation:* which refs the ops name.
- **Host region entry (Tasks 48, 49, 50, 47, 56).** `routing/host-region-entry.ts`
  `enterHostRegion` runs in this order:
  1. the journal check;
  2. the entry pin, by its own CAS;
  3. a verify-or-switch to the host branch through `childBranchFor` / `leafBranchFor` and
     `switchToChild`;
  4. the `audit` restage, once per `(roundId, host)`;
  5. `writeFrozenBlocks`, which lives in `remediation-append.ts`, the single appender. It commits
     through `commitEngineChangeWhenStacked` with a `Round:` trailer;
  6. obligation admission and the restage (Task 69), then the task-status seed;
  7. the no-op guard;
  8. one `admitted→repairing` transaction carrying the obligation bindings and the
     `routed_repair_phase {credit: true}` outbox entry.

  `reconcileRounds` gains a `repairing` resume arm. It verifies the branch, reconciles the
  obligations and the seed, and never re-appends or restages. The `revalidate` arm of the `RouteKind`
  switch returns a refusal that names #3212.
- **Membership (Tasks 52, 54, 55, 39).**
  - The prepare-commit-msg hook delegates to a new `ai-conductor round-stamp` subcommand
    (`round-stamp-cli.ts`, registered in the commander program). It returns unchanged when
    `routingEligible` is false.
  - Membership reads the committed `**Child:**` line through the shipped `readRemTaskChildLine`,
    then the cache, and refuses when neither is present.
  - Seal rotation unions in the frozen-allocation ids.
  - `task-cli.ts` and the membership hook authorize the current host's routed ids (execution
    projection) while task status stays flat.
  - *Pattern:* the `task-membership-check` delegation in `git-hook-assets.ts` and
    `task-membership-check-cli.ts`.
- **Acceptance (Tasks 53, 207).**
  - `closeChild` writes `red/c<k>` only with routing on and a RED marker present, and accepts a
    same-digest blob on resume.
  - A routed pass runs `verifyGreenAcceptance` instead of `selfHealAcceptanceRed`, and emits
    `acceptance_red` with `mode: verify-green`.
- **Budgets (Tasks 60–67, 65, 33).**
  - `routing/round-receipt.ts` `settleRoundAtDispatch` replaces the `settlePendingRepair` call in the
    BUILD settlement closure (`settleBuildPendingRepair` in `conductor.ts`) when the execution child
    carries `routedRepair`.
  - It always holds the kickback-ledger lease, runs an unlocked `reconcileReceiptLedger` first, and
    checks every cap before its CAS.
  - The ledger is written only after the CAS. A lost CAS acknowledges only proven settlement.
  - `chargeTasklessAtAdmission` charges `manual_test` before any routing ref exists.
  - Custom-step kickbacks keep today's `bumpKickbackGateInLedger` and add a receipt echo.
  - *Pattern:* `settlePendingRepair` and `settlementReceipts` in `kickback-ledger.ts`. Presence of
    the id means the charge is applied; apply under the lease; never refund.
- **Obligations (Tasks 68–70).**
  - `admitRoutedObligation` keys by `(roundId, findingId, taskIds)`.
  - The route record is authoritative, and `engine-state.json` is reconciled from it.
  - Trailer resolution reads `head..tip(branch)` through a branch-aware variant of
    `listCommitsWithTrailersAfterRepairBoundary`.
- **Review (Tasks 72, 74).**
  - `resolveChildBase` gains a `routed-repair` kind that returns the pinned base, and testQuality
    receives the same SHA.
  - `routedRepairCredit {roundId}` lives in the host child ledger and is consumed before the
    cumulative-bound halt.
- **Reroute (Tasks 204, 57, 58, 59, 206).**
  - A routed build dispatch requests an optional terminal structured result.
  - `verifyPrerequisiteClaim` checks paths with `ls-tree` and symbols as exported names, plus the
    work order's prerequisite inputs (`classifyCitedPaths`).
  - `rerouteRound` runs one fenced transaction, then `completeRerouteSync` runs `read-tree -m -u`.
  - *Pattern:* `syncRestackedWorktree` in `restack/restack-sync.ts`.
- **Parity (Task 205).** The N=1 golden guard and a routing-off parity test cover every new reader.

**Fixture.** Tests use the three-child stack from the stories: slug `demo`, closed `feat/c1/demo`
and `feat/c2/demo`, the leaf `feat/daemon-demo`, round `r1`, and frozen `rem-prd-audit-T1` for host
1. Real-git tests commit `.ai-conductor/config.yml` before building a routed resume (memory gotcha
routed-resume-fixtures-must-commit-config).

## Prerequisites

- Spec A (#2944, #3219) and spec B (#3210, #3243) are on main: route types and parsers, ref names,
  `writeRoutingTransaction`, `createRouteRecord`, `transitionHost`, `admitRound`,
  `reconcileRounds`, `allocateFrozenBlocks`, `resolveExecutionChild`, `routedRepairPhaseEvent`,
  and the default-off setting.

## Task Dependency Graph

```text
200 ─┬─ 201 ─┬─ 48 ─ 49 ─┬─ 50
     │       │           ├─ 47
     │       │           ├─ 55
     │       │           ├─ 54 ─ 39
     │       │           └─ 69 ─ 56
     │       ├─ 60 ─┬─ 61
     │       │      ├─ 62 ─ 63 ─ 64
     │       │      ├─ 66
     │       │      └─ 65 ─┬─ 67
     │       │             └─ 33
     │       └─ 58 ─ 59
     ├─ 202 ─ 68 ─┬─ 69
     │            └─ 70
     └─ 72 ─ 74
52 (after 201) ; 53 ─ 207 (after 48) ; 204 ─ 57 ─ 58 ; 206 (after 57, 59) ; 205 (after 49, 52, 55, 58, 62)
```

## Integration Points

- After Task 49: a routed round admitted by spec B reaches `repairing` on host 1 with its blocks committed on `feat/c1/demo`.
- After Task 60: a routed host's BUILD dispatch charges the round once.
- After Task 59: a verified builder claim moves the round upward.

## Tasks

### Task 200: Typed route-record fields for receipts, entry pins, bindings and reroutes
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/route-types.test.ts` — parse a record carrying a settled receipt, an unsettled `{}` receipt, a malformed receipt, an `entry` pin, an `existing-task` item with and without `taskIds`, an `obligation` binding with a valid and an invalid branch name, and a `fallback` entry.
2. Verify RED
3. Implement: in `src/conductor/src/engine/routing/route-types.ts`, replace `RoundReceipt` with a typed shape `{laps, growth, taskless, echo, settlementId?, acks}` and add `HostEntry {pinnedBase, tree}`, `RoutedItem.taskIds`, `RoutedItem.obligation {branch, head, tree}`, `RouteRecord.fallback` and `RouteRecord.reroute` (phase payload `{sourceBranch, rejectedTip, resetTip, destination}`). Extend the closed parser: `{}` is an unsettled empty receipt; any other unparseable receipt, an `existing-task` item without `taskIds`, or an obligation branch that fails `git check-ref-format --branch` rules makes the record malformed.
4. Verify GREEN, commit.

**Done when:**
- [test] `parseRouteRecord` returns a record whose receipt is unsettled with zero laps and growth for a stored receipt of `{}`, and returns `malformed` for a receipt of `{laps: "x"}`.
- [test] `parseRouteRecord` returns `malformed` for an `existing-task` routed item with no `taskIds`, and for an obligation binding whose branch is `feat/../x`.
- [test] `parseRouteRecord` round-trips a record carrying a settled receipt with `settlementId`, an `acks` entry, an `entry` pin, a `fallback` entry and a `reroute` payload, byte-identical through serialize then parse.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-types.ts` — typed fields and parser
- `src/conductor/test/engine/routing/route-types.test.ts` — parser tests

**Dependencies:** none

### Task 201: The fenced writer gains branch, pin and marker ops, and every new writer uses it
**Story:** 9
**Type:** infrastructure

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/route-writers-journal.realgit.test.ts` — a journal in state `moved`; an `update-branch`, `create-pin` and `update-marker` transaction; a journal created between the read and the transaction by an injected writer; a structural test over `src/conductor/src/engine/` source files.
2. Verify RED
3. Implement: extend `RoutingTransactionOp` in `src/conductor/src/engine/routing/route-record-store.ts` with `update-branch {ref, old, new}` (only `refs/heads/feat/…`), `create-pin {ref, new}` (only under `refs/conductor/<slug>/rejected/`) and `update-marker {old, new}`, rendered into the same `update-ref --stdin` transaction that starts with the journal `verify` line. Add a structural test that fails when any source file other than `route-record-store.ts` writes a `refs/conductor/<slug>/routes/` or `repairing` ref.
4. Verify GREEN, commit.

**Done when:**
- [test] with the journal in `moved`, `writeRoutingTransaction` with an `update-branch`, a `create-pin` or an `update-marker` op returns `restack-journal-open` and `routes/r1`, `feat/c1/demo` and `refs/conductor/demo/repairing` keep their prior SHAs.
- [test] with no journal, one transaction carrying `update-branch`, `create-pin` and `update-marker` ops moves all three refs, and the recorded stdin begins with a `verify refs/conductor/demo/restack/journal` line.
- [test] with an injected writer creating the journal ref between the read and the transaction, the transaction fails on the journal `verify` line and no ref named in it moves.
- [test] the structural test in `src/conductor/test/structural/routing-ref-writers.test.ts` fails on a fixture source file that writes `refs/conductor/demo/routes/r1` outside `route-record-store.ts`, allows deletions through `routingTeardownRefNames` in `restack-refs-cleanup.ts`, and passes on the shipped tree.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — new ops
- `src/conductor/test/engine/routing/route-writers-journal.realgit.test.ts` — fence tests
- `src/conductor/test/structural/routing-ref-writers.test.ts` — structural writer check

**Dependencies:** Task 200

### Task 202: The router records existing-task bindings and restricts no-restage to mixed rounds
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-router.test.ts` — an `existing-task` gap bound to `T1` in a round without FAIL rows, and an `existing-task` gap bound to `T2` in a mixed round with FAIL rows.
2. Verify RED
3. Implement: in `routeAdmittedRound` (`src/conductor/src/engine/routing/round-router.ts`), set `taskIds` (canonical order) on every `existing-task` routed item, and set `restage: false` only when the round carries `consolidatedManualTestFail` rows.
4. Verify GREEN, commit.

**Done when:**
- [test] `routeAdmittedRound` for an `existing-task` gap bound to `T1` with no FAIL rows returns an item with `taskIds: ['T1']` and no `restage` field.
- [test] `routeAdmittedRound` for a mixed round with FAIL rows and an `existing-task` gap bound to `T2` returns an item with `taskIds: ['T2']` and `restage: false`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — bindings and mixed-only no-restage
- `src/conductor/test/engine/routing/round-router.test.ts` — router tests

**Dependencies:** Task 200

### Task 48: Host region entry pins the base, switches to the host and restages its region once per round
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — host 1 `admitted` for `r1`; a leaf-only round; an uncommitted file in the worktree; a crash after the pin; host 1 already `repairing` with the worktree on another branch; a `revalidate` record; a conductor-level spy on `kickback` events and `navigateBack`.
2. Verify RED
3. Implement: `enterHostRegion({worktree, slug, roundId, host, emitter, git})` in `src/conductor/src/engine/routing/host-region-entry.ts`. Refuse while the journal is non-terminal. When the host has no `entry`, CAS-write `entry {pinnedBase, tree}` (`closed/c<h>` through `closureRefFor`, or the leaf tip read through `leafBranchFor`) by an `update-record` op before any other mutation; reuse a recorded pin. Resolve the branch with `childBranchFor`/`leafBranchFor`, and verify or switch through `switchToChild` (today's dirty-tree refusal). Restage `acceptance_specs`, `build`, `test_suite` and `build_review` in the host overlay (`createRoutedConductStateStore(worktree, host)`) by an exhaustive switch over `RouteKind` with no default arm; `revalidate` returns a refusal naming #3212. When the host is already `repairing` for `roundId`, verify the branch and return `resume` with no restage. Call it from the conductor's region entry when `resolveExecutionChild` returns `routed-host`. It never emits `kickback` and never calls `navigateBack`.
4. Verify GREEN, commit.

**Done when:**
- [test] `enterHostRegion` for host 1 `admitted` leaves `git symbolic-ref --short HEAD` at `feat/c1/demo`, child 1's region overlay with `acceptance_specs`, `build`, `test_suite` and `build_review` restaged pending, and `routes/r1` holding host 1's `entry.pinnedBase` equal to the `closed/c1` SHA, written before the first `git switch` and before any commit in the recorded argv.
- [test] with an uncommitted file in the worktree, `enterHostRegion` returns the `switchToChild` dirty-tree refusal naming that file and host 1 stays `admitted`; after a crash injected after the pin, a resumed `enterHostRegion` leaves `entry.pinnedBase` unchanged.
- [test] with host 1 already `repairing` for `r1` and the worktree on `feat/daemon-demo`, `enterHostRegion` switches to `feat/c1/demo` before returning `resume`, and child 1's region overlay is byte-identical to its value before the call, no rem block is appended to the plan, and no commit is created.
- [test] in the conductor-level test, admitting `r1` and running host 1's region entry records exactly one `kickback` event and one leaf `navigateBack` call for `r1`, and `enterHostRegion` itself records neither.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — new `enterHostRegion`
- `src/conductor/src/engine/conductor.ts` — region entry calls it for a routed host
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — entry tests

**Dependencies:** Task 201

### Task 49: Frozen blocks are written verbatim, seeded, and the host moves to repairing
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — block content and trailers, the `repairing` transaction, an idempotent replay, an id outside the frozen allocation, the commit fence; `src/conductor/test/engine/routing/stack-id-uniqueness.realgit.test.ts` — existing rem blocks on `feat/c1/demo` and on the leaf.
2. Verify RED
3. Implement: `writeFrozenBlocks({worktree, planPath, roundId, host, allocation, git})` in `src/conductor/src/engine/remediation-append.ts`. It parses existing `### Task <id>:` blocks, appends the stored body bytes for absent ids only, accepts an existing id only with an identical canonical body, refuses any id absent from the host's frozen allocation, and commits through `commitEngineChangeWhenStacked` with a `Round: <roundId>` trailer (add `remediation-append.ts` to `COMMIT_CALL_ALLOWLIST`). `enterHostRegion` calls it, then (after Task 69's obligation step) seeds task status with the execution projection, then writes one `admitted→repairing` transaction through `transitionHost` carrying the obligation bindings and the `routed_repair_phase` outbox entry. The `repairing` resume arm of `reconcileRounds` re-runs only the seed reconciliation.
4. Verify GREEN, commit.

**Done when:**
- [test] after `enterHostRegion` for host 1, each `### Task rem-` block in the fixture plan on `feat/c1/demo` is byte-identical to its stored frozen body, contains `**Child:** 1` and `**Round:** r1`, and the append commit carries a `Round: r1` trailer.
- [test] host 1 moves `admitted` to `repairing` through one `update-ref --stdin` transaction recorded after the append commit and after the task-status seed write in the ordered spy log.
- [test] replaying `writeFrozenBlocks` when a block with the same id and an identical canonical body exists returns success with no halt or refusal, appends nothing and creates no commit, and a block id absent from the frozen allocation is refused with nothing appended.
- [test] with a restack journal in `moved`, the append is refused by `commitEngineChangeWhenStacked`, no commit is created and `routes/r1` keeps its prior blob, and the engine-commit-sites structural test passes with `remediation-append.ts` in `COMMIT_CALL_ALLOWLIST`.
- [test] in `stack-id-uniqueness.realgit.test.ts`, with rem blocks already on `feat/c1/demo` and on the leaf, a round allocating work for `T1` and `T3` written by `writeFrozenBlocks` leaves no duplicated rem id or ordinal across the two plans.

**Files likely touched:**
- `src/conductor/src/engine/remediation-append.ts` — `writeFrozenBlocks`
- `src/conductor/src/engine/routing/host-region-entry.ts` — seed and `repairing` transaction
- `src/conductor/src/engine/routing/round-admission.ts` — `repairing` resume arm
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — block-writing tests
- `src/conductor/test/engine/routing/stack-id-uniqueness.realgit.test.ts` — uniqueness test
- `src/conductor/test/structural/engine-commit-sites.test.ts` — allowlist entry

**Dependencies:** Task 48

### Task 50: A conflicting or refused frozen block halts, a leaf-only round writes on the leaf, and N=1 keeps title drift
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — the same id with a different body; a pre-commit hook rejecting the append commit; `src/conductor/test/engine/remediation-append.test.ts` — an N=1 drifted-title append.
2. Verify RED
3. Implement: in `writeFrozenBlocks`, a same-id different-body block returns `halted` (needs-human) naming the id; a non-zero commit exit returns `halted`, and `enterHostRegion` propagates it to a feature halt. Leave the N=1 `appendRemediationTasks` path unchanged.
4. Verify GREEN, commit.

**Done when:**
- [test] when `feat/c1/demo` holds a block with a frozen id but a different canonical body, `enterHostRegion` halts needs-human naming that id, no commit is created, and no `-2` ordinal id appears in the plan.
- [test] when a pre-commit hook rejects the append commit, `enterHostRegion` returns a halt, host 1 stays `admitted`, and the dispatch spy records no later region step.
- [test] for an N=1 feature, `appendRemediationTasks` with a drifted title still appends the `-2` ordinal id exactly as the existing drift test expects.
- [test] for a round whose only host is the leaf, `enterHostRegion` writes the leaf's frozen blocks on `feat/daemon-demo` and records `entry.pinnedBase` equal to the `feat/daemon-demo` tip read before the append commit in the recorded argv.

**Files likely touched:**
- `src/conductor/src/engine/remediation-append.ts` — halt results
- `src/conductor/src/engine/routing/host-region-entry.ts` — halt propagation
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — negative tests
- `src/conductor/test/engine/remediation-append.test.ts` — N=1 drift regression

**Dependencies:** Task 49

### Task 47: A crash at every region-entry boundary converges
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-crash-matrix.realgit.test.ts` — a git-runner wrapper throws after each boundary (entry pin, append commit, seed write, `repairing` transaction), then resume runs the preflight and region entry.
2. Verify RED
3. Implement: fix any non-convergence the matrix exposes in `reconcileRounds` and `enterHostRegion` (the append is keyed by `(roundId, id)` and canonical body).
4. Verify GREEN, commit.

**Done when:**
- [test] with a crash after the append commit and before `repairing`, resume through `enterHostRegion` leaves each frozen rem id exactly once on `feat/c1/demo` and host 1 `repairing`.
- [test] for a crash after each boundary entry pin, append commit, seed write and `repairing`, resume converges to exactly one `routes/r1` ref, at most one `repairing` marker, and no duplicated `### Task rem-` header on any branch.

**Files likely touched:**
- `src/conductor/test/engine/routing/round-crash-matrix.realgit.test.ts` — crash matrix
- `src/conductor/src/engine/routing/host-region-entry.ts` — convergence fixes
- `src/conductor/src/engine/routing/round-admission.ts` — convergence fixes

**Dependencies:** Task 49

### Task 56: The no-op guard runs at host entry only when nothing is dispatchable
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/no-op-guard-placement.test.ts` — an audit round where every routed task for host 1 is already evidence-complete; a round where authored `T1` is complete and frozen `rem-prd-audit-T1` is pending; an N=1 regression.
2. Verify RED
3. Implement: in `enterHostRegion`, for an `audit` round only, after the frozen-block write and the existing-task restage (Task 69) and before the `repairing` transaction, call `checkStepCompletion(..., 'build', ...)` with the host's completion context (`activeChild` = host) over every routed task for the host (frozen rem ids and restaged bound ids). When it reports done, write the halt with outcome `derived-already-complete` in the halt record through the existing halt-marker path, and dispatch nothing.
4. Verify GREEN, commit.

**Done when:**
- [test] with every routed task for host 1 already evidence-complete on `feat/c1/demo`, `enterHostRegion` writes a halt whose record carries outcome `derived-already-complete`, host 1 stays `admitted`, and the dispatch spy records no build.
- [test] with authored `T1` complete and frozen `rem-prd-audit-T1` pending, the guard calls `checkStepCompletion` with `activeChild` 1 and does not halt, and host 1 reaches `repairing`.
- [test] for an N=1 feature the route-into-no-op guard in `planRemediation` still runs at route resolution exactly as the existing no-op guard test expects.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — guard at host entry
- `src/conductor/test/engine/routing/no-op-guard-placement.test.ts` — placement tests

**Dependencies:** Task 69

### Task 52: The commit hook stamps Round while a marker names the host
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/git-hook-assets-round-stamp.realgit.test.ts` — install the hook assets in a temp repo with a marker blob, commit on the host branch, on another branch and with no marker; a message already carrying `Round: r1`; an N=1 feature under `withGitArgvShim` (`src/conductor/test/engine/n1-golden-shared.ts`).
2. Verify RED
3. Implement: extend `PREPARE_COMMIT_MSG_HOOK` in `src/conductor/src/engine/git-hook-assets.ts`, after the `Task:` stamp, to call `ai-conductor round-stamp "$COMMIT_MSG_FILE"` (same launcher quoting as `task-membership-check`). Add `src/conductor/src/engine/round-stamp-cli.ts`, registered in the commander program: it applies `routingEligible` first and returns with the message unchanged, reading no routing ref, when false; otherwise it reads `refs/conductor/<slug>/repairing`, and when the current branch equals the marker host's branch and the message has no `Round:` trailer it adds `Round: <roundId>` with `git interpret-trailers`.
4. Verify GREEN, commit.

**Done when:**
- [test] with `refs/conductor/demo/repairing` naming host 1 and `r1`, a commit on `feat/c1/demo` through the installed hook carries both a `Task: <id>` trailer and a `Round: r1` trailer.
- [test] with no marker, or on a branch other than `feat/c1/demo`, the hook adds no `Round:` trailer and the message equals the output of the hook without `round-stamp`.
- [test] a message already carrying `Round: r1` keeps exactly one `Round:` trailer.
- [test] for an N=1 feature, a commit through the installed hook records, via `withGitArgvShim`, no git command naming `refs/conductor/demo/routes`, `refs/conductor/demo/repairing` or `refs/conductor/demo/revalidate`, and the message equals the output of the hook without `round-stamp`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts` — hook delegates to `round-stamp`
- `src/conductor/src/engine/round-stamp-cli.ts` — new subcommand
- `src/conductor/src/cli.ts` — register `round-stamp`
- `src/conductor/test/engine/git-hook-assets-round-stamp.realgit.test.ts` — hook tests

**Dependencies:** Task 201

### Task 54: Rem membership comes from the committed Child line
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/task-membership-hook.test.ts` and `src/conductor/test/engine/task-progress.test.ts` — a recreated worktree without `engine-state.json`; a cache that disagrees with the plan; a rem task with neither source.
2. Verify RED
3. Implement: `runTaskMembershipCheck` (`src/conductor/src/engine/task-membership-check-cli.ts`) and `resolveChildTaskScope` (`src/conductor/src/engine/task-progress.ts`) read the rem task's child with `readRemTaskChildLine` (`routing/owner-derivation.ts`) first and fall back to `readAppendedRemediationTaskChildren`; `src/conductor/src/engine/artifacts.ts` rebuilds that cache from the plan's `Child:` lines. Refuse only when both are absent.
4. Verify GREEN, commit.

**Done when:**
- [test] in a recreated worktree with no `engine-state.json`, `runTaskMembershipCheck` resolves `rem-prd-audit-T1` to child 1 from the committed `**Child:** 1` line and exits 0 on `feat/c1/demo`.
- [test] when `appendedRemediationTaskChildren` names child 2 and the plan's `Child:` line names child 1, membership resolves child 1 and the rebuilt cache records child 1.
- [test] for a rem task with neither a committed `Child:` line nor a cache entry, `runTaskMembershipCheck` exits non-zero with an unreadable-membership message naming the task.

**Files likely touched:**
- `src/conductor/src/engine/task-membership-check-cli.ts` — `Child:` line authority
- `src/conductor/src/engine/task-progress.ts` — `Child:` line authority
- `src/conductor/src/engine/artifacts.ts` — cache rebuilt from the plan
- `src/conductor/test/engine/task-membership-hook.test.ts` — membership tests
- `src/conductor/test/engine/task-progress.test.ts` — scope tests

**Dependencies:** Task 49

### Task 55: Seal rotation accepts frozen-allocation ids
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/protected-artifact-seal-routing.realgit.test.ts` — child 2 holds rem blocks of `r1` in a recreated worktree with no recorded appended ids; an id in neither source; an N=1 feature under a recording git runner.
2. Verify RED
3. Implement: in `evaluateProtectedArtifactSealRotationInRepository` (`src/conductor/src/engine/protected-artifact-seal.ts`), union `readRecordedAppendedRemediationTaskIds` with every id in each `routes/<roundId>` record's frozen allocation, read through the route-record store only when `routingEligible` is true.
4. Verify GREEN, commit.

**Done when:**
- [test] in a recreated worktree where child 2 holds rem blocks of `r1`, `evaluateProtectedArtifactSealRotationInRepository` accepts the ids in `routes/r1`'s frozen allocation and returns a rotation-permitted verdict.
- [test] a rem id in neither `readRecordedAppendedRemediationTaskIds` nor any frozen allocation still returns `engine-append-unvouched`, and for an N=1 feature the recording git runner records no argument naming `routes`, `repairing` or `revalidate`.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — frozen ids as recorded appends
- `src/conductor/test/engine/protected-artifact-seal-routing.realgit.test.ts` — rotation tests

**Dependencies:** Task 49

### Task 39: The execution projection lets a host complete routed tasks in the hook and task-cli
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/task-membership-hook.test.ts` and `src/conductor/test/engine/task-cli.test.ts` — the marker names host 2 and `r1`, and `r1` routes owner-1 task `T1` to host 2, with `feat/c2/demo` checked out.
2. Verify RED
3. Implement: `routedTaskIdsForHost(record, host)` in `src/conductor/src/engine/routing/round-router.ts` returns the host's frozen rem ids plus the `taskIds` of its `existing-task` items. `runTaskMembershipCheck` and the `start` and `done` arms of `src/conductor/src/engine/task-cli.ts` add those ids to the allowed set when the marker names the checked-out child; task status is written to the flat `.pipeline/task-status.json` as today.
4. Verify GREEN, commit.

**Done when:**
- [test] `runTaskMembershipCheck` on `feat/c2/demo` with a commit message carrying `Task: T1` exits 0 while `r1` routes `T1` to host 2.
- [test] `conduct task done T1` (`task-cli.ts`) on `feat/c2/demo` exits 0 and marks `T1` done in the flat `.pipeline/task-status.json`.
- [test] `runTaskMembershipCheck` on `feat/c2/demo` with a commit carrying `Task: T3` exits non-zero and names `T3`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — `routedTaskIdsForHost`
- `src/conductor/src/engine/task-membership-check-cli.ts` — execution projection
- `src/conductor/src/engine/task-cli.ts` — execution projection
- `src/conductor/test/engine/task-membership-hook.test.ts` — hook tests
- `src/conductor/test/engine/task-cli.test.ts` — task-cli tests

**Dependencies:** Task 54

### Task 53: closeChild records RED under red/c<k> when routing is on
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/child-lifecycle-red-ref.realgit.test.ts` — `closeChild` with routing on and a RED marker, routing off, a child with no RED marker, an existing same-digest and different-digest `red/c1`.
2. Verify RED
3. Implement: in `closeChild` (`src/conductor/src/engine/child-lifecycle.ts`), when `routingSettingOn` and the child's `.pipeline/children/<k>/acceptance-specs-red.json` exists, write `refs/conductor/<slug>/red/c<k>` to a blob of its digest, create-only, and accept an existing blob with the same digest.
4. Verify GREEN, commit.

**Done when:**
- [test] with routing on, `closeChild` for child 1 with a RED marker creates `refs/conductor/demo/red/c1` pointing at a blob of the marker's digest; with routing off, or with no RED marker, no `red/c1` ref exists after `closeChild`.
- [test] with `red/c1` already holding the same digest, a resumed `closeChild` succeeds and the blob SHA is unchanged; with a different digest, `closeChild` returns `refused` and the blob SHA is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/child-lifecycle.ts` — `red/c<k>` write
- `src/conductor/test/engine/child-lifecycle-red-ref.realgit.test.ts` — ref tests

**Dependencies:** none

### Task 207: A routed pass runs acceptance verify-green from the step path, never the self-heal
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/verify-green-acceptance.test.ts` — the routed pass with the per-child marker absent, with no `red/c1`, with no RED marker, with a legacy marker without provenance, with a digest mismatch, with a failing spec, with skipped, errored and zero-executed runs, an exec spy over the completion predicate, and the existing N=1 acceptance-RED tests.
2. Verify RED
3. Implement: `verifyGreenAcceptance` in `src/conductor/src/engine/routing/host-region-entry.ts` runs the child's recorded run contract, requires every spec to pass with `skipped == 0`, `errors == 0` and `executed >= 1`, fails on a present marker whose digest differs from `red/c<k>`, and treats an absent marker, an absent ref or a marker without provenance as no refusal. In `src/conductor/src/engine/conductor.ts`'s `acceptance_specs` step path a routed pass runs it, never calls `selfHealAcceptanceRed`, records its result, and emits `acceptance_red` with `state: satisfied` and `mode: 'verify-green'` (optional `mode` field on the event type). `src/conductor/src/engine/artifacts.ts`'s completion predicate reads only that recorded result.
4. Verify GREEN, commit.

**Done when:**
- [test] host 1's routed pass with `.pipeline/children/1/acceptance-specs-red.json` absent runs child 1's run contract, reads the digest from `refs/conductor/demo/red/c1`, completes, records no `selfHealAcceptanceRed` call and no `missing` RED refusal, and emits `acceptance_red` with `state` `satisfied`, `mode` `verify-green` and no `viaException` field.
- [test] the routed pass runs verify-green (its `acceptance_red` carries `mode` `verify-green`) and completes without a refusal when no `red/c1` ref exists, when the child has no RED marker and when the marker has no provenance, and fails naming the digest mismatch when the marker digest differs from `red/c1`.
- [test] the routed pass fails `acceptance_specs` for host 1's region with no `selfHealAcceptanceRed` call when one of child 1's specs fails, and when the run reports skipped > 0, errors > 0, or executed == 0.
- [test] evaluating the `acceptance_specs` completion predicate for a routed pass spawns no subprocess (exec spy) and reads only the recorded verify-green result, which is keyed by `(roundId, host)` and the host tip SHA, so a result recorded for another round or before a later commit does not satisfy the predicate.
- [test] for an N=1 feature every existing acceptance-RED lifecycle test (marker present, absent and without provenance) passes unchanged, and a run with the marker absent calls `selfHealAcceptanceRed` and emits `acceptance_red` with no `mode` field.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — `verifyGreenAcceptance`
- `src/conductor/src/engine/conductor.ts` — routed pass in the step path
- `src/conductor/src/engine/artifacts.ts` — predicate reads the recorded result
- `src/conductor/src/types/events.ts` — optional `mode` on `acceptance_red`
- `src/conductor/test/engine/routing/verify-green-acceptance.test.ts` — verify-green tests

**Dependencies:** Tasks 48, 53

### Task 60: Settle the round receipt by compare-and-swap at the host's BUILD dispatch
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-receipt.test.ts` — a round with 1 new rem task for host 1 and 1 for the leaf; a later dispatch of the settled round; a joined round with a `prd_audit` FIXABLE and an as-built REMEDIABLE; an ordered spy over the receipt CAS, the ledger write and the provider dispatch; a conductor-level routed round traced from admission to settlement with a `bumpKickbackGateInLedger` spy.
2. Verify RED
3. Implement: `src/conductor/src/engine/routing/round-receipt.ts` with `settleRoundAtDispatch({projectRoot, slug, roundId, dispatchingChild, budgets, git})`. Under `withKickbackLedgerLease` it runs `reconcileReceiptLedgerUnlocked` (Task 62), reads the record, and for an unsettled receipt CAS-writes per-gate laps, growth (the frozen allocation's new-task count) and a settlement id derived from `(roundId, receipt digest)`; a settled receipt records only `acks[child]`. After the CAS it writes the flat ledger (laps, `growth`, `settlementReceipts[settlementId]`). In `src/conductor/src/engine/conductor.ts`, the `settleBuildPendingRepair` closure calls it instead of `settlePendingRepair` when the execution child carries `routedRepair`.
4. Verify GREEN, commit.

**Done when:**
- [test] `settleRoundAtDispatch` at host 1's dispatch for a round with 1 new rem task for host 1 and 1 for the leaf CAS-writes a receipt charging one `prd_audit` lap and growth 2 with a settlement id, before the provider dispatch spy is called, and the flat ledger records one `prd_audit` lap and growth 2 under `settlementReceipts` for that id.
- [test] a later `settleRoundAtDispatch` for the settled round's current host records only an `acks` entry, and the ledger's `prd_audit` laps and `growth.added` are byte-identical to their values before the call.
- [test] for one joined round admitting a `prd_audit` FIXABLE and an as-built REMEDIABLE, one dispatch charges one lap to `prd_audit`, one lap to `architecture_review_as_built` and their growth once, under one settlement id.
- [test] the ordered spy log shows the receipt CAS before the flat ledger write, and the ledger write before the provider dispatch.
- [test] in the conductor-level trace of a routed round from admission to settlement, for host 1 and for a leaf-only round, `bumpKickbackGateInLedger` records no `prd_audit` call, the ledger has no `pendingRepair` field, and the receipt settlement is the only change to the `prd_audit` lap count.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-receipt.ts` — new: settlement and acknowledgement
- `src/conductor/src/engine/conductor.ts` — route the BUILD settlement closure for routed passes
- `src/conductor/test/engine/routing/round-receipt.test.ts` — unit tests

**Dependencies:** Task 201

### Task 61: Refuse settlement off the current host, and resolve races and lost CAS correctly
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-receipt.race.test.ts` — child 2's dispatch while host 1 is current; two racing settlements with a writer injected between the read and the transaction; a CAS lost to an outbox drain that changed the record without settling it; a journal opened between the read and the CAS.
2. Verify RED
3. Implement: in `settleRoundAtDispatch`, return `{kind: 'refused', reason: 'not-current-host'}` before any write when `dispatchingChild` is not the current host. On `cas-failed`, re-read: acknowledge only when the receipt parses settled; on any other change retry the whole fenced operation, at most 3 attempts, then return `halted` (needs-human naming the round). On `restack-journal-open`, return `halted` with nothing charged.
4. Verify GREEN, commit.

**Done when:**
- [test] `settleRoundAtDispatch` for child 2 while host 1 is current returns `not-current-host`, the receipt blob SHA is unchanged, and no ledger write is recorded.
- [test] two racing settlements for `r1` record exactly one settlement id and `prd_audit` laps up by one, and the loser writes an `acks` entry.
- [test] a CAS lost to an outbox drain that left the receipt unsettled is retried rather than acknowledged, and after 3 lost attempts the result is `halted` with a needs-human reason naming `r1`.
- [test] a journal opened between the read and the CAS returns `halted`, and the receipt and the ledger are unchanged.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-receipt.ts` — host check and CAS-loss handling
- `src/conductor/test/engine/routing/round-receipt.race.test.ts` — concurrency tests

**Dependencies:** Task 60

### Task 62: Reconcile the ledger by settlement id across a crash on either side of the commit point
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-receipt.recovery.test.ts` — a crash after the receipt CAS and before the ledger write; a crash before the CAS; a double reconcile; an N=1 resume under a recording git runner.
2. Verify RED
3. Implement: `reconcileReceiptLedger(projectRoot, slug)` (takes the lease) and `reconcileReceiptLedgerUnlocked` (caller holds it) in `src/conductor/src/engine/routing/round-receipt.ts`: for every settled receipt whose settlement id is absent from `settlementReceipts`, apply its laps and growth once. Call the locked variant from conductor resume and from `src/conductor/src/engine/restack/stack-preflight.ts` after journal recovery; both read route records only when `routingEligible` is true.
4. Verify GREEN, commit.

**Done when:**
- [test] after a crash injected after the settlement CAS and before the ledger write, the next `settleRoundAtDispatch` for the settled round applies the `prd_audit` lap exactly once, keyed by the receipt's settlement id, before acknowledging.
- [test] running `reconcileReceiptLedger` twice for the same settled receipt leaves `.pipeline/kickback-ledger.json` byte-identical after the second run.
- [test] after a crash before the settlement CAS the receipt stays unsettled, and the next host 1 dispatch charges the round exactly once.
- [test] for an N=1 feature, conductor resume records no git argument naming `routes`, `repairing` or `revalidate`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-receipt.ts` — reconciliation
- `src/conductor/src/engine/conductor.ts` — call on resume
- `src/conductor/src/engine/restack/stack-preflight.ts` — call after journal recovery
- `src/conductor/test/engine/routing/round-receipt.recovery.test.ts` — crash tests

**Dependencies:** Task 60

### Task 63: Check every cap before settling, record cap evidence flat, and fail closed on a malformed record
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-receipt.caps.test.ts` — the `prd_audit` lap cap used; a joined round with the as-built lap cap or the effective growth cap exhausted; a malformed route record; a malformed receipt.
2. Verify RED
3. Implement: inside `settleRoundAtDispatch`, after reconciliation and before the CAS, validate the effective lap cap of every gate in the receipt (`effectiveLapCap` or `remediationLapCapForGate`) and the effective growth cap. On exhaustion return `{kind: 'exhausted', gate, allowance}` with no receipt write; the conductor closure records typed cap evidence and a halt generation for the whole-feature gate in the flat ledger and halts with `KICKBACK_CAP_HALT_CLASS`. A record or receipt that fails to parse returns `exhausted`.
4. Verify GREEN, commit.

**Done when:**
- [test] with the `prd_audit` lap cap used, settlement returns `exhausted`, the receipt stays unsettled, the frozen allocation is byte-identical, the provider dispatch spy is never called, and HALT.class is `kickback-cap`.
- [test] after that halt the flat `.pipeline/kickback-ledger.json` holds typed `laps` cap evidence for `prd_audit` with a halt generation, and `.pipeline/children/1/kickback-ledger.json` holds no cap evidence.
- [test] in a joined round with the as-built lap cap exhausted, or with the effective growth cap exhausted, while the `prd_audit` lap is available, neither gate is charged and the provider dispatch spy is never called, and after the growth-cap exhaustion the flat ledger holds typed `growth` cap evidence.
- [test] a malformed record at `refs/conductor/demo/routes/r1` (including an `existing-task` item with no `taskIds`), or a malformed receipt, makes settlement return `exhausted` and the feature halts.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-receipt.ts` — cap checks and malformed handling
- `src/conductor/src/engine/conductor.ts` — map `exhausted` to the flat cap evidence and halt
- `src/conductor/test/engine/routing/round-receipt.caps.test.ts` — cap tests

**Dependencies:** Task 62

### Task 64: A raise resumes a cap halt on the same frozen tasks, and whole-feature gates stay flat
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/kickback-budget-cli.routed.test.ts` — a raise after a routed `prd_audit` cap halt while host 1 is the execution child, then resume.
2. Verify RED
3. Implement: in `src/conductor/src/engine/kickback-budget-cli.ts`, `raise` and `reset` for `prd_audit`, `architecture_review_as_built` and `manual_test` read the typed evidence from and write to the flat feature ledger regardless of the execution child. The resumed dispatch calls `settleRoundAtDispatch` on the existing record without re-entering the gap loop.
4. Verify GREEN, commit.

**Done when:**
- [test] after the cap halt, with host 1 the execution child, `kickback-budget raise --gate prd_audit` writes the raise to `.pipeline/kickback-ledger.json` and `.pipeline/children/1/kickback-ledger.json` is byte-identical to its value before the raise.
- [test] after that raise the feature resumes and settles the same receipt, the frozen allocation is byte-identical to its pre-halt value, and no new `routes/` ref and no new rem id is written.
- [test] after a routed growth-cap halt, a `growth` raise through `kickback-budget raise --gate prd_audit` raises the flat ledger's effective growth cap and the resumed dispatch settles the round.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — whole-feature gates flat
- `src/conductor/test/engine/kickback-budget-cli.routed.test.ts` — raise and resume tests

**Dependencies:** Task 63

### Task 66: Store the growth denominator from the sealed plan and exclude pending ids by frozen allocation
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/kickback-ledger.stacked-growth.test.ts` — a stacked feature with a 12-task sealed plan and rem blocks only on child 1's plan; a stored `0`; an unsettled receipt; the existing N=1 growth cases.
2. Verify RED
3. Implement: in `src/conductor/src/engine/kickback-ledger.ts`, for a stacked feature `readGrowth` takes `authored` from the sealed plan's authored `Task` headings on the first record, stores it, and never re-derives it; a stored `0` against a sealed plan with authored headings throws. The pending-task exclusion reads `pendingAllocationTaskIds(slug)` from `src/conductor/src/engine/routing/round-receipt.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] for the stacked fixture, `readGrowth` on the first record stores `authored` 12 from the sealed plan, and returns `authored` 12 after rem blocks exist only on child 1's plan.
- [test] a stored `authored` of `0` against the 12-task sealed plan makes `readGrowth` throw rather than re-derive.
- [test] with `routes/r1` unsettled, its frozen allocation holding `rem-prd-audit-T1` and the worktree on `feat/daemon-demo` (whose plan holds no rem block), `pendingAllocationTaskIds` returns exactly `['rem-prd-audit-T1']` and `readGrowth` excludes it; after `r1` settles it returns `[]`.
- [test] the existing N=1 growth and settlement cases in `src/conductor/test/engine/kickback-ledger.test.ts` and `src/conductor/test/engine/conductor-kickback-ledger.test.ts` pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — stacked `authored` and exclusion
- `src/conductor/src/engine/routing/round-receipt.ts` — `pendingAllocationTaskIds`
- `src/conductor/test/engine/kickback-ledger.stacked-growth.test.ts` — growth tests

**Dependencies:** Task 60

### Task 65: Charge taskless manual_test rounds at admission, before any routing ref exists
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-receipt.taskless.test.ts` — a standalone `manual_test` FAIL routed to child 2; a validation-group join whose only failure is `manual_test`; the counter at `MAX_KICKBACKS_PER_GATE`; an ordered spy over the counter, the `kickback` event and the cap check; a ledger snapshot; an N=1 FAIL.
2. Verify RED
3. Implement: `chargeTasklessAtAdmission({gate: 'manual_test', slug, git})` in `src/conductor/src/engine/routing/round-receipt.ts` computes the count from every route record's receipt plus one, lets admission emit the round's single `kickback` event, then checks `MAX_KICKBACKS_PER_GATE`; on exhaustion it returns today's exhausted self-heal reason and admission writes no ref. `handleManualTestFailKickback` and the FAIL-only validation-group join in `src/conductor/src/engine/conductor.ts` call `routeAdmittedRound` and `admitRound` for a routing-eligible feature, with the charge recorded in the receipt of the created record, and emit no second `kickback` after admission.
4. Verify GREEN, commit.

**Done when:**
- [test] a standalone `manual_test` FAIL routed to child 2 creates a record whose receipt holds `taskless.manual_test` 1, and the receipt and flat ledger hold no `prd_audit` or as-built charge.
- [test] a validation-group join whose only failure is `manual_test` creates a record charged the same way, and host 2's stored `retryHint` contains the FAIL rows.
- [test] the ordered spy log shows the counter computation, then exactly one `kickback` event for the round, then the cap check, and no `kickback` event after admission returns.
- [test] with the counter at `MAX_KICKBACKS_PER_GATE`, the FAIL halts with today's exhausted self-heal reason, and `git show-ref` shows neither `refs/conductor/demo/routes/` nor `refs/conductor/demo/repairing`.
- [test] the flat ledger's gate entries are byte-identical before and after a routed `manual_test` round, and an N=1 `manual_test` FAIL uses today's self-heal counter with no routing ref read.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-receipt.ts` — `chargeTasklessAtAdmission`
- `src/conductor/src/engine/routing/round-admission.ts` — taskless admission order
- `src/conductor/src/engine/conductor.ts` — FAIL-only routing callers
- `src/conductor/test/engine/routing/round-receipt.taskless.test.ts` — taskless tests

**Dependencies:** Task 60

### Task 33: A routed custom-step kickback keeps today's ledger bump and echoes it in the receipt
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/conductor-routed-custom-step.test.ts` — a three-child stack whose post-region custom step `lint-docs` kicks back through `scanKickbackVerdicts` with a judge answering `1`; the re-opened gate's counter at `MAX_KICKBACKS_PER_GATE` on the current tree; an N=1 custom-step kickback.
2. Verify RED
3. Implement: in `scanKickbackVerdicts` (`src/conductor/src/engine/conductor.ts`), for a routing-eligible feature and a post-region custom step, keep today's `bumpKickbackGateInLedger(target)`, `kickback` event and ping-pong cap check first; when not exhausted, build a taskless item with gate key `lint-docs`, route it through `routeAdmittedRound` and `admitRound`, and record `echo.lint-docs` (the bumped count) in the created record's receipt. No task is appended.
4. Verify GREEN, commit.

**Done when:**
- [test] the `lint-docs` kickback with the judge answering `1` creates a record whose taskless item has host 1, the fixture plan gains no rem block, and `bumpKickbackGateInLedger` is called exactly once for the re-opened gate.
- [test] the created record's receipt holds `echo.lint-docs` equal to the bumped count and no `laps` or `taskless` charge for `lint-docs`, and settlement applies no charge for it.
- [test] with the re-opened gate's counter at `MAX_KICKBACKS_PER_GATE` on the current tree, the kickback halts with today's `kickback ping-pong` reason and no `routes/` ref exists.
- [test] an N=1 custom-step kickback produces the same ledger entry and halt behaviour as the existing `scanKickbackVerdicts` tests with no routing ref read.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `scanKickbackVerdicts` routed branch
- `src/conductor/test/engine/routing/conductor-routed-custom-step.test.ts` — custom-step tests

**Dependencies:** Task 65

### Task 67: Rebuild budgets from round receipts and read as-built prior findings from the route record
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-receipt.recreate.test.ts` — a worktree recreated after settlement of a `prd_audit` round and a `manual_test` round; `src/conductor/test/engine/as-built-projection.routed.test.ts` — a worktree recreated while an as-built round is open, and an unreadable record.
2. Verify RED
3. Implement: `rebuildLedgerFromReceipts(projectRoot, slug)` in `src/conductor/src/engine/routing/round-receipt.ts` runs on resume when the flat ledger is absent: it rebuilds settled laps, growth and taskless counters from every receipt, writes no `pendingRepair`, and reconstructs no `effectiveLapCap`, `effectiveGrowthCap`, adjustments, resume authorisations or `convergenceCreditReceipts`. In `src/conductor/src/engine/as-built-projection.ts`, the stacked prior-findings input adds the pending as-built items of every open route record; an unreadable record yields the unreadable result.
4. Verify GREEN, commit.

**Done when:**
- [test] after a worktree recreated after settlement, resume rebuilds the `prd_audit` laps, growth and the `manual_test` counter from the receipts, and the rebuilt ledger has no `pendingRepair` field.
- [test] after that recreation the rebuilt ledger has no `effectiveLapCap`, `effectiveGrowthCap`, adjustments, resume authorisation or `convergenceCreditReceipts`.
- [test] with an as-built round open and the worktree recreated, the as-built prior-findings input includes the pending findings read from `routes/r1`, and an unreadable record returns the unreadable result, never an empty set.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-receipt.ts` — `rebuildLedgerFromReceipts`
- `src/conductor/src/engine/as-built-projection.ts` — route-record prior findings
- `src/conductor/test/engine/routing/round-receipt.recreate.test.ts` — recreation tests
- `src/conductor/test/engine/as-built-projection.routed.test.ts` — prior-findings tests

**Dependencies:** Task 65

### Task 68: Admit routed obligations under the round key with an optional branch
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests: `src/conductor/test/engine/repair-obligations.routed.test.ts` — the round-keyed admission key under a changed HEAD and plan path; a crash between admission and restage; an N=1 admission; a record with an invalid `branch`.
2. Verify RED
3. Implement: in `src/conductor/src/engine/repair-obligations.ts`, add an optional `baseline.branch` to `RepairAdmission` and `RepairObligation`, validated by the section parser. In `src/conductor/src/engine/repair-restage.ts`, add `admitRoutedObligation({roundId, findingId, taskIds, branch, head, tree})` whose key hashes only `(roundId, findingId, taskIds)`. `admitAndRestageRepair` (N=1) is unchanged and never writes `branch`.
4. Verify GREEN, commit.

**Done when:**
- [test] `admitRoutedObligation` derives the same admission key when HEAD or the plan path changes.
- [test] a crash injected between admission and restage, then resume, reuses the same obligation, and the obligation section holds exactly one record for the key.
- [test] an N=1 obligation admitted through `admitAndRestageRepair` has no `branch` field, and the existing `repair-obligations.test.ts` resolution cases pass unchanged.
- [test] the section parser in `repair-obligations.ts` rejects a record whose `branch` is `feat/../x`.

**Files likely touched:**
- `src/conductor/src/engine/repair-obligations.ts` — optional branch and validation
- `src/conductor/src/engine/repair-restage.ts` — `admitRoutedObligation`
- `src/conductor/test/engine/repair-obligations.routed.test.ts` — admission tests

**Dependencies:** Task 202

### Task 69: Region entry binds obligations to the host branch, restages, and reconciles engine state from the record
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/host-region-entry.obligation.test.ts` — an `existing-task` repair of `T1` hosted by child 1 with no FAIL rows; a mixed round's `existing-task` item on `T2` with `restage: false`; a restage failure; a recreated worktree with host 1 `repairing`; a build with no commit and an unchanged tree.
2. Verify RED
3. Implement: in `enterHostRegion`, after the frozen-block write, for each `existing-task` item call `admitRoutedObligation` with `{branch: feat/c<h>/<slug>, head: tip at entry, tree: entry.tree}`, and restage its `taskIds` through `restageExistingRemediationTaskStatuses` unless `restage` is `false`; a restage failure halts. Record each binding on the item in the `repairing` transaction (Task 49). The `repairing` resume arm rebuilds missing engine-state obligations from the record's bindings by admission key. Remove nothing from the N=1 path. Expose `hostNoOpEvidence(record, host, git)` returning whether the host branch moved and its tree differs from `entry.tree`, for #3212's exit.
4. Verify GREEN, commit.

**Done when:**
- [test] region entry for an `existing-task` repair of `T1` hosted by child 1 writes an obligation with branch `feat/c1/demo`, head the tip at entry and the entry tree hash, and restages `T1` before the BUILD dispatch spy is called.
- [test] for the mixed round's `existing-task` item on `T2` with `restage: false`, the obligation is admitted and the restage spy records no call for `T2`.
- [test] a restage failure halts the feature, host 1 stays `admitted`, and the provider dispatch spy is never called.
- [test] in a recreated worktree with no `engine-state.json` and host 1 `repairing`, resume rebuilds the obligation from `routes/r1` with the same branch, boundary and admission key.
- [test] after a build with no commit, `hostNoOpEvidence` reports no head move and a tree equal to `entry.tree` for host 1.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — bindings, restage, rebuild, no-op evidence
- `src/conductor/src/engine/routing/round-admission.ts` — `repairing` resume rebuild
- `src/conductor/test/engine/routing/host-region-entry.obligation.test.ts` — obligation tests

**Dependencies:** Tasks 49, 68

### Task 70: Resolve obligations from trailers on the host branch only
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/task-progress.routed-obligation.realgit.test.ts` — real-git repository with `feat/c1/demo` and the leaf; commits with `Task: T1` before the boundary, after it, and on the leaf; the per-row restore with the leaf checked out; a restack rewriting the boundary.
2. Verify RED
3. Implement: in `src/conductor/src/engine/task-progress.ts`, when an obligation carries `branch`, read trailers from `head..tip(branch)` through a branch-aware variant of `listCommitsWithTrailersAfterRepairBoundary` in `src/conductor/src/engine/autoheal.ts`, which checks ancestry against the branch tip and keeps rewrite translation. In `src/conductor/src/engine/task-seed.ts`, the per-row trailer restore reads the host branch for a branch-bound obligation.
4. Verify GREEN, commit.

**Done when:**
- [test] a commit with `Task: T1` on `feat/c1/demo` after the boundary resolves `T1` through `task-progress.ts` reading `head..tip(feat/c1/demo)`.
- [test] a pre-boundary commit with `Task: T1` on `feat/c1/demo` does not resolve `T1`, and a commit with `Task: T1` on the leaf does not resolve the obligation bound to `feat/c1/demo`.
- [test] the per-row restore in `task-seed.ts` restores `T1`'s row from a trailer on `feat/c1/demo` while `feat/daemon-demo` is checked out.
- [test] a boundary on `feat/c1/demo` rewritten by a restack is followed through rewrite translation, and only post-boundary commits resolve `T1`.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — branch-bound resolution
- `src/conductor/src/engine/autoheal.ts` — branch-aware trailer range
- `src/conductor/src/engine/task-seed.ts` — per-row restore on the host branch
- `src/conductor/test/engine/task-progress.routed-obligation.realgit.test.ts` — real-git tests

**Dependencies:** Task 68

### Task 72: Grade a routed repair against the pinned base, shared with testQuality
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/build-review-inputs.routed.test.ts` — host 1 `repairing` with `entry.pinnedBase`; testQuality materialisation for the same pass; child 1's parent closure moved after entry; an N=1 and a non-routed child pass.
2. Verify RED
3. Implement: extend `BuildReviewInputs['baseKind']` in `src/conductor/src/engine/build-review-inputs.ts` with `'routed-repair'` (exhaustive switch, no default arm). Extend `ChildBaseResolution` in `src/conductor/src/engine/child-cursor.ts` with a `routed-repair` kind that `resolveChildBase` returns from the route record's `entry.pinnedBase` when the execution child is a routed host, never re-resolving the closure. Pass the same SHA as `mergeBase` to `src/conductor/src/engine/build-review-test-quality-preflight.ts` and `src/conductor/src/engine/build-review-materialization.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] `assembleBuildReviewInputs` with host 1 `repairing` returns `baseKind: 'routed-repair'` and a base equal to `entry.pinnedBase` (the `closed/c1` SHA), produced by `resolveChildBase` (spy).
- [test] the graded diff for that pass lists only commits after `entry.pinnedBase`, and none of child 1's original commits.
- [test] testQuality materialisation and evidence binding for the routed pass receive `mergeBase` equal to `entry.pinnedBase`.
- [test] moving child 1's parent closure after region entry leaves the routed pass's base unchanged, and an N=1 or non-routed child pass still returns its existing base kind.

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — `routed-repair` kind
- `src/conductor/src/engine/child-cursor.ts` — pinned base from the producer
- `src/conductor/src/engine/build-review-test-quality-preflight.ts` — same base
- `src/conductor/src/engine/build-review-materialization.ts` — same base
- `src/conductor/test/engine/build-review-inputs.routed.test.ts` — base tests

**Dependencies:** Task 200

### Task 74: Grant one routedRepairCredit per round, and keep feature-repair refund-free
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/routed-repair-credit.test.ts` — child 1's cumulative `build_review` bound reached, then one and two routed `build_review` FAILs; the persisted `routed_repair_phase` event; a `feature-repair` restack with a round open; child 1's ledger before and after.
2. Verify RED
3. Implement: `grantRoutedRepairCredit({projectRoot, child, roundId})` in `src/conductor/src/engine/routing/round-receipt.ts` writes `routedRepairCredit: {roundId}` into the host child ledger (`kickbackLedgerPathFor(root, child)`) after the `repairing` transaction, whose outbox carries `routed_repair_phase {phase: 'repairing', credit: true}`; resume re-writes it from the record when absent. Add the field to the child ledger with a fail-closed parse in `src/conductor/src/engine/kickback-ledger.ts`. In `src/conductor/src/engine/conductor.ts`, the `build_review` cumulative-bound check consumes an unused credit for the current round before halting; a FAIL with the credit used halts through the existing cumulative-cap halt path (`writeHaltMarker(..., 'needs-human')`) with a reason naming the child.
4. Verify GREEN, commit.

**Done when:**
- [test] with child 1's cumulative `build_review` bound reached, the routed pass consumes `routedRepairCredit` for `r1` on the next FAIL and the feature does not halt.
- [test] the persisted `routed_repair_phase` event for host 1's `repairing` transition carries `credit: true`.
- [test] after the credit is used, a further `build_review` FAIL halts with HALT.class `needs-human` and a reason naming child 1.
- [test] for a `feature-repair` restack with `r1` open, `creditBuildReviewConvergence` grants no refund, and child 1's `convergenceCreditReceipts` and other per-child caps are byte-identical before and after the credit grant.
- [test] after `enterHostRegion` moves host 1 to `repairing` for `r1`, child 1's ledger holds `routedRepairCredit {roundId: 'r1'}`; after a crash before that write, resume re-writes it from the record exactly once.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-receipt.ts` — `grantRoutedRepairCredit`
- `src/conductor/src/engine/kickback-ledger.ts` — `routedRepairCredit` field
- `src/conductor/src/engine/conductor.ts` — credit consumed before the halt
- `src/conductor/test/engine/routing/routed-repair-credit.test.ts` — credit tests

**Dependencies:** Task 72

### Task 204: A routed build may return a schema'd prerequisite claim
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/prerequisite-claim-schema.test.ts` — a routed build dispatch's request options; a `blocked-by-prerequisite` result with symbols, with paths, malformed, and absent; an N=1 and a non-routed build dispatch.
2. Verify RED
3. Implement: in `src/conductor/src/engine/routing/prerequisite-claim.ts`, a closed schema `{outcome: 'completed'} | {outcome: 'blocked-by-prerequisite', paths?, symbols?, child}` and `parseBuilderClaim(result)` returning `none` (absent result or `completed`), `claim`, or `malformed`. In `src/conductor/src/engine/step-runners.ts`, the build dispatch requests this terminal structured result only when the execution child is a routed host.
4. Verify GREEN, commit.

**Done when:**
- [test] a routed build dispatch requests the prerequisite-claim result schema, and an N=1 or non-routed build dispatch requests no structured result.
- [test] `parseBuilderClaim` returns `claim` for `{outcome: 'blocked-by-prerequisite', symbols: ['parseB'], child: 2}`, `none` for an absent result, and `malformed` for `{outcome: 'blocked-by-prerequisite'}` with no child.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — schema and parser
- `src/conductor/src/engine/step-runners.ts` — routed build requests it
- `src/conductor/test/engine/routing/prerequisite-claim-schema.test.ts` — schema tests

**Dependencies:** none

### Task 57: The builder's prerequisite claim is verified before anything moves
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/prerequisite-claim.realgit.test.ts` — `parseB` exported only at `closed/c2`; `parseB` present at `closed/c1`; host 2 naming child 1; `closed/c2` lacking another prerequisite input; host 2 naming the leaf for `src/c.ts`; a malformed and an absent result through the conductor's routed build handling.
2. Verify RED
3. Implement: `verifyPrerequisiteClaim({claim, host, slug, git})` in `src/conductor/src/engine/routing/prerequisite-claim.ts` returning `verified | unverified | refused-not-above` (exhaustive). The destination tree is `closed/c<j>`, or the leaf tip when it names the leaf. Paths are checked with `ls-tree`, symbols as exported names in the tree, and the destination must also hold every prerequisite input of the work order (`classifyCitedPaths` inputs). In the conductor's routed build result handling, `unverified`, `refused-not-above` and `malformed` count as a failed attempt on the host region's own attempt counter, never through `escalateBuildFailure`; `none` is processed as today.
4. Verify GREEN, commit.

**Done when:**
- [test] `verifyPrerequisiteClaim` returns `verified` for symbols `[parseB]` naming child 2 when `parseB` is exported at `closed/c2` and absent at `closed/c1`.
- [test] when `parseB` is present at `closed/c1`, it returns `unverified`, child 1's region attempt counter records one failed attempt, `escalateBuildFailure` is never called, and the marker still names host 1.
- [test] for host 2 naming child 1 it returns `refused-not-above`, and when `closed/c2` lacks another prerequisite input it returns `unverified` and child 1's region attempt counter records one failed attempt; in both cases no ref under `refs/heads/` or `refs/conductor/demo/` moves.
- [test] for host 2 claiming `paths: [src/c.ts]` naming the leaf, presence is checked against the `feat/daemon-demo` tip and no `closed/` ref is read for the destination.
- [test] a malformed claim records one failed attempt on the host region's counter, and an absent result yields `none`: no claim is recorded, the attempt counter and the marker are unchanged, and the existing non-routed build-result handler (spy) processes the build.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — verifier
- `src/conductor/src/engine/conductor.ts` — routed build result handling
- `src/conductor/test/engine/routing/prerequisite-claim.realgit.test.ts` — verifier tests

**Dependencies:** Task 204

### Task 58: A verified claim reroutes in one guarded transaction
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — host 1 with two `Round: r1`-stamped commits; an unstamped operator commit (made with `--no-verify`); an operator commit made through the hook; a non-terminal journal; a non-`pending` destination; stamped plus halt-record-only commits; an injected concurrent writer on the marker and on `feat/c1/demo`.
2. Verify RED
3. Implement: `rerouteRound` in `src/conductor/src/engine/routing/prerequisite-claim.ts`. Refuse needs-human when the journal is non-terminal, when the destination host is neither `pending` nor absent, or when `rev-list closed/c1..feat/c1/demo` holds a commit with no `Round: r1` trailer that is not halt-record-only (export `isHaltRecordOnlyDescendant` from `src/conductor/src/engine/restack/restack-recovery.ts`). Otherwise run one fenced transaction: `create-pin` `rejected/r1/<n>` at the old tip; `update-branch` `feat/c1/demo` from that tip to `closed/c1`; `update-marker` to host 2; `update-record` with the fallback `{from, to, evidence}`, the `reroute` payload, phase `reroute-moved` for host 1, the destination allocation merged with the moved ids' bodies re-rendered with `**Child:** 2`, the moved items' `host` and obligation bindings re-pointed to `feat/c2/demo` at the `closed/c2` SHA, and a `remediation_rerouted` outbox entry from a new `remediationReroutedEvent` constructor in `src/conductor/src/engine/routing/routing-events.ts` naming the rejected ref. A failed CAS halts needs-human naming the round.
4. Verify GREEN, commit.

**Done when:**
- [test] a verified claim on host 1 runs one `update-ref --stdin` that pins the old tip at `refs/conductor/demo/rejected/r1/1`, moves `feat/c1/demo` to `closed/c1` and moves the marker to host 2, and `git rev-parse refs/conductor/demo/rejected/r1/1` equals the pre-reroute tip.
- [test] that transaction records fallback `{from: 1, to: 2}`, phase `reroute-moved`, the moved bodies with `**Child:** 2`, and obligation bindings naming `feat/c2/demo` at the `closed/c2` SHA, with exactly one obligation for the admission key.
- [test] exactly one persisted `remediation_rerouted` event names `r1`, child 1, child 2 and `refs/conductor/demo/rejected/r1/1`, and an operator commit made through the hook stays reachable at that ref after the reset.
- [test] with an unstamped `--no-verify` commit on `feat/c1/demo` past `closed/c1` the reroute halts needs-human naming that commit and nothing is reset; with only stamped and halt-record-only commits it proceeds.
- [test] with a non-terminal journal, a non-`pending` destination, or an injected writer moving the marker or `feat/c1/demo` before the transaction, no ref moves and the feature halts needs-human, naming the round on a failed compare-and-swap.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — `rerouteRound`
- `src/conductor/src/engine/routing/routing-events.ts` — `remediationReroutedEvent`
- `src/conductor/src/engine/restack/restack-recovery.ts` — export `isHaltRecordOnlyDescendant`
- `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — transaction tests

**Dependencies:** Tasks 57, 201

### Task 59: The reroute syncs the tree, admits the destination, and resumes from reroute-moved
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — the sync after a verified reroute; a crash between the transaction and the sync; a failing sync; child 2's region entry; the receipt before and after; a second reroute from child 2 to the leaf and a later claim from the leaf.
2. Verify RED
3. Implement: `completeRerouteSync` in `src/conductor/src/engine/routing/prerequisite-claim.ts` runs `read-tree -m -u <rejected tip> <reset tip>` (following `syncRestackedWorktree` in `src/conductor/src/engine/restack/restack-sync.ts`), then in one fenced CAS moves the source `reroute-moved`→`rerouted` and the destination `pending`→`admitted`, then reconciles engine-state obligations from the record; it is idempotent when the destination is already `admitted` or later. `reconcileRounds` (`src/conductor/src/engine/routing/round-admission.ts`) gains a `reroute-moved` arm that calls it first and returns no admission or dispatch until it succeeds. The reroute never calls settlement.
4. Verify GREEN, commit.

**Done when:**
- [test] after a verified reroute, `completeRerouteSync` leaves the checked-out tree equal to `closed/c1`'s tree and the record marks host 1 `rerouted` and host 2 `admitted`.
- [test] `enterHostRegion` for host 2 then writes the moved rem ids on `feat/c2/demo` with bodies byte-identical to the record's re-rendered bodies, and the receipt's laps and growth are byte-identical to their pre-reroute values.
- [test] after a crash between the transaction and the sync, resume finds `reroute-moved`, `reconcileRounds` completes the sync before any `admitRound` or dispatch, and the tree ends at `closed/c1`; a second `completeRerouteSync` leaves host 2's state unchanged.
- [test] when the sync fails, resume leaves the phase `reroute-moved` and records no admission or dispatch until `completeRerouteSync` succeeds.
- [test] a round rerouted from child 1 to child 2 whose child-2 builder makes a verified claim naming the leaf moves the host to the leaf, and a later claim from the leaf host returns `refused-not-above`.

**Files likely touched:**
- `src/conductor/src/engine/routing/prerequisite-claim.ts` — `completeRerouteSync`
- `src/conductor/src/engine/routing/round-admission.ts` — `reroute-moved` arm
- `src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts` — sync and resume tests

**Dependencies:** Tasks 48, 58

### Task 206: The conductor reroutes on a verified claim and caps unverified ones
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/conductor-routed-build-claim.test.ts` — a routed build returning a verified claim; child 1's region one attempt below `defaults.max_retries` with an unverified and with a malformed claim.
2. Verify RED
3. Implement: in the conductor's routed build-result handling (`src/conductor/src/engine/conductor.ts`), a `verified` claim calls `rerouteRound` once and then `completeRerouteSync`, records no failed attempt and never calls `escalateBuildFailure`; an `unverified`, `refused-not-above` or `malformed` claim consumes one attempt of the host region's existing `defaults.max_retries` retry loop, so exhaustion takes today's retries-exhausted outcome for that region.
4. Verify GREEN, commit.

**Done when:**
- [test] in the conductor's routed build-result handling, a `verified` claim calls `rerouteRound` once, then `completeRerouteSync`, records no failed attempt, and does not call `escalateBuildFailure`.
- [test] with child 1's region one attempt below `defaults.max_retries`, one more unverified or malformed claim exhausts it and takes today's retries-exhausted outcome for child 1's region.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — routed build-result wiring
- `src/conductor/test/engine/routing/conductor-routed-build-claim.test.ts` — wiring tests

**Dependencies:** Tasks 57, 59

### Task 205: Every new writer is fenced, and N=1 and routing-off features are untouched
**Story:** 9
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/route-writers-journal.realgit.test.ts` — with the journal in `moved`, call `enterHostRegion`, `settleRoundAtDispatch` and `rerouteRound`, spying `writeRoutingTransaction`; extend `src/conductor/test/engine/n1-golden-routing-guard.test.ts` with an N=1 remediation lap (append, BUILD settlement, acceptance, commit through the installed hook, seal rotation, resume) under `withGitArgvShim`; `src/conductor/test/engine/routing/routing-off-parity.test.ts` — a three-child stack with the setting off whose `prd_audit` fails.
2. Verify RED
3. Implement: route every new reader (`round-stamp`, seal rotation, receipt reconciliation, membership, region entry) through a `routingEligible` short-circuit before any routing ref read, fixing any reader the golden test exposes.
4. Verify GREEN, commit.

**Done when:**
- [test] in a golden cell whose committed config sets `stacked_prs.route_whole_feature_fixes: true`, the extended N=1 golden lap records no git command naming `routes`, `repairing` or `revalidate`, and its plan, ledger and task status equal the existing golden fixtures.
- [test] with the setting off on the three-child stack, a failing `prd_audit` leaves the leaf plan, `.pipeline/kickback-ledger.json` (including the flat `pendingRepair`) and task status equal to the routing-off fixtures recorded from the pre-change path, and `git show-ref` shows no `refs/conductor/demo/routes/` ref.
- [test] with the journal in `moved`, `enterHostRegion`, `settleRoundAtDispatch` and `rerouteRound` each reach git only through `writeRoutingTransaction` (spy), each transaction's stdin begins with the journal `verify` line, and each returns a refusal leaving `routes/r1` at its prior blob.
- [test] with no journal and with a terminal `applied` journal, `enterHostRegion`, `settleRoundAtDispatch` and `rerouteRound` each write through `writeRoutingTransaction` (spy), and each recorded transaction's stdin begins with the `verify refs/conductor/demo/restack/journal` line.

**Files likely touched:**
- `src/conductor/test/engine/n1-golden-routing-guard.test.ts` — extended golden lap
- `src/conductor/test/engine/routing/routing-off-parity.test.ts` — routing-off parity
- `src/conductor/test/engine/routing/route-writers-journal.realgit.test.ts` — caller-level fence

**Dependencies:** Tasks 49, 52, 55, 58, 62

## Architecture Obligation Coverage

Six APPROVED ADRs carry #3211 amendment notes in this change set, so each of their decisions has one row.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | task | task-205 | records no git command naming `routes`, `repairing` or `revalidate` |
| adr-2026-10-12-routed-whole-feature-repair#D2 | existing | none | Mechanical owner derivation shipped with #3243 in `src/conductor/src/engine/routing/owner-derivation.ts` (`deriveTaskBoundOwner`); this spec consumes its owners unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | task | task-202 | returns an item with `taskIds: ['T2']` and `restage: false` |
| adr-2026-10-12-routed-whole-feature-repair#D4 | task | task-39, task-60 | with a commit message carrying `Task: T1` exits 0 |
| adr-2026-10-12-routed-whole-feature-repair#D5 | task | task-58, task-57, task-59, task-206 | pins the old tip at `refs/conductor/demo/rejected/r1/1` |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-200, task-201 | round-trips a record carrying a settled receipt |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-56 | writes a halt whose record carries outcome `derived-already-complete` |
| adr-2026-10-12-routed-whole-feature-repair#D8 | existing | none | `resolveExecutionChild` in `src/conductor/src/engine/routing/execution-child.ts` (shipped with #3219) returns the routed host first; this spec calls it at region entry without changing it. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | task | task-49, task-48, task-52, task-53, task-54, task-55, task-207 | is byte-identical to its stored frozen body |
| adr-2026-10-12-routed-whole-feature-repair#D10 | task | task-60, task-61, task-62, task-63, task-64, task-65, task-66, task-67, task-33 | CAS-writes a receipt charging one `prd_audit` lap and growth 2 with a settlement id |
| adr-2026-10-12-routed-whole-feature-repair#D11 | task | task-69, task-68, task-70, task-58 | writes an obligation with branch `feat/c1/demo` |
| adr-2026-10-12-routed-whole-feature-repair#D12 | task | task-72, task-74 | returns `baseKind: 'routed-repair'` |
| adr-2026-10-12-routed-whole-feature-repair#D13 | no-change | none | Implemented by #3212 per decision 18 (routed exit restack and the no-commit exit, its Task 84); this spec leaves a host in `repairing` and only exposes its no-op evidence. |
| adr-2026-10-12-routed-whole-feature-repair#D14 | no-change | none | Implemented by #3212 per decision 18 (re-validation queue); this spec writes no queue ref. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | no-change | none | Implemented by #3212 per decision 18 (leaf gates re-run when the queue drains); this spec changes no leaf-gate re-pending. |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-58, task-74 | names `r1`, child 1, child 2 |
| adr-2026-10-12-routed-whole-feature-repair#D17 | task | task-205 | its plan, ledger and task status equal the existing golden fixtures |
| adr-2026-10-12-routed-whole-feature-repair#D18 | task | task-205 | equal to the routing-off fixtures recorded from the pre-change path |
| adr-2026-07-21-engine-owned-acceptance-red-execution#D1 | existing | none | `/writing-system-tests` already records `.pipeline/acceptance-specs-run.json`; verify-green runs that recorded contract unchanged. |
| adr-2026-07-21-engine-owned-acceptance-red-execution#D2 | task | task-207 | records no `selfHealAcceptanceRed` call and no `missing` RED refusal |
| adr-2026-07-21-engine-owned-acceptance-red-execution#D3 | task | task-207 | spawns no subprocess (exec spy) and reads only the recorded verify-green result |
| adr-2026-07-21-engine-owned-acceptance-red-execution#D4 | existing | none | The engine writes the marker to the authoritative path (per child under `.pipeline/children/<k>/` since #2942); verify-green reads that path unchanged. |
| adr-2026-07-21-engine-owned-acceptance-red-execution#D5 | task | task-207 | when the run reports skipped > 0, errors > 0, or executed == 0 |
| adr-2026-08-09-recorded-red-exception-for-remediation#D1 | existing | none | `validateAcceptanceRedEvidence` already requires a structured exception for a waived RED; verify-green is not a waiver and adds no exception kind. |
| adr-2026-08-09-recorded-red-exception-for-remediation#D2 | task | task-207 | emits `acceptance_red` with `state` `satisfied`, `mode` `verify-green` and no `viaException` field |
| adr-2026-08-09-recorded-red-exception-for-remediation#D3 | task | task-207 | emits `acceptance_red` with no `mode` field |
| adr-2026-08-09-recorded-red-exception-for-remediation#D4 | existing | none | The self-heal still carries a recorded exception forward on re-execution; a routed pass never invokes the self-heal, so that path is unchanged. |
| adr-2026-08-09-recorded-red-exception-for-remediation#D5 | existing | none | `skills/remediate/SKILL.md` already states the declaration obligation; this spec changes no skill text. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D1 | existing | none | Remediation-append cap halts keep `kickback-cap` per this ADR's amendment section, and operator cap halts stay `needs-human`; this spec adds no halt class. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D2 | task | task-63 | holds typed `laps` cap evidence for `prd_audit` with a halt generation |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D3 | task | task-64 | after that raise the feature resumes and settles the same receipt |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D4 | existing | none | `kickback-budget inspect`, `raise` and `reset` keep their command family; only the ledger they target for whole-feature gates is fixed to the flat file. |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D5 | task | task-64 | a `growth` raise through `kickback-budget raise --gate prd_audit` raises the flat ledger's effective growth cap |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D1 | task | task-207 | emits `acceptance_red` with `state` `satisfied`, `mode` `verify-green` and no `viaException` field |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D2 | task | task-53 | creates `refs/conductor/demo/red/c1` pointing at a blob of the marker's digest |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D3 | existing | none | The live surface renders `acceptance_red` state unchanged; the optional `mode` field adds no new state. |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D4 | task | task-207 | when the marker has no provenance |
| adr-2026-07-13-kickback-build-no-op-escalation#D1 | task | task-56 | writes a halt whose record carries outcome `derived-already-complete` |
| adr-2026-07-13-kickback-build-no-op-escalation#D2 | no-change | none | The zero-progress plus unchanged-verdict escalation after a routed host pass is implemented by #3212 with the no-commit exit (its Task 84), per the operator-confirmed move recorded in the track marker; this spec only records the host's tree baseline. |
| adr-2026-07-13-kickback-build-no-op-escalation#D3 | task | task-56 | writes a halt whose record carries outcome `derived-already-complete` |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given round `r1` with host 1 `admitted`, when region entry runs, then the worktree is on `feat/c1/demo` and child 1's `acceptance_specs`, `build`, `test_suite` and `build_review` are restaged pending. | 48 | "leaves `git symbolic-ref --short HEAD` at `feat/c1/demo`" | diff-local |
| Story 1 happy: Given round `r1` region entry, when the frozen blocks are written, then each block in the feature plan on `feat/c1/demo` is byte-identical to its frozen body, carries `**Child:** 1` and `**Round:** r1`, and the append commit carries a `Round: r1` trailer. | 49 | "is byte-identical to its stored frozen body" | diff-local |
| Story 1 happy: Given round `r1` region entry, when it completes, then host 1 is `repairing` in the route record, and that transition happened only after the append commit exists. | 49 | "recorded after the append commit and after the task-status seed write" | diff-local |
| Story 1 happy: Given round `r1` region entry, when it begins, then host 1's base is pinned in the route record as the `closed/c1` SHA before any branch switch or commit. | 48 | "written before the first `git switch` and before any commit in the recorded argv" | diff-local |
| Story 1 happy: Given a round whose only host is the leaf, when region entry runs, then the leaf's frozen blocks are written on `feat/daemon-demo` and the pinned base is the leaf tip read before the append commit. | 50 | "writes the leaf's frozen blocks on `feat/daemon-demo`" | diff-local |
| Story 1 happy: Given an audit round whose every routed task for host 1, frozen rem ids and restaged bound ids alike, is already evidence-complete on child 1's tree after region entry, when the no-op guard runs, then the feature halts with outcome `derived-already-complete` on its halt record and no build is dispatched. | 56 | "writes a halt whose record carries outcome `derived-already-complete`" | diff-local |
| Story 1 happy: Given round `r1` admitted and region entry run, when the events are read, then exactly one `kickback` event and one leaf rewind exist for the round, and region entry emitted neither. | 48 | "records exactly one `kickback` event and one leaf `navigateBack` call" | diff-local |
| Story 1 negative: Given region entry is replayed after a crash, when a block with the same id and an identical canonical body already exists, then it is accepted and nothing is appended or committed. | 49 | "appends nothing and creates no commit" | diff-local |
| Story 1 negative: Given region entry, when a block with the same id but a different body exists on `feat/c1/demo`, then the feature halts needs-human naming the id, no commit is made, and no `-2` ordinal id appears. | 50 | "halts needs-human naming that id" | diff-local |
| Story 1 negative: Given region entry, when the append commit is refused by a pre-commit hook, then the feature halts, host 1 stays `admitted`, and no later region step is dispatched. | 50 | "host 1 stays `admitted`, and the dispatch spy records no later region step" | diff-local |
| Story 1 negative: Given the worktree has an uncommitted file, when region entry tries to switch to `feat/c1/demo`, then it is refused naming that file, and host 1 stays `admitted`. | 48 | "returns the `switchToChild` dirty-tree refusal naming that file" | diff-local |
| Story 1 negative: Given region entry would write a rem id that is not in the round's frozen allocation, when the write runs, then it is refused and nothing is appended. | 49 | "a block id absent from the frozen allocation is refused with nothing appended" | diff-local |
| Story 1 negative: Given a crash after the append commit and before host 1 is `repairing`, when the feature resumes, then each frozen rem id appears exactly once on `feat/c1/demo` and host 1 ends `repairing`. | 47 | "leaves each frozen rem id exactly once on `feat/c1/demo`" | diff-local |
| Story 1 negative: Given a crash after the base pin and before the switch, when the feature resumes, then the recorded pin is reused unchanged. | 48 | "leaves `entry.pinnedBase` unchanged" | diff-local |
| Story 1 negative: Given host 1 already `repairing` for `r1`, when the feature resumes in host 1's region, then child 1's region steps are not restaged again and nothing is appended. | 48 | "no rem block is appended to the plan, and no commit is created" | diff-local |
| Story 1 negative: Given host 1 already `repairing` for `r1` and the worktree checked out on another branch, when the feature resumes, then the worktree is switched to `feat/c1/demo` before any dispatch. | 48 | "switches to `feat/c1/demo` before returning `resume`" | diff-local |
| Story 1 negative: Given round `r1` region entry where authored `T1` is complete and frozen `rem-prd-audit-T1` is pending, when the no-op guard runs, then it does not halt. | 56 | "does not halt, and host 1 reaches `repairing`" | diff-local |
| Story 1 negative: Given an N=1 feature, when a remediation block's title drifted from a prior lap, then today's `-2` ordinal renaming still applies. | 50 | "still appends the `-2` ordinal id" | diff-local |
| Story 2 happy: Given host 1 `repairing` for `r1`, when any commit is made on `feat/c1/demo`, then the commit hook adds `Round: r1` beside the engine-stamped `Task:` trailer. | 52 | "carries both a `Task: <id>` trailer and a `Round: r1` trailer" | diff-local |
| Story 2 happy: Given a recreated worktree with no `engine-state.json`, when membership of `rem-prd-audit-T1` is checked, then it resolves to child 1 from the committed `**Child:** 1` line. | 54 | "resolves `rem-prd-audit-T1` to child 1 from the committed `**Child:** 1` line" | diff-local |
| Story 2 happy: Given rem blocks already on `feat/c1/demo` and on the leaf, when a new round allocates work for `T1` and `T3`, then no rem id or ordinal is minted twice across the plans of the stack. | 49 | "leaves no duplicated rem id or ordinal across the two plans" | diff-local |
| Story 2 happy: Given a recreated worktree whose child holds rem blocks of route round `r1`, when seal rotation is evaluated, then the ids in `r1`'s frozen allocation count as engine-recorded appends and rotation is permitted. | 55 | "accepts the ids in `routes/r1`'s frozen allocation" | diff-local |
| Story 2 happy: Given round `r1` routes owner-1 task `T1` to host 2, when `conduct task done T1` runs on `feat/c2/demo`, then it succeeds and marks `T1` done in the flat task status through host 2's execution projection. | 39 | "marks `T1` done in the flat `.pipeline/task-status.json`" | diff-local |
| Story 2 happy: Given round `r1` routes `T1` to host 2, when a commit on `feat/c2/demo` carries `Task: T1`, then the membership hook accepts it. | 39 | "with a commit message carrying `Task: T1` exits 0" | diff-local |
| Story 2 negative: Given no marker, or a commit on a branch other than the marker's host branch, when the commit hook runs, then no `Round:` trailer is added and the message equals today's output. | 52 | "the hook adds no `Round:` trailer" | diff-local |
| Story 2 negative: Given a commit message that already carries `Round: r1`, when the hook runs, then the message keeps exactly one `Round:` trailer. | 52 | "keeps exactly one `Round:` trailer" | diff-local |
| Story 2 negative: Given an N=1 feature, when a commit goes through the installed hook under a recording git shim, then no command names `refs/conductor/demo/routes`, `repairing` or `revalidate`, and the message equals today's output. | 52 | "records, via `withGitArgvShim`, no git command naming" | diff-local |
| Story 2 negative: Given the `appendedRemediationTaskChildren` cache disagrees with the committed `Child:` line, when membership is checked, then it follows the `Child:` line and the rebuilt cache matches it. | 54 | "membership resolves child 1 and the rebuilt cache records child 1" | diff-local |
| Story 2 negative: Given a rem task with neither a committed `Child:` line nor a cache entry, when a commit names it, then the commit is refused as unreadable membership. | 54 | "exits non-zero with an unreadable-membership message naming the task" | diff-local |
| Story 2 negative: Given a rem id in neither the recorded appends nor any route record's frozen allocation, when seal rotation is evaluated, then rotation is refused. | 55 | "still returns `engine-append-unvouched`" | diff-local |
| Story 2 negative: Given round `r1` routes `T1` to host 2, when a commit on `feat/c2/demo` carries `Task: T3`, then the membership hook refuses it naming `T3`. | 39 | "with a commit carrying `Task: T3` exits non-zero and names `T3`" | diff-local |
| Story 3 happy: Given routing on and child 1 closing with a RED marker, when `closeChild` runs, then `refs/conductor/demo/red/c1` is created pointing at a blob holding the digest of child 1's RED evidence. | 53 | "creates `refs/conductor/demo/red/c1` pointing at a blob of the marker's digest" | diff-local |
| Story 3 happy: Given host 1's routed pass passes verify-green, when the event log is read, then the `acceptance_red` event has `state` `satisfied` and `mode` `verify-green`, never a fresh RED proof or a waiver. | 207 | "emits `acceptance_red` with `state` `satisfied`, `mode` `verify-green` and no `viaException` field" | diff-local |
| Story 3 happy: Given host 1's routed pass with a present RED marker that has no provenance (a legacy marker), when `acceptance_specs` runs, then verify-green runs and the legacy marker is not a refusal. | 207 | "runs verify-green (its `acceptance_red` carries `mode` `verify-green`)" | diff-local |
| Story 3 happy: Given host 1's routed pass with `.pipeline/children/1/acceptance-specs-red.json` absent after a worktree recreation, when `acceptance_specs` runs, then it runs child 1's existing specs in verify-green mode and reads the digest from `red/c1`. | 207 | "reads the digest from `refs/conductor/demo/red/c1`" | diff-local |
| Story 3 happy: Given a child closed before this change with no `red/c1` ref, when its routed pass runs acceptance on passing specs, then the step completes without a refusal. | 207 | "completes without a refusal when no `red/c1` ref exists" | diff-local |
| Story 3 negative: Given host 1's routed pass, when `acceptance_specs` runs, then the RED self-heal is never invoked and no `missing` RED refusal is recorded. | 207 | "records no `selfHealAcceptanceRed` call and no `missing` RED refusal" | diff-local |
| Story 3 negative: Given host 1's routed pass, when one of child 1's existing acceptance specs fails, then `acceptance_specs` fails for host 1's region and is not re-run as a RED self-heal. | 207 | "fails `acceptance_specs` for host 1's region with no `selfHealAcceptanceRed` call when one of child 1's specs fails" | diff-local |
| Story 3 negative: Given `red/c1` already exists with the same digest because a closure is resumed after a crash, when `closeChild` runs again, then it succeeds and the blob is unchanged. | 53 | "a resumed `closeChild` succeeds and the blob SHA is unchanged" | diff-local |
| Story 3 negative: Given `red/c1` already exists with a different digest, when `closeChild` runs, then it is refused and the existing blob is unchanged. | 53 | "`closeChild` returns `refused` and the blob SHA is unchanged" | diff-local |
| Story 3 negative: Given routing off, when `closeChild` runs, then no `red/c<k>` ref is written. | 53 | "with routing off, or with no RED marker, no `red/c1` ref exists after `closeChild`" | diff-local |
| Story 3 negative: Given a child with no owned criteria and so no RED marker, when it closes, then no `red/c<k>` ref is written, and its later routed pass runs verify-green without a refusal. | 53, 207 | "when the child has no RED marker" | diff-local |
| Story 3 negative: Given host 1's routed pass with a present RED marker whose digest differs from `red/c1`, when `acceptance_specs` runs, then the step fails naming the digest mismatch. | 207 | "fails naming the digest mismatch" | diff-local |
| Story 3 negative: Given an N=1 feature, when `acceptance_specs` runs, then today's RED lifecycle applies unchanged. | 207 | "every existing acceptance-RED lifecycle test (marker present, absent and without provenance) passes unchanged" | diff-local |
| Story 4 happy: Given a round with 1 new rem task for host 1 and 1 for the leaf, when host 1's BUILD dispatch occurs, then before the provider is dispatched one `prd_audit` lap and growth 2 are charged in the route record's receipt with a settlement id, and the flat ledger records them under that id. | 60 | "the flat ledger records one `prd_audit` lap and growth 2 under `settlementReceipts` for that id" | diff-local |
| Story 4 happy: Given that settled round, when a later BUILD dispatch for the round's current host occurs, then only an acknowledgement is recorded, and the ledger's laps and growth are unchanged. | 60 | "records only an `acks` entry" | diff-local |
| Story 4 happy: Given one round admitting a `prd_audit` FIXABLE and an as-built REMEDIABLE, when host 1 dispatches, then one lap is charged to each gate and their growth once, in one settlement. | 60 | "under one settlement id" | diff-local |
| Story 4 happy: Given a stacked feature's first ledger record, when growth is read, then `authored` is stored as 12 from the sealed plan, and it stays 12 after rem blocks exist only on child 1's plan. | 66 | "stores `authored` 12 from the sealed plan" | diff-local |
| Story 4 happy: Given rem blocks pending only on child 1's plan, when growth is read before settlement, then the pending-task exclusion takes those ids from the frozen allocation. | 66 | "`pendingAllocationTaskIds` returns exactly `['rem-prd-audit-T1']` and `readGrowth` excludes it" | diff-local |
| Story 4 happy: Given a worktree recreated after settlement, when the feature resumes, then settled laps, growth and taskless counters are rebuilt from the round receipts, and the ledger has no `pendingRepair` field. | 67 | "rebuilds the `prd_audit` laps, growth and the `manual_test` counter from the receipts" | diff-local |
| Story 4 happy: Given a worktree recreated while an as-built round is open, when as-built runs again, then its prior-findings input includes the pending findings read from the route record. | 67 | "includes the pending findings read from `routes/r1`" | diff-local |
| Story 4 happy: Given a routed round, when its life from admission to settlement is traced, then the receipt settlement is the only durable `prd_audit` lap charge. | 60 | "the receipt settlement is the only change to the `prd_audit` lap count" | diff-local |
| Story 4 negative: Given a crash after the settlement compare-and-swap and before the ledger write, when the feature resumes and dispatches, then the ledger is reconciled by settlement id and the lap is charged exactly once. | 62 | "applies the `prd_audit` lap exactly once, keyed by the receipt's settlement id" | diff-local |
| Story 4 negative: Given a crash before the settlement compare-and-swap, when host 1 dispatches again, then the round is charged exactly once. | 62 | "the next host 1 dispatch charges the round exactly once" | diff-local |
| Story 4 negative: Given the `prd_audit` lap cap already used, when round `r1` reaches host 1's dispatch, then settlement is refused, the receipt stays unsettled, the allocation stays pending, no provider is dispatched, and the feature halts with HALT.class `kickback-cap`. | 63 | "settlement returns `exhausted`, the receipt stays unsettled" | diff-local |
| Story 4 negative: Given that cap halt, when the flat feature ledger is read, then it holds typed `laps` cap evidence for `prd_audit` with a halt generation, and child 1's ledger holds none. | 63 | "holds typed `laps` cap evidence for `prd_audit` with a halt generation" | diff-local |
| Story 4 negative: Given that cap halt, when the operator runs `kickback-budget raise --gate prd_audit` and the feature resumes, then the same receipt settles on the same frozen tasks, and no new route record or rem id is written. | 64 | "settles the same receipt, the frozen allocation is byte-identical" | diff-local |
| Story 4 negative: Given a joined round, when the as-built lap cap or the effective growth cap is exhausted while the `prd_audit` lap is available, then neither gate is charged and no provider is dispatched. | 63 | "neither gate is charged and the provider dispatch spy is never called" | diff-local |
| Story 4 negative: Given a malformed route record or receipt, when settlement reads it, then the budget is treated as exhausted and the feature halts. | 63 | "makes settlement return `exhausted` and the feature halts" | diff-local |
| Story 4 negative: Given the current host is child 1, when child 2's BUILD dispatch tries to settle, then settlement is refused and nothing is written. | 61 | "returns `not-current-host`, the receipt blob SHA is unchanged" | diff-local |
| Story 4 negative: Given two settlement attempts for the same round racing to the compare-and-swap, when both complete, then exactly one charge and one settlement id are recorded, and the loser records an acknowledgement. | 61 | "record exactly one settlement id" | diff-local |
| Story 4 negative: Given the settlement compare-and-swap loses to an outbox drain that changed the record without settling it, when settlement re-reads, then it retries the whole operation rather than acknowledging, and halts needs-human naming the round after 3 failed attempts. | 61 | "is retried rather than acknowledged" | diff-local |
| Story 4 negative: Given a restack journal opens between the settlement read and its compare-and-swap, when the transaction runs, then nothing is charged and the feature halts. | 61 | "a journal opened between the read and the CAS returns `halted`" | diff-local |
| Story 4 negative: Given a stored `authored` of `0` against a sealed plan with 12 authored tasks, when growth is read, then it fails closed rather than re-deriving. | 66 | "makes `readGrowth` throw rather than re-derive" | diff-local |
| Story 4 negative: Given `kickback-budget raise --gate prd_audit` while host 1 is the execution child, when it runs, then the raise is written to the flat feature ledger and child 1's ledger is unchanged. | 64 | "with host 1 the execution child, `kickback-budget raise --gate prd_audit` writes the raise to `.pipeline/kickback-ledger.json`" | diff-local |
| Story 4 negative: Given an N=1 feature, when it remediates, then the existing growth and settlement behaviour passes unchanged. | 66, 205 | "growth and settlement cases" | diff-local |
| Story 5 happy: Given a three-child stack, when a standalone `manual_test` FAIL is routed to child 2, then only the `manual_test` counter is charged, in the round receipt, and no `prd_audit` or as-built charge is made. | 65 | "creates a record whose receipt holds `taskless.manual_test` 1" | diff-local |
| Story 5 happy: Given a three-child stack, when a validation-group join whose only failure is `manual_test` is routed, then it is charged the same way and its FAIL rows ride the host's retry hint. | 65 | "host 2's stored `retryHint` contains the FAIL rows" | diff-local |
| Story 5 happy: Given a three-child stack, when a post-region custom step `lint-docs` kicks back and is routed to child 1, then no task is appended, today's durable tree-keyed kickback counter for the re-opened gate is bumped once, and the round receipt echoes that charge under `lint-docs` without charging it again. | 33 | "`bumpKickbackGateInLedger` is called exactly once for the re-opened gate" | diff-local |
| Story 5 happy: Given a taskless round is admitted, when its admission is traced, then the counter bump, then the round's single `kickback` event, then the cap check occur in that order. | 65 | "then exactly one `kickback` event for the round, then the cap check" | diff-local |
| Story 5 happy: Given a taskless round is admitted, when the caller returns from admission, then it emits no second `kickback` event for the round. | 65 | "no `kickback` event after admission returns" | diff-local |
| Story 5 happy: Given a worktree recreated after a taskless round, when the feature resumes, then the `manual_test` counter is rebuilt from the round receipts. | 67 | "the `manual_test` counter from the receipts" | diff-local |
| Story 5 negative: Given the `manual_test` counter at `MAX_KICKBACKS_PER_GATE`, when a stacked FAIL is admitted, then the feature halts with today's exhausted self-heal reason, and neither a route record nor `refs/conductor/demo/repairing` exists. | 65 | "halts with today's exhausted self-heal reason" | diff-local |
| Story 5 negative: Given the re-opened gate's kickback counter at `MAX_KICKBACKS_PER_GATE` on the current tree, when `lint-docs` kicks back again, then the feature halts with today's `kickback ping-pong` reason and no route record exists. | 33 | "halts with today's `kickback ping-pong` reason and no `routes/` ref exists" | diff-local |
| Story 5 negative: Given a `manual_test` taskless round, when its charge is recorded, then no gate entry in the kickback ledger changes. | 65 | "the flat ledger's gate entries are byte-identical before and after a routed `manual_test` round" | diff-local |
| Story 5 negative: Given an N=1 feature, when `manual_test` FAILs or a custom step kicks back, then today's `manual_test` self-heal counter and today's durable custom-step kickback ledger apply unchanged. | 65, 33 | "an N=1 `manual_test` FAIL uses today's self-heal counter with no routing ref read" | diff-local |
| Story 6 happy: Given an `existing-task` repair of `T1` hosted by child 1 in a round without FAIL rows, when region entry runs, then the obligation's boundary is `feat/c1/demo` at its tip on entry with a tree-hash baseline, and `T1` is restaged before child 1's BUILD dispatch. | 69 | "writes an obligation with branch `feat/c1/demo`, head the tip at entry and the entry tree hash" | diff-local |
| Story 6 happy: Given that obligation, when a commit with `Task: T1` lands on `feat/c1/demo` after the boundary, then `T1` resolves. | 70 | "resolves `T1` through `task-progress.ts` reading `head..tip(feat/c1/demo)`" | diff-local |
| Story 6 happy: Given that obligation, when the task-status rows are restored from trailers while the leaf is checked out, then `T1`'s row is restored from the trailer on `feat/c1/demo`. | 70 | "restores `T1`'s row from a trailer on `feat/c1/demo` while `feat/daemon-demo` is checked out" | diff-local |
| Story 6 happy: Given a recreated worktree with no `engine-state.json` while host 1 is `repairing`, when the feature resumes, then the obligation is rebuilt from the route record with the same branch, boundary and admission key. | 69 | "resume rebuilds the obligation from `routes/r1` with the same branch, boundary and admission key" | diff-local |
| Story 6 happy: Given an N=1 feature, when an obligation is admitted, then it carries no branch, and resolution behaves as today. | 68 | "has no `branch` field" | diff-local |
| Story 6 negative: Given that obligation, when a pre-boundary commit with `Task: T1` exists on `feat/c1/demo`, then it does not resolve `T1`. | 70 | "a pre-boundary commit with `Task: T1` on `feat/c1/demo` does not resolve `T1`" | diff-local |
| Story 6 negative: Given that obligation, when a commit with `Task: T1` lands on the leaf, then it does not resolve the obligation. | 70 | "a commit with `Task: T1` on the leaf does not resolve the obligation" | diff-local |
| Story 6 negative: Given a crash between obligation admission and restage, when the feature resumes, then the admission key `(roundId, findingId, taskIds)` reuses the same obligation, and exactly one exists. | 68 | "reuses the same obligation" | diff-local |
| Story 6 negative: Given a mixed round with FAIL rows and an `existing-task` gap on `T2`, when region entry runs, then the obligation is admitted but `T2` is not restaged. | 69 | "the restage spy records no call for `T2`" | diff-local |
| Story 6 negative: Given a route record whose `existing-task` item has no bound task ids, when it is read, then it is rejected as malformed and the feature halts. | 63, 200 | "including an `existing-task` item with no `taskIds`" | diff-local |
| Story 6 negative: Given an obligation boundary on `feat/c1/demo` rewritten by a restack, when trailers are read, then the rewrite is followed and only post-boundary commits resolve `T1`. | 70 | "is followed through rewrite translation" | diff-local |
| Story 6 negative: Given an obligation record whose branch is not a valid branch name, when it is parsed, then it is rejected. | 68 | "rejects a record whose `branch` is `feat/../x`" | diff-local |
| Story 7 happy: Given host 1 `repairing`, when `build_review` runs, then its base kind is `routed-repair`, its base is the pinned `closed/c1` SHA, and only commits made after that base are graded. | 72 | "returns `baseKind: 'routed-repair'` and a base equal to `entry.pinnedBase`" | diff-local |
| Story 7 happy: Given host 1's routed pass, when testQuality materialises pre-change content, then it restores from the same pinned base as the review. | 72 | "receive `mergeBase` equal to `entry.pinnedBase`" | diff-local |
| Story 7 happy: Given host 1's routed pass at child 1's cumulative `build_review` bound, when `build_review` fails, then the round's `routedRepairCredit` grants one more lap and the feature does not halt. | 74 | "consumes `routedRepairCredit` for `r1` on the next FAIL and the feature does not halt" | diff-local |
| Story 7 happy: Given the credit was granted, when the event log is read, then the `routed_repair_phase` event for `repairing` carries `credit: true`. | 74 | "carries `credit: true`" | diff-local |
| Story 7 negative: Given host 1 already used its `routedRepairCredit`, when `build_review` fails again, then the feature halts needs-human with a reason naming child 1. | 74 | "halts with HALT.class `needs-human` and a reason naming child 1" | diff-local |
| Story 7 negative: Given child 1's parent closure moves after region entry, when the routed pass's `build_review` runs, then its base is unchanged. | 72 | "leaves the routed pass's base unchanged" | diff-local |
| Story 7 negative: Given a `feature-repair` restack while a round is open, when refunds are computed, then no convergence refund is granted. | 74 | "`creditBuildReviewConvergence` grants no refund" | diff-local |
| Story 7 negative: Given the credit was granted, when child 1's ledger is read, then `convergenceCreditReceipts` and its other per-child caps are unchanged. | 74 | "`convergenceCreditReceipts` and other per-child caps are byte-identical" | diff-local |
| Story 7 negative: Given an N=1 feature or a non-routed child pass, when `build_review` runs, then today's base kinds apply. | 72 | "still returns its existing base kind" | diff-local |
| Story 8 happy: Given host 1 mid-repair with two builder commits stamped `Round: r1`, when the builder returns `blocked-by-prerequisite` with symbols `parseB` naming child 2, and `parseB` is absent at `closed/c1` and present at `closed/c2`, then one transaction pins the rejected tip, resets `feat/c1/demo` to `closed/c1`, moves the marker to child 2, records the fallback and re-targets the open obligations. | 58, 206 | "pins the old tip at `refs/conductor/demo/rejected/r1/1`, moves `feat/c1/demo` to `closed/c1` and moves the marker to host 2" | diff-local |
| Story 8 happy: Given that verified reroute, when the worktree sync completes, then the checked-out tree equals `closed/c1`, host 1 is `rerouted`, child 2 is `admitted`, and child 2's region entry writes the same rem ids and bodies with `**Child:** 2`. | 59 | "leaves the checked-out tree equal to `closed/c1`'s tree" | diff-local |
| Story 8 happy: Given that verified reroute, when the round's receipt is read, then no lap or growth was charged a second time. | 59 | "the receipt's laps and growth are byte-identical to their pre-reroute values" | diff-local |
| Story 8 happy: Given that verified reroute, when the event log is read, then one `remediation_rerouted` event names the round, child 1 and child 2. | 58 | "exactly one persisted `remediation_rerouted` event names `r1`" | diff-local |
| Story 8 happy: Given that verified reroute, when `refs/conductor/demo/rejected/r1/1` is read, then it equals the pre-reroute `feat/c1/demo` tip. | 58 | "equals the pre-reroute tip" | diff-local |
| Story 8 happy: Given host 2 claims `src/c.ts` is missing and names the leaf, when the claim is verified against the leaf tip, then the host moves to the leaf. | 57, 59 | "moves the host to the leaf" | diff-local |
| Story 8 happy: Given host 1 whose only commits past `closed/c1` are stamped `Round: r1` or are halt-record-only, when a verified claim arrives, then the reroute proceeds. | 58, 206 | "with only stamped and halt-record-only commits it proceeds" | diff-local |
| Story 8 happy: Given an operator commit made through the hook on `feat/c1/demo` while the marker names host 1, when a verified reroute resets the branch, then that commit stays reachable at `rejected/r1/1` and the `remediation_rerouted` event names that ref. | 58 | "an operator commit made through the hook stays reachable at that ref after the reset" | diff-local |
| Story 8 negative: Given host 1, when the builder claims `parseB` is missing but `parseB` is present at `closed/c1`, then the claim is rejected, the attempt counts against child 1's region caps, and the host stays 1. | 57, 206 | "returns `unverified`, child 1's region attempt counter records one failed attempt" | diff-local |
| Story 8 negative: Given host 2, when the builder names child 1, then the claim is refused because child 1 is not above the host, and no ref moves. | 57 | "for host 2 naming child 1 it returns `refused-not-above`" | diff-local |
| Story 8 negative: Given a verified claim naming child 2, when child 2's closure holds `parseB` but lacks another prerequisite input of the work order, then the claim is rejected and counts as a failed attempt. | 57, 206 | "when `closed/c2` lacks another prerequisite input it returns `unverified`" | diff-local |
| Story 8 negative: Given host 1's branch holds an unstamped operator commit past `closed/c1`, when a verified claim arrives, then the reroute is refused needs-human naming that commit and nothing is reset. | 58 | "the reroute halts needs-human naming that commit and nothing is reset" | diff-local |
| Story 8 negative: Given a restack journal that is not terminal, when a verified claim arrives, then the reroute is refused needs-human and no ref moves. | 58 | "with a non-terminal journal" | diff-local |
| Story 8 negative: Given the destination child is not `pending`, when a verified claim names it, then the reroute is refused needs-human and no ref moves. | 58 | "a non-`pending` destination" | diff-local |
| Story 8 negative: Given the reroute transaction, when another writer changes the marker or the host branch between read and write, then nothing moves and the feature halts needs-human naming the round. | 58 | "naming the round on a failed compare-and-swap" | diff-local |
| Story 8 negative: Given a crash after the reroute transaction and before the worktree sync, when the feature resumes, then the sync completes before any admission or dispatch and the tree ends at `closed/c1`. | 59 | "completes the sync before any `admitRound` or dispatch" | diff-local |
| Story 8 negative: Given the worktree sync fails, when the feature resumes, then the round stays `reroute-moved` and no admission or dispatch happens until the sync succeeds. | 59 | "leaves the phase `reroute-moved` and records no admission or dispatch" | diff-local |
| Story 8 negative: Given a round already rerouted from child 1 to child 2, when child 2's builder makes a verified claim naming the leaf, then the host becomes the leaf, and a later claim from the leaf is refused. | 59 | "a later claim from the leaf host returns `refused-not-above`" | diff-local |
| Story 8 negative: Given a routed build returns a malformed structured result, when it is handled, then it counts as a failed attempt on the host region's caps. | 57, 206 | "a malformed claim records one failed attempt on the host region's counter" | diff-local |
| Story 8 negative: Given a routed build returns no structured result, when it is handled, then no claim is made and the build is processed as today. | 57 | "no claim is recorded" | diff-local |
| Story 8 negative: Given an N=1 feature or a non-routed build, when the builder is dispatched, then no structured result is requested. | 204 | "an N=1 or non-routed build dispatch requests no structured result" | diff-local |
| Story 9 happy: Given no restack journal or a terminal one, when region entry, settlement and the reroute run, then each writes through the single fenced routing transaction carrying a `verify` of the journal ref. | 205, 201 | "with no journal and with a terminal `applied` journal" | diff-local |
| Story 9 happy: Given an N=1 feature with routing on, when a full remediation lap runs under a recording git shim, then no git command names `routes`, `repairing` or `revalidate`. | 205 | "records no git command naming `routes`, `repairing` or `revalidate`" | diff-local |
| Story 9 happy: Given routing off on a three-child stack, when a whole-feature gate fails, then remediation behaves exactly as before this spec. | 205 | "equal to the routing-off fixtures recorded from the pre-change path" | diff-local |
| Story 9 negative: Given a restack journal in state `moved`, when region entry, settlement or the reroute tries to write, then each is refused and `routes/r1` stays at its prior blob. | 205 | "each returns a refusal leaving `routes/r1` at its prior blob" | diff-local |
| Story 9 negative: Given a restack journal created between a writer's read and its transaction, when the transaction runs, then it fails on the journal `verify` and nothing is written. | 201 | "fails on the journal `verify` line" | diff-local |
| Story 9 negative: Given a fixture that writes a `routes/` ref outside the route-record store, when the structural check runs, then it fails. | 201 | "fails on a fixture source file that writes" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-rem-prd-audit-S3-4: host-region-entry.ts verifyGreenAcceptance: derive child run contract from committed artifacts when .pipeline run contract is absent, compare marker digest against red/c1 when both exist; add recreated-worktree test with run contract and RED marker removed
**Gate:** prd-audit
**Rationale:** Implementation gap inside Task 207 (95%): the routed verify-green path refuses when the gitignored acceptance-specs-run.json is lost on recreation, and it never compares the marker digest with red/c1. The fix is code plus a recreation test, with no design decision needed.
**Criterion:** S3.4
**Parent task:** 207
**Done when:**
- [test] S3.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S3-4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S3-7: conductor.ts/artifacts.ts: on routed pass, a refused verifyGreenAcceptance fails acceptance_specs for the host region (never falls through to RED lifecycle or self-heal); completionCtx always marks routed passes so the predicate requires a matching (roundId, host, tip) verify-green record; add conductor-level refusal test
**Gate:** prd-audit
**Rationale:** Implementation gap inside Task 207 (95%): when verify-green is refused, the routed pass falls back to the ordinary RED lifecycle and can complete on stale RED evidence. The fix is to fail the routed acceptance_specs pass for the host region, with a conductor-level test.
**Criterion:** S3.7
**Parent task:** 207
**Done when:**
- [test] S3.7 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S3-7 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S4-4: conductor.ts/round-receipt.ts: compute sealedAuthored once from the sealed plan (excluding rem- blocks) and carry the first record's value into later rounds and taskless records; add stacked fixture test asserting authored 12 after rem blocks exist on child 1's plan
**Gate:** prd-audit
**Rationale:** Implementation gap inside Task 66 (95%): sealedAuthored is recounted from the current leaf plan, including rem blocks. It must come from the sealed plan (first record) and be reused, with a stacked fixture test.
**Criterion:** S4.4
**Parent task:** 66
**Done when:**
- [test] S4.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S4-4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S4-5: kickback-ledger.ts readGrowthAccounting: apply pendingAllocationTaskIds exclusion on the sealedRoutedAuthored path; add test with unsettled routes/r1 holding rem-prd-audit-T1 on feat/daemon-demo, then settled returns []
**Gate:** prd-audit
**Rationale:** Implementation gap inside Task 66 (95%): readGrowthAccounting returns before it excludes pendingAllocationTaskIds on the routed path. The fix is code plus the Task 66 stacked-route fixture.
**Criterion:** S4.5
**Parent task:** 66
**Done when:**
- [test] S4.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S4-5 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S4-6: round-receipt.ts/conductor.ts: run rebuildLedgerFromReceipts on resume whenever route records exist, and seed the manual_test counter from receipt taskless charges; add recreated-after-settlement test asserting prd_audit laps, growth and manual_test counter rebuilt with no pendingRepair/effectiveLapCap/adjustments/convergenceCreditReceipts
**Gate:** prd-audit
**Rationale:** Implementation gap inside Task 67 (93%): the rebuild runs only under hasDurableChildState, and the manual_test counter it rebuilds is never read. The fix is to wire the recovered count and add the planned recreation test.
**Criterion:** S4.6
**Parent task:** 67
**Done when:**
- [test] S4.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S4-6 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S4-7: kickback-ledger.ts readPendingAsBuiltRemediationFindings: resolve slug from the branch/worktree identity rather than .pipeline/conduct-state.json; add recreated-worktree test reading pending findings from routes/r1 and an unreadable-record test returning the unreadable result
**Gate:** prd-audit
**Rationale:** Implementation gap inside Task 67 (92%): reading pending as-built findings depends on gitignored conduct-state.json to get the slug. The fix is to resolve the slug durably and add the recreated-worktree test.
**Criterion:** S4.7
**Parent task:** 67
**Done when:**
- [test] S4.7 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S4-7 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S4-13: Add end-to-end test: routed cap halt, kickback-budget raise --gate prd_audit (flat ledger written, child ledger byte-identical), resume settles same receipt with byte-identical frozen allocation and no new routes/ ref or rem id; plus growth-raise variant; fix any defect the test exposes
**Gate:** prd-audit
**Rationale:** Test coverage gap inside Task 64 (95%): the mechanism exists, but the end-to-end raise→resume→same-receipt behavior is unproven.
**Criterion:** S4.13
**Parent task:** 64
**Done when:**
- [test] S4.13 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S4-13 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S4-22: kickback-ledger.ts readGrowthAccounting: confine persist-on-first-read and fail-closed denominator to routed features; restore N=1 goldens (flag-off/flag-on-unsliced-fixable-lap kickback-ledger) and revert rewritten N=1 tests in kickback-ledger.test, remediation-caps, daemon-observe-cli and kickback-budget fixtures to their pre-change form
**Gate:** prd-audit
**Rationale:** Regression against Task 66's done-when (95%): the existing N=1 growth tests must pass unchanged, yet persisting growth on first read and failing closed now apply to every feature, and the N=1 goldens and tests were rewritten. The fix is to scope the new behavior to routed features and restore the N=1 fixtures.
**Criterion:** S4.22
**Parent task:** 66
**Done when:**
- [test] S4.22 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S4-22 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S5-3: conductor.ts scanKickbackVerdicts: select routing when the originating stepName is a custom step (including kickbacks to built-in gates such as build), pass stepName as the taskless identity and key receipt echo by stepName; keep bumpKickbackGateInLedger under the re-opened target; add lint-docs tests per Task 33 done-when
**Gate:** prd-audit
**Rationale:** Implementation defect inside Task 33 (95%): routing and the echo use the re-opened target, not the originating custom step. The ledger bump stays under the re-opened gate.
**Criterion:** S5.3
**Parent task:** 33
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S5-3 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S5-4: conductor.ts handleManualTestFailKickback/admitRoutedTasklessKickback: reorder to counter computation, then single kickback emission, then cap check, then record creation and charge; add ordered spy test asserting no kickback after admission returns
**Gate:** prd-audit
**Rationale:** Ordering defect inside Task 65 (95%): the approved order is counter → kickback event → cap check, but the cap check currently runs before the event. Add the ordered spy test.
**Criterion:** S5.4
**Parent task:** 65
**Done when:**
- [test] S5.4 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S5-4 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S5-6: conductor.ts: initialize manualTestSelfHeals from receipt-recovered taskless manual_test charges on routed resume; add recreated-worktree test asserting the recovered counter governs the cap
**Gate:** prd-audit
**Rationale:** Implementation gap inside Task 67 (93%): the recovered manual_test count is written but never consumed by the cap. This shares its fix with S4.6.
**Criterion:** S5.6
**Parent task:** 67
**Done when:**
- [test] S5.6 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S5-6 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S5-7: conductor.ts tasklessAdmissionCapacity: use MAX_KICKBACKS_PER_GATE and today's exhausted self-heal halt reason, sourced from the recovered counter; add exhausted-conductor test asserting the reason and no routes/ or repairing ref
**Gate:** prd-audit
**Rationale:** Defect inside Task 65 (95%): exhaustion must halt with today's self-heal reason at MAX_KICKBACKS_PER_GATE, not with a new hardcoded message and threshold.
**Criterion:** S5.7
**Parent task:** 65
**Done when:**
- [test] S5.7 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S5-7 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S8-11: prerequisite-claim.ts settleRoutedBuildClaim: load the admitted work order's prerequisite inputs and pass them as prerequisitePaths to verifyPrerequisiteClaim; add conductor-path test where a destination missing a non-claimed prerequisite is refused
**Gate:** prd-audit
**Rationale:** Wiring gap inside Task 206 (96%): the production caller never passes the work order's prerequisitePaths. This shares its fix with the decision 5 as-built finding.
**Criterion:** S8.11
**Parent task:** 206
**Done when:**
- [test] S8.11 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S8-11 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-S9-3: Add routing-off three-child parity test: failing prd_audit leaves leaf plan, kickback-ledger.json (with flat pendingRepair) and task status equal to fixtures recorded from the pre-change path, with no refs/conductor/demo/routes/ ref; ensure readGrowthAccounting routing-only changes keep it passing
**Gate:** prd-audit
**Rationale:** Regression against Task 205 (95%): the growth-accounting changes affect routing-off features, and the routing-off three-child parity fixture is missing. Gate the behavior and add the fixture.
**Criterion:** S9.3
**Parent task:** 205
**Done when:**
- [test] S9.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-S9-3 is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-e24e-1: prerequisite-claim.ts: supply work-order prerequisitePaths from settleRoutedBuildClaim; check source absence only for claimed missing paths and destination presence for all prerequisites; add tests for both cases
**Gate:** as-built
**Rationale:** Conforming implementation drift from ADR decision 5 (99%): every prerequisite must exist at the destination, but only the claimed missing ones must be absent at the source. No architectural change is needed.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 5
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 5 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-e24e-1 is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-e24e-3: conductor.ts admitRoutedTasklessKickback: replace execution.target.child shortcut with the residue-routing judgment for both manual_test and custom-step admission; add tests asserting the judged host is used
**Gate:** as-built
**Rationale:** Conforming drift from ADR decision 3 (95%): standalone taskless admission bypasses the residue-routing judgment the ADR requires. The routing judgment already exists for the residue path, so this is a wiring fix within Task 65 and Task 33 admission.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 3
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 3 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-e24e-3 is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-e24e-4: conductor.ts custom-step kickback: route on originating custom stepName (including re-opened build), use stepName for finding identity and receipt echo, keep ledger bump under the re-opened target
**Gate:** as-built
**Rationale:** Conforming drift from ADR decision 10 (99%): custom-step taskless routing must select and identify by the originating step, while the ledger bump stays under the re-opened gate. Same fix as S5.3.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 10
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 10 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-e24e-4 is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-e24e-5: conductor.ts: restore counter→kickback event→cap ordering for manual_test (:7029/:7048) and custom-step (:15117/:15157) admission, use today's exhaustion reason, and drive event count from the recovered counter; keep preflight preventing route creation when already exhausted
**Gate:** as-built
**Rationale:** Conforming drift from ADR decision 10 (98%): the counter → event → cap ordering and the existing exhaustion reason are approved, and recovered counts must drive the event and the cap. This covers both manual_test and custom-step admission. Same fix class as S5.4 and S5.7.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 10
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 10 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-e24e-5 is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-e24e-6: conductor.ts/round-receipt.ts: stop recounting Task headings per round; stamp sealedAuthored on taskless records; remove authored-zero fallback (:206) and zero persistence (:415–433), failing closed when no record supplies sealedAuthored
**Gate:** as-built
**Rationale:** Conforming drift from ADR decision 10 (98%): the denominator must be sealed once and recovered, never recounted or zeroed. This shares its fix with S4.4.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 10
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 10 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-e24e-6 is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-e24e-7: round-receipt.ts pendingAsBuiltFindingsFromRoutes: include findings from rounds whose lifecycle is still open (host repairing/admitted) regardless of receipt settlement; add recreated-worktree test with settled-but-open round
**Gate:** as-built
**Rationale:** Conforming drift from ADR decision 10 (98%): pending as-built findings must follow the round lifecycle (open until the round closes), not accounting settlement, which happens before BUILD.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 10
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 10 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-e24e-7 is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-e24e-8: round-receipt.ts (:110–111): grant each new round its convergence-credit allowance without requiring the prior round's credit to be consumed; add test where previous round's credit is unused and new-round host entry succeeds
**Gate:** as-built
**Rationale:** Conforming drift from ADR decision 12 (98%): every new round receives its own credit allowance, whether or not the previous round used its credit.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 12
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 12 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-e24e-8 is committed and its targeted tests pass.
