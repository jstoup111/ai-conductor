# Implementation Plan: Place admitted whole-feature fixes in the owning stacked child

**Date:** 2026-10-14
**Design:** .docs/decisions/adr-2026-10-12-routed-whole-feature-repair.md
**Stories:** .docs/stories/admitted-whole-feature-fixes-in-a-stacked-feature-.md
**Conflict check:** Clean as of 2026-10-14 (.docs/conflicts/admitted-whole-feature-fixes-in-a-stacked-feature-.md)

## Summary

This is spec B of four for `adr-2026-10-12-routed-whole-feature-repair` (decision 18). It routes
admitted whole-feature remediation in a stacked feature to its owning and hosting child, records the
round and the marker before any other change, recovers a crashed round, and holds the stack still
while a round is open. Routing stays dark behind `stacked_prs.route_whole_feature_fixes` (default
`false`). The plan has 27 tasks. Ids 9, 20–32, 34–36 and 40–44 are kept from the design-time plan;
ids 100–104 are new to this spec.

## Technical Approach

Governing review: `.docs/decisions/architecture-review-2026-10-14-admitted-whole-feature-fixes-in-a-stacked-feature-.md`
(findings F1–F11, O1, O2). Paths below are under `src/conductor/src/engine/`.

- **One fenced writer (Tasks 100–102).** `routing/route-record-store.ts` gains
  `writeRoutingTransaction`, the only writer of routing refs. It takes a closed union of ops
  (`create-record`, `update-record`, `delete-record`, `create-marker`), reads the restack journal ref
  (`journalRefFor`, `refs/conductor/<slug>/restack/journal`) once, refuses when the journal is
  non-terminal or `applied` with a pending `followOnCause`, and issues one `update-ref --stdin`
  transaction that starts with `verify <journalRef> <observed value or zero>`. The shipped
  `writeRouteRecord` becomes one `update-record` op. Pattern: the restack executor's private
  `transaction(lines)` helper and `journalStateUpdateLines` in `restack/` — keep one start/prepare/
  commit call, explicit old values and a zero old value for create; the allowed variation is the
  journal `verify` line and the helper's home in the store. Transition legality
  (`isLegalHostTransition`, `isLegalRoundPhaseTransition`) and `nextRoundId` live beside the types.
- **Events (Task 9).** `routing/routing-events.ts` is the only constructor module for
  `remediation_routed` and `routed_repair_phase`. `createRouteRecord` writes a `prepared` record with
  an empty outbox; the marker transaction (Task 40) writes `remediation_routed` and the host's
  `routed_repair_phase` together (review F11). The reroute and revalidation constructors are built by
  #3211 and #3212 with their producers.
- **Routing (Tasks 20–32, 103).** `routing/owner-derivation.ts` derives task-bound owners
  mechanically (`taskSlices`, the committed `**Child:**` line, then the engine's appended-remediation
  membership, and the earliest owner when several tasks are bound). `routing/cannot-host.ts` classifies
  cited paths by leaf-tip presence with `git ls-tree` and picks the earliest closure above the owner
  that holds every input. `routing/residue-routing-call.ts` is the residue judgement with its own
  schema and a two-attempt budget, through a new optional `dispatchResidueRoutingJudgement` port.
  Pattern: `dispatchRebaseRegradeJudgement` on `step-runner-types.ts` and `step-runners.ts` — an
  optional method shaped `(prompt) => Promise<{ success; output? }>`, provider resolved through
  `resolvedConfigFor` for a named step, absence fails closed; the allowed variation is the step key
  (`remediate`) and the schema. `allocateFrozenBlocks` in `remediation-append.ts` renders complete
  rem blocks, with `**Child:**` and `**Round:**` lines, without writing any plan (review F6).
  `routing/round-router.ts` composes these into one routed round.
- **Admission and recovery (Tasks 34–36, 40–42).** In `conductor.ts`'s `planRemediation`, when
  `routingEligible` is true, today's halt and target predicates are evaluated first; only a round
  that today's path would send to a region step takes the routing branch, which runs before the leaf
  append, skips the append and its bookkeeping, admits the round marker-first through
  `routing/round-admission.ts`, and returns the existing `route` result so the callers emit one
  `kickback` and one `navigateBack`. `reconcileRounds` aborts every `prepared` round no marker names
  and returns a leaf re-navigation action that conductor resume applies.
- **Holding the stack still (Tasks 43, 44).** `restack/stack-preflight.ts` runs reconciliation after
  journal recovery and the outbox drain and before the cursor, never runs the automatic
  `feature-repair` restack while a marker exists, and defers base refresh while `routedRoundOpen` is
  true. The same deferral guards `daemon-rekick.ts`'s `resumeRebaseFirst` and the FINISH rebase in
  `conductor.ts`.
- **Reachability.** Every new primitive has a production caller in this spec, reached only when
  `routingEligible` is true: the router and admission from `planRemediation`; reconciliation and
  `routedRoundOpen` from `runStackPreflight` (conductor resume, FINISH, `daemon-cli.ts`) and the
  two base-refresh sites; the event constructors from admission; the judge port from the routing
  branch.
- **Delivered elsewhere.** Writing frozen blocks into a host plan, host region entry, settlement,
  the `Round:` stamp and `Child:`-line membership, FAIL-only and custom-step routing, host
  progression (`selectNextHost`) and the reroute are #3211; the exit restack, re-validation and the
  leaf return are #3212.

## Prerequisites

- #2944 shipped (PR #3219): route types and parsers, routing refs and teardown, the store's reads and
  outbox drain, the cursor fields, the execution-child resolver and the default-off setting.

## Task Dependency Graph

```text
100 ─┬─> 9 ─────────────┐
101 ─┼─> 102            │
     └─> 9              │
20 ──> 21 ──────────┐   │
22 ──> 23 ──────────┤   │
24 ─┬> 25 ──> 32 ───┤   │
    ├> 27           │   │
    └───────────────┼─> 28 ─┬─> 29
103 ────────────────┘       ├─> 30 ─> 31
                            ├─> 26
                            └─> 32
9, 100, 101 ──> 40 ─┬─> 41
                    ├─> 42 ─> 43 ─> 44
28, 32, 40 ──> 34 ─┬─> 35
                   ├─> 36
26, 29, 31 ────────┴─> 104
```

## Integration Points

- After Task 40: a routed round can be admitted and recovered at the store level in real git.
- After Task 34: a stacked feature with routing on admits a routed round from a real `prd_audit`
  verdict through `planRemediation` and its gap-loop caller.
- After Task 44: an open round holds back every automatic restack and base refresh.

## Tasks

### Task 100: Legal routing transitions and round-id allocation
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/route-transitions.test.ts` — every `HostState` pair and every `RoundPhase` pair against the ADR decision 6 phase table; a real-git `demo` fixture with zero, two and 999 `routes/` refs.
2. Verify RED.
3. Implement: in `src/conductor/src/engine/routing/route-types.ts`, `isLegalHostTransition(from, to)` and `isLegalRoundPhaseTransition(from, to)`, each an exhaustive table over the closed union with `assertNever` and no default arm (host: `pending→admitted`, `admitted→repairing`, `repairing→reroute-moved|built|done`, `reroute-moved→rerouted`, `built→restacked`; round: `prepared→open`, `open→closed`). In `route-record-store.ts`, `nextRoundId(worktree, slug, deps)` lists `refs/conductor/<slug>/routes/` and returns `r<max+1>`, or `{ kind: 'round-limit' }` when `r999` (`MAX_ROUTE_ROUNDS`) exists, writing nothing.
4. Verify GREEN, commit.

**Done when:**
- [test] `isLegalHostTransition('pending', 'admitted')` is true and `isLegalHostTransition('pending', 'built')` is false, and every `HostState` pair matches the table in `route-transitions.test.ts`.
- [test] `isLegalRoundPhaseTransition` returns true only for `prepared→open` and `open→closed`.
- [test] `nextRoundId` returns `r1` when no `refs/conductor/demo/routes/` ref exists and `r3` when `routes/r1` and `routes/r2` exist.
- [test] `nextRoundId` returns `{ kind: 'round-limit' }` when `routes/r999` exists, and the git argv spy records no write command.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-types.ts` — transition tables
- `src/conductor/src/engine/routing/route-record-store.ts` — `nextRoundId`
- `src/conductor/test/engine/routing/route-transitions.test.ts` — tests

**Dependencies:** none

### Task 101: One fenced transaction writer for every routing ref
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/route-transaction.realgit.test.ts` — create a record and the marker in one call; CAS-delete a record; a recorded git argv for the transaction input.
2. Verify RED.
3. Implement: in `src/conductor/src/engine/routing/route-record-store.ts`, `writeRoutingTransaction(worktree, slug, ops, deps)` over the closed op union `create-record | update-record | delete-record | create-marker` (exhaustive switch, no default arm). It reads `journalRefFor(slug)` once, writes each blob with `hash-object -w --stdin`, and issues one `update-ref --stdin` whose input is `start`, `verify <journalRef> <observed sha or zero>`, one line per op (create and `create-marker` with an all-zero old value; update and delete with the observed blob), `prepare`, `commit`. It returns `updated | cas-failed | restack-journal-open | unavailable`. Re-implement `writeRouteRecord` as a single `update-record` op so `drainOutbox` writes through it. Follow the restack executor's `transaction(lines)` traits: one call, explicit old values, zero old value for create; the `verify` line is the allowed variation.
4. Verify GREEN, commit.

**Done when:**
- [test] the recorded git argv for `create-record` plus `create-marker` shows exactly one `update-ref --stdin` whose input contains `verify refs/conductor/demo/restack/journal`, a zero-old-value line for `refs/conductor/demo/routes/r1` and a zero-old-value line for `refs/conductor/demo/repairing`.
- [test] with no journal ref, that `verify` line carries the all-zero value and the real-git refs `routes/r1` and `repairing` both exist after the call returns `updated`.
- [test] every `update-ref --stdin` input recorded in `route-outbox.test.ts` during `drainOutbox` carries the journal `verify` line, because `writeRouteRecord` writes only through `writeRoutingTransaction`.
- [test] a `delete-record` op CAS-deletes `routes/r1` from its observed blob and leaves `routes/r2` byte-identical.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — `writeRoutingTransaction`, `writeRouteRecord` through it
- `src/conductor/test/engine/routing/route-transaction.realgit.test.ts` — transaction tests
- `src/conductor/test/engine/routing/route-outbox.test.ts` — verify-line assertion

**Dependencies:** none

### Task 102: The fence refuses an open or follow-on journal and loses any race to a restack
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/route-transaction.realgit.test.ts` — a journal in state `moved`; an `applied` journal with `followOnCause: 'base-refresh'`; a git-runner wrapper that writes a new journal blob between the fence read and `update-ref --stdin`.
2. Verify RED.
3. Implement: in `writeRoutingTransaction`, return `restack-journal-open` before any write when the journal state is neither `applied` nor `aborted`, or is `applied` with a `followOnCause`; map a non-zero `update-ref` exit to `cas-failed` and never retry.
4. Verify GREEN, commit.

**Done when:**
- [test] with the restack journal in state `moved`, `writeRoutingTransaction` returns `restack-journal-open`, the git argv spy records no `update-ref` call, `routes/r1` keeps its prior blob SHA, and no `refs/conductor/demo/repairing` ref exists.
- [test] with an `applied` journal carrying `followOnCause: 'base-refresh'`, a `create-record` op returns `restack-journal-open` and no `refs/conductor/demo/routes/`, `repairing` or `revalidate` ref exists afterwards.
- [test] when a wrapper writes a new journal blob after the fence read and before `update-ref --stdin`, run once with the journal absent at the read and once with it `aborted` at the read, the transaction returns `cas-failed` in both runs, neither `routes/r1` nor `repairing` exists afterwards, and a `for-each-ref refs/conductor/demo/` snapshot shows no `routes/`, `repairing` or `revalidate` ref was added or changed.

