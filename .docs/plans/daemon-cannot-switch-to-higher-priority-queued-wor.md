# Implementation Plan: Daemon preempts lower-priority work at step boundaries (#1929)

**Date:** 2026-11-07
**Stories:** .docs/stories/daemon-cannot-switch-to-higher-priority-queued-wor.md
**Conflict check:** Clean as of 2026-11-07 (`.docs/conflicts/daemon-cannot-switch-to-higher-priority-queued-wor.md`)
**Architecture:** `architecture-review-2026-11-07-daemon-cannot-switch-to-higher-priority-queued-wor` (APPROVED WITH CONDITIONS); new `adr-2026-11-07-daemon-step-boundary-preemption`; amendment to `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`

## Summary

The plan has 9 tasks. When every slot is busy and the next eligible backlog item outranks a running
feature and precedes it in backlog order, the daemon asks that feature's child executor to yield.
The child stops at its next operator-park-safe boundary with a `preempted` termination. The daemon
releases the slot with no marker, and ordinary backlog order resumes the feature later.

## Technical Approach

- **Rank and victim (pure).** `backlog-priority.ts` gains `preemptionRank(band)` and
  `selectPreemptionVictim(next, running)`. The rank is critical 3, high 2, medium, unlabeled and
  no-issue 1, low 0, and `undefined` for a missing band. `running` lists each feature worker's slug,
  band, backlog-order index and dispatch sequence. A feature is a candidate only when the next
  item's rank is strictly higher AND the next item's order index is lower. The victim is the
  lowest-ranked candidate, and on a tie the highest dispatch sequence.
- **IPC.** `executor-protocol.ts` adds `{ kind: 'yield' }` to the `ExecutorMessage` union and to
  `parseExecutorMessage`. `EXECUTOR_PROTOCOL_VERSION` stays 1 (ADR D4). `executor-child.ts`'s
  message handler sets an in-memory `yieldRequested` flag and passes `preemptionRequested: () =>
  yieldRequested` into `deps.run`. `child-feature-executor.ts` gains `requestYield(slug): boolean`.
  It sends `yield` to the running child whose `order.slug` matches and returns whether one was
  found. Its ledger mapping records a `preempted` outcome as `terminated`.
- **Conductor.** `conductor-options.ts` gains `PreemptedTermination { kind: 'preempted'; boundary }`
  and an optional daemon-only `preemptionRequested?: () => boolean`. The constructor, at the point
  that stores `opts.operatorParkBoundary`, stores a composed predicate (park OR yield) under that
  same field. Every existing gate site, and the group core it is handed to, therefore observes the
  yield with no per-site edit (ADR D5). `stopAtOperatorParkBoundary` classifies the stop. It
  re-reads the raw park predicate, treating a read error as parked; park returns the existing
  `operator-parked` result and event. Otherwise a requested yield closes open executions, emits
  `{ type: 'preemption_boundary', featureSlug, boundary }` and returns `{ kind: 'preempted',
  boundary }`. `event-sinks.ts` gets a `preemption_boundary` row matching `operator_park_boundary`'s
  (render, persist).
- **Runner and pool.** `executor-child-runtime.ts` passes the child's `preemptionRequested` into the
  conductor options beside `operatorParkBoundary`. `daemon-runner.ts` maps a `preempted`
  termination to `{ status: 'preempted' }` the way it maps `operator-parked`: `endDispatch`
  terminated, worktree kept, and no `readOutcome`, escalation, HALT or shipped effects.
  `FeatureStatus` and `FeatureExecutionOutcome.status` gain `'preempted'`. `daemon.ts`'s outcome
  collection releases the claim and returns without `claims.park`, `claims.complete`,
  `registerWatcher` or `onHaltWritten`.
