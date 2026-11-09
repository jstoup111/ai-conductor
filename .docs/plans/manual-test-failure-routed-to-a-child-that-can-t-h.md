# Implementation Plan: A whole-feature failure is routed to a child that can hold the fix, and a stranded round has a supported way out (#3605)

**Date:** 2026-11-07
**Design:** `.docs/decisions/architecture-review-2026-11-07-manual-test-failure-routed-to-a-child-that-can-t-h.md` (technical track, no PRD)
**Stories:** .docs/stories/manual-test-failure-routed-to-a-child-that-can-t-h.md
**Conflict check:** Clean as of 2026-11-07 (`.docs/conflicts/2026-11-07-manual-test-failure-routed-to-a-child-that-can-t-h.md`)

## Summary

This plan fixes a taskless routed obligation (a `manual_test` FAIL or a post-region custom-step kickback). Its host now dispatches BUILD instead of deriving "already complete". It is placed from its evidence on a child that contains the named code. A stranded sole audit round can be closed by a recorded operator command, and the commit guard names only commands that apply. 14 tasks.

## Technical Approach

- **Taskless guard (`src/conductor/src/engine/routing/host-region-entry.ts`).** Add a pure predicate, `hostCarriesTasklessObligation(record, host)`. It is true when at least one item is hosted there, the host's allocation `remTaskIds` is empty, and no item hosted there carries `taskIds`. Task work always yields rem ids or existing-task `taskIds`, so a hosted item with neither is a taskless obligation. The predicate does not depend on `retryHint`, because `admitRoutedCustomStepKickback` records no hint. The `audit` arm of the `auditAlreadyComplete` check returns `false` when the predicate holds, so entry proceeds to the `repairing` transition. Task-bound hosts, and hosts with no hosted item, keep today's `checkStepCompletion` path. The route-record schema does not change.
- **Path manifest (`src/conductor/src/engine/routing/cannot-host.ts`).** Add `changedPathsByPosition({ slug, positions, leafTip, baseRef, git })`. It returns, per declared position, `git diff --name-only` between consecutive refs: `baseRef` (the merge-base of the feature's base branch and child 1's closure) to `closureRefFor(slug, 1)`, then closure N-1 to closure N, then the last child closure to `leafTip`. Any unreadable ref returns `{ kind: 'halt', detail }` naming the child.
- **Routing contract v2 (`src/conductor/src/engine/routing/residue-routing-call.ts`).** `RESIDUE_ROUTING_CALL_CONTRACT_VERSION` becomes `v2`. Each answer item may carry `implicatedPaths: string[]`, where each path is a non-empty string. A malformed value counts as a malformed answer under the existing two-attempt budget. `ResidueRoutingAnswer` exposes `implicatedPaths` (default `[]`). `routeAdmittedRound` callers ignore it.
- **Taskless placement (`Conductor.admitRoutedTasklessKickback` in `src/conductor/src/engine/conductor.ts`).** The routing-call item gains `evidence` (the retry hint, when present) and `changedPaths` (the manifest). After the judgement, implicated paths are filtered to those present on the leaf tip (`hasPath`). With at least one kept path, the host is `selectHost({ owner, inputs: kept, … })`, whose reason is `owner` (recorded as the judged reason) or `prerequisite-paths`. With none kept, the host is the last declared position, and the item's reason stays the judged owner's reason. The route item records `owner`, `host` and `reason`.
- **Sole-round close (`src/conductor/src/engine/stack-rounds-cli.ts`).** `checkRoundSupersession` gains a `leaf-return` result for the sole non-closed `open` `audit` round: every host must be `pending`, `admitted`, `restacked`, `done` or `rerouted`, there must be no reroute, and the marker must name the round or be absent. `supersedeRound` writes `pending` and `admitted` hosts `done`, the round `closed`, and (when present) `{ kind: 'delete-marker' }`, all in one `writeRoutingTransaction`. This mirrors `abandonOperatorRound`'s `update-record` plus `delete-marker` transaction in `src/conductor/src/engine/routing/operator-round.ts`. Non-sole rounds keep today's predicate unchanged.
- **Event (`src/conductor/src/engine/routing/routing-events.ts`, `src/conductor/src/types/events.ts`).** `routing_round_superseded` gains `disposition: 'superseded' | 'leaf-return'`. `supersededBy` is required for `superseded` and absent for `leaf-return`.
- **Commit guard (`src/conductor/src/engine/stack-commit-guard-cli.ts`).** The refusal suffix is chosen by an exhaustive switch over the round kind: `audit` gives `ai-conductor stack rounds --slug <slug> --close <rN> --reason <text>`, and `operator` gives `ai-conductor stack land --slug <slug> --abandon`.

