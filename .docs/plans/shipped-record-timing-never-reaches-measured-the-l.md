# Implementation Plan: Shipped-record timing reaches `measured`, or says why not (#1260)

**Date:** 2026-08-12
**Design:** `.docs/architecture/shipped-record-timing-never-reaches-measured-the-l.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-12-execution-lifecycle-completeness-for-timing.md`
**Stories:** `.docs/stories/shipped-record-timing-never-reaches-measured-the-l.md`
**Complexity:** `.docs/complexity/shipped-record-timing-never-reaches-measured-the-l.md`
**Conflict check:** Clean as of 2026-08-12

## Summary

Make the LLM-vs-code timing KPI actually produce numbers, in seventeen short TDD tasks. The
partition arithmetic already works — measured on 2026-08-12, the one live worktree ledger with no
open executions returns a complete `measured` result, and the other five return `partial` solely
because `openExecutions.size > 0`. Two things change: every catchable interrupt emits the terminal
event that carries its execution's real `activeInterval`, and a genuine `partial` records which of
the five degrade routes fired.

The read side is done first (tasks 1-7): the reason plumbing is self-contained, immediately useful
on the ledgers that will stay `partial`, and it makes the emission work in tasks 8-16 diagnosable
while it is being built.

## Technical Approach

- `calculateTimingRollup` returns the degrade route alongside the state. Its five routes
  (`timing-rollup.ts:143-147`, `:157-162`, `:172`) become a discriminated reason; the
  open-executions route carries the execution keys still open, which is the diagnostic the intake
  actually asked for.
- `appendTimingSection` (`shipped-record.ts:217`) renders the reason as one additional line in the
  existing `## Time` block, following
  `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`. `kpi-report`'s `## Time`
  parser reads it by name, so a record without it parses exactly as it does today.
- Emission completeness is built as machinery, not discipline, per this repository's Design
  Principle and the pattern `adr-2026-08-11-halt-events-ride-the-persisted-spine` chose for
  `loop_halt`: one private conductor-owned path emits the terminal for whatever executions are open,
  and each interrupt site calls that one path rather than constructing its own event. A site added
  later cannot omit a field it never supplies.
- The terminal reuses the existing `step_failed` / `parallel_failure` variants where their semantics
  fit, so `EventPersister` stamps `activeInterval` through its existing
  `closesStep` / `closesGroup` branch (`event-persister.ts:83-100`) with no new interval source. If
  a distinct variant is genuinely needed, `EVENT_SINKS` must declare its three sinks —
  compile-enforced by `adr-2026-07-26-event-sink-registry-exhaustiveness`, so this cannot be
  silently skipped.
- Nothing closes an execution reader-side. Decision 2 of
  `adr-2026-08-12-execution-lifecycle-completeness-for-timing` forbids it, because the missing
  terminal is also the missing duration.
- Tests are focused unit and integration tests against the real emitter, persister, rollup, and
  renderer. No third-party calls and no daemon run.

## Prerequisites