**Files likely touched:**
- `src/conductor/src/engine/routing/route-record-store.ts` — fence refusals
- `src/conductor/test/engine/routing/route-transaction.realgit.test.ts` — negative tests

**Dependencies:** Task 101

### Task 9: Routing event constructors, record creation and per-transition phase events
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/routing-events.test.ts`, draining into a real `EventPersister`.
2. Verify RED.
3. Implement: `src/conductor/src/engine/routing/routing-events.ts` with `remediationRoutedEvent(record)` (child = the lowest host) and `routedRepairPhaseEvent(roundId, host, phase, credit)` (child = host), each stamping a fresh `eventId` and `occurredAt`, and `withOutboxEvent(record, event)`. In `route-record-store.ts`: `createRouteRecord(worktree, slug, { roundId, kind, items, allocation }, deps)` writes a `prepared` record with every host `pending`, `currentHostIndex` 0 and an empty outbox through a `create-record` op; `transitionHost(stored, host, to, { credit })` refuses a pair `isLegalHostTransition` rejects with `illegal-transition`, otherwise writes the new state with one `routed_repair_phase` outbox entry in the same `update-record` op.
4. Verify GREEN, commit.

**Done when:**
- [test] `createRouteRecord` for round `r1` with hosts `1` and `2` writes `routes/r1` in phase `prepared` with both hosts `pending` and an empty `outbox`.
- [test] after `transitionHost` moves host `1` from `pending` to `admitted` and the outbox drains into a real `EventPersister`, `events.jsonl` holds exactly one `routed_repair_phase` for host `1` with phase `admitted` and `credit: false`.
- [test] `transitionHost` refuses `pending→built` with `illegal-transition`, leaves the record blob and its outbox byte-identical, and `events.jsonl` gains no `routed_repair_phase` event.
- [test] `remediationRoutedEvent` for a record with items owned by `T1` and `T2` returns one event naming the `roundId`, each item's `owner`, `host` and `reason`, and `child` `1`.
- [test] a structural check in `routing-events.test.ts` fails on an in-memory fixture that builds a `{ type: 'routed_repair_phase' }` or `{ type: 'remediation_routed' }` literal outside `routing/routing-events.ts`, naming the fixture file.

**Files likely touched:**
- `src/conductor/src/engine/routing/routing-events.ts` — constructors
- `src/conductor/src/engine/routing/route-record-store.ts` — `createRouteRecord`, `transitionHost`
- `src/conductor/test/engine/routing/routing-events.test.ts` — drain-to-log and structural tests

**Dependencies:** Tasks 100, 101

### Task 20: Mechanical owner derivation for task-bound work
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/owner-derivation.test.ts` — the three-child `demo` sealed envelope `taskSlices {T1: 1, T2: 2, T3: 3}`, a fixture plan whose block `rem-prd-audit-T1` carries `**Child:** 1`, and an appended-remediation membership fixture.
2. Verify RED.
3. Implement: `src/conductor/src/engine/routing/owner-derivation.ts` exporting `deriveTaskBoundOwner({ taskIds, envelope, planText, appendedChildren, declaredPositions })` returning `{ kind: 'owned'; owner; reason }` with reason `task-slice | rem-child-line | rem-cache | multi-task-earliest`, or `{ kind: 'halt'; taskId; detail }`. Authored ids read `envelope.sliceMembership.taskSlices`; ids for which `isEngineAppendedRemediationTaskId` is true read `readRemTaskChildLine(planText, id)`, then `appendedChildren`. When the bound ids resolve to more than one child, the owner is the lowest, with reason `multi-task-earliest`. Add `readAppendedRemediationTaskChildren(projectRoot)` to `artifacts.ts` beside `readAppendedRemediationTaskIds`. The function takes no judge or provider dependency.
4. Verify GREEN, commit.

**Done when:**
- [test] `deriveTaskBoundOwner` for `['T1']` against `taskSlices {T1: 1, T2: 2, T3: 3}` returns `{ kind: 'owned', owner: 1, reason: 'task-slice' }`.
- [test] for `['rem-prd-audit-T1']` whose committed fixture block carries `**Child:** 1` it returns owner `1` with reason `rem-child-line`, and for the same id with no `**Child:**` line and membership `{ 'rem-prd-audit-T1': 1 }` it returns owner `1` with reason `rem-cache`.
- [test] for `['T2', 'T3']` it returns owner `2` with reason `multi-task-earliest`.
- [test] a type-level test in `owner-derivation.test.ts` fails to compile when `deriveTaskBoundOwner` is passed a `judge` dependency.

**Files likely touched:**
- `src/conductor/src/engine/routing/owner-derivation.ts` — owner derivation and `readRemTaskChildLine`
- `src/conductor/src/engine/artifacts.ts` — `readAppendedRemediationTaskChildren`
- `src/conductor/test/engine/routing/owner-derivation.test.ts` — unit tests

**Dependencies:** none

### Task 21: Owner derivation halts rather than guessing
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/owner-derivation.test.ts` — an envelope without a `T2` slice entry; a rem block whose `**Child:**` line is `7` with positions `1`, `2`, `3` declared; a rem id with neither a `**Child:**` line nor a membership entry.
2. Verify RED.
3. Implement: the halt arms of `deriveTaskBoundOwner`, each naming the task (and the bad position where there is one); no nearest or default child is ever returned.
4. Verify GREEN, commit.

**Done when:**
- [test] for `['T2']` against `taskSlices` lacking `T2` it returns `kind: 'halt'` whose detail names `T2`, and the result has no `owner` field.
- [test] for a rem task whose committed `**Child:**` line is `7`, with declared positions `1`, `2`, `3`, it returns `kind: 'halt'` whose detail names the rem task id and position `7`.
- [test] for a rem task with no `**Child:**` line and no membership entry it returns `kind: 'halt'` naming the task, with no `owner` field.

**Files likely touched:**
- `src/conductor/src/engine/routing/owner-derivation.ts` — halt arms
- `src/conductor/test/engine/routing/owner-derivation.test.ts` — negative tests

**Dependencies:** Task 20

### Task 22: Cannot-host classifies inputs by leaf-tip presence and picks the earliest closure above the owner
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` — a three-child `demo` stack where `src/b.ts` is absent at `refs/conductor/demo/closed/c1`, present at `closed/c2` and at the `feat/daemon-demo` tip; `src/new.ts` is absent everywhere.
2. Verify RED.
3. Implement: `closureRefFor(slug, child)` in `routing/routing-refs.ts`; `src/conductor/src/engine/routing/cannot-host.ts` exporting `classifyCitedPaths(paths, leafTip, git)` (a path listed by `git ls-tree <leafTip> -- <path>` is a prerequisite input; an empty listing is an output) and `selectHost({ owner, inputs, positions, leafTip, git })` returning `{ host, reason }`: the owner when every input is in its closure tree, else the earliest closed child above the owner holding every input with reason `prerequisite-paths`, else the leaf. Cited paths are the work order's Done-when paths, finding evidence paths and the owner task's declared files. Branch names come from `leafBranchFor` and `childBranchFor`. The function never reads the coverage-binding envelope.
4. Verify GREEN, commit.

**Done when:**
- [test] `selectHost` for a work order owned by `T1` citing `src/b.ts` returns host `2`, reason `prerequisite-paths` and owner `1`, and the sealed envelope's `taskSlices.T1` is still `1` after the call.
- [test] `classifyCitedPaths` marks `src/new.ts` (absent at the leaf tip) as an output, and `selectHost` for a `T1` work order citing only `src/new.ts` returns host `1`.
- [test] `closureRefFor('demo', 2)` returns `refs/conductor/demo/closed/c2`, and the git argv spy during `selectHost` records no write command and no read of the coverage-binding envelope.

**Files likely touched:**
- `src/conductor/src/engine/routing/routing-refs.ts` — `closureRefFor`
- `src/conductor/src/engine/routing/cannot-host.ts` — classification and host selection
- `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` — real-git tests

**Dependencies:** none

### Task 23: Cannot-host moves only upward, needs every input at one tree, and halts on unreadable trees
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` — (a) a `T1` work order citing a path present only at the leaf tip; (b) a `T2` work order citing a path present at `closed/c1` and the leaf tip but deleted at `closed/c2`; (c) a `T1` work order citing `src/b.ts` and a leaf-only path; (d) a git runner whose `ls-tree` on `closed/c2` exits non-zero; (e) an unresolvable leaf tip.
2. Verify RED.
3. Implement: in `selectHost`, scan only positions strictly above the owner and require every input in one candidate tree; a non-zero `ls-tree` exit on a closure returns a needs-human halt naming that child; an unresolvable leaf tip in `classifyCitedPaths` returns a halt naming the leaf branch.
4. Verify GREEN, commit.

**Done when:**
- [test] `selectHost` for a `T1` work order citing a path present at the leaf tip but absent from `closed/c1` and `closed/c2` returns the leaf host with reason `prerequisite-paths` and owner `1`.
- [test] `selectHost` for a `T2` work order citing a path present at `closed/c1` and the leaf tip but absent at `closed/c2` never returns child `1` and returns the leaf host with reason `prerequisite-paths`.
- [test] `selectHost` for a `T1` work order citing `src/b.ts` and a leaf-only path does not return child `2` and returns the leaf host.
- [test] when `ls-tree` on `closed/c2` exits non-zero `selectHost` returns a needs-human halt naming child `2`, and when the leaf tip cannot be resolved `classifyCitedPaths` returns a needs-human halt naming `feat/daemon-demo`.

**Files likely touched:**
- `src/conductor/src/engine/routing/cannot-host.ts` — upward-only scan and halts
- `src/conductor/test/engine/routing/cannot-host.realgit.test.ts` — negative fixtures

**Dependencies:** Task 22

### Task 24: Residue routing call schema, validation and its own two-attempt budget
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/residue-routing-call.test.ts` — schema shape, parser acceptance and rejection, attempt counting; `src/conductor/test/engine/step-runners-residue-judgement.test.ts` for the provider port.
2. Verify RED.
3. Implement: `src/conductor/src/engine/routing/residue-routing-call.ts` exporting `RESIDUE_ROUTING_CALL_SCHEMA` (per item `{ itemId, child, candidates[], rationale }`), `RESIDUE_ROUTING_CALL_CONTRACT_VERSION`, `RESIDUE_ROUTING_MAX_ATTEMPTS = 2`, `parseResidueRoutingAnswer(output, items, declaredPositions)` returning per item `valid | invalid-position | malformed`, and `runResidueRoutingCall({ items, declaredPositions, judge })`, one call per round for every residue item. Add optional `dispatchResidueRoutingJudgement?(prompt)` to `step-runner-types.ts` and implement it in `step-runners.ts` following `dispatchRebaseRegradeJudgement`: same `(prompt) => Promise<{ success; output? }>` shape, provider through `resolvedConfigFor('remediate')`.
4. Verify GREEN, commit.

**Done when:**
- [test] `RESIDUE_ROUTING_CALL_SCHEMA` requires `itemId`, `child`, `candidates` and `rationale` per item, is tagged with `RESIDUE_ROUTING_CALL_CONTRACT_VERSION`, and is a distinct object from the `prd_audit` judgment and as-built verdict schemas.
- [test] `runResidueRoutingCall` invokes `judge` exactly once when the first answer is valid and exactly `RESIDUE_ROUTING_MAX_ATTEMPTS` (2) times when the first is invalid, and one invocation's prompt lists every residue item of the round.
- [test] `parseResidueRoutingAnswer` classifies an answer naming an undeclared child or candidate as `invalid-position` and a non-JSON or schema-violating answer as `malformed`.
- [test] `dispatchResidueRoutingJudgement` in `step-runners.ts` resolves its provider through `resolvedConfigFor('remediate')` and returns `{ success, output }` from the provider call.