## Prerequisites

None. The #3590 settle, `hostReasons`, and the #3459 `stack rounds` CLI are on main.

## Tasks

### Task 1: The audit no-op guard treats a host whose only work is a taskless obligation as dispatchable
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `hostCarriesTasklessObligation` and use it in the `audit` arm of the `auditAlreadyComplete` switch in `enterRoutedHostRegion`.
4. Verify GREEN and commit.

**Done when:**
- [test] `enterRoutedHostRegion` for an audit round whose only item is `manual-test-fail` on host 4, with `remTaskIds: []`, a FAIL-row `retryHint`, and every authored task on child 4 evidence-complete, returns `entered` and the stored record shows host 4 `repairing`.
- [test] `enterRoutedHostRegion` for an audit round whose only item is a custom-step kickback on host 2, with `remTaskIds: []` and no `retryHint`, returns `entered` and the stored record shows host 2 `repairing`.
- [test] `enterRoutedHostRegion` for an audit round whose host has zero routed tasks and no item hosted on it returns `derived-already-complete` with the existing "has no dispatchable BUILD work" detail, and the host stays `admitted`.
- [test] `hostCarriesTasklessObligation` is false for a host with one rem task id or one hosted item carrying `taskIds`, even when that host's allocation has a `retryHint`.

**Files likely touched:**
- `src/conductor/src/engine/routing/host-region-entry.ts` — taskless predicate and guard arm
- `src/conductor/test/engine/routing/host-region-entry.realgit.test.ts` — entry tests

**Dependencies:** none

### Task 2: The conductor dispatches BUILD on a taskless host with the stored retry hint
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-taskless-admission.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement whatever wiring Task 1 leaves missing between region entry and the BUILD dispatch. The host BUILD already reads `route.record.allocation[host].retryHint`.
4. Verify GREEN and commit.

**Done when:**
- [test] A conductor run with an open audit round whose only item is `manual-test-fail` hosted on child 4 and every authored task on child 4 complete dispatches the `build` step with `activeChild` 4, its retry reason contains each stored FAIL row verbatim, and the route record then shows host 4 `repairing`.
- [test] A conductor run in which a post-region custom step kicks back on a stacked feature, with an injected judge answering child 2 with candidates `[2]` and an implicated path first added by child 2, admits the round through `admitRoutedCustomStepKickback` with item host 2 and no rem tasks, then dispatches the `build` step with `activeChild` 2, and the route record then shows host 2 `repairing`.
- [test] Neither run writes `.pipeline/HALT` or emits a `loop_halt` whose text contains `derived-already-complete`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — routed host entry to BUILD dispatch, only if Task 1 leaves a gap
- `src/conductor/test/engine/routing/conductor-routed-taskless-admission.test.ts` — dispatch tests

**Dependencies:** Task 1

### Task 3: A taskless host's BUILD exits through restack on a commit and through the no-commit exit otherwise
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Fix any exit-path gap the taskless host exposes in `exitRoutedHostAndReconcile`; no new exit kind.
4. Verify GREEN and commit.

**Done when:**
- [test] A real-git run in which the taskless host 4's BUILD commits a file on `feat/c4/demo` leaves host 4 `restacked`, that commit is an ancestor of `feat/daemon-demo`, and the round's next routed step is the leaf return.
- [test] A real-git run in which host 4's BUILD commits nothing leaves host 4 `done` through the no-commit exit, and `feat/daemon-demo` HEAD is unchanged.
- [test] After that no-commit exit, a `manual_test` PASS rewrite at the unchanged leaf HEAD is refused by the existing anti-whitewash check, and the `manual_test` step is not recorded done.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — only if the taskless exit exposes a gap
- `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` — exit tests

**Dependencies:** Task 2

### Task 4: Task-bound no-op hosts keep their outcome, and an interrupted taskless BUILD resumes
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement any resume-path fix so a `repairing` taskless host re-enters BUILD with its stored hint.
4. Verify GREEN and commit.

