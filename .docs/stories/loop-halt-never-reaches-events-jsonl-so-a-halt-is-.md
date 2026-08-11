**Status:** Accepted

# Stories: Halt events reach the persisted spine (#1477)

Technical intent, derived from #1477's desired outcomes and the APPROVED ADR
(`adr-2026-08-11-halt-events-ride-the-persisted-spine`):

- **TI-1** — after a build halts, the halt and its cause are recoverable from
  `.pipeline/events.jsonl` alone, without consulting the audit trail or the daemon log.
- **TI-2** — the recorded halt names the step that actually halted; a halt in a step other
  than `build` is attributed to that step, in both the ledger and the audit record.
- **TI-3** — a rebase-conflict halt is likewise recoverable from the spine.
- **TI-4** — a halt count computed over persisted events reports a non-zero count when halts
  have occurred.
- **TI-5** — when the on-disk halt marker cannot be written, that failure is itself visible
  rather than silent.
- **TI-6** — non-halt event volume does not measurably grow (negative path — must not
  regress).

## Story 1: A halt is reconstructable from the persisted ledger alone

**Requirement:** TI-1

As an operator diagnosing an overnight build that stopped, I want the halt and its reason in
`.pipeline/events.jsonl` so I can answer "why did it stop" from the file the spine
documentation tells me to read.

### Acceptance Criteria

#### Happy Path

- Given a conductor run that halts, when the run ends, then `.pipeline/events.jsonl` contains
  a `loop_halt` record whose `reason` is the halt reason verbatim.
- Given a halt raised in `auto` mode where a needs-remediation PR was opened, when the halt is
  persisted, then the record carries the `prUrl` field alongside the reason.
- Given the sink declaration table, when `persistedEventTypes()` is called, then it includes
  `loop_halt`.

#### Negative Paths

- Given a halt emitted immediately before the process exits, when the process terminates, then
  the `loop_halt` record is already on disk — the write is synchronous and is not lost to an
  unflushed buffer.
- Given a run that halts with no remediation PR (mode is not `auto`, or escalation failed),
  when the halt is persisted, then the record omits `prUrl` entirely rather than recording an
  empty or null URL.
- Given the events ledger cannot be appended to, when a halt is emitted, then the existing
  `EventPersistError` path is taken unchanged and the halt still writes its `.pipeline/HALT`
  marker.

### Done When

- [ ] `EVENT_SINKS.loop_halt.persist` is `true` and a unit test asserts it.
- [ ] An integration test drives a halt through the real emitter and persister and asserts a
      `loop_halt` line with the expected `reason` appears in the ledger file.
- [ ] A test asserts `prUrl` is present when supplied and absent when not.

## Story 2: The halt names the step that actually halted

**Requirement:** TI-2

As an operator, I want the halt record to name the step it happened in so I do not have to
guess from surrounding events or trust an audit record that always says `build`.

### Acceptance Criteria

#### Happy Path

- Given a run that halts while the step loop's last advanced step is `manual_test`, when the
  halt is persisted, then the `loop_halt` record's `step` is `manual_test` — not `build`.
- Given that same halt, when it is translated into an audit record, then the audit record's
  `step` is `manual_test`, matching the ledger.
- Given a halt raised while the last advanced step is `build`, when the halt is recorded, then
  `step` is `build` — the common case is unchanged.

#### Negative Paths

- Given a halt raised outside the step loop, where no breadcrumb step was recorded, when the
  step is resolved, then the existing `resolveLastStep` preference order applies
  (`state.last_step`, then breadcrumb, then furthest `done` step) and the record still carries
  a step rather than throwing or emitting `undefined`.
- Given a `loop_halt` record written before this change and therefore carrying no `step`
  field, when the audit translator reads it, then it falls back to `build` exactly as today —
  an old record is not rejected.
- Given a halt raised after a step settled but before the next dispatched, when the step is
  stamped, then it is the settled step. This is the expected attribution, asserted
  deliberately, not an accident.

### Done When

- [ ] `loop_halt` in the `ConductorEvent` union carries an optional `step`.
- [ ] Every `loop_halt` emission in `conductor.ts` routes through one conductor-owned emit
      path; no `loop_halt` object literal is constructed outside it.
- [ ] A test asserts a non-`build` halt records that step in the ledger AND in the audit
      record.
- [ ] A test asserts a `loop_halt` with no `step` still audits as `build`.

## Story 3: A rebase-conflict halt is recoverable from the spine

**Requirement:** TI-3

As an operator whose feature parked on a rebase conflict, I want that halt in the ledger so a
rebase halt is diagnosed the same way as every other halt.

### Acceptance Criteria

#### Happy Path

- Given a rebase that parks on a non-trivial conflict, when `rebase_conflict_halt` is emitted,
  then a record with its `reason` and its `conflicts` list appears in
  `.pipeline/events.jsonl`.
- Given that record, when its step is read, then it is `rebase`.
- Given the same halt, when the terminal renders the run, then the rebase-conflict halt is
  rendered rather than silently dropped.

#### Negative Paths

- Given a rebase conflict with an empty conflicts list, when the halt is persisted, then the
  record still appears with its reason and an empty `conflicts` array — an empty list does not
  suppress the record.
- Given a rebase that completes cleanly, when the run finishes, then no `rebase_conflict_halt`
  record is written.

### Done When

- [ ] `EVENT_SINKS.rebase_conflict_halt` declares `render: true, persist: true`.
- [ ] A test asserts the persisted record carries `reason`, `conflicts` and `step: 'rebase'`.
- [ ] A test asserts a clean rebase writes no such record.