**Files likely touched:**
- `src/conductor/src/engine/routing/residue-routing-call.ts` — schema, parser, call driver
- `src/conductor/src/engine/step-runner-types.ts` — optional `dispatchResidueRoutingJudgement`
- `src/conductor/src/engine/step-runners.ts` — provider implementation
- `src/conductor/test/engine/routing/residue-routing-call.test.ts` — unit tests
- `src/conductor/test/engine/step-runners-residue-judgement.test.ts` — port test

**Dependencies:** none

### Task 25: Judged and residue-default residue owners carry their recorded reason
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/residue-routing-call.test.ts` and `src/conductor/test/engine/routing/route-types.test.ts` — answers `{child: 2, candidates: [2], rationale: "implements D2"}` and `{child: 2, candidates: [1, 2], rationale: "ambiguous ownership"}`; a route record whose item carries a `rationale`.
2. Verify RED.
3. Implement: `resolveResidueOwner(answer)` in `residue-routing-call.ts` — a single candidate equal to `child` gives owner `child`, reason `residue-judged` and the rationale; several candidates give the earliest, reason `residue-default`. Add an optional `rationale` string to `RoutedItem` and accept it in `parseRoutedItem` (`route-types.ts`).
4. Verify GREEN, commit.

**Done when:**
- [test] `resolveResidueOwner` for `{child: 2, candidates: [2], rationale: "implements D2"}` returns owner `2` with reason `residue-judged` and rationale `implements D2`.
- [test] `resolveResidueOwner` for `{child: 2, candidates: [1, 2], rationale: "ambiguous ownership"}` returns owner `1` with reason `residue-default`.
- [test] `parseRouteRecord` round-trips an item carrying `rationale: "implements D2"`, and rejects an item whose `rationale` is not a string.

**Files likely touched:**
- `src/conductor/src/engine/routing/residue-routing-call.ts` — owner resolution
- `src/conductor/src/engine/routing/route-types.ts` — optional `rationale`
- `src/conductor/test/engine/routing/residue-routing-call.test.ts` — resolution tests
- `src/conductor/test/engine/routing/route-types.test.ts` — parser tests

**Dependencies:** Task 24

### Task 26: An invalid, malformed, unavailable or missing routing call halts without guessing or charging laps
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-router.test.ts` — stub judges answering child `7` twice, malformed output twice, a timeout rejection twice, `{ success: false }` twice, and no judge; a recorded git argv spy and a kickback-ledger fixture.
2. Verify RED.
3. Implement: `runResidueRoutingCall` returns `{ kind: 'halt'; itemId; detail }` after the second failed attempt of any of those kinds; `routeAdmittedRound` converts it, or an absent judge with a residue item, to a needs-human halt naming the item before any routing ref is read or written; the call path never touches `kickback-ledger.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] with a judge answering child `7` on both attempts, the judge is called exactly twice and `routeAdmittedRound` returns a needs-human halt naming the item, with no `refs/conductor/demo/routes/` write in the git argv spy.
- [test] with a judge returning malformed output twice, `routeAdmittedRound` returns a needs-human halt naming the item, and the ledger's `gates.prd_audit` and `gates.architecture_review_as_built` lap counts are byte-identical before and after the call.
- [test] with a judge that rejects with a timeout on both attempts, and separately one returning `{ success: false }` on both, `routeAdmittedRound` returns a needs-human halt naming the item and the git argv spy records no command naming `refs/conductor/demo/routes`, `repairing` or `revalidate`.
- [test] with no judge and one residue item, `routeAdmittedRound` returns a needs-human halt naming the item, invokes no provider, and the git argv spy records no command naming a routing ref.

**Files likely touched:**
- `src/conductor/src/engine/routing/residue-routing-call.ts` — halt after two failed attempts
- `src/conductor/src/engine/routing/round-router.ts` — halt conversion, missing judge
- `src/conductor/test/engine/routing/round-router.test.ts` — negative tests

**Dependencies:** Tasks 24, 28

### Task 27: Gate verdict schemas and contract versions are unchanged by the routing call
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/verdict-schema-unchanged.test.ts` — SHA-256 digests of the serialized `prd_audit` judgment schema (`prd-audit-contract.ts`) and as-built verdict schema (`as-built-contract.ts`), compared after `runResidueRoutingCall` has run.
2. Verify RED (the digest fixture does not exist yet).
3. Implement: commit `src/conductor/test/fixtures/routing/gate-verdict-schema-digests.json` computed from the two schemas as they exist at spec base `8aedc143fa` (read with `git show 8aedc143fa:<path>`), never from the working tree; no production change to either contract module.
4. Verify GREEN, commit.

**Done when:**
- [test] after `runResidueRoutingCall` runs, `PRD_AUDIT_JUDGMENT_CONTRACT_VERSION` is still `v1` and `AS_BUILT_VERDICT_CONTRACT_VERSION` is still `v2`.
- [test] the SHA-256 digests of the serialized `prd_audit` judgment schema and as-built verdict schema equal the digests committed in `gate-verdict-schema-digests.json`, which records spec base `8aedc143fa` as its source commit.
- `git diff --quiet $(git merge-base origin/main HEAD) HEAD -- src/conductor/src/engine/prd-audit-contract.ts src/conductor/src/engine/as-built-contract.ts` exits 0, so this feature's diff changes neither contract module.

**Files likely touched:**
- `src/conductor/test/engine/routing/verdict-schema-unchanged.test.ts` — version and digest guard
- `src/conductor/test/fixtures/routing/gate-verdict-schema-digests.json` — spec-base digests

**Dependencies:** Task 24

### Task 103: Frozen rem blocks are rendered complete without writing any plan
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/frozen-allocation.realgit.test.ts` — a three-child `demo` stack whose leaf plan holds an existing rem block, and whose `feat/c2/demo` plan holds another.
2. Verify RED.
3. Implement: `allocateFrozenBlocks({ itemsByHost, leafPlan, hostPlans, roundId })` in `src/conductor/src/engine/remediation-append.ts`, reusing the existing private `renderTaskBlock` so a frozen body equals today's rendering plus a `**Child:** <host>` and a `**Round:** <roundId>` line; ids are allocated against the union of rem ids in the leaf plan and every host plan (read with `git show <branch>:<planPath>`). It writes nothing.
4. Verify GREEN, commit.

**Done when:**
- [test] `allocateFrozenBlocks` for a `T1` item hosted on `1` in round `r1` returns one block whose body contains the lines `**Child:** 1` and `**Round:** r1`, and the plan file on every fixture branch is byte-identical before and after the call.
- [test] every id `allocateFrozenBlocks` returns differs from every rem id present in the leaf plan or in any host plan, and from every other id it returns.
- [test] an allocated body with its `**Child:**` and `**Round:**` lines removed equals the block `appendConductorRemediationTasks` writes for the same item on an N=1 fixture.

**Files likely touched:**
- `src/conductor/src/engine/remediation-append.ts` — `allocateFrozenBlocks`
- `src/conductor/test/engine/routing/frozen-allocation.realgit.test.ts` — tests

**Dependencies:** none

### Task 28: Round router places task-bound items by owner, hosts them by evidence, and orders hosts
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-router.test.ts` — admitted FIXABLE items owned by `T1`; by `T1` and `T3` in one pass; by `T2` with a judge spy that would answer `1`; a `T1` item whose inputs exist only at the leaf tip.
2. Verify RED.
3. Implement: `src/conductor/src/engine/routing/round-router.ts` exporting `routeAdmittedRound({ admitted, envelope, planText, appendedChildren, declaredPositions, leafTip, roundId, judge, git })` returning `{ kind: 'routed'; items; hosts; allocation; hostHints }` or `{ kind: 'halt'; haltClass: 'needs-human'; detail }`. Task-bound items go through `deriveTaskBoundOwner` then `selectHost`; only residue items reach `runResidueRoutingCall`, which is skipped when there are none; the allocation comes from `allocateFrozenBlocks`. Each item records `{ findingId, kind: 'audit', owner, host, reason, fallback: [] }`. Export `hostOrder(hosts)`, which sorts host positions numerically ascending; the leaf, the highest position, is therefore last, and admission takes `hostOrder(...)[0]` as the first host. The switch over the item kind is exhaustive with no default arm.
4. Verify GREEN, commit.

**Done when:**
- [test] for a FIXABLE finding owned by `T1`, `routeAdmittedRound` returns one item with owner `1`, host `1` and reason `task-slice`, and the judge spy records zero calls.
- [test] for one `prd_audit` pass admitting findings owned by `T1` and `T3`, `hostOrder(routed.hosts)` returns `[1, 3]`.
- [test] for a finding owned by `T2` with a judge stub that would answer `1`, it returns owner `2` and the judge spy records zero calls.
- [test] for a round with a `T1` item hosted on `1` and a `T1` item whose inputs exist only at the leaf tip, `hostOrder(routed.hosts)` returns `[1, 3]`, with leaf position `3` last, and `hostOrder` of `{3, 1, 2}` returns `[1, 2, 3]`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — round routing
- `src/conductor/test/engine/routing/round-router.test.ts` — task-bound routing tests

**Dependencies:** Tasks 20, 22, 24, 103

### Task 29: Round router surfaces owner and host halts before any routing write
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-router.test.ts` — the Task 21 fixtures and the Task 23 unreadable-tree fixtures, passed through `routeAdmittedRound` with a recorded git argv spy.
2. Verify RED.
3. Implement: in `routeAdmittedRound`, return the first owner or host halt as `{ kind: 'halt'; haltClass: 'needs-human'; detail }` before the residue call, the allocation and any routing ref access.
4. Verify GREEN, commit.

**Done when:**
- [test] `routeAdmittedRound` with a sealed envelope lacking a `taskSlices` entry for the owning task returns `halt` with class `needs-human` naming the task, returns no item, and the git argv spy records no `refs/conductor/demo/routes/` write.
- [test] `routeAdmittedRound` for a finding citing a rem task whose committed `**Child:**` line names undeclared position `7` returns `halt` with class `needs-human` naming the task and `7`, returns no item, and the git argv spy records no `refs/conductor/demo/routes/` write.
- [test] `routeAdmittedRound` for a finding citing a rem task with neither a `**Child:**` line nor a membership entry returns `halt` with class `needs-human` naming the task, returns no item and no owner, and the git argv spy records no `refs/conductor/demo/routes/` write.
- [test] `routeAdmittedRound` returns a needs-human `halt` naming child `2` when its closure cannot be read, and one naming `feat/daemon-demo` when the leaf tip cannot be read, each with no routing ref in the git argv spy.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — halt propagation
- `src/conductor/test/engine/routing/round-router.test.ts` — negative tests

**Dependencies:** Tasks 21, 23, 28

### Task 30: A mixed validation-group round hosts the FAIL obligation with the task-owned host, without judgement
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-router-mixed.test.ts` — one join work order with a FIXABLE gap owned by `T2` and `manual_test` FAIL rows, with a judge spy.
2. Verify RED.
3. Implement: in `routeAdmittedRound`, when the admitted set carries task-bound gaps and FAIL rows (`consolidatedManualTestFail`), place the FAIL obligation with the lowest task-owned host, reason `mixed-round`, and add the FAIL rows verbatim to every host's `hostHints`; FAIL rows never reach the residue call. Each host's hint is also stored as an optional `retryHint` string on that host's `FrozenHostAllocation` (`route-types.ts`, accepted by `parseAllocation`) so it survives to that host's region entry.
4. Verify GREEN, commit.