**Done when:**
- [test] A conductor run whose host 3 holds one evidence-complete rem task, no `retryHint`, with host 4 `pending` dispatches no `build` step for host 3 and leaves host 3 `done` with `hostReasons[3]` `derived-already-complete`.
- [test] The same fixture with host 3 as the round's only host writes a `needs-human` `.pipeline/HALT` whose body ends `Outcome: derived-already-complete` and dispatches no `build` step.
- [test] A resumed run whose taskless host 4 is already `repairing` dispatches the `build` step with `activeChild` 4 and the same stored retry hint, and writes no HALT containing `derived-already-complete`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — resume of a `repairing` taskless host, only if needed
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — resume and preserved-outcome tests

**Dependencies:** Task 1

### Task 5: The residue routing contract v2 carries optional implicated paths
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/residue-routing-call.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the `v2` schema, the parse of `implicatedPaths`, and `ResidueRoutingAnswer.implicatedPaths`.
4. Verify GREEN and commit.

**Done when:**
- [test] `runResidueRoutingCall` with a judge answering `version: "v2"` and `implicatedPaths: ["src/a.ts"]` returns `routed` whose answer carries `implicatedPaths` `["src/a.ts"]`.
- [test] `runResidueRoutingCall` with a judge answering `v2` without `implicatedPaths` returns `routed` whose answer carries `implicatedPaths` `[]`.
- [test] A judge answering `implicatedPaths: [""]` or `implicatedPaths: "src/a.ts"` on both attempts makes `runResidueRoutingCall` return `halt` naming the item id, after exactly two judge calls.
- [test] A judge answering `version: "v1"` on both attempts makes `runResidueRoutingCall` return `halt`, and `renderResidueRoutingPrompt` output contains the `v2` contract.

**Files likely touched:**
- `src/conductor/src/engine/routing/residue-routing-call.ts` — v2 schema and parse
- `src/conductor/test/engine/routing/residue-routing-call.test.ts` — contract tests

**Dependencies:** none

### Task 6: Each declared position's changed paths are derived from the stack refs
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `changedPathsByPosition` beside `selectHost`, reusing `closureRefFor` and the module's git runner.
4. Verify GREEN and commit.

**Done when:**
- [test] On a real five-child `demo` stack, `changedPathsByPosition` returns, for position 4, a set containing `src/client/input/touch.ts` and `src/client/ui/hud.ts`, and for position 5 a set containing `src/client/art/manifest.ts`.
- [test] Position 1's set equals `git diff --name-only` from the merge-base of `main` and `closed/c1` to `closed/c1`, and no position's set contains a path changed only by another position.
- [test] With `closed/c3` deleted, `changedPathsByPosition` returns `{ kind: 'halt' }` whose detail names child 3.

**Files likely touched:**
- `src/conductor/src/engine/routing/cannot-host.ts` — manifest helper
- `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` — manifest tests

**Dependencies:** none

### Task 7: Taskless admission sends the judge the FAIL evidence and the per-position manifest
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-taskless-admission.test.ts` for every Done-when check below.
2. Verify RED.
3. In `admitRoutedTasklessKickback`, build the manifest before the routing call, add `evidence` and `changedPaths` to the item, and halt on a manifest `halt` before any judge call or record creation.
4. Verify GREEN and commit.

**Done when:**
- [test] For a `manual_test` FAIL on `demo` whose rows describe overlapping touch controls, the injected judge is called exactly once, and its prompt's single item carries every FAIL row verbatim and a `changedPaths` entry for each position 1 to 5 holding the paths that position changed, with position 4's entry containing `src/client/input/touch.ts` and `src/client/ui/hud.ts` and position 5's containing `src/client/art/manifest.ts`.
- [test] With `closed/c3` unreadable, admission writes a `needs-human` HALT naming child 3, the injected judge is never called, and no `refs/conductor/demo/routes/` ref exists.
- [test] With a judge answering an undeclared position on both attempts, admission writes a `needs-human` HALT naming item `manual-test-fail`, and no `refs/conductor/demo/routes/` ref exists.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — taskless admission item and manifest halt
- `src/conductor/test/engine/routing/conductor-routed-taskless-admission.test.ts` — admission tests

**Dependencies:** Task 5, Task 6

### Task 8: A taskless obligation is hosted on the lowest child that contains its kept paths, else on the leaf
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-taskless-admission.test.ts` for every Done-when check below.
2. Verify RED.
3. In `admitRoutedTasklessKickback`, filter `implicatedPaths` to paths present on the leaf tip, call `selectHost` with the kept paths from the judged owner, or use the last declared position when none are kept, and record owner, host and reason on the route item.
4. Verify GREEN and commit.