- **Trigger.** In `runDaemon`'s busy-pool branch, after `discoverBacklog`, the daemon runs
  `pickEligible` over the discovered items to get the next item. It builds `running` from feature
  workers (in dispatch order) and their bands in the same discovery. If no request is outstanding
  and `deps.requestYield` exists, it calls `selectPreemptionVictim` and `deps.requestYield(victim)`.
  It records `{ victim, cause }` until that victim's outcome is collected. Collecting a `preempted`
  outcome logs `■ preempted <slug>: yielded to <cause>`. `daemon-cli.ts` wires
  `requestYield` to the child executor only in child mode, and `renderDaemonEventUnsafe` renders
  `preemption_boundary` as its own line.
- **Local pattern.** Operator park is the precedent: `stopAtOperatorParkBoundary`,
  `OperatorParkedTermination`, the `operator_park_boundary` event and its `EVENT_SINKS` row, the
  `operator-parked` branch in `makeRunFeature`, and the `outcome.status === 'parked'` branch in
  `runDaemon`'s collection. Preserve these traits: fail toward park on a read error; one
  classification point; executions closed before the boundary event; the worktree kept and
  escalation skipped. The only allowed variations are that the pool releases the claim instead of
  parking it, and that no marker is read or written. To find comparable tests, search
  `test/engine/operator-park-boundary.test.ts`, `test/engine/daemon.test.ts` (parked collection)
  and `test/engine/child-feature-executor.test.ts` (injected `fork`).
- **Test isolation.** Child executor tests use the injected `fork` fake, and daemon tests inject
  `runFeature`, `discoverBacklog` and `requestYield` fakes. No real process or tmux is spawned.

## Prerequisites

- None. Child executor isolation is the default (`executor_isolation` defaults to `child`).

## Tasks

### Task 1: Rank resolver bands and select a preemption victim
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/backlog-priority.test.ts` for every Done-when check below.
2. Implement `preemptionRank` and `selectPreemptionVictim` in `src/conductor/src/engine/backlog-priority.ts` as the Technical Approach states. Both are pure; read only `PriorityBand` strings, never labels.
3. Run the targeted test file and commit.

**Done when:**
- [test] `preemptionRank` returns 3 for critical, 2 for high, 1 for medium, unlabeled and no-issue, 0 for low, and `undefined` for an absent band.
- [test] `selectPreemptionVictim` with next item critical at order index 0 and running features low and medium at higher indices returns the low feature, and with two low features returns the one with the higher dispatch sequence.
- [test] `selectPreemptionVictim` returns the unlabeled running feature for a next item of band high ordered ahead of it.
- [test] `selectPreemptionVictim` returns `undefined` when the lowest running rank is medium and the next item is unlabeled, no-issue or medium; when the next item ranks below every running feature; when any band is absent; for a running low feature with a next unlabeled item ordered behind it; and for a running critical feature with a next no-issue item ordered ahead of it.

**Files likely touched:**
- `src/conductor/src/engine/backlog-priority.ts` — rank and victim selection
- `src/conductor/test/engine/backlog-priority.test.ts` — new tests

**Dependencies:** none

### Task 2: Carry a yield request over the executor IPC into the child
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-protocol.test.ts` and `src/conductor/test/engine/executor-child.test.ts` for every Done-when check below.
2. Add `{ kind: 'yield' }` to `ExecutorMessage` and parse it in `parseExecutorMessage` in `src/conductor/src/engine/executor-protocol.ts`; leave `EXECUTOR_PROTOCOL_VERSION` at 1.
3. In `runExecutorChild` in `src/conductor/src/engine/executor-child.ts`, set an in-memory flag on a parsed `yield` and pass `preemptionRequested` into `deps.run`. Do not abort the controller.
4. Run the targeted test files and commit.

**Done when:**
- [test] `parseExecutorMessage({ kind: 'yield' })` returns `{ kind: 'ok', message: { kind: 'yield' } }` and `EXECUTOR_PROTOCOL_VERSION` still equals 1.
- [test] After a `yield` message reaches `runExecutorChild`, the `preemptionRequested` it passed to `deps.run` returns true, and the run's abort signal is not aborted.
- [test] An older child that predates `yield` parses it as an unknown kind, so it is modelled by `runExecutorChild` receiving an unknown kind for which `parseExecutorMessage` returns `malformed`: the child neither crashes, aborts its signal nor stops early, and it then sends exactly the DONE or HALT outcome `deps.run` resolved with, unchanged.

