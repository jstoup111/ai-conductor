# Implementation Plan: Operator command to inspect and recover wedged routed rounds

**Date:** 2026-10-29
**Design:** `.docs/decisions/architecture-review-2026-10-29-operator-command-to-inspect-and-recover-wedged-rou.md`; `adr-2026-10-12-routed-whole-feature-repair` decisions 6, 7 and 16 (amended by #3459); diagram `.docs/architecture/operator-command-to-inspect-and-recover-wedged-rou.md`
**Stories:** .docs/stories/operator-command-to-inspect-and-recover-wedged-rou.md
**Conflict check:** Clean as of 2026-10-29 (`.docs/conflicts/2026-10-29-operator-command-to-inspect-and-recover-wedged-rou.md`)

## Summary

Add `ai-conductor stack rounds --slug <slug>`, a read-only inspection of a feature's routed rounds, and
`ai-conductor stack rounds --slug <slug> --close <rN> --reason <text>`, which supersedes one stale open `audit`
round through the routing compare-and-swap and records a `routing_round_superseded` spine event in the same
write. The plan has 10 tasks and ships as a single PR.

## Technical Approach

- **One new module, `src/conductor/src/engine/stack-rounds-cli.ts`.** It follows the `stack land` precedent in
  `src/conductor/src/engine/stack-land-cli.ts`, keeping its semantic traits:
  - an injectable `StackRoundsCliDeps` whose every member defaults to the real git-backed implementation;
  - the eligibility check (routing setting on, durable child state) runs before any routing ref is read;
  - `refused(print, detail)` prints `stack rounds: refused — <detail>` and returns exit code 1;
  - the feature dispatch lease is taken only after every read-only refusal, and released in `finally`.

  The command copies the shape, not the land-specific logic: there is no park, no topology load and no HALT
  clearing. Search hints: `checkStackLandEligibility`, `dispatchStackLandAbandonCommand`, `resolveCliFeatureWorktree`.
- **Read model.** `describeRoutingRounds(worktree, slug, deps)` enumerates
  `refs/conductor/<slug>/routes/` with `for-each-ref`. It reads each record through `readRouteRecord`, reads the
  marker through `readRepairMarker`, and returns a closed result: one entry per round (`record` or `unreadable`
  with its blob id), the marker (`absent`, `unreadable` or `marker`), and the wedges found. A wedge is an open
  `audit` round that has no active host and at least one `pending` host, while the marker names a different
  round. Rendering is a pure function of that result.
- **Close predicate.** `checkRoundSupersession(worktree, slug, roundId, deps)` is read-only and returns either
  `{ kind: 'supersedable'; stored; supersededBy; droppedHosts; findingIds }` or `{ kind: 'refused'; detail }`.
  It classifies hosts with an exhaustive `switch` over `HostState` that ends in `assertNever`. Its conditions
  come from adr-2026-10-12 decision 6 as amended by #3459.
- **Close write.** `supersedeRound(worktree, slug, checked, reason, operator, deps)` builds the next record:
  `phase: 'closed'`, each pending host set to `done`, and the event appended through `withOutboxEvent`. It writes
  that record in one `writeRoutingTransaction` `update-record` against `checked.stored`, so a concurrent change
  makes the compare-and-swap fail. It writes no other ref and no `.pipeline/` file.
- **Event.** A new `ConductorEvent` member, `routing_round_superseded {eventId, occurredAt, roundId, child,
  supersededBy, droppedHosts, findingIds, reason, operator}`, built by `routingRoundSupersededEvent` in
  `routing/routing-events.ts`. `child` is the lowest dropped host. The member joins
  `ROUTING_OCCURRENCE_TYPES` in `event-persister.ts`, so dedup is by `eventId`. Delivery uses the engine's
  existing `drainRoutingOutboxes`; this feature adds no drain call.
- **CLI wiring.** `detectStackRoundsCommand` (`cli.ts`) parses `stack rounds --slug <slug> [--close <rN>
  --reason <text>]`, with the same slug rules as `detectStackLandCommand`. Wiring touches:
  - a commander `stack rounds` help entry beside `stack land`/`stack owners`;
  - a `cli-pre-dispatch.ts` table row;
  - the `index.ts` pre-dispatch call beside `detectStackLandCommand`.

  The daemon-session entry guard already refuses every `stack` subcommand, because `stack` is not in
  `SESSION_SANCTIONED_SUBCOMMANDS`. This plan adds a test of that guard and no new code.
- **Sequencing.** Tasks 1–5 are leaf primitives with unit and real-git tests. Tasks 6–8 compose them into the
  dispatcher. Task 9 wires the production entry point. Task 10 proves the downstream engine effects of a
  close: outbox drain, dedup, and the surviving round's leaf return.

## Prerequisites

- None. Every reused primitive is on main. Spec #3462 (for #3445) is not a prerequisite: this feature does not
  edit `routing/round-admission.ts`.

## Tasks

### Task 1: `routing_round_superseded` event member, factory and dedup
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routing-events.test.ts` and `src/conductor/test/engine/event-persister.test.ts` for each Done-when check (RED).
2. Add the union member to `src/conductor/src/types/events.ts` beside `operator_round`; add `routingRoundSupersededEvent(record, supersededBy, droppedHosts, findingIds, reason, operator)` to `routing/routing-events.ts` using the module's `occurrence()` helper; add the type to `ROUTING_OCCURRENCE_TYPES` (GREEN).
3. Commit.

**Done when:**
- [test] `routingRoundSupersededEvent` for round r4 with dropped host 2 returns `type: 'routing_round_superseded'`, `roundId` r4, `supersededBy` r5, `droppedHosts` [2], `child` 2, the given `findingIds`, reason and operator, and a non-empty `eventId` and `occurredAt`.
- [test] The persister, given the same `routing_round_superseded` event twice with one `eventId`, appends exactly one line to `.pipeline/events.jsonl` and returns `duplicate` for the second.
- `ROUTING_OCCURRENCE_TYPES` in `src/conductor/src/engine/event-persister.ts` contains `routing_round_superseded`, and `tsc --noEmit` passes with the new union member.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — union member
- `src/conductor/src/engine/routing/routing-events.ts` — factory
- `src/conductor/src/engine/event-persister.ts` — dedup set
- `src/conductor/test/engine/routing/routing-events.test.ts` — factory test
- `src/conductor/test/engine/event-persister.test.ts` — dedup test

**Dependencies:** none

### Task 2: Parse the `stack rounds` grammar
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/stack-rounds-detect.test.ts` (RED).
2. Add `StackRoundsInspectDispatch`, `StackRoundsCloseDispatch` and `StackRoundsDispatch` to `src/conductor/src/types/cli.ts`; add `detectStackRoundsCommand(argv)` to `src/conductor/src/cli.ts`, which accepts exactly `stack rounds --slug <s>` or `stack rounds --slug <s> --close <id> --reason <text>` in any pairwise flag order, and rejects slugs containing `/` or equal to `.` or `..`, like `detectStackLandCommand` (GREEN).
3. Commit.

**Done when:**
- [test] `detectStackRoundsCommand` returns `{ kind: 'stack-rounds-inspect', slug }` for `stack rounds --slug demo` and `{ kind: 'stack-rounds-close', slug, roundId: 'r4', reason }` for `stack rounds --slug demo --close r4 --reason x`.
- [test] `detectStackRoundsCommand` returns `null` for each of: an unknown flag, a repeated `--slug`, `--close` without `--reason`, `--reason` without `--close`, a slug `a/b`, a slug `.`, a slug `..`, and a missing `--slug`.
- [test] Running the CLI entry with each rejected vector does not call `dispatchStackRoundsCommand` (spied in `src/conductor/test/cli/stack-rounds-detect.test.ts`), and `git for-each-ref refs/conductor/` output in the fixture repository is identical before and after.

**Files likely touched:**
- `src/conductor/src/types/cli.ts` — dispatch types
- `src/conductor/src/cli.ts` — detector
- `src/conductor/test/cli/stack-rounds-detect.test.ts` — grammar tests

**Dependencies:** none

### Task 3: Read model of a feature's routed rounds with wedge detection
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/stack-rounds-inspect.realgit.test.ts`, building route refs with `createRouteRecord`/`writeRoutingTransaction` in a temporary repository (RED).
2. Implement `describeRoutingRounds` and the pure `renderRoutingRounds` in `src/conductor/src/engine/stack-rounds-cli.ts` (GREEN).
3. Commit.

**Done when:**
- [test] For the r4/r5 fixture (r4 audit open with hosts 1 `restacked` and 2 `pending`, current host 1, settled receipt; r5 audit open with host 1 `repairing`, unsettled receipt; marker host 1 of r5), `renderRoutingRounds` prints one line per round in ascending order containing round id, kind, phase, each host and state, current host, `settled` or `unsettled`, and outbox length, then a marker line naming host 1 and r5.
- [test] For that fixture, the rendered output contains a wedge line naming r4, host 2 `pending` unadmitted, the marker round r5, and the literal command `ai-conductor stack rounds --slug <slug> --close r4 --reason <text>`.
- [test] With no route refs and no marker, `describeRoutingRounds` returns zero rounds and an `absent` marker, and the rendering states the feature has no routed rounds and no repair marker.
- [test] With r3's ref pointing at an unparseable blob, `describeRoutingRounds` still returns r4 and r5 as records and r3 as `unreadable` with its blob id, and its `readable` flag is false; with an unparseable marker blob it returns every round and an `unreadable` marker with `readable` false.
- [test] A snapshot of `git for-each-ref refs/conductor/` and a recursive listing of the worktree's `.pipeline/` taken before and after `describeRoutingRounds` are identical.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — read model and renderer
- `src/conductor/test/engine/stack-rounds-inspect.realgit.test.ts` — read-model tests

**Dependencies:** none

### Task 4: Supersession predicate admits only a superseded audit round
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` (RED).
2. Implement `checkRoundSupersession` in `src/conductor/src/engine/stack-rounds-cli.ts`. It returns `supersedable` with the stored record, `supersededBy` (the lowest other non-closed round id), `droppedHosts` (every `pending` host ascending), and `findingIds` (the `findingId` of every item whose `host` is a dropped host). It classifies host states with an exhaustive `switch` on `HostState` ending in `assertNever` (GREEN).
3. Commit.

**Done when:**
- [test] For the r4/r5 fixture, `checkRoundSupersession(r4)` returns `supersedable` with `supersededBy` r5, `droppedHosts` [2], and `findingIds` equal to r4's items whose host is 2.
- [test] For an open audit round r2 whose current host 1 is `restacked` and hosts 2 and 3 are `pending`, with r3 open, `checkRoundSupersession(r2)` returns `supersedable` with `droppedHosts` [2, 3].
- [test] Neither call writes: `git for-each-ref refs/conductor/` output is identical before and after each call.
- The host classification in `checkRoundSupersession` is a `switch` over `HostState` whose default arm calls `assertNever`, so adding a `HostState` member fails `tsc --noEmit` until it is classified.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — predicate
- `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` — predicate tests

**Dependencies:** Task 3

### Task 5: Supersession predicate refusals
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Add failing refusal fixtures to `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` (RED).
2. Implement each refusal in `checkRoundSupersession`, in this order: round-id grammar, record read, phase, kind, reroute, host states, marker, other non-closed rounds. Each refusal's `detail` names the round and the condition (GREEN).
3. Commit.

**Done when:**
- [test] `checkRoundSupersession` returns `refused` for the sole non-closed round, with a `detail` stating that closing the sole non-closed round would skip the leaf return; for a `revalidate` round and for an `operator` round, with a `detail` naming the kind and stating that only `audit` rounds can be superseded, the `operator` detail also naming `ai-conductor stack land --slug <slug> --abandon`.
- [test] It returns `refused` naming the host and its state for six fixtures, one round each holding an `admitted`, `repairing`, `built`, `reroute-moved`, `abandoning` or `abandoned` host; for a record carrying `reroute`, with a `detail` naming the in-progress reroute; and when the marker names the round, with a `detail` stating that the marker holds it.
- [test] It returns `refused` naming the marker when the marker blob is unreadable; naming the round and its condition for a missing ref, an id `x4` not matching `r<N>`, a `prepared` round, a `closed` round, and an unparseable round blob; and naming the other round when another round's blob is unreadable.
- [test] For every refusal fixture, `git for-each-ref refs/conductor/` output, including the `repairing` marker ref, is identical before and after the call.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — refusals
- `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` — refusal fixtures

**Dependencies:** Task 4

### Task 6: Supersede a round in one compare-and-swap
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/stack-rounds-close-write.realgit.test.ts` (RED).
2. Implement `supersedeRound` in `src/conductor/src/engine/stack-rounds-cli.ts`. It builds the closed record with pending hosts set to `done`, appends `routingRoundSupersededEvent` through `withOutboxEvent`, and calls `writeRoutingTransaction` with a single `update-record` against `checked.stored`. It returns `{ kind: 'superseded'; event }` or `{ kind: 'refused'; detail }` for a non-`updated` write (GREEN).
3. Commit.

**Done when:**
- [test] After `supersedeRound` on r4 in the r4/r5 fixture, `readRouteRecord(r4)` returns phase `closed` with hosts {1: `restacked`, 2: `done`}, and the r5 ref and the `repairing` ref resolve to the same blob ids as before; on round r2 with hosts 1 `restacked`, 2 and 3 `pending`, it writes hosts {1: `restacked`, 2: `done`, 3: `done`}.
- [test] r4's stored outbox holds exactly one more entry than before, a `routing_round_superseded` event with `roundId` r4, `supersededBy` r5, `droppedHosts` [2], `findingIds` equal to r4's host-2 items, the trimmed reason, the operator, and non-empty `eventId` and `occurredAt`; the r4 ref moved exactly once (one new blob).
- [test] `rebuildLedgerFromReceipts`, run in two fresh copies of the fixture repository (no `.pipeline/kickback-ledger.json`) before and after the close, writes kickback ledgers whose `gates`, `growth` and taskless `count` values are deep-equal.
- [test] When r4's record is rewritten by another writer between `checkRoundSupersession` and `supersedeRound`, `supersedeRound` returns `refused` naming the contested write, r4 keeps the other writer's blob, and no `routing_round_superseded` entry exists in its outbox.
- [test] With an injected git runner whose `update-ref --stdin` exits non-zero, `supersedeRound` returns `refused` naming the failed write, and r4's ref resolves to its previous blob.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — write
- `src/conductor/test/engine/stack-rounds-close-write.realgit.test.ts` — write tests

**Dependencies:** Tasks 1, 4

### Task 7: Inspect dispatcher: eligibility, output and exit codes
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-rounds-cli.test.ts` with injected deps (RED).
2. Implement `dispatchStackRoundsCommand` for `stack-rounds-inspect`. It resolves the worktree with `resolveCliFeatureWorktree`, then runs the stack-land-style eligibility check (`routingSettingOn` from `loadConfig`, `hasDurableChildState`) before any routing read, then prints `renderRoutingRounds` and returns 0, or 1 when the result is not `readable` (GREEN).
3. Commit.

**Done when:**
- [test] For the r4/r5 fixture, `dispatchStackRoundsCommand` returns 0 and prints the rendered rounds, marker line and r4 wedge line; for a fixture with no route refs it returns 0 printing no routed rounds and no repair marker; for a fixture whose r3 blob is unparseable it prints r4, r5 and r3 as unreadable with r3's blob id, and for an unparseable marker it prints every round and the marker as unreadable; both return 1.
- [test] With `stacked_prs.route_whole_feature_fixes: false`, it prints `stack rounds: refused` with a reason naming the disabled routing setting, returns 1, and the injected `readRouteRecord`, `readRepairMarker` and `for-each-ref` git spies record zero calls.
- [test] For a slug whose worktree resolves to `undefined`, and for a feature whose `hasDurableChildState` is false, it prints `stack rounds: refused` naming the slug and returns 1.
- [test] For every inspect run against a real-git fixture, the injected `acquireLease` spy records zero calls, and `git for-each-ref refs/conductor/` output plus the sorted list of path and sha256 content hash for every file under the worktree's `.pipeline/` are identical before and after the dispatcher run.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — dispatcher (inspect)
- `src/conductor/test/engine/stack-rounds-cli.test.ts` — dispatcher tests

**Dependencies:** Task 3

### Task 8: Close dispatcher: authority, lease and refusal order
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/stack-rounds-cli.test.ts` with injected `loadConfig`, `hasDurableChildState`, `resolveOperator`, `acquireLease`, predicate and write (RED).
2. Implement the `stack-rounds-close` branch in this order: eligibility, then operator identity (`resolveMachineOperatorIdentity`) and the trimmed non-empty reason, then `checkRoundSupersession`, then `acquireFeatureDispatchLease(root, slug, 'stack rounds --close')`, then `supersedeRound` inside `try`, with the lease released in `finally`. On success it prints the closed round, dropped hosts, finding ids, and `Clear any HALT with ai-conductor halt clear before the daemon resumes.` It never reads, writes or clears `.pipeline/HALT` (GREEN).
3. Commit.

**Done when:**
- [test] With a qualifying round, routing on, an operator identity, reason `"  superseded by r5  "` and a free lease, the dispatcher returns 0, calls `acquireLease` before `supersedeRound`, calls `lease.release` once, passes reason `superseded by r5` to the write, and prints r4, dropped host 2, its finding ids, the trimmed reason `superseded by r5` and the `ai-conductor halt clear` next step.
- [test] With a pre-existing `.pipeline/HALT` and `.pipeline/HALT.class`, both files are byte-identical after a successful close.
- [test] When `acquireLease` returns a held lease, the dispatcher prints `formatFeatureDispatchLeaseRefusal` output naming the holder, returns 1, and the write spy records zero calls.
- [test] With no operator identity, or a reason that is empty or only whitespace, it refuses naming the missing identity or requiring a non-empty reason, returns 1, and the lease and write spies record zero calls; with routing off or no durable child state it refuses naming the condition, and the `readRepairMarker`, lease and write spies record zero calls.
- [test] When the predicate refuses, or `supersedeRound` returns `refused`, the dispatcher prints `stack rounds: refused — <detail>` with that detail and returns 1; on a predicate refusal the lease, write and injected `createOwnedPark` spies record zero calls; when `supersedeRound` throws after the lease is acquired, `lease.release` is called once and it returns 1 printing the error message.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — dispatcher (close)
- `src/conductor/test/engine/stack-rounds-cli.test.ts` — close dispatcher tests

**Dependencies:** Tasks 5, 6, 7

### Task 9: Wire `stack rounds` into the CLI entry point
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/cli/stack-rounds-entry.test.ts` and extend the help catalog checks (RED).
2. Add the `{ detector: 'detectStackRoundsCommand', commandPath: ['stack', 'rounds'], helpOwner: 'router' }` row to `src/conductor/src/cli-pre-dispatch.ts`. Add the `detectStackRoundsCommand` call to `src/conductor/src/index.ts` beside `detectStackLandCommand`, dispatching to `dispatchStackRoundsCommand` and setting `process.exitCode`. Add a commander `stack rounds` entry in `cli.ts` with `--slug`, `--close` and `--reason` and their descriptions (GREEN).
3. Commit.

**Done when:**
- [test] Running the built CLI entry as `stack rounds --slug <slug>` against a temporary stacked repository holding the r4/r5 fixture exits 0 and prints the r4 wedge line, without starting the pipeline (no `.pipeline/conduct-state.json` is created).
- [test] Running the built CLI entry as `stack rounds --slug <slug> --close r4 --reason x` against the same fixture with an approved operator identity exits 0, and r4 reads `closed` afterwards.
- [test] The pre-dispatch command table contains `commandPath` `['stack', 'rounds']` with `helpOwner` `router`, and `ai-conductor stack --help` lists `rounds`.
- [test] `guardDaemonSessionInvocation(['node', 'ai-conductor', 'stack', 'rounds', '--slug', 'demo', '--close', 'r4', '--reason', 'x'], { CONDUCT_DAEMON_SESSION: '1' })` returns `allowed: false`, and the entry run under that env exits non-zero with every `refs/conductor/<slug>/*` ref (r4, r5 and `repairing`) resolving to the same object and the lease file unchanged.

**Files likely touched:**
- `src/conductor/src/cli-pre-dispatch.ts` — command table row
- `src/conductor/src/index.ts` — pre-dispatch call
- `src/conductor/src/cli.ts` — commander help entry
- `src/conductor/test/cli/stack-rounds-entry.test.ts` — entry tests

**Dependencies:** Task 8

### Task 10: A superseded round's event drains once and the surviving round returns to the leaf
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/stack-rounds-close-downstream.realgit.test.ts` that close r4 through `dispatchStackRoundsCommand` and then call the engine's existing `drainRoutingOutboxes` and `reconcileRounds` (RED).
2. Fix any gap the tests expose in `stack-rounds-cli.ts`. No change is expected in `route-record-store.ts` or `round-admission.ts`; if one is needed, stop and raise it, because it is outside this plan (GREEN).
3. Commit.

**Done when:**
- [test] After the close, `drainRoutingOutboxes` with the real `EventPersister` appends exactly one `routing_round_superseded` line for r4 to `.pipeline/events.jsonl` and empties r4's outbox; a second drain appends no line.
- [test] With a persist callback that returns failure on the first drain, r4's outbox still holds the event and `.pipeline/events.jsonl` has no line for it; a later drain with the real persister appends it exactly once.
- [test] After the close, with r5's host 1 moved to `restacked` (its last host) and an empty revalidation queue, `reconcileRounds` returns `leaf-returned` for r5, and `prd_audit`, `architecture_review_as_built` and `manual_test` read `pending` in `.pipeline/conduct-state.json`.
- [test] Running the identical close command a second time returns 1 with a refusal naming r4 as not open, and r4's blob id, including its outbox, is unchanged.

**Files likely touched:**
- `src/conductor/test/engine/stack-rounds-close-downstream.realgit.test.ts` — downstream tests
- `src/conductor/src/engine/stack-rounds-cli.ts` — gap fixes, if any

**Dependencies:** Task 8

### Task 11: Close an open audit round whose hosts are all `restacked`
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` and `src/conductor/test/engine/routing/routing-events.test.ts` for each Done-when check (RED).
2. In `src/conductor/src/engine/stack-rounds-cli.ts`, remove the `has no pending hosts to drop` refusal so an admissible round with no `pending` host returns `supersedable` with an empty `droppedHosts`. In `src/conductor/src/engine/routing/routing-events.ts`, let `routingRoundSupersededEvent` accept an empty `droppedHosts` and set `child` to the lowest dropped host, or to the record's current host (`currentHostOf`) when none is dropped (GREEN).
3. Commit.

**Done when:**
- [test] For an open audit round r2 whose hosts 1 and 2 are both `restacked`, with r3 open and named by the marker, `checkRoundSupersession(r2)` returns `supersedable` with `supersededBy` r3, `droppedHosts` [] and `findingIds` [].
- [test] Closing that r2 writes phase `closed` with hosts {1: `restacked`, 2: `restacked`} and exactly one `routing_round_superseded` outbox event with `droppedHosts` [] and `child` equal to r2's current host.
- [test] `routingRoundSupersededEvent` with an empty `droppedHosts` returns `child` equal to the record's current host, and with `droppedHosts` [2, 3] returns `child` 2.
- `src/conductor/src/engine/stack-rounds-cli.ts` contains no `has no pending hosts to drop` refusal, and `tsc --noEmit` passes.

**Files likely touched:**
- `src/conductor/src/engine/stack-rounds-cli.ts` — predicate
- `src/conductor/src/engine/routing/routing-events.ts` — factory child fallback
- `src/conductor/test/engine/stack-rounds-close-predicate.realgit.test.ts` — all-restacked close tests
- `src/conductor/test/engine/routing/routing-events.test.ts` — factory test

**Dependencies:** Task 1, Task 4, Task 6

## Task Dependency Graph

```
Task 1 ─────────────┐
Task 3 ─┬─ Task 4 ─┬┴─ Task 6 ─┐
        │          └── Task 5 ─┼─ Task 8 ─┬─ Task 9
        └─ Task 7 ─────────────┘          └─ Task 10
Task 2 (independent)
Task 1, Task 4, Task 6 ── Task 11
```

## Integration Points

- After Task 8: the dispatcher performs inspect and close end to end with real stores.
- After Task 9: the production CLI entry point reaches both forms. The daemon-session guard refuses them inside dispatched sessions.
- After Task 10: a close's event reaches `.pipeline/events.jsonl` through the engine's drain, and the surviving round's leaf return re-pends whole-feature validation.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-routed-whole-feature-repair#D1 | no-change | none | Routing entry and classification are untouched; the command operates only on existing route refs. |
| adr-2026-10-12-routed-whole-feature-repair#D2 | no-change | none | Owner derivation is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D3 | no-change | none | Residue routing judgement is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D4 | no-change | none | Owner/host separation and upward moves are not changed; a record with an in-progress reroute is refused. |
| adr-2026-10-12-routed-whole-feature-repair#D5 | no-change | none | Prerequisite claims and reroutes are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D6 | task | task-6, task-4, task-5, task-11 | `readRouteRecord(r4)` returns phase `closed` with hosts {1: `restacked`, 2: `done`} |
| adr-2026-10-12-routed-whole-feature-repair#D7 | task | task-8, task-7, task-9 | calls `acquireLease` before `supersedeRound`, calls `lease.release` once |
| adr-2026-10-12-routed-whole-feature-repair#D8 | no-change | none | The cursor and execution-child resolver are not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D9 | no-change | none | Routed task append at region entry is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D10 | task | task-6 | writes kickback ledgers whose `gates`, `growth` and taskless `count` values are deep-equal |
| adr-2026-10-12-routed-whole-feature-repair#D11 | no-change | none | Repair obligation keying is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D12 | no-change | none | The host `build_review` snapshot base is not changed. |
| adr-2026-10-12-routed-whole-feature-repair#D13 | no-change | none | Routed exit restacks are not changed; a superseded round has no `built` host by predicate. |
| adr-2026-10-12-routed-whole-feature-repair#D14 | no-change | none | The re-validation queue is not read or written; `revalidate` rounds are refused. |
| adr-2026-10-12-routed-whole-feature-repair#D15 | task | task-10 | `reconcileRounds` returns `leaf-returned` for r5, and `prd_audit`, `architecture_review_as_built` and `manual_test` read `pending` |
| adr-2026-10-12-routed-whole-feature-repair#D16 | task | task-1, task-10, task-11 | appends exactly one `routing_round_superseded` line for r4 to `.pipeline/events.jsonl` and empties r4's outbox |
| adr-2026-10-12-routed-whole-feature-repair#D17 | no-change | none | A flat N=1 feature has no durable child state, so the eligibility check refuses before any routing read. |
| adr-2026-10-12-routed-whole-feature-repair#D18 | existing | none | The routing flag is read through the existing `routingSettingOn`; the command refuses when routing is disabled and changes no default. |

## Verification

- [ ] Every happy-path and negative-path criterion is covered by at least one task. The coherence mapping records the criterion rows.
- [ ] Every task has 2–5 single-line `Done when:` checks naming the mechanism.
- [ ] Dependencies are acyclic.
- [ ] No task edits another feature's sealed artifact.