**Done when:**
- [test] A judge answer `{child: 4, candidates: [4], implicatedPaths: ["src/client/input/touch.ts"]}` creates a route record whose `manual-test-fail` item has owner 4, host 4 and reason `residue-judged`.
- [test] A judge answer `{child: 1, candidates: [1], implicatedPaths: ["src/client/ui/hud.ts"]}` creates an item with owner 1, host 4 and reason `prerequisite-paths`, and an answer naming `touch.ts` and `src/client/art/manifest.ts` from child 4 creates an item with host 5.
- [test] A judge answer `{child: 1, candidates: [1, 2]}` with no implicated paths, and an answer `{child: 2, candidates: [2]}` whose implicated paths are all absent from `feat/daemon-demo`, each create a route record whose item has host 5, and neither writes `.pipeline/HALT`.
- [test] A post-region custom-step kickback whose judge answer names no implicated paths creates a route record whose item has host 5, and the judge prompt's item carries no `evidence` rows.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — placement after the judgement
- `src/conductor/test/engine/routing/conductor-routed-taskless-admission.test.ts` — placement tests

**Dependencies:** Task 7

### Task 9: A mixed round still places its FAIL obligation without a routing call
**Story:** Story 2
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Add or locate a test in `src/conductor/test/engine/routing/round-router.test.ts` for the Done-when checks below.
2. Confirm it passes on the changed tree with no production change.
3. Commit with `Evidence: satisfied-by <sha>` when the test already exists, else the test-only commit.

**Done when:**
- [test] `routeAdmittedRound` for a consolidated round carrying a task-bound gap on host 2 and FAIL rows makes zero residue routing calls for the FAIL obligation, and returns a `manual-test-fail` item with host 2 and reason `mixed-round`.
- [test] In that result, host 2's allocation `retryHint` contains every FAIL row verbatim.

**Files likely touched:**
- `src/conductor/test/engine/routing/round-router.test.ts` — mixed-round placement test

**Dependencies:** none

### Task 10: The close predicate admits a sole open audit round whose hosts have not started repairing
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/stack-rounds-close-predicate.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Extend `checkRoundSupersession` with the `leaf-return` result and its refusals, keeping the exhaustive `HostState` switch and the survivor path unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `checkRoundSupersession` for sole open audit round r2 with host 1 `admitted` and the marker naming r2 returns `{ kind: 'leaf-return' }` listing host 1, and the same round with no marker also returns `leaf-return`.
- [test] `dispatchStackRoundsCommand` closing sole r2 with host 1 in each of `repairing`, `built`, `reroute-moved`, `abandoning`, `abandoned`, or with an in-progress reroute, prints `stack rounds: refused` naming that host and state or the reroute, returns 1, and leaves every `refs/conductor/demo/` ref unchanged.
- [test] `dispatchStackRoundsCommand` closing sole r2 while the marker names r7 prints a refusal naming r7, returns 1, and leaves every `refs/conductor/demo/` ref unchanged.
- [test] `dispatchStackRoundsCommand` closing r4 with host 2 `admitted` while r5 is open prints a refusal naming host 2 and `admitted`, returns 1, and leaves every `refs/conductor/demo/` ref unchanged.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — leaf-return predicate
- `src/conductor/test/engine/routing/stack-rounds-close-predicate.realgit.test.ts` — predicate tests

**Dependencies:** none