**Files likely touched:**
- `src/conductor/src/engine/executor-protocol.ts` — `yield` message kind
- `src/conductor/src/engine/executor-child.ts` — yield flag and `preemptionRequested`
- `src/conductor/test/engine/executor-protocol.test.ts` — parse tests
- `src/conductor/test/engine/executor-child.test.ts` — child handler tests

**Dependencies:** none

### Task 3: The supervisor sends a yield to the running child for a slug
**Story:** Story 2
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/child-feature-executor.test.ts`, using the injected `fork` fake, for every Done-when check below.
2. Add `'preempted'` to `FeatureExecutionOutcome.status` in `src/conductor/src/engine/feature-executor.ts`.
3. Add `requestYield(slug)` to `createChildProcessFeatureExecutor` in `src/conductor/src/engine/child-feature-executor.ts`, and map a `preempted` outcome to ledger outcome `terminated`.
4. Run the targeted test file and commit.

**Done when:**
- [test] With one running child for slug `a`, `requestYield('a')` sends exactly one `{ kind: 'yield' }` message to that child's fake fork and returns true, and `requestYield('b')` sends nothing and returns false.
- [test] When a yield is sent to the running child for `a` and that child then sends a final `done` (or `halted`) outcome, `execute` returns that outcome unchanged; after it is collected, `requestYield('a')` sends nothing, returns false, and leaves the returned outcome unchanged.
- [test] A child outcome with status `preempted` is returned from `execute` with status `preempted`, and its executor ledger record's outcome is `terminated`, not `halted` or `complete`.

**Files likely touched:**
- `src/conductor/src/engine/child-feature-executor.ts` — `requestYield` and ledger mapping
- `src/conductor/src/engine/feature-executor.ts` — `preempted` status
- `src/conductor/test/engine/child-feature-executor.test.ts` — supervisor tests

**Dependencies:** Task 2

### Task 4: The conductor classifies a yield stop as preempted at the boundary primitive
**Story:** Story 2
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/operator-park-boundary.test.ts` for every Done-when check below. Follow that file's daemon-conductor fixtures.
2. Add `PreemptedTermination` and `preemptionRequested` to `src/conductor/src/engine/conductor-options.ts`. Add the `preemption_boundary` variant to `src/conductor/src/types/events.ts` and its row in `src/conductor/src/engine/event-sinks.ts`, modelled on `operator_park_boundary`.
3. In `src/conductor/src/engine/conductor.ts`, compose park OR yield into the stored park-predicate field in the constructor, and classify in `stopAtOperatorParkBoundary` as the Technical Approach states. Keep its traits: fail toward park, close executions before the event.
4. Run the targeted test file and commit.

**Done when:**
- [test] A daemon conductor with `preemptionRequested` returning true and no park reaches the pre-unit gate before its next pending serial step and returns `{ kind: 'preempted', boundary }`, whose boundary is the last settled unit, and its events ledger holds one `preemption_boundary` event with that feature slug and boundary and no `operator_park_boundary` event.
- [test] With both an active operator park and a yield requested, the conductor returns `operator-parked` and emits `operator_park_boundary` and no `preemption_boundary`; with the park predicate rejecting and a yield requested, it also returns `operator-parked`.
- [test] With an operator park and no yield requested, the conductor's termination and its single `operator_park_boundary` event are unchanged from today, and no `preemption_boundary` event is emitted.
- [test] An interactive conductor (daemon false) given a `preemptionRequested` that returns true runs every step without stopping and never calls it.
- [test] `EVENT_SINKS.preemption_boundary` is `{ render: true, persist: true, audit: false, otel: false }`.

**Files likely touched:**
- `src/conductor/src/engine/conductor-options.ts` — termination type and option
- `src/conductor/src/engine/conductor.ts` — predicate composition and classification
- `src/conductor/src/types/events.ts` — `preemption_boundary` variant
- `src/conductor/src/engine/event-sinks.ts` — sink row
- `src/conductor/test/engine/operator-park-boundary.test.ts` — conductor tests