**Done when:**
- [test] `routeAdmittedRound` for a join with a FIXABLE gap owned by `T2` plus FAIL rows records zero judge calls and places the FAIL obligation with host `2` and reason `mixed-round`.
- [test] the returned `hostHints[2]` contains every FAIL row verbatim, and the returned `allocation[2].retryHint` equals `hostHints[2]`.
- [test] `parseRouteRecord` round-trips an allocation entry carrying `retryHint`, and rejects one whose `retryHint` is not a string.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — mixed-round rule and `hostHints`
- `src/conductor/src/engine/routing/route-types.ts` — optional `retryHint` on the allocation
- `src/conductor/test/engine/routing/round-router-mixed.test.ts` — tests

**Dependencies:** Task 28

### Task 31: Mixed rounds spread FAIL rows to every host and never restage an existing-task gap
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-router-mixed.test.ts` — a mixed round with gaps owned by `T1` and `T3` plus FAIL rows; a mixed round with FAIL rows and an `existing-task` gap bound to `T2`, with an `admitAndRestageRepair` spy.
2. Verify RED.
3. Implement: the lowest-host rule picks the lowest position among task-owned hosts; an `existing-task` gap contributes its rationale to its host's `hostHints` and is marked `restage: false` on its routed item.
4. Verify GREEN, commit.

**Done when:**
- [test] for a mixed round with gaps owned by `T1` and `T3`, `routeAdmittedRound` places the FAIL obligation with host `1`, and both `hostHints[1]` and `hostHints[3]` contain every FAIL row.
- [test] for a mixed round with FAIL rows and an `existing-task` gap on `T2`, the gap appears in `hostHints[2]`, its routed item has `restage: false`, and the `admitAndRestageRepair` spy records no call for `T2`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — lowest-host and existing-task handling
- `src/conductor/test/engine/routing/round-router-mixed.test.ts` — negative tests

**Dependencies:** Task 30

### Task 32: Residue kinds, refusal rework and existing-task gaps are classified and placed correctly
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/round-router-residue.test.ts` — an operator-refused `prd_audit` decision producing refusal rework with a judge answering `2`; a merged `/remediate` gap with an `existing-task` disposition binding `T2`; an as-built REMEDIABLE finding citing only `adr-x D2`, a second residue item and a `T1`-bound finding in one round; an as-built finding citing `task rem-prd-audit-T1`.
2. Verify RED.
3. Implement: in `routeAdmittedRound`, an item is residue exactly when it is an as-built REMEDIABLE finding whose governing reference is an ADR decision, or refusal rework (`refusal-<decisionId>`); a gap with bound task ids, including an `existing-task` gap's resolved ids and an as-built `plan-task` reference, is task-bound. Refusal-rework blocks are allocated under the chosen host only.
4. Verify GREEN, commit.

**Done when:**
- [test] refusal rework from an operator-refused `prd_audit` decision is sent to the judge, and with the answer `2` its rem blocks appear only under host `2` in the returned frozen allocation.
- [test] a merged `/remediate` gap with an `existing-task` disposition binding `T2` yields owner `2` with reason `task-slice` and zero judge calls.
- [test] for a round holding an as-built REMEDIABLE finding citing only `adr-x D2`, a second residue item and a `T1`-bound finding, exactly one judge call is made, its prompt lists both residue items, and the `T1`-bound finding is absent from it.
- [test] an as-built REMEDIABLE finding citing `task rem-prd-audit-T1` reaches `deriveTaskBoundOwner`, is excluded from the routing-call item list, and records zero judge calls.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-router.ts` — residue classification
- `src/conductor/test/engine/routing/round-router-residue.test.ts` — tests

**Dependencies:** Tasks 25, 28

### Task 40: Marker-first round admission
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — a recorded git argv and stdin for `admitRound` on the three-child stack, draining into a real `EventPersister`.
2. Verify RED.
3. Implement: `admitRound({ worktree, slug, roundId, routed, persist, git })` in `src/conductor/src/engine/routing/round-admission.ts`: `createRouteRecord` in phase `prepared`; then one `writeRoutingTransaction` with `create-marker {host: lowest host, roundId}` and an `update-record` moving the round to `open`, the lowest host to `admitted`, and appending `remediationRoutedEvent` and `routedRepairPhaseEvent(admitted)` to the outbox; then `drainOutbox`. It returns the exhaustive union `admitted | halted | refused`.
4. Verify GREEN, commit.

**Done when:**
- [test] `admitRound` writes `refs/conductor/demo/routes/r1` in phase `prepared`, with every host `pending` and a frozen allocation entry for every host, before any other ref write in the recorded git argv, and the plan file on every fixture branch is byte-identical before and after `admitRound`.
- [test] the marker step is exactly one `update-ref --stdin` call whose input creates `refs/conductor/demo/repairing` as `{host: 1, roundId: r1}` with an all-zero old value and moves `routes/r1` from its `prepared` blob to a blob in phase `open` with host `1` `admitted`.
- [test] after `admitRound` returns `admitted`, `events.jsonl` holds exactly one `remediation_routed` and one `routed_repair_phase` with phase `admitted` for `r1`, and the `prepared` blob's outbox was empty.
- [test] when the `prepared` record creation fails, no `refs/conductor/demo/repairing` ref exists and `admitRound` returns `halted`.
- [test] when a drain is interrupted after `persist` succeeds and before the outbox entry is removed, a second drain leaves `events.jsonl` holding that `remediation_routed` event exactly once, with its original `eventId` and `occurredAt`.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — `admitRound`
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — admission tests

**Dependencies:** Tasks 9, 100, 101

### Task 41: The marker transaction refuses a concurrent round or a moved record
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — a git-runner wrapper injecting a marker for `r2`, or a new `routes/r1` blob, between the `prepared` write and the marker transaction.
2. Verify RED.
3. Implement: in `admitRound`, a `cas-failed` marker transaction re-reads the marker; when it names another round, return `halted` with haltClass `needs-human` naming both round ids; otherwise return `halted` naming the round. Never retry.
4. Verify GREEN, commit.

**Done when:**
- [test] with an injected writer creating `refs/conductor/demo/repairing` for round `r2` before the marker transaction, `admitRound` returns `halted` with haltClass `needs-human` and a detail naming both `r2` and `r1`.
- [test] after that refused transaction `routes/r1` is still in phase `prepared` and the marker still names `r2`.
- [test] with an injected writer moving `routes/r1` between its read and the marker transaction, the transaction returns `cas-failed`, and neither the marker nor host `1` `admitted` is written.
- [test] `admitRound` with the journal in state `moved`, and separately with an `applied` journal carrying a pending `followOnCause`, returns `refused` and writes no `routes/`, `repairing` or `revalidate` ref, because both its writes go through `writeRoutingTransaction`.
- [test] with `routes/r1` already `prepared` and an `applied` journal carrying a pending `followOnCause` appearing before the marker transaction, the marker transaction returns `restack-journal-open`, `admitRound` returns `refused`, `r1` stays `prepared` and no marker exists.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — concurrent-writer handling
- `src/conductor/test/engine/routing/round-admission.realgit.test.ts` — injected-writer tests

**Dependencies:** Task 40

### Task 42: Round reconciliation aborts orphaned rounds and re-navigates an admitted one
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing real-git tests: `src/conductor/test/engine/routing/round-reconciliation.realgit.test.ts` — fixtures killed after the `prepared` write and after the marker transaction; a `prepared` `r1` beside a marker naming `r2`; a conductor resume test in `src/conductor/test/engine/routing/conductor-routing-resume.test.ts`; a type test over the switches.
2. Verify RED.
3. Implement: `reconcileRounds({ worktree, slug, git })` in `round-admission.ts`, an exhaustive switch (no default arm) over `RoundPhase` and `HostState`. A `prepared` round that no marker names is CAS-deleted through a `delete-record` op and reported `aborted`. An `admitted` host yields the action `navigate-leaf-to-build` and writes nothing. Every later state yields `deferred` (handled by #3211 and #3212). Conductor resume in `conductor.ts`, after `runStackPreflight`, applies `navigate-leaf-to-build` by navigating the leaf to `build` when it is not already there.
4. Verify GREEN, commit.

**Done when:**
- [test] with a crash after the `prepared` record and before the marker, `reconcileRounds` CAS-deletes `routes/r1`, no marker exists, and no `### Task rem-` block of that round exists on `feat/c1/demo`, `feat/c2/demo` or `feat/daemon-demo`.
- [test] after that abort, the next leaf `prd_audit` pass creates a fresh `prepared` `routes/r1` with an all-zero old value, and `events.jsonl` holds exactly one `remediation_routed` for `r1`.
- [test] with a `prepared` `r1` and a marker naming `r2`, `reconcileRounds` deletes `routes/r1` and leaves `routes/r2` and the marker byte-identical.
- [test] with a crash after the marker transaction and before `navigateBack`, conductor resume navigates the leaf back to `build`, and the counts of `routes/` refs and `repairing` refs both stay at 1.
- [test] `reconcileRounds` switches over every `HostState` and `RoundPhase` with no default arm, and a type test adding a member to `HostState` fails compilation.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — `reconcileRounds`
- `src/conductor/src/engine/conductor.ts` — resume applies the re-navigation action
- `src/conductor/test/engine/routing/round-reconciliation.realgit.test.ts` — crash-recovery tests
- `src/conductor/test/engine/routing/conductor-routing-resume.test.ts` — resume test

**Dependencies:** Task 40

### Task 43: The preflight reconciles after journal recovery and never auto-restacks while a marker exists
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — call-order spies on `recoverRestackJournal`, `reconcileRounds` and `resolveActiveChild`; real-git fixtures with host `1` `admitted` and post-closure commits on `feat/c1/demo` and on `feat/c2/demo`.
2. Verify RED.
3. Implement: in `runStackPreflight` (`src/conductor/src/engine/restack/stack-preflight.ts`), when routing is on, call an injected `reconcileRounds` (default: the real one) after the second `recoverRestackJournal` and the outbox drain and before `resolveActiveChild`, and return its actions to the caller. When the cursor carries `routedRepair`, return `clear` without calling `runRestack`. Pass the reconciler from conductor resume and from `daemon-cli.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] `runStackPreflight` with an open round records calls in the order second `recoverRestackJournal`, `reconcileRounds`, `resolveActiveChild`.
- [test] the conductor resume call of `runStackPreflight` and the one in `daemon-cli.ts` both reach the injected `reconcileRounds` before `resolveActiveChild`.
- [test] with host `1` `admitted` and two new commits on `feat/c1/demo` past `closed/c1`, `runStackPreflight` returns `clear`, never calls `runRestack`, and `refs/conductor/demo/closed/c1` and `refs/heads/feat/c2/demo` are unchanged.
- [test] with host `1` `admitted` and an unstamped operator commit on `feat/c2/demo` past `closed/c2`, `runStackPreflight` calls no `runRestack` and no `refs/conductor/demo/restack/journal` ref exists afterwards.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — reconciliation hook and marker skip
- `src/conductor/src/engine/conductor.ts` — pass the reconciler into the resume preflight
- `src/conductor/src/daemon-cli.ts` — pass the reconciler into the daemon preflight
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — order and skip tests

**Dependencies:** Task 42

### Task 44: Base refresh is deferred while a round is open
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/restack/stack-preflight-routing.test.ts`, `src/conductor/test/engine/daemon-rekick-routing.test.ts` and `src/conductor/test/engine/finish-rebase-routing.test.ts` — an open round with `REKICK` present; a non-closed record with no marker; every record `closed` and no queue.
2. Verify RED.
3. Implement: `routedRoundOpen(worktree, slug, deps)` in `round-admission.ts`, true when any `routes/` record is not `closed` or the `revalidate` ref holds an entry. In `runStackPreflight`, when it is true and `baseRefreshDue`, emit `emitRestackRefused({ reason: 'deferred-base-refresh' })`, do not call `consumeRekick`, and move no ref. Apply the same check before the base-refresh `runRestack` in `daemon-rekick.ts` `resumeRebaseFirst` (emit, keep `REKICK`, and return `'skipped'`, so the daemon caller proceeds to `conductor.run()` with no rebase forced) and in the FINISH rebase in `conductor.ts` (emit and return `success: false` with detail `stack base refresh deferred: routed round open`).
4. Verify GREEN, commit.