## Story 4: Halt counters over persisted events report real counts

**Requirement:** TI-4

As an operator reading a cost rollup or an engineer signal report, I want the halt count to be
the number of halts that happened, so a permanent zero does not read as "no halts occurred".

### Acceptance Criteria

#### Happy Path

- Given a ledger containing two `loop_halt` records, when `computeCostRollup` runs over that
  worktree, then `rollup.halts` is 2.
- Given a ledger containing one `loop_halt` record, when `aggregateHalts` parses it, then it
  returns one `HaltEntry` carrying that reason.
- Given signals assembled from a run with halts, when `computeSignalRates` runs, then
  `haltRate` is non-zero.

#### Negative Paths

- Given a ledger with no `loop_halt` records, when the rollup runs, then `rollup.halts` is 0
  and no other counter is disturbed.
- Given a `loop_halt` record whose `reason` is missing or not a string, when `aggregateHalts`
  parses it, then it yields the existing `'unknown'` reason rather than throwing.
- Given a ledger containing a malformed line, when the rollup runs, then the existing
  malformed-line handling is unchanged and halts from well-formed lines are still counted.

### Done When

- [ ] A test drives a real halt into a ledger and asserts `rollup.halts` is non-zero — the
      branch at `cost-rollup.ts:174` executes for the first time.
- [ ] A test asserts `aggregateHalts` returns entries from a ledger containing halts, and that
      the resulting `haltRate` is non-zero.
- [ ] Any pre-existing test asserting a zero halt count after a halt is corrected, with a note
      that the zero was the defect.

## Story 5: A failed halt-marker write is visible

**Requirement:** TI-5

As an operator, I want to know when `.pipeline/HALT` could not be written, because a halt that
failed to park is worse than a halt that did.

### Acceptance Criteria

#### Happy Path

- Given a halt-marker write that fails, when `writeHaltMarker` returns, then it reports the
  failure in its result rather than returning silently.
- Given the same failure with an emitter available, when the failure is reported, then a
  `halt_marker_write_failed` record naming the marker path and the failure reason appears in
  `.pipeline/events.jsonl`.
- Given a halt-marker write that succeeds, when `writeHaltMarker` returns, then it reports
  success and emits no failure event.

#### Negative Paths

- Given a halt-marker write that fails, when the failure is handled, then `writeHaltMarker`
  still does not throw — a failed marker write must not crash the finish flow.
- Given a call site with no emitter available, when the write fails, then the returned result
  still reports the failure, so no call site regresses to today's silence.
- Given the failure event itself cannot be emitted or persisted, when the write fails, then
  the returned result is still the failure — a failed emit does not restore the swallow.
- Given `.pipeline/HALT.class` fails to write while `.pipeline/HALT` succeeds, when the result
  is returned, then the partial failure is reported rather than counted as success.

### Done When

- [ ] `writeHaltMarker` returns a result type instead of `void` and never throws.
- [ ] `halt_marker_write_failed` is a member of the `ConductorEvent` union with a sink
      declaration and a terminal renderer case.
- [ ] All six `writeHaltMarker` call sites compile against the new contract and none discards
      a failure silently.
- [ ] A test asserts the failure event is emitted, and a test asserts the no-emitter call site
      still reports failure via the result.

## Story 6: Non-halt event volume is unchanged

**Requirement:** TI-6

As an operator, I want this fix not to turn the ledger into a firehose, so the spine stays
readable.

### Acceptance Criteria

#### Happy Path

- Given the sink declaration table, when the persisted type set is compared against its
  pre-change value, then the only additions are `loop_halt`, `rebase_conflict_halt` and
  `halt_marker_write_failed`.
- Given a run that does not halt, when it completes, then its ledger contains no
  halt-class records and its line count is unchanged from before this feature.

#### Negative Paths

- Given `loop_converged`, `build_review_base`, `pipeline_closeout`, `retry_decision`,
  `group_member_step`, `test_suite_verification` and the rebase-lifecycle events, when the
  sink table is read, then each still declares `persist: false`.
- Given a future edit that flips an unrelated event to `persist: true`, when the suite runs,
  then the pinning test fails — the constraint is machine-enforced, not asserted in prose.

### Done When

- [ ] A test pins the exact persisted-type set so any unintended addition fails the suite.
- [ ] A test asserts a non-halting run's ledger contains no halt-class records.

## Story 7: The documented limitation is corrected

**Requirement:** TI-1

As a reader of the runbooks, I want the docs to describe the fixed behavior, because two pages
currently document this defect as a permanent known limitation and would send an operator down
the wrong diagnosis path.

### Acceptance Criteria

#### Happy Path

- Given `docs/runbooks/stalled-or-stuck-feature.md`, when its `--report` known-limitation note
  is read, then it no longer claims `loop_halt` never reaches `events.jsonl`.
- Given `docs/reference/artifacts.md`, when its `.pipeline/events.jsonl` section is read, then
  its event-coverage note reflects that halt-class events now persist.

#### Negative Paths

- Given the runbook's surviving guidance, when an operator follows it, then the
  `.pipeline/HALT` marker is still documented as the park signal — the marker is not
  described as replaced by the event.

### Done When

- [ ] `docs/runbooks/stalled-or-stuck-feature.md` no longer states that halts never reach the
      ledger.
- [ ] `docs/reference/artifacts.md`'s events-ledger section is accurate for the new sink set.