**Dependencies:** none

### Task 5: A yield stops before the next attempt and at a group join, spending nothing
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/operator-park-boundary.test.ts` for every Done-when check below, reusing that file's attempt-gate and group fixtures from the park work.
2. Fix any gate site the tests show bypassing the composed predicate or classifying its own stop. Expect none (ADR A2), since every site reads the stored field and returns through `stopAtOperatorParkBoundary`.
3. Run the targeted test file and commit.

**Done when:**
- [test] A serial step allowed three attempts, whose yield is requested while attempt 1 runs, records exactly one runner dispatch, attempt 1's runner call returns its own result with no abort, and the conductor returns `preempted` whose boundary names that step and attempt 2.
- [test] A yield requested while a parallel group's members run lets every started member settle, records no member as `no-verdict` or exhausted, and returns `preempted` after the join.
- [test] After a preempted stop in the serial-attempt fixture, the step status is `in_progress`, no escalation rung or no-evidence attempt count advanced, the retry budget is unchanged, no `.pipeline/HALT` exists, and previously completed task statuses are unchanged.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — only if a gate site needs the composed predicate
- `src/conductor/test/engine/operator-park-boundary.test.ts` — attempt and group tests

**Dependencies:** Task 4

### Task 6: The runner and pool release a preempted feature without parking it
**Story:** Story 3
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-runner.test.ts`, `src/conductor/test/engine/executor-child-runtime.test.ts` and `src/conductor/test/engine/daemon.test.ts` for every Done-when check below.
2. Pass the child's `preemptionRequested` into the conductor options in `src/conductor/src/engine/executor-child-runtime.ts`.
3. In `makeRunFeature` in `src/conductor/src/engine/daemon-runner.ts`, map a `preempted` termination to status `preempted`, following the `operator-parked` branch.
4. Add `'preempted'` to `FeatureStatus` in `src/conductor/src/engine/daemon.ts` and release-only collection, as the Technical Approach states.
5. Run the targeted test files and commit.

**Done when:**
- [test] `makeExecutorChildRun` hands the conductor a `preemptionRequested` that returns the child's yield flag beside the existing `operatorParkBoundary`.
- [test] `makeRunFeature` given a conductor returning `{ kind: 'preempted' }` returns status `preempted`, keeps the worktree, ends the dispatch `terminated`, and calls no `readOutcome`, escalation, HALT writer, shipped record or processed-ledger writer.
- [test] `runDaemon` collecting a `preempted` outcome releases the slug's claim and writes no operator park marker, no HALT marker, no HALT watcher and no `onHaltWritten` stamp; it neither completes nor parks the slug in the claims, and adds it to neither `processed` nor the completion narration.
- [test] `runDaemon`'s log for a preempted collection contains no "intentional operator stop" line for that slug, while a `parked` collection with no yield requested still logs the existing "intentional operator stop" line unchanged.

**Files likely touched:**
- `src/conductor/src/engine/executor-child-runtime.ts` — pass `preemptionRequested`
- `src/conductor/src/engine/daemon-runner.ts` — `preempted` mapping
- `src/conductor/src/engine/daemon.ts` — `FeatureStatus` and collection
- `src/conductor/test/engine/daemon-runner.test.ts` — runner tests
- `src/conductor/test/engine/executor-child-runtime.test.ts` — runtime wiring test
- `src/conductor/test/engine/daemon.test.ts` — collection tests

**Dependencies:** Task 2, Task 3, Task 4