**Done when:**
- [test] `routedRoundOpen` is true when any `routes/` record is not `closed`, including one with no marker, or `revalidate` holds an entry, and false when every record is `closed` and no `revalidate` ref exists.
- [test] with a round open, both with the marker present and with a non-`closed` record and no marker, and `REKICK` present, `runStackPreflight({ baseRefreshDue: true })` leaves a `for-each-ref` snapshot of `refs/heads/` and `refs/conductor/demo/` unchanged, emits one `restack_refused` with reason `deferred-base-refresh`, and never calls `consumeRekick`.
- [test] with a round open, `resumeRebaseFirst` emits one `restack_refused` with reason `deferred-base-refresh`, never calls `runRestack` with cause `base-refresh`, leaves `.pipeline/REKICK` and the `for-each-ref` snapshot unchanged, and returns `'skipped'`; a `daemon-cli.ts` re-kick test with that result reaches `conductor.run()`.
- [test] with a round open, the FINISH rebase emits one `restack_refused` with reason `deferred-base-refresh`, never calls `runRestack` with cause `base-refresh`, leaves the `for-each-ref` snapshot unchanged, and returns `success: false` so the publish step is never dispatched.
- [test] after every route record is `closed` and no `revalidate` ref exists, `resumeRebaseFirst` with `REKICK` present calls `runRestack` with cause `base-refresh` and consumes `REKICK` as before this change.

**Files likely touched:**
- `src/conductor/src/engine/routing/round-admission.ts` — `routedRoundOpen`
- `src/conductor/src/engine/restack/stack-preflight.ts` — deferral
- `src/conductor/src/engine/daemon-rekick.ts` — deferral
- `src/conductor/src/engine/conductor.ts` — FINISH deferral
- `src/conductor/test/engine/restack/stack-preflight-routing.test.ts` — preflight deferral
- `src/conductor/test/engine/daemon-rekick-routing.test.ts` — re-kick deferral
- `src/conductor/test/engine/finish-rebase-routing.test.ts` — FINISH deferral

**Dependencies:** Task 43