### Task 11: A leaf-return close writes hosts, round and marker in one transaction with a recorded disposition
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/stack-rounds-close-write.realgit.test.ts` and `src/conductor/test/engine/routing/routing-events.test.ts` for every Done-when check below.
2. Verify RED.
3. Extend `supersedeRound` for `leaf-return`, add `disposition` to `routingRoundSupersededEvent` and the `routing_round_superseded` event type.
4. Verify GREEN and commit.

**Done when:**
- [test] `supersedeRound` for a `leaf-return` check on r2 issues exactly one `writeRoutingTransaction` holding `update-record` and `delete-marker`, after which r2 is `closed`, host 1 is `done`, and the repair marker ref is absent.
- [test] The closed r2 record's outbox holds exactly one `routing_round_superseded` event with `roundId` r2, `disposition` `leaf-return`, the trimmed reason, the operator identity, and no `supersededBy` key.
- [test] `supersedeRound` for a survivor close of r4 by r5 records `disposition` `superseded` with `supersededBy` r5.
- [test] When the marker ref is moved between `checkRoundSupersession` and the write, `supersedeRound` returns `refused` naming a contested write, and r2's record blob and the marker ref equal their moved values.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — leaf-return write
- `src/conductor/src/engine/routing/routing-events.ts` — disposition field
- `src/conductor/src/types/events.ts` — `routing_round_superseded` shape
- `src/conductor/test/engine/routing/stack-rounds-close-write.realgit.test.ts` — write tests
- `src/conductor/test/engine/routing/routing-events.test.ts` — event tests

**Dependencies:** Task 10

### Task 12: The `stack rounds --close` command reports a leaf-return close and unblocks a leaf commit
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-rounds-cli.test.ts` and `src/conductor/test/engine/stack-commit-guard.hook.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Print the leaf-return outcome in `dispatchStackRoundsCommand`, keeping the reason and lease checks before any write.
4. Verify GREEN and commit.

**Done when:**
- [test] `dispatchStackRoundsCommand` for `--slug demo --close r2 --reason "fix lands on leaf"` on halted `demo` returns 0, prints r2, closed host 1, the reason and `ai-conductor halt clear`, and afterwards r2 is `closed`, host 1 is `done`, and the marker ref is absent.
- [test] After that close, the installed pre-commit hook allows a tracked-file commit on `feat/daemon-demo`.
- [test] A close of sole r2 with `--reason "  "` returns 1, never calls the injected `acquireLease`, and leaves every `refs/conductor/demo/` ref unchanged.
- [test] A close of sole r2 while the injected `acquireLease` reports the lease held returns 1, prints a refusal naming the held lease, and leaves every `refs/conductor/demo/` ref unchanged.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — leaf-return output
- `src/conductor/test/engine/stack-rounds-cli.test.ts` — CLI tests
- `src/conductor/test/engine/stack-commit-guard.hook.realgit.test.ts` — post-close commit test

**Dependencies:** Task 11

### Task 13: After a sole-round close the next dispatch drains the event and runs the leaf gates
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement any reconciliation gap so that, with no non-closed round and no marker, the leaf resumes from its kickback-set state.
4. Verify GREEN and commit.

**Done when:**
- [test] A real-git conductor dispatch after a leaf-return close of r2, a leaf commit and a cleared HALT appends exactly one `routing_round_superseded` line for r2 with `disposition` `leaf-return`, the close's reason, the operator identity and no `supersededBy` key to `.pipeline/events.jsonl`, and a second drain appends none.
- [test] That dispatch emits no `routed_repair_phase` event and dispatches no step with an `activeChild` below the leaf.
- [test] That dispatch dispatches `manual_test` on the leaf worktree, whose HEAD equals the operator's leaf commit.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — leaf resume after a leaf-return close, only if needed
- `src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts` — dispatch tests

**Dependencies:** Task 12

### Task 14: The stack-commit-guard refusal names only the recovery command for the active round's kind
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-commit-guard.test.ts` for every Done-when check below.
2. Verify RED.
3. Replace the fixed suffix in `runStackCommitGuard` with an exhaustive switch over the stored round kind.
4. Verify GREEN and commit.

**Done when:**
- [test] `runStackCommitGuard` for a leaf commit while the marker names audit round r2 hosted on child 1 returns non-zero, prints a refusal naming `feat/c1/demo` and `ai-conductor stack rounds --slug demo --close r2 --reason <text>`, and the refusal does not contain `stack land --abandon`.
- [test] `runStackCommitGuard` for a leaf commit while the marker names operator round r3 hosted on child 2 prints a refusal naming `feat/c2/demo` and `ai-conductor stack land --slug demo --abandon`, and the refusal does not contain `stack rounds --close`.
- [test] `runStackCommitGuard` for a commit on `feat/c1/demo` while the marker names audit round r2 hosted on child 1 returns 0.
- [test] With an unreadable marker, `runStackCommitGuard` for a tracked-file commit on each of `feat/c1/demo`, `feat/c3/demo` and `feat/daemon-demo` returns non-zero with a refusal containing `routed repair marker is unreadable` and containing neither `stack rounds --close` nor `stack land --abandon`.
- [test] With a readable marker naming audit round r2 hosted on child 1 whose route record is unreadable, `runStackCommitGuard` for a commit on `feat/daemon-demo` returns non-zero with a refusal naming the unreadable route record and containing neither `stack rounds --close` nor `stack land --abandon`.