### Task 7: A full pool requests one yield for a strictly higher-ranked next item
**Story:** Story 1
**Story:** Story 3
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon.test.ts`, injecting `discoverBacklog`, `runFeature` and `requestYield` fakes, for every Done-when check below.
2. Add an optional `requestYield?: (slug: string) => boolean` to `DaemonDeps`. In `runDaemon`'s busy-pool branch, after `discoverBacklog`, select the next item with `pickEligible` and the victim with `selectPreemptionVictim` (Task 1). Track at most one outstanding `{ victim, cause }`, clear it when the victim's outcome is collected, and log the preempted line naming the cause.
3. Run the targeted test file and commit.

**Done when:**
- [test] On a full width-2 pool running low and medium features, a busy pass whose `pickEligible` result is critical calls `requestYield` exactly once with the low slug; when that feature returns `preempted` and no repair is queued, the next fill claims the critical slug.
- [test] `runDaemon`'s busy pass hands `selectPreemptionVictim` that pass's `pickEligible` result plus every running feature worker's band, backlog-order index and dispatch sequence, and calls `requestYield` exactly when it returns a slug, with that slug: a fixture with two running low features yields the more recently dispatched one, a high item ordered ahead of a running unlabeled feature yields the unlabeled one, and an unbanded (fallback-mode) backlog makes no call.
- [test] With the same yield outstanding, later busy passes with another strictly higher-ranked eligible item call `requestYield` no further time until the victim's outcome is collected, whatever that outcome is; once it is collected the outstanding request is cleared, so a later busy pass with a strictly higher-ranked item calls `requestYield` again.
- [test] No `requestYield` call happens when a slot is free (the higher-ranked item is claimed into it), when every slot holds a repair worker, when `requestYield` is absent from the deps (dispatch is otherwise unchanged), or when the backlog order's head is parked, halted or claimed and the `pickEligible` result does not outrank and precede a running feature.
- [test] When a preempted feature's slot frees while a repair is queued, the next fill claims the repair and the higher-ranked item is claimed at the following free slot, and the daemon log for each preempted collection says `preempted <slug>` and names the causing item's slug.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — trigger, outstanding request, log line
- `src/conductor/test/engine/daemon.test.ts` — pool tests

**Dependencies:** Task 1, Task 6

### Task 8: The daemon CLI wires yield to the child executor and renders the boundary
**Story:** Story 1
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-mode-feature-log.integration.test.ts` (rendering) and in the daemon CLI wiring tests near `src/conductor/test/engine/daemon-cli-priority-wiring.test.ts` for every Done-when check below.
2. In `src/conductor/src/daemon-cli.ts`, pass `requestYield: (slug) => childExecutor.requestYield(slug)` to the daemon deps on the child-executor path only (the in-process path, removed by #3403, passes none), and add a `preemption_boundary` case to `renderDaemonEventUnsafe`.
3. Run the targeted test files and commit.

**Done when:**
- [test] The daemon deps built by `daemon-cli.ts` for the child executor carry a `requestYield` that, called with a running slug, reaches that child executor's `requestYield` with the same slug and returns its result.
- [test] `renderDaemonEvent` renders a `preemption_boundary` event as a line containing `preempted[<slug>]` and the boundary, and renders no `operator park[` text for it.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — `requestYield` wiring and rendering
- `src/conductor/test/engine/daemon-mode-feature-log.integration.test.ts` — rendering test
- `src/conductor/test/engine/daemon-cli-priority-wiring.test.ts` — wiring test

**Dependencies:** Task 3, Task 7

### Task 9: A preempted feature resumes from its kept worktree by backlog order
**Story:** Story 3
**Type:** verification

**Steps:**
1. Write tests in `src/conductor/test/engine/operator-park-boundary.test.ts` (resume) and `src/conductor/test/engine/daemon.test.ts` (eligibility) for every Done-when check below.
2. Expect them to pass on the release-only collection from Task 6 and the existing resume path (ADR A5). Fix only a concrete failure.
3. Commit the tests.

**Done when:**
- [test] After a preempted stop leaves step S `in_progress`, a new daemon conductor run over the same kept worktree resumes at S, dispatching no completed step again and leaving committed task statuses unchanged.
- [test] `pickEligible` returns a preempted, released slug when it is the first eligible item in backlog order, and skips it while a repo-root operator park marker exists for it, until that marker is removed.

**Files likely touched:**
- `src/conductor/test/engine/operator-park-boundary.test.ts` — resume test
- `src/conductor/test/engine/daemon.test.ts` — eligibility test

**Verify-only:** yes

**Dependencies:** Task 6

## Task Dependency Graph

```text
Task 1 ───────────────────────────────▶ Task 7 ─▶ Task 8
Task 2 ─▶ Task 3 ─┬──────────────────▶ Task 6 ─▶ Task 7
Task 4 ─┬─────────┘                    Task 6 ─▶ Task 9
        └▶ Task 5
Task 3 ─────────────────────────────────────────▶ Task 8
```

## Integration Points

- After Task 3: a supervisor `requestYield` reaches a child's in-memory flag through the IPC fake.
- After Task 6: a preempted conductor stop becomes a released pool slot.
- After Task 8: the production daemon composition sends real yields in child mode, and daemon.log shows the boundary.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-07-daemon-step-boundary-preemption#D1 | task | task-1 | `preemptionRank` returns 3 for critical, 2 for high, 1 for medium, unlabeled and no-issue, 0 for low, and `undefined` for an absent band. |
| adr-2026-11-07-daemon-step-boundary-preemption#D2 | task | task-1, task-7 | for a running low feature with a next unlabeled item ordered behind it |
| adr-2026-11-07-daemon-step-boundary-preemption#D3 | task | task-1, task-7 | later busy passes with another strictly higher-ranked eligible item call `requestYield` no further time until the victim's outcome is collected, whatever that outcome is; once it is collected the outstanding request is cleared, so a later busy pass with a strictly higher-ranked item calls `requestYield` again. |
| adr-2026-11-07-daemon-step-boundary-preemption#D4 | task | task-2, task-3 | `parseExecutorMessage({ kind: 'yield' })` returns `{ kind: 'ok', message: { kind: 'yield' } }` and `EXECUTOR_PROTOCOL_VERSION` still equals 1. |
| adr-2026-11-07-daemon-step-boundary-preemption#D5 | task | task-4, task-5, task-6 | An interactive conductor (daemon false) given a `preemptionRequested` that returns true runs every step without stopping and never calls it. |
| adr-2026-11-07-daemon-step-boundary-preemption#D6 | task | task-4 | With both an active operator park and a yield requested, the conductor returns `operator-parked` and emits `operator_park_boundary` and no `preemption_boundary` |
| adr-2026-11-07-daemon-step-boundary-preemption#D7 | task | task-5 | the step status is `in_progress`, no escalation rung or no-evidence attempt count advanced, the retry budget is unchanged, no `.pipeline/HALT` exists |
| adr-2026-11-07-daemon-step-boundary-preemption#D8 | task | task-6, task-7, task-9 | releases the slug's claim and writes no operator park marker, no HALT marker, no HALT watcher and no `onHaltWritten` stamp |
| adr-2026-11-07-daemon-step-boundary-preemption#D9 | task | task-6 | `makeRunFeature` given a conductor returning `{ kind: 'preempted' }` returns status `preempted`, keeps the worktree, ends the dispatch `terminated`, and calls no `readOutcome`, escalation, HALT writer, shipped record or processed-ledger writer. |
| adr-2026-11-07-daemon-step-boundary-preemption#D10 | task | task-7, task-8 | The daemon deps built by `daemon-cli.ts` for the child executor carry a `requestYield` that, called with a running slug, reaches that child executor's `requestYield` with the same slug and returns its result. |
| adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever#D1 | existing | none | The error catch in `makeRunFeature` already derives the marker path from the slug; this feature does not touch that path. |
| adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever#D2 | existing | none | The explicit unrecoverable-state warning on a failed marker write already exists in `daemon-runner.ts` and is unchanged. |
| adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever#D3 | existing | none | Marker content naming the failing stage and resuming action is written by the existing error path, unchanged. |
| adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever#D4 | no-change | none | Errored features still stay stopped until the marker is cleared; the only marker-free outcome is `preempted`, carved out by the 2026-11-07 amendment and delivered by Task 6. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