### Task 34: planRemediation routes admitted work before the leaf append, only where today's path would route into the region
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/conductor-routing-entry.test.ts` — a three-child stack where `prd_audit` returns a FIXABLE finding owned by `T1`; an ordered spy log over admission inside `planRemediation` and the git runner; the same stack with `stacked_prs.enabled: false`; a gap-loop caller driving a round hosted on `1` and `3`; a residue item with a step-runner spy.
2. Verify RED.
3. Implement: in `planRemediation` (`src/conductor/src/engine/conductor.ts`), when `this.featureSlug` is set and `routingEligible(cursor, this.config)` is true, evaluate today's halt predicates without side effects: any `halt` disposition, `earliestRemediationTarget`'s unresolved dispositions, and `isRegionStep(target)`. If any would halt or the target is not a region step, run today's path unchanged. Otherwise, after admission, the per-gap ladder and the budget checks and before `appendConductorRemediationTasks`, build the admitted items, call `routeAdmittedRound` with `this.stepRunner.dispatchResidueRoutingJudgement` as its judge and `nextRoundId` for the round, call `admitRound`, and return `{ kind: 'route', target: 'build', hint, evidence, routedRound }` only on `admitted` (a halt otherwise). The routing branch skips `appendConductorRemediationTasks`, `recordAppendedRemediationTaskIds`, `recordPendingRepair`, `admitAndRestageRepair` and the route-into-no-op guard. Remove the `void routingEligible` placeholder.
4. Verify GREEN, commit.

**Done when:**
- [test] for a FIXABLE finding owned by `T1` on the three-child stack, the ordered spy log shows the finding's admission entries before the first git command naming `refs/conductor/demo/routes/`, and `planRemediation` returns `{ kind: 'route', target: 'build' }` only after the marker transaction's `update-ref --stdin` call, with a route record whose item has owner `1`.
- [test] with durable child state, routing on and `stacked_prs.enabled: false`, admitted work produces a route record naming a child host and `appendConductorRemediationTasks` records zero calls.
- [test] for a routed round, `appendConductorRemediationTasks`, `recordAppendedRemediationTaskIds`, `recordPendingRepair` and `admitAndRestageRepair` record zero calls, the leaf's fixture feature plan file is byte-identical, and the route-into-no-op guard is never evaluated.
- [test] a gap-loop caller driving a routed round with hosts `1` and `3` emits exactly one `kickback` event and makes exactly one `navigateBack` to `build`.
- [test] for a round with a residue item, the routing branch invokes `this.stepRunner.dispatchResidueRoutingJudgement` as the router's judge, asserted by a step-runner spy.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — routing branch in `planRemediation`
- `src/conductor/test/engine/routing/conductor-routing-entry.test.ts` — entry tests

**Dependencies:** Tasks 28, 32, 40

### Task 104: planRemediation turns every routing halt into a feature halt and persists what the router decided
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/conductor-routing-halts.test.ts` — on the three-child stack through `planRemediation`: router halts from a missing `taskSlices` entry, an undeclared `Child:` position, a rem task with no membership, an invalid-twice routing call, an unreadable closure and an unreadable leaf tip; a step runner without `dispatchResidueRoutingJudgement`; a `prd_audit` pass owned by `T1` and `T3` plus a judged residue item; a validation-group join with a gap owned by `T2` and FAIL rows.
2. Verify RED.
3. Implement: in the routing branch of `planRemediation` (`src/conductor/src/engine/conductor.ts`), map every `routeAdmittedRound` halt to `{ kind: 'halt', haltClass: 'needs-human', detail }` before `nextRoundId` or any routing ref access, never falling through to today's path; pass `consolidatedManualTestFail` rows into the router; pass `routeAdmittedRound`'s items, hosts and allocation (with each host's `retryHint`) to `admitRound` unchanged, and return the first host's `retryHint` as the route's hint.
4. Verify GREEN, commit.

**Done when:**
- [test] for each router halt fixture, `planRemediation` returns `{ kind: 'halt', haltClass: 'needs-human' }` whose detail names the task, item, child or leaf branch from the fixture, `appendConductorRemediationTasks` records zero calls, and the git argv spy records no command naming `refs/conductor/demo/routes/` or `repairing`.
- [test] with a step runner lacking `dispatchResidueRoutingJudgement` and one residue item, `planRemediation` returns a needs-human halt naming the item and no routing ref is written.
- [test] after `planRemediation` admits a pass owned by `T1` and `T3` plus an as-built REMEDIABLE finding citing only `adr-x D2`, classified as residue and judged `{child: 2, candidates: [2], rationale: "implements D2"}`, the stored `routes/r1` items carry exactly the owner, host, reason and rationale `routeAdmittedRound` returned, `hostOrder` of its `hosts` is `[1, 2, 3]`, and the marker names host `1`.
- [test] for a validation-group join with a gap owned by `T2` and FAIL rows, `planRemediation` passes the FAIL rows to the router, the stored `routes/r1` allocation for host `2` has a `retryHint` containing every FAIL row verbatim, and the returned route's hint equals it.
- [test] for a validation-group join with FAIL rows and an `existing-task` gap bound to `T2`, an `admitAndRestageRepair` spy across the whole `planRemediation` call records no call for `T2`, and the stored host `2` `retryHint` contains the gap's rationale.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — halt mapping, FAIL-row input, persistence hand-off
- `src/conductor/test/engine/routing/conductor-routing-halts.test.ts` — tests

**Dependencies:** Tasks 26, 29, 31, 34

### Task 35: Routing-off, N=1, PLAN_GAP and DESIGN behave exactly as today
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/n1-golden-routing-guard.test.ts` run with the setting on; `src/conductor/test/engine/routing/conductor-routing-refusals.test.ts` — the three-child stack with routing off; a `prd_audit` PLAN_GAP no task owns; an as-built DESIGN finding citing a decision `T2` implements; each compared against the same verdict on an N=1 fixture with a recorded git argv spy.
2. Verify RED.
3. Implement: no production change beyond keeping Task 34's branch behind `routingEligible` and after the PLAN_GAP and DESIGN outcomes; fix any ordering the tests expose.
4. Verify GREEN, commit.

**Done when:**
- [test] the N=1 golden suite run with `stacked_prs.route_whole_feature_fixes: true` records through its `PATH`-shimmed `git` no command naming `refs/conductor/<slug>/routes`, `repairing` or `revalidate`, and its goldens are unchanged.
- [test] the three-child stack with routing off appends the rem block on the leaf plan exactly as the pre-change golden, and its git argv spy records no command naming a routing ref.
- [test] the stacked PLAN_GAP halt has the same halt class and reason as the N=1 fixture, the git argv spy records no command naming `refs/conductor/demo/routes/` or `refs/conductor/demo/repairing`, and no plan gains a rem block.
- [test] the stacked DESIGN finding citing a decision `T2` implements halts needs-human with the same reason as N=1, and no route record or marker is created.

**Files likely touched:**
- `src/conductor/test/engine/n1-golden-routing-guard.test.ts` — setting-on guard
- `src/conductor/test/engine/routing/conductor-routing-refusals.test.ts` — parity tests
- `src/conductor/src/engine/conductor.ts` — ordering fix only if needed

**Dependencies:** Task 34

### Task 36: OVER_SCOPE, malformed, no-owner, halt-disposition, unresolved, pre-region and FAIL-only work is untouched by routing
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: `src/conductor/test/engine/routing/conductor-routing-refusals.test.ts` — on the three-child stack: an OVER_SCOPE finding with no refuse decision; a FIXABLE finding with malformed evidence and one with no owning task; a work order with an admitted fix plus a `halt` disposition; one naming an unresolvable disposition; joins targeting `plan` and `coverage_binding`; a FAIL-only join; each compared with N=1 under a recorded git argv spy and a `routeAdmittedRound` spy.
2. Verify RED.
3. Implement: no production change beyond Task 34's predicates; fix any ordering the tests expose.
4. Verify GREEN, commit.

**Done when:**
- [test] the stacked OVER_SCOPE finding with no refuse decision produces the same outcome as N=1 and no route record is created.
- [test] the stacked FIXABLE findings with malformed evidence or no owning task are refused with today's refusal reason, the `routeAdmittedRound` spy records zero calls, and no routing ref is written.
- [test] a stacked work order with an admitted fix plus a `halt` disposition halts with today's halt detail, and one naming an unresolvable disposition halts with today's unresolvable-disposition detail, each with no route record or marker created.
- [test] the joins targeting `plan` and `coverage_binding` each run today's kickback to that target, and a FAIL-only join runs today's deterministic `manual_test` kickback, each with no route record created.
- [test] when `nextRoundId` returns `round-limit`, `planRemediation` returns a needs-human halt whose detail names the `r999` round limit, and no route record is created.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-routing-refusals.test.ts` — parity tests
- `src/conductor/src/engine/conductor.ts` — ordering fix only if needed

**Dependencies:** Task 34

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a three-child stack, when `prd_audit` returns a FIXABLE finding owned by `T1`, then the finding is classified and admitted by today's rules before any routing ref is read or written, and a route record is then created for it. | 34 | "shows the finding's admission entries before the first git command naming `refs/conductor/demo/routes/`" | diff-local |
| Story 1 happy: Given a three-child stack whose project sets `stacked_prs.enabled: false`, when `prd_audit` admits a FIXABLE finding owned by `T1`, then the work is still routed to a child, because the feature still has durable child state. | 34 | "with durable child state, routing on and `stacked_prs.enabled: false`, admitted work produces a route record naming a child host" | diff-local |
| Story 1 happy: Given an N=1 feature with routing on, when `prd_audit` admits a FIXABLE finding, then the remediation lap appends on the checked-out branch exactly as today and no routing ref is read or written. | 35 | "the N=1 golden suite run with `stacked_prs.route_whole_feature_fixes: true` records through its `PATH`-shimmed `git` no command naming" | diff-local |
| Story 1 negative: Given the three-child stack with routing off, when `prd_audit` admits a FIXABLE finding owned by `T1`, then the rem task is appended on the leaf exactly as today and no routing ref is read or written. | 35 | "the three-child stack with routing off appends the rem block on the leaf plan exactly as the pre-change golden" | diff-local |
| Story 1 negative: Given a three-child stack, when `prd_audit` returns a PLAN_GAP on a happy-path criterion that no task owns, then the feature halts exactly as `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` decision 7 requires, and no route record or marker is created. | 35 | "the stacked PLAN_GAP halt has the same halt class and reason as the N=1 fixture" | diff-local |
| Story 1 negative: Given a three-child stack, when `prd_audit` returns an OVER_SCOPE finding against work in child 1 with no recorded refuse decision, then it is handled exactly as today and no route record is created. | 36 | "the stacked OVER_SCOPE finding with no refuse decision produces the same outcome as N=1 and no route record is created" | diff-local |
| Story 1 negative: Given a three-child stack, when as-built returns a DESIGN finding citing a decision that `T2` implements, then the feature halts needs-human as today and no route record is created, even though an implementing child exists. | 35 | "the stacked DESIGN finding citing a decision `T2` implements halts needs-human with the same reason as N=1, and no route record or marker is created" | diff-local |
| Story 1 negative: Given a three-child stack, when `prd_audit` returns a FIXABLE finding with malformed evidence or no owning task, then it is refused with today's refusal reason and nothing is routed. | 36 | "are refused with today's refusal reason, the `routeAdmittedRound` spy records zero calls, and no routing ref is written" | diff-local |
| Story 1 negative: Given a three-child stack, when a remediation work order contains an admitted fix together with a `halt` disposition, then the feature halts with today's halt detail and no route record or marker is created. | 36 | "a stacked work order with an admitted fix plus a `halt` disposition halts with today's halt detail" | diff-local |
| Story 1 negative: Given a three-child stack, when a remediation work order names a disposition target that cannot be resolved, then the feature halts with today's unresolvable-disposition detail and no route record is created. | 36 | "one naming an unresolvable disposition halts with today's unresolvable-disposition detail, each with no route record or marker created" | diff-local |
| Story 1 negative: Given a three-child stack, when a validation-group join's earliest target is `plan` or `coverage_binding`, then the kickback runs exactly as today and no route record is created. | 36 | "the joins targeting `plan` and `coverage_binding` each run today's kickback to that target" | diff-local |
| Story 2 happy: Given a three-child stack, when `prd_audit` admits a FIXABLE finding owned by `T1`, then the route record names owner `1` and host `1` with reason `task-slice`, and no routing judgement call is made. | 28, 104 | "returns one item with owner `1`, host `1` and reason `task-slice`, and the judge spy records zero calls" | diff-local |
| Story 2 happy: Given a three-child stack whose plan holds a rem task `rem-prd-audit-T1` whose committed block carries `**Child:** 1`, when as-built admits a REMEDIABLE finding citing `task rem-prd-audit-T1`, then the owner is `1` with reason `rem-child-line`. | 20 | "whose committed fixture block carries `**Child:** 1` it returns owner `1` with reason `rem-child-line`" | diff-local |
| Story 2 happy: Given a three-child stack whose rem task `rem-prd-audit-T1` has no `**Child:**` line and is recorded under child `1` in the engine's appended-remediation membership, when a finding cites it, then the owner is `1` with reason `rem-cache`. | 20 | "membership `{ 'rem-prd-audit-T1': 1 }` it returns owner `1` with reason `rem-cache`" | diff-local |
| Story 2 happy: Given a three-child stack, when one `prd_audit` pass admits findings owned by `T1` and `T3`, then the route record names hosts `1` and `3`, in that order. | 28, 104 | "`hostOrder(routed.hosts)` returns `[1, 3]`." | diff-local |
| Story 2 happy: Given a three-child stack, when as-built admits a REMEDIABLE finding citing `task T2,T3`, then the owner is `2` with reason `multi-task-earliest`, and no routing judgement call is made. | 20 | "for `['T2', 'T3']` it returns owner `2` with reason `multi-task-earliest`" | diff-local |
| Story 2 happy: Given a three-child stack, when a merged `/remediate` gap with an `existing-task` disposition binds `T2`, then the owner is `2` with no routing judgement call. | 32 | "a merged `/remediate` gap with an `existing-task` disposition binding `T2` yields owner `2` with reason `task-slice` and zero judge calls" | diff-local |
| Story 2 negative: Given a three-child stack, when a finding is owned by `T2` and a stubbed routing judgement would have answered `1`, then the owner is still `2` and the judgement is never called. | 28 | "for a finding owned by `T2` with a judge stub that would answer `1`, it returns owner `2` and the judge spy records zero calls" | diff-local |
| Story 2 negative: Given a three-child stack whose sealed envelope has no `taskSlices` entry for the owning task, when the finding is routed, then the feature halts needs-human naming the task, and no route record is created. | 29, 104 | "lacking a `taskSlices` entry for the owning task returns `halt` with class `needs-human` naming the task, returns no item" | diff-local |
| Story 2 negative: Given a rem task whose committed `**Child:**` line names position `7` while positions `1`, `2` and `3` are declared, when a finding cites it, then the feature halts needs-human naming the task and position `7`, and no route record is created. | 29, 104 | "names undeclared position `7` returns `halt` with class `needs-human` naming the task and `7`" | diff-local |
| Story 2 negative: Given a rem task with neither a `**Child:**` line nor an appended-remediation membership entry, when a finding cites it, then the feature halts needs-human naming the task, and no child is guessed. | 29, 104 | "with neither a `**Child:**` line nor a membership entry returns `halt` with class `needs-human` naming the task" | diff-local |
| Story 3 happy: Given a three-child stack, when as-built admits a REMEDIABLE finding citing only `adr-x D2` and the routing call returns `{child: 2, candidates: [2], rationale: "implements D2"}`, then the owner is `2` with reason `residue-judged` and the rationale is recorded. | 25, 104 | "returns owner `2` with reason `residue-judged` and rationale `implements D2`" | diff-local |
| Story 3 happy: Given a three-child stack, when the routing call returns `{child: 2, candidates: [1, 2], rationale: "ambiguous ownership"}` for a residue item, then the owner is `1` with reason `residue-default`. | 25 | "returns owner `1` with reason `residue-default`" | diff-local |
| Story 3 happy: Given a three-child stack, when an operator-refused `prd_audit` decision produces refusal rework and the routing call answers `2`, then the rework's rem blocks are frozen under host `2` only. | 32 | "with the answer `2` its rem blocks appear only under host `2` in the returned frozen allocation" | diff-local |
| Story 3 happy: Given a three-child stack, when one round holds two residue items and a `T1`-bound finding, then exactly one routing call is made, its item list holds the two residue items, and the `T1`-bound finding is not in it. | 32 | "exactly one judge call is made, its prompt lists both residue items, and the `T1`-bound finding is absent from it" | diff-local |
| Story 3 happy: Given a three-child stack, when one validation-group join produces a FIXABLE gap owned by `T2` together with `manual_test` FAIL rows, then no routing call is made, the FAIL obligation is placed with host `2` with reason `mixed-round`, and the FAIL rows appear verbatim in host `2`'s retry hint. | 30, 31, 104 | "records zero judge calls and places the FAIL obligation with host `2` and reason `mixed-round`" | diff-local |
| Story 3 happy: Given a three-child stack, when the routing call has run, then the `prd_audit` judgment contract version is still `v1`, the as-built verdict contract version is still `v2`, and both verdict schemas are unchanged. | 27 | "`PRD_AUDIT_JUDGMENT_CONTRACT_VERSION` is still `v1` and `AS_BUILT_VERDICT_CONTRACT_VERSION` is still `v2`" | diff-local |
| Story 3 negative: Given a three-child stack, when the routing call returns child `7`, which is not declared, then it is asked once more, and when the second answer is also undeclared the feature halts needs-human naming the item, with no route record created. | 26, 104 | "with a judge answering child `7` on both attempts, the judge is called exactly twice" | diff-local |
| Story 3 negative: Given a three-child stack, when the routing call returns malformed output twice, then the feature halts needs-human naming the item, and the `prd_audit` and as-built lap counts in the kickback ledger are unchanged by the routing call. | 26, 104 | "lap counts are byte-identical before and after the call" | diff-local |
| Story 3 negative: Given a three-child stack, when the routing call times out on both attempts, or the provider reports it is unavailable on both, then the feature halts needs-human naming the item, and no routing ref is written. | 26, 104 | "with a judge that rejects with a timeout on both attempts, and separately one returning `{ success: false }` on both" | diff-local |
| Story 3 negative: Given a three-child stack whose step runner provides no residue routing judgement, when a round holds a residue item, then the feature halts needs-human naming the item before any routing ref is written. | 26, 104 | "with no judge and one residue item, `routeAdmittedRound` returns a needs-human halt naming the item, invokes no provider" | diff-local |
| Story 3 negative: Given a mixed round whose task-bound gaps are owned by `T1` and `T3` and which carries FAIL rows, when the round is routed, then the FAIL obligation goes to host `1`, and the FAIL rows ride both host `1`'s and host `3`'s retry hints. | 31 | "places the FAIL obligation with host `1`, and both `hostHints[1]` and `hostHints[3]` contain every FAIL row" | diff-local |
| Story 3 negative: Given a mixed round with FAIL rows and an `existing-task` gap bound to `T2`, when the round is routed, then the gap rides host `2`'s retry hint, its routed item is marked not to restage, and `T2` is not restaged. | 31, 104 | "its routed item has `restage: false`, and the `admitAndRestageRepair` spy records no call for `T2`" | diff-local |
| Story 3 negative: Given a three-child stack, when a validation-group join's only failure is `manual_test` FAIL rows, then this spec leaves it unchanged: the deterministic `manual_test` kickback runs exactly as today and no route record is created, because routing FAIL-only work is delivered by #3211. | 36 | "a FAIL-only join runs today's deterministic `manual_test` kickback, each with no route record created" | diff-local |
| Story 4 happy: Given a three-child stack, when a work order owned by `T1` cites `src/b.ts`, which is present at the leaf tip, absent at `closed/c1` and present at `closed/c2`, then the host is `2` with reason `prerequisite-paths`, the owner stays `1`, and `taskSlices.T1` is still `1`. | 22 | "returns host `2`, reason `prerequisite-paths` and owner `1`, and the sealed envelope's `taskSlices.T1` is still `1` after the call" | diff-local |
| Story 4 happy: Given a three-child stack, when a work order owned by `T1` cites `src/new.ts`, which is absent at the leaf tip, then `src/new.ts` is treated as an output and the host stays `1`. | 22 | "`classifyCitedPaths` marks `src/new.ts` (absent at the leaf tip) as an output" | diff-local |
| Story 4 happy: Given a three-child stack, when one round hosts items on child `1` and on the leaf, then the route record's host order places child `1` first and the leaf last. | 28, 104 | "with leaf position `3` last, and `hostOrder` of `{3, 1, 2}` returns `[1, 2, 3]`" | diff-local |
| Story 4 negative: Given a three-child stack, when a work order owned by `T1` cites a path present at the leaf tip but absent from `closed/c1` and `closed/c2`, then the host is the leaf with reason `prerequisite-paths`, and the owner stays `1`. | 23 | "citing a path present at the leaf tip but absent from `closed/c1` and `closed/c2` returns the leaf host with reason `prerequisite-paths` and owner `1`" | diff-local |
| Story 4 negative: Given a work order owned by `T2` citing a path present at `closed/c1` and the leaf tip but absent at `closed/c2`, when the host is chosen, then child `1` is never chosen and the host is the leaf with reason `prerequisite-paths`. | 23 | "never returns child `1` and returns the leaf host with reason `prerequisite-paths`" | diff-local |
| Story 4 negative: Given a work order owned by `T1` citing `src/b.ts` and a path that only the leaf adds, when the host is chosen, then child `2` is not chosen because it lacks one input, and the host is the leaf. | 23 | "citing `src/b.ts` and a leaf-only path does not return child `2` and returns the leaf host" | diff-local |
| Story 4 negative: Given the leaf tip cannot be read while cited paths are classified, when the host is chosen, then the feature halts needs-human naming the leaf branch, and no route record is created. | 23, 29, 104 | "when the leaf tip cannot be resolved `classifyCitedPaths` returns a needs-human halt naming `feat/daemon-demo`" | diff-local |
| Story 4 negative: Given a closure ref that cannot be read while hosts are compared, when the host is chosen, then the feature halts needs-human naming the child, and no route record is created. | 23, 29, 104 | "when `ls-tree` on `closed/c2` exits non-zero `selectHost` returns a needs-human halt naming child `2`" | diff-local |
| Story 5 happy: Given a three-child stack, when a FIXABLE finding owned by `T1` is admitted, then a route record is created in phase `prepared` with every host `pending` and a frozen allocation for every host, and no plan file on any branch is modified. | 40, 103 | "in phase `prepared`, with every host `pending` and a frozen allocation entry for every host" | diff-local |
| Story 5 happy: Given that `prepared` record, when admission continues, then one transaction creates the marker `{host: 1, roundId}`, moves the round to `open` and marks host `1` `admitted`, and only then does remediation planning return a route to `build`. | 40, 34 | "creates `refs/conductor/demo/repairing` as `{host: 1, roundId: r1}` with an all-zero old value and moves `routes/r1` from its `prepared` blob to a blob in phase `open` with host `1` `admitted`" | diff-local |
| Story 5 happy: Given an admitted round, when the frozen allocation is read, then each rem block body carries its host's `**Child:**` line and the round's `**Round:**` line, and every rem id is unique across the leaf's plan and every host's plan. | 103 | "returns one block whose body contains the lines `**Child:** 1` and `**Round:** r1`" | diff-local |
| Story 5 happy: Given an admitted round with hosts `1` and `3`, when the route is followed, then exactly one `kickback` event and exactly one leaf `navigateBack` to `build` are recorded. | 34 | "emits exactly one `kickback` event and makes exactly one `navigateBack` to `build`" | diff-local |
| Story 5 happy: Given an admitted round, when remediation planning returns its route, then no rem block is appended on the leaf and the route-into-no-op guard is not evaluated at the leaf. | 34 | "the leaf's fixture feature plan file is byte-identical, and the route-into-no-op guard is never evaluated" | diff-local |
| Story 5 happy: Given a feature resuming with no route record, when the next round is admitted, then its round id is `r1`, and later rounds take the next unused id. | 100 | "`nextRoundId` returns `r1` when no `refs/conductor/demo/routes/` ref exists and `r3` when `routes/r1` and `routes/r2` exist" | diff-local |
| Story 5 negative: Given a crash after the route record is `prepared` and before the marker exists, when the feature resumes, then the record is deleted, no marker exists, and the next leaf gate pass admits the work as a fresh round. | 42 | "`reconcileRounds` CAS-deletes `routes/r1`, no marker exists, and no `### Task rem-` block of that round exists" | diff-local |
| Story 5 negative: Given a `prepared` round `r1` left after its marker transaction lost to a marker for round `r2`, when the feature resumes after the halt is cleared, then `r1` is deleted because no marker names it, and `r2` and its marker are unchanged. | 42 | "with a `prepared` `r1` and a marker naming `r2`, `reconcileRounds` deletes `routes/r1` and leaves `routes/r2` and the marker byte-identical" | diff-local |
| Story 5 negative: Given a crash after the marker transaction and before the leaf is navigated, when the feature resumes, then the leaf is navigated back to `build`, and there is still exactly one route record and one marker. | 42 | "conductor resume navigates the leaf back to `build`, and the counts of `routes/` refs and `repairing` refs both stay at 1" | diff-local |
| Story 5 negative: Given the marker transaction, when another writer has already created a marker for round `r2`, then the transaction fails, the round stays `prepared`, and the feature halts needs-human naming both rounds. | 41 | "`admitRound` returns `halted` with haltClass `needs-human` and a detail naming both `r2` and `r1`" | diff-local |
| Story 5 negative: Given the marker transaction, when another writer has moved the route record since it was read, then the transaction fails, and neither the marker nor host `1` `admitted` is written. | 41 | "the transaction returns `cas-failed`, and neither the marker nor host `1` `admitted` is written" | diff-local |
| Story 5 negative: Given a restack journal that is not `applied` or `aborted`, when admission tries to create or update a route record, then the write is refused, the record keeps its prior value, and no marker is written. | 102, 41 | "with the restack journal in state `moved`, `writeRoutingTransaction` returns `restack-journal-open`" | diff-local |
| Story 5 negative: Given admission has read a terminal or absent restack journal, when a restack creates or advances the journal before admission's transaction commits, then the transaction fails and no routing ref is written. | 102, 41 | "a `for-each-ref refs/conductor/demo/` snapshot shows no `routes/`, `repairing` or `revalidate` ref was added or changed" | diff-local |
| Story 5 negative: Given an `applied` restack journal that still carries a pending base-refresh follow-on, when admission tries to create a route record, then the write is refused and no routing ref is written, so no round can open while that follow-on is outstanding. | 102, 41 | "with an `applied` journal carrying `followOnCause: 'base-refresh'`, a `create-record` op returns `restack-journal-open`" | diff-local |
| Story 5 negative: Given route records `r1` through `r999` already exist, when a new round is admitted, then the feature halts needs-human naming the round limit, and no record is created. | 36, 100 | "returns a needs-human halt whose detail names the `r999` round limit, and no route record is created" | diff-local |
| Story 5 negative: Given a host in state `pending`, when any writer tries to move it directly to `built`, then the transition is refused and the record is unchanged. | 9, 100 | "`transitionHost` refuses `pending→built` with `illegal-transition`, leaves the record blob and its outbox byte-identical" | diff-local |
| Story 6 happy: Given a feature resuming with a round open, when the stack preflight runs, then journal recovery runs first, then round reconciliation, then the cursor is resolved. | 43 | "records calls in the order second `recoverRestackJournal`, `reconcileRounds`, `resolveActiveChild`" | diff-local |
| Story 6 happy: Given host `1` `admitted` and two new commits on `feat/c1/demo` past `closed/c1`, when the stack preflight runs, then no `feature-repair` restack runs and `closed/c1` and `feat/c2/demo` are unchanged. | 43 | "`runStackPreflight` returns `clear`, never calls `runRestack`, and `refs/conductor/demo/closed/c1` and `refs/heads/feat/c2/demo` are unchanged" | diff-local |
| Story 6 happy: Given no route record that is not `closed` and an empty queue, when a base refresh is due, then it runs exactly as today. | 44 | "`resumeRebaseFirst` with `REKICK` present calls `runRestack` with cause `base-refresh` and consumes `REKICK` as before this change" | diff-local |
| Story 6 negative: Given host `1` `admitted` and an unstamped operator commit on `feat/c2/demo` past `closed/c2`, when the stack preflight runs, then no automatic restack runs for child 2 and no restack journal is created. | 43 | "an unstamped operator commit on `feat/c2/demo` past `closed/c2`, `runStackPreflight` calls no `runRestack`" | diff-local |
| Story 6 negative: Given a round open and a daemon re-kick requesting a base refresh, when the stack preflight runs, then no ref moves, one `restack_refused` with reason `deferred-base-refresh` is emitted, and the re-kick request is kept. | 44 | "emits one `restack_refused` with reason `deferred-base-refresh`, and never calls `consumeRekick`" | diff-local |
| Story 6 negative: Given a round open, when the daemon re-kick resume reaches its base refresh, then it emits `restack_refused` with reason `deferred-base-refresh`, runs no base-refresh restack, leaves every branch and `refs/conductor/demo/` ref unchanged, keeps the re-kick request, and continues the resume instead of halting. | 44 | "leaves `.pipeline/REKICK` and the `for-each-ref` snapshot unchanged, and returns `'skipped'`" | diff-local |
| Story 6 negative: Given a round open, when the FINISH rebase reaches its base refresh, then it emits `restack_refused` with reason `deferred-base-refresh`, runs no base-refresh restack, leaves every branch and `refs/conductor/demo/` ref unchanged, and the feature is not published. | 44 | "returns `success: false` so the publish step is never dispatched" | diff-local |
| Story 6 negative: Given a route record that is not `closed` and no marker, when a base refresh is due, then it is still deferred, because the marker alone does not decide whether a round is open. | 44 | "`routedRoundOpen` is true when any `routes/` record is not `closed`, including one with no marker" | diff-local |
| Story 7 happy: Given a round is admitted with items owned by `T1` and `T2`, when `.pipeline/events.jsonl` is read, then it holds exactly one `remediation_routed` event naming the round, each item's owner, host and reason, and `child` `1`. | 40, 9 | "`events.jsonl` holds exactly one `remediation_routed` and one `routed_repair_phase` with phase `admitted` for `r1`" | diff-local |
| Story 7 happy: Given host `1` moves from `pending` to `admitted`, when the event log is read, then it holds exactly one `routed_repair_phase` event for host `1` with phase `admitted`. | 9 | "`events.jsonl` holds exactly one `routed_repair_phase` for host `1` with phase `admitted` and `credit: false`" | diff-local |
| Story 7 negative: Given a round aborted on resume because it was `prepared` with no marker naming it, when the work is re-admitted as a fresh round with the same round id, then `events.jsonl` holds exactly one `remediation_routed` event for that round id, from the fresh round. | 42 | "`events.jsonl` holds exactly one `remediation_routed` for `r1`" | diff-local |
| Story 7 negative: Given a crash after an event is persisted and before it is removed from the route record's outbox, when the feature resumes and the outbox drains again, then `events.jsonl` still holds that event exactly once, with its original `eventId` and occurrence time. | 40 | "a second drain leaves `events.jsonl` holding that `remediation_routed` event exactly once, with its original `eventId` and `occurredAt`" | diff-local |
| Story 7 negative: Given a transition refused as illegal, when the event log is read, then no `routed_repair_phase` event exists for it and the record's outbox is unchanged. | 9 | "and `events.jsonl` gains no `routed_repair_phase` event" | diff-local |
| Story 7 negative: Given code outside the routing event module that builds a `remediation_routed` or `routed_repair_phase` event literal, when the structural check runs, then it fails naming the file. | 9 | "fails on an in-memory fixture that builds a `{ type: 'routed_repair_phase' }` or `{ type: 'remediation_routed' }` literal outside `routing/routing-events.ts`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-W1: conductor.ts routing branch: wrap the residue judge as (prompt) => this.stepRunner.dispatchResidueRoutingJudgement(prompt), matching the regrade judge; add a conductor-level test with a real-shaped step runner whose method reads `this`, asserting the router's judge invokes it once per residue item without a TypeError or malformed halt
**Gate:** prd-audit
**Rationale:** Verified defect: conductor.ts passes this.stepRunner.dispatchResidueRoutingJudgement unbound, and step-runners.ts reads this.resolvedConfigFor. The fix is a conforming implementation repair, an arrow wrapper like the existing regrade judge, plus a step-runner spy test. Task 34 Done-when already requires this.
**Criterion:** S3.1
**Parent task:** 34
**Done when:**
- [test] S3.1 is satisfied by this task.
- The repair for task rem-prd-audit-W1 is committed and its targeted tests pass.

### Task rem-prd-audit-W2: conductor.ts + routing/round-router.ts: classify residue from admitted finding provenance (ADR-only as-built findings and refusal rework are residue even when they carry proposed tasks) instead of gap.tasks.length === 0, and pass the gap rationale/summary and governing evidence into the judge projection; add round-router.test.ts and conductor tests covering refusal rework with tasks and an ADR-only finding reaching the judge
**Gate:** prd-audit
**Rationale:** Two verified defects. The judge is unbound (fixed by W1). conductor marks residue as gap.tasks.length === 0, so refusal rework that carries tasks bypasses the judge. ADR D3 already defines residue by provenance, so this is BUILD work, not an architecture decision.
**Criterion:** S3.3
**Parent task:** 34
**Done when:**
- [test] S3.3 is satisfied by this task.
- The repair for task rem-prd-audit-W2 is committed and its targeted tests pass.

### Task rem-prd-audit-W4: conductor.ts + routing/round-router.ts mixed rounds: thread the actual consolidated manual_test FAIL rows (not a boolean/placeholder) into routeAdmittedRound and the stored host retryHint verbatim; keep existing-task mixed items hint-only (no new rem block allocation); choose the FAIL host from task-bound items only when residue coexists; add tests per task 104 Done-when
**Gate:** prd-audit
**Rationale:** Verified: conductor.ts passes the placeholder ['manual_test: FAIL'] because hintSource.consolidatedManualTestFail is a boolean. The real FAIL rows must flow to host 2's retryHint, as task 104's Done-when requires. This is an implementation fix.
**Criterion:** S3.5
**Parent task:** 104
**Done when:**
- [test] S3.5 is satisfied by this task.
- The repair for task rem-prd-audit-W4 is committed and its targeted tests pass.

### Task rem-prd-audit-W5: conductor.ts + routing/round-router.ts + routing/cannot-host.ts: populate AdmittedRoutingItem.citedPaths from the work order's Done-when paths, finding evidence paths and the owner task's declared files; preserve selectHost's prerequisite-paths reason on both item constructors; verify the leaf fallback by checking every prerequisite exists at the leaf tip and halting needs-human on missing paths; add conductor-level test where a T1 item citing a child-2 path routes to host 2
**Gate:** prd-audit
**Rationale:** Verified: production builds AdmittedRoutingItem without citedPaths, so selectHost always returns the owner. Task 22 already defines cited paths: Done-when paths, finding evidence paths, and the owner task's declared files. Wiring them is BUILD work.
**Criterion:** S4.1
**Parent task:** 22
**Done when:**
- [test] S4.1 is satisfied by this task.
- The repair for task rem-prd-audit-W5 is committed and its targeted tests pass.

### Task rem-prd-audit-W6: conductor.ts: read each candidate host child branch's feature plan and pass hostPlans to routeAdmittedRound so frozen allocation reserves rem ids from the union of leaf and every host plan; add a conductor-level test where a child plan already holds a rem id and allocation skips it
**Gate:** prd-audit
**Rationale:** Verified: conductor.ts calls routeAdmittedRound without hostPlans, so allocation reserves only the leaf plan's rem ids. ADR D6 requires the union of the leaf plan and every host plan.
**Criterion:** S5.3
**Parent task:** 34
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-W6 is committed and its targeted tests pass.

### Task rem-prd-audit-W7: restack/stack-preflight.ts + conductor.ts resume: return a navigate-leaf-to-build preflight result instead of clear, and have conductor resume navigateBack the leaf to build without re-admitting; add the task 42 crash-after-marker resume test asserting routes/ and repairing ref counts stay 1
**Gate:** prd-audit
**Rationale:** Verified: navigate-leaf-to-build is produced by reconcileRounds, but stack-preflight.ts discards it as clear. Task 42 requires that resume navigate the leaf back to build. This is a wiring fix.
**Criterion:** S5.9
**Parent task:** 42
**Done when:**
- [test] S5.9 is satisfied by this task.
- The repair for task rem-prd-audit-W7 is committed and its targeted tests pass.

### Task rem-prd-audit-W8: routing/round-admission.ts: make the concurrent-round refusal detail name both the existing marker's round and the round being admitted (e.g. 'routing round r2 is already open; cannot admit r1'); tighten round-admission.realgit.test.ts to assert both ids
**Gate:** prd-audit
**Rationale:** Verified: the refusal detail names only the existing marker's round. Task 41 requires the detail to name both rounds. This is a small implementation and test fix.
**Criterion:** S5.10
**Parent task:** 41
**Done when:**
- [test] S5.10 is satisfied by this task.
- The repair for task rem-prd-audit-W8 is committed and its targeted tests pass.

### Task rem-prd-audit-W9: restack/stack-preflight.ts: evaluate routedRoundOpen + baseRefreshDue and emit restack_refused deferred-base-refresh before the navigate-leaf-to-build and non-repair-pending early exits; add task 44 tests with an admitted round (marker present) asserting one restack_refused and no consumeRekick
**Gate:** prd-audit
**Rationale:** Verified: stack-preflight returns clear for admitted rounds and for non-repair-pending cursors before the routedRoundOpen check, so deferred-base-refresh is never emitted for an admitted round. Task 44 defines the contract. This is a control-flow fix.
**Criterion:** S6.5
**Parent task:** 44
**Done when:**
- [test] S6.5 is satisfied by this task.
- The repair for task rem-prd-audit-W9 is committed and its targeted tests pass.

### Task rem-prd-audit-W10: test/engine/routing/routing-events.test.ts: add a structural check that scans src for { type: 'routed_repair_phase' } / { type: 'remediation_routed' } literals outside routing/routing-events.ts, failing with the offending file name, plus an in-memory fixture proving it fails
**Gate:** prd-audit
**Rationale:** Verified: the structural guard required by task 9's Done-when is missing. Adding it is test work inside an existing task.
**Criterion:** S7.6
**Parent task:** 9
**Done when:**
- [test] S7.6 is satisfied by this task.
- The repair for task rem-prd-audit-W10 is committed and its targeted tests pass.

### Task rem-as-built-W11: routing/round-admission.ts: perform the host pending->admitted change via transitionHost and gate the round prepared->open phase change with isLegalRoundPhaseTransition, so both transition guards participate in the shipped admission path; add a test that an illegal pre-state is refused with no ref written
**Gate:** as-built
**Rationale:** Verified: transitionHost has no production caller, and admission mutates host state by hand. Task 9 plans the primitive, so wiring it into admission is conforming BUILD work.
**Parent task:** 9
**Governing clause:** Task 9
**Done when:**
- Task 9 is satisfied by this task.
- The repair for task rem-as-built-W11 is committed and its targeted tests pass.

### Task rem-as-built-W12: conductor.ts planRemediation: move the routing decision, prepared-record creation and marker admission ahead of the leaf appendConductorRemediationTasks, recordAppendedRemediationTaskIds, seeding/commit and recordPendingRepair/admitAndRestageRepair, so routed rounds and routing halts leave no leaf-side mutations; add the task 34 ordered-spy and zero-call/byte-identical-plan tests
**Gate:** as-built
**Rationale:** Verified ordering defect. ADR D7 and task 34 already require routing before the leaf append, membership recording, and pending-repair creation. Reordering conductor.ts conforms to the approved design.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 7
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 7 is satisfied by this task.
- The repair for task rem-as-built-W12 is committed and its targeted tests pass.

### Task rem-as-built-W3: conductor.ts + routing/round-router.ts: derive each item's owning task ids from the admitted parent binding attached during admission (not the proposed repair task ids), and remove the round-router fallback to proposed ids; add a test where a repair task id differs from its owning authored/rem task and routes to the owner's host
**Gate:** as-built
**Rationale:** Verified: proposed repair-task ids are used as owners instead of the admitted parent binding. ADR D2 defines ownership, so this is an implementation fix.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 2
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 2 is satisfied by this task.
- The repair for task rem-as-built-W3 is committed and its targeted tests pass.

### Task rem-as-built-W13: routing/round-admission.ts + conductor.ts: drain the route record outbox into the existing EventPersister immediately after a successful marker transaction and before planRemediation returns the build route; add a test asserting remediation_routed and routed_repair_phase admitted are in events.jsonl before navigateBack
**Gate:** as-built
**Rationale:** Verified: the admission outbox is not drained before the BUILD route returns. ADR D7 requires the events on the existing event spine before leaf navigation. This is a wiring fix through the existing EventPersister.
**Governing clause:** adr-2026-10-12-routed-whole-feature-repair decision 7
**Done when:**
- adr-2026-10-12-routed-whole-feature-repair decision 7 is satisfied by this task.
- The repair for task rem-as-built-W13 is committed and its targeted tests pass.

### Task rem-prd-audit-refusal-51431839-5348-4d88-8273-9c808a3b7887: conductor.ts planRemediation: remove the halts.length>0 halt-disposition return and the fixes.length>0 && routedFixes.length===0 rejection from resolveStackedRoute and restore both, unchanged, at their original position after the leaf append/recordAppendedRemediationTaskIds/seed/commit/recordPendingRepair block, leaving only the routingEligible/routeAdmittedRound admission ahead of readRemediationGateAppendBudget/appendConductorRemediationTasks; add/adjust tests asserting an N=1 (or routing-off) feature with a halt gap or an unadmitted-fix plan produces the same ordering of append/commit calls and the same halt as main
**Gate:** prd-audit
**Rationale:** Removal-only rework within decision 51431839 r1. resolveStackedRoute, which runs unconditionally before append at conductor.ts:4394, now holds two checks that must move back. The first is the `halts.length > 0` halt-disposition check (around line 4598). The second is the `fixes.length > 0 && routedFixes.length === 0` rejection (around line 4719). Both return to their original position after the leaf append, record, seed and commit block. The pre-append resolver keeps only the routingEligible/routeAdmittedRound admission. This restores today's behaviour for N=1 and routing-off features (Story 5). No new behaviour is introduced.
**Criterion:** NC-1
**Governing clause:** Refused NC-1 (decision 51431839-5348-4d88-8273-9c808a3b7887 r1)
**Done when:**
- [test] NC-1 is satisfied by this task.
- Refused NC-1 (decision 51431839-5348-4d88-8273-9c808a3b7887 r1) is satisfied by this task.
- The repair for task rem-prd-audit-refusal-51431839-5348-4d88-8273-9c808a3b7887 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-W14: conductor.ts routing branch (+ as-built-routing.ts if needed): split a comma-canonicalised multi-task parentTask (e.g. 'T2,T3') into separate owner task ids before it reaches routeAdmittedRound/citedPathsFor, so deriveTaskBoundOwner resolves the earliest owning host instead of halting 'cannot derive an owner for T2,T3'; add a conductor-level planRemediation test driving an as-built REMEDIABLE finding whose plan-task reference cites 'T2,T3' end-to-end through the contract canonicalisation, asserting the stored routes/r1 item's owner/host is T2's child and no halt
**Gate:** prd-audit
**Rationale:** Verified (95%) by reading the code. as-built-contract.ts:447 canonicalises a multi-task plan-task reference to 'T2,T3'. as-built-routing.ts:27 copies that string into parentTask, and conductor.ts:4678 wraps it as the single owner ['T2,T3']. deriveTaskBoundOwner then finds no slice and halts. This is an implementation bug under approved Task 104 and ADR D2, which require each owning task to resolve to its earliest host. No architectural decision is needed.
**Criterion:** S2.5
**Parent task:** 104
**Done when:**
- [test] S2.5 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-W14 is committed and its targeted tests pass.