- Accepted stories and a clean conflict check are present.
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing` is APPROVED.
- No schema migration, external service, database, port, or fixture installation is required.
- Historical ledgers under `.worktrees/*/.pipeline/events.jsonl` are available as realistic
  read-only fixtures; committed records under `.docs/shipped/` are the backward-compatibility
  corpus.

## Task Dependency Graph

```
T1 ─┬─ T2 ── T3 ── T4 ── T5 ─┬─ T6
    │                        └─ T7
    └─ T15

T8 ── T9 ─┬─ T10 ─┬─ T13 ── T16
          ├─ T11 ─┤
          └─ T12 ─┴─ T14

T6, T7, T15, T16 ── T17
```

T1-T7 and T15 (the read side) are independent of T8-T16 (the emission side); the two halves may
proceed in parallel and meet at T17.

## Tasks

### Task 1: Return the degrade route from the rollup

**Story:** Story 3 — a genuine `partial` names the route that produced it.
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write a failing test asserting `calculateTimingRollup` returns a distinguishable reason for the
   empty-active-union route (`timing-rollup.ts:143-147`).
2. Verify it fails because the returned object carries only `{ state: 'partial' }`.
3. Widen the `TimingRollup` partial variant with an optional reason and return it from that route.
4. Verify the focused test passes and the existing `timing-rollup.test.ts` suite still passes.

### Task 2: Cover the remaining four degrade routes

**Story:** Story 3 — a genuine `partial` names the route that produced it.
**Type:** happy-path
**Dependencies:** T1

**Steps:**
1. Write failing tests for `activeEvidenceIncomplete`, open executions, the
   `providerDurationMs !== providerWithinActiveDurationMs` mismatch, and
   `providerEvidenceIncomplete`, asserting each returns a *different* reason.
2. Verify they fail.
3. Return the specific reason from each route, including the execution keys still open for the
   open-executions case.
4. Verify all five routes are distinguishable and that a `measured` rollup carries no reason.

### Task 3: Render the reason into the `## Time` block

**Story:** Story 3 — a genuine `partial` names the route that produced it.
**Type:** happy-path
**Dependencies:** T2

**Steps:**
1. Write a failing test asserting `appendTimingSection` emits a reason line for a `partial` rollup
   carrying one, on a single parseable line however many executions are open.
2. Verify it fails.
3. Emit the line from `appendTimingSection`, after `state:` and alongside `active_ms` rather than
   replacing it.
4. Verify a `measured` rollup emits no reason line and an `unavailable` block is byte-identical to
   today's output.

### Task 4: Parse the reason back in the KPI timing parser

**Story:** Story 3 — a genuine `partial` names the route that produced it.
**Type:** happy-path
**Dependencies:** T3

**Steps:**
1. Write a failing test asserting `kpi-report`'s `## Time` parser returns the reason from a block
   that carries one.
2. Verify it fails.
3. Read the field by name in the parser, leaving every existing field's handling untouched.
4. Verify a block with no reason still parses to exactly the state it parses to today.

### Task 5: Surface the reason on the KPI feature row

**Story:** Story 3 — a genuine `partial` names the route that produced it.
**Type:** happy-path
**Dependencies:** T4

**Steps:**
1. Write a failing test asserting `formatFeatureTiming` includes the reason on a `partial` row.
2. Verify it fails.
3. Append the reason to the `time=partial` rendering, preserving the existing `active_ms` output.
4. Verify `measured` and `unavailable` rows are unchanged.

### Task 6: Pin backward compatibility for both historical record shapes

**Story:** Story 5 — historical records and the aggregate keep working.
**Type:** negative-path
**Dependencies:** T5

**Steps:**
1. Write failing-or-passing round-trip tests for a committed record carrying a reason-free
   `state: partial` and for a record with no `## Time` block at all, asserting each parses to
   exactly the state it parses to today.
2. Add a malformed/hand-edited `## Time` block case asserting the parser degrades rather than
   throwing.
3. Verify all three pass against the changed parser.
4. Verify a record carrying the new reason field loses none of the fields an older reader knows.

### Task 7: Pin the zero-measured aggregate

**Story:** Story 5 — historical records and the aggregate keep working.
**Type:** negative-path
**Dependencies:** T5

**Steps:**
1. Write a test asserting that an aggregate over records none of which is `measured` reports
   `measured=0` with the `partial` and `unavailable` counts and emits no average.
2. Verify it passes against current behavior — this pins an existing guarantee the intake believed
   was broken, so it must not silently regress.
3. Add a mixed `measured`/`partial` case asserting the averages are computed only over the measured
   records and the reported count matches that number.
4. Verify both pass.

### Task 8: Enumerate the interrupt paths that exit with an execution open

**Story:** Story 2 — a catchable interrupt still closes its execution.
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Find every path in `conductor.ts` that can return or exit after `step_started` /
   `parallel_started` was emitted and before a terminal is emitted — halt, live-boundary abort, and
   graceful shutdown at minimum.
2. For each, record whether it can still run code at that point (catchable) or not (SIGKILL-class).
3. Write the catchable list into the task's commit message as the checklist T10-T12 must satisfy.
4. Confirm the list against the open-execution keys measured on the live ledgers — `step:build`,
   `parallel:wiring_check`, `step:build_review`, `step:architecture_review_as_built` — and note any
   key the enumeration does not explain.

### Task 9: Introduce the single conductor-owned terminal emitter

**Story:** Story 2 — a catchable interrupt still closes its execution.
**Type:** happy-path
**Dependencies:** T8

**Steps:**
1. Write a failing test asserting one private conductor method emits a terminal for each currently
   open execution, carrying the step name, without any caller supplying it.
2. Verify it fails because no such path exists.
3. Add the method, resolving open executions from the conductor's own state and emitting through the
   existing emitter so `EventPersister` stamps `activeInterval` by its existing branch.
4. Verify the emitted terminal reaches the ledger with a non-negative `durationMs` and the
   `startedAtMs` recorded at the matching start.

### Task 10: Close open executions on the halt path

**Story:** Story 2 — a catchable interrupt still closes its execution.
**Type:** happy-path
**Dependencies:** T9

**Steps:**
1. Write a failing integration test driving a real halt with a step open, asserting the ledger's
   starts and terminals balance afterwards.
2. Verify it fails.
3. Call the T9 emitter from the halt path, before the halt marker is written.
4. Verify the balance assertion passes and the existing `loop_halt` behavior is unchanged.

### Task 11: Close open executions on the live-boundary abort path

**Story:** Story 2 — a catchable interrupt still closes its execution.
**Type:** happy-path
**Dependencies:** T9

**Steps:**
1. Write a failing test driving a live-boundary abort with an execution open.
2. Verify it fails.
3. Call the T9 emitter from that path.
4. Verify the ledger balances and the abort's own diagnostic output is unchanged.

### Task 12: Close open executions on graceful shutdown

**Story:** Story 2 — a catchable interrupt still closes its execution.
**Type:** happy-path
**Dependencies:** T9

**Steps:**
1. Write a failing test driving a graceful shutdown with an execution open.
2. Verify it fails.
3. Call the T9 emitter from that path.
4. Verify the ledger balances.

### Task 13: Guard against a second terminal for one start

**Story:** Story 2 — a catchable interrupt still closes its execution.
**Type:** negative-path
**Dependencies:** T10, T11, T12

**Steps:**
1. Write a failing test asserting that an execution which already emitted its terminal normally
   receives no second terminal when the interrupt path subsequently runs.
2. Verify it fails if the emitter is unconditional.
3. Emit only for executions still open at that moment.
4. Verify exactly one terminal per start across a run that both completes steps and then halts.

### Task 14: Guard against an orphan terminal

**Story:** Story 2 — a catchable interrupt still closes its execution.
**Type:** negative-path
**Dependencies:** T10, T11, T12

**Steps:**
1. Write a failing test asserting that an interrupt occurring before any start was emitted produces
   no terminal.
2. Verify it fails if the emitter assumes at least one open execution.
3. Make the emit a no-op on an empty open set.
4. Verify the ledger gains no event in that case.

### Task 15: Pin that the rollup never closes an open execution

**Story:** Story 4 — the rollup never closes an execution the ledger left open.
**Type:** negative-path
**Dependencies:** T1

**Steps:**
1. Write a test asserting a ledger with a stale start and no matching terminal returns `partial`
   naming that execution, and is *not* closed by a later start of the same key.
2. Write a test asserting three starts and two terminals for one key still returns `partial` — the
   count is what matters, not mere presence.
3. Write a test asserting no combination of otherwise-complete provider evidence promotes a ledger
   with a non-empty open set to `measured`.
4. Verify all three pass and that an unparseable ledger line still degrades rather than totalling
   the lines that parsed.

### Task 16: Prove an interrupted-then-resumed feature reaches `measured`

**Story:** Story 1 — an uninterrupted run's record reads `measured`.
**Type:** happy-path
**Dependencies:** T13, T14

**Steps:**
1. Write an integration test that drives a run through the real emitter and persister, interrupts it
   with an execution open, resumes into the same ledger, and completes.
2. Assert the resulting rollup is `measured` with all three values, and that
   `providerActiveMs + noProviderActiveMs === activeMs`.
3. Assert the interrupted execution's active time is included rather than dropped.
4. Verify the rendered `## Time` block carries all three numeric lines and no reason line.

### Task 17: Update the affected reference documentation

**Story:** Story 5 — historical records and the aggregate keep working.
**Type:** happy-path
**Dependencies:** T6, T7, T15, T16

**Steps:**
1. Update `docs/reference/cli.md` (~640-691) where the `## Time` block's fields and `conduct-ts
   kpi`'s row and aggregate output are described, adding the reason field.
2. Update `docs/reference/artifacts.md` (~566-574) where the `## Time` block's contract is
   described, including that a `partial` now names its route.
3. State in both that records shipped before the reason field simply omit the line.
4. Verify no other page documents these fields, and run `test/test_harness_integrity.sh`.
### Task rem-adr-001: src/conductor/src/engine/conductor.ts:1269,1300,3051,3931,3963,5107,6089,6354,6366,6399 — remove closeOpenExecutions() from the generic writeHaltMarker wrapper and invoke it only on genuine run-exit halt, signal, and deferred live-boundary paths, leaving the retryable protected-artifact halt at :6089 to reach its own real terminal; test/engine/conductor.test.ts:382 — add a halt-marker-before-real-terminal regression asserting one start, exactly one interval-bearing terminal, and a measured timing rollup