**Files likely touched:**
- `src/conductor/src/engine/stack-commit-guard-cli.ts` — round-kind suffix
- `src/conductor/test/engine/stack-commit-guard.test.ts` — guard tests

**Dependencies:** none

## Task Dependency Graph

```text
Task 1 ─┬─▶ Task 2 ─▶ Task 3
        └─▶ Task 4
Task 5 ─┐
Task 6 ─┴─▶ Task 7 ─▶ Task 8
Task 9 (independent, verify-only)
Task 10 ─▶ Task 11 ─▶ Task 12 ─▶ Task 13
Task 14 (independent)
```

## Integration Points

- After Task 2: a routed `manual_test` FAIL on a complete child dispatches BUILD end to end.
- After Task 8: a `manual_test` kickback on a stack routes to a host containing the named code.
- After Task 13: an operator can close a stranded sole round, commit on the leaf, and resume.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | task | task-2 | dispatches the `build` step with `activeChild` 4, its retry reason contains each stored FAIL row verbatim |
| adr-2026-10-12-routed-whole-feature-repair#D2 | existing | none | Task-bound owner derivation is `routeAdmittedRound` in `src/conductor/src/engine/routing/round-router.ts`; unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | task | task-7, task-8 | its prompt's single item carries every FAIL row verbatim and a `changedPaths` entry for each position 1 to 5 |
| adr-2026-10-12-routed-whole-feature-repair#D4 | task | task-8 | creates an item with owner 1, host 4 and reason `prerequisite-paths` |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | No builder prerequisite claim or reroute changes. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-11 | issues exactly one `writeRoutingTransaction` holding `update-record` and `delete-marker` |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-1, task-12 | returns `entered` and the stored record shows host 4 `repairing` |
| adr-2026-10-12-routed-whole-feature-repair#D8 | existing | none | `resolveExecutionChild` in `src/conductor/src/engine/routing/execution-child.ts` stays the one resolver. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | existing | none | Region-entry appends are unchanged in `src/conductor/src/engine/routing/host-region-entry.ts`. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | existing | none | Taskless receipt charging is `chargeTasklessAtAdmission`; unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D11 | existing | none | Round-keyed obligations are `admitRoutedObligation` in `src/conductor/src/engine/repair-restage.ts`; unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The routed review base is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | task | task-3 | that commit is an ancestor of `feat/daemon-demo` |
| adr-2026-10-12-routed-whole-feature-repair#D14 | existing | none | The re-validation queue path through `exitRoutedHostAndReconcile` is unchanged. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-13 | That dispatch dispatches `manual_test` on the leaf worktree, whose HEAD equals the operator's leaf commit. |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-13 | appends exactly one `routing_round_superseded` line for r2 with `disposition` `leaf-return` |
| adr-2026-10-12-routed-whole-feature-repair#D17 | existing | none | `routingEligible` is false for a flat cursor, so N=1 never reaches routing. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | existing | none | `routingSettingOn` reads `stacked_prs.route_whole_feature_fixes`; unchanged. |
| adr-2026-07-13-kickback-build-no-op-escalation#D1 | task | task-1, task-4 | writes a `needs-human` `.pipeline/HALT` whose body ends `Outcome: derived-already-complete` and dispatches no `build` step |
| adr-2026-07-13-kickback-build-no-op-escalation#D2 | existing | none | Zero-progress escalation is `classifyBuildProgress` and `shouldEscalateKickback` in `src/conductor/src/engine/kickback-escalation.ts`. |
| adr-2026-07-13-kickback-build-no-op-escalation#D3 | existing | none | The did-work distinction is recorded on the existing `kickback` event by `classifyBuildProgress`. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
