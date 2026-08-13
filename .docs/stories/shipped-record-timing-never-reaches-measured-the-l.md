**Status:** Accepted

# Stories: Shipped-record timing reaches `measured`, or says why not (#1260)

Technical intent, derived from #1260's desired outcomes and the APPROVED ADR
(`adr-2026-08-12-execution-lifecycle-completeness-for-timing`):

- **TI-1** — a feature that ships through an uninterrupted daemon run produces a shipped record
  whose `## Time` block reads `measured`, with `active_ms`, `provider_active_ms`, and
  `no_provider_active_ms` all present and summing exactly.
- **TI-2** — an execution interrupted on a path that can still run code closes on the ledger,
  carrying the real active interval the persister holds, so its time is not lost to the feature's
  rollup.
- **TI-3** — when timing genuinely cannot be measured, the committed record names which evidence
  was missing or inconsistent, so a reader can tell the five degrade routes apart without re-running
  the build.
- **TI-4** — a run with genuinely incomplete evidence degrades rather than reporting a fabricated
  `measured` total (negative path — the rollup never closes an execution the ledger left open).
- **TI-5** — records already committed, in either historical shape, keep parsing exactly as they do
  today, and the aggregate KPI keeps reporting its sample counts without computing an average over
  zero samples (negative path — must not regress).

Baseline measured on 2026-08-12 by running the shipped `computeTimingRollup` against all six live
worktree ledgers: five returned `partial`, every one via `openExecutions.size > 0`; the sixth, the
only one with no open executions, returned a complete `measured` result
(`active_ms` 484268 = `provider_active_ms` 467554 + `no_provider_active_ms` 16714). The partition
arithmetic is correct today and is not what these stories change.

## Story 1: An uninterrupted run's record reads `measured`

**Requirement:** TI-1

As an operator asking how much of a build was LLM time versus local execution, I want a shipped
record that carries the numbers, so the question is answerable from the committed artifact instead
of being permanently blank.

### Acceptance Criteria

#### Happy Path

- Given a feature ledger in which every `step_started` and `parallel_started` has a matching
  terminal event, when `computeTimingRollup` runs over it, then it returns `state: 'measured'` with
  `activeMs`, `providerActiveMs`, and `noProviderActiveMs` all defined.
- Given that rollup, when the shipped record is written, then its `## Time` block carries
  `state: measured`, `active_ms`, `provider_active_ms`, and `no_provider_active_ms` lines.
- Given that committed record, when `conduct-ts kpi` parses it, then the row reports
  `time=measured` and `provider_active_ms + no_provider_active_ms` equals `active_ms` exactly.

#### Negative Paths

- Given a ledger whose executions all close but whose provider evidence is incomplete, when the
  rollup runs, then it returns `partial` carrying `activeMs` — a complete execution lifecycle alone
  does not promote a record to `measured`.
- Given a ledger with no timing evidence at all, when the rollup runs, then it returns
  `unavailable`, not `measured` with zeros.

### Done When

- [ ] A test builds a ledger with balanced starts and terminals and asserts a `measured` rollup with
      all three values.
- [ ] A test asserts the rendered `## Time` block for that rollup carries all three numeric lines.
- [ ] A round-trip test asserts `kpi-report`'s parser reads back the exact values that
      `appendTimingSection` wrote.

## Story 2: A catchable interrupt still closes its execution

**Requirement:** TI-2

As the engine, when a run is halted or aborted on a path where I can still run code, I want to emit
the execution's terminal event, so the active time it really consumed is recorded rather than
discarded — the terminal event is the sole carrier of `activeInterval`.

### Acceptance Criteria

#### Happy Path

- Given a step that has emitted `step_started`, when the run halts before the step completes
  normally, then a terminal event for that step is appended to `.pipeline/events.jsonl`.
- Given that terminal event, when it is persisted, then it carries an `activeInterval` whose
  `startedAtMs` is the value the persister recorded at `step_started` and whose `durationMs` is
  non-negative.
- Given a ledger containing that interrupt terminal, when the rollup pairs starts against terminals,
  then the interrupted execution is not in `openExecutions`.
- Given a `parallel_started` group interrupted the same way, when the run halts, then its terminal
  is emitted through the same path and closes the group key.

#### Negative Paths

- Given an execution that already emitted its terminal normally, when the interrupt path runs, then
  no second terminal is emitted for that key — exactly one terminal per start.
- Given an interrupt that occurs before any `step_started` was emitted, when the interrupt path
  runs, then it emits no orphan terminal for a step that never opened.
- Given a process killed without the chance to run code, when the ledger is later read, then its
  start remains open — no interval is synthesized for it (see Story 4).

### Done When

- [ ] Every catchable interrupt path that can exit with an execution open is enumerated and emits
      its terminal.
- [ ] Emission is routed through a single conductor-owned path, so no call site is free to omit it,
      and a test asserts that shape rather than relying on prose discipline.
- [ ] An integration test drives a real interrupt through the real emitter and persister and asserts
      the ledger's starts and terminals balance.

## Story 3: A genuine `partial` names the route that produced it

**Requirement:** TI-3

As an operator reading a shipped record months later, I want the record to say which evidence was
missing, so I can diagnose it without the `.pipeline/` state — which is gitignored, dies with the
worktree, and is not backfillable.

### Acceptance Criteria

#### Happy Path

- Given a rollup that degrades because executions are still open, when the record is written, then
  its `## Time` block names that route and lists the execution keys still open.
- Given a rollup that degrades for each of the other four routes — empty active union, incomplete
  active evidence, provider intervals falling outside the active union, incomplete provider
  evidence — when the record is written, then the block names that specific route, distinguishably
  from the other four.
- Given a `partial` that carries `active_ms`, when the record is written, then the reason appears
  alongside `active_ms` rather than replacing it.

#### Negative Paths

- Given a `measured` rollup, when the record is written, then no reason line is emitted — the field
  qualifies a degrade and is absent when nothing degraded.
- Given an `unavailable` rollup, when the record is written, then the block is unchanged from
  today's `state: unavailable` output.
- Given a record whose reason names open executions, when the reason is rendered, then it stays on
  a single parseable line regardless of how many executions are open.

### Done When

- [ ] `calculateTimingRollup` returns which of its five conditions fired, distinguishably.
- [ ] A test covers all five routes and asserts each renders a different, recognizable reason.
- [ ] `kpi-report` reads the reason back and surfaces it on the row for a `partial` record.

## Story 4: The rollup never closes an execution the ledger left open

**Requirement:** TI-4

As an operator trusting the KPI, I want a run with unrecoverable evidence to stay `partial`, so a
figure labelled `measured` is never a total that silently undercounts.

### Acceptance Criteria

#### Happy Path

- Given a ledger with a stale `step_started` from an earlier dispatch and no matching terminal, when
  the rollup runs, then it returns `partial` naming that open execution — it does not treat a later
  start of the same key as closing the earlier one.
- Given a ledger where the same execution key was started three times and closed twice, when the
  rollup runs, then it returns `partial` — the count, not merely the presence, of open executions is
  what matters.

#### Negative Paths

- Given any ledger with a non-empty `openExecutions` set, when the rollup runs, then it never
  returns `measured` under any combination of otherwise-complete provider evidence.
- Given a ledger whose only defect is an open execution, when the rollup runs, then it does not
  report a `measured` total computed from the closed executions alone.
- Given an unparseable line anywhere in the ledger, when the rollup runs, then it degrades rather
  than computing a total over the lines that did parse.

### Done When

- [ ] A test asserts that a ledger with an open execution returns `partial` even when every other
      evidence signal is complete.
- [ ] A test asserts that repeated starts of one key are counted, not collapsed.
- [ ] No code path closes an execution by inference from a later start.

## Story 5: Historical records and the aggregate keep working

**Requirement:** TI-5

As a reader of the existing 110 shipped records, I want the change to be additive, so records
already committed do not start parsing differently and the aggregate does not begin reporting a
figure it has no samples for.

### Acceptance Criteria

#### Happy Path

- Given a committed record carrying a reason-free `state: partial`, when the current parser reads
  it, then it yields exactly the state it yields today, with the reason simply absent.
- Given a committed record with no `## Time` block at all, when the parser reads it, then it yields
  `unavailable`, unchanged.
- Given a set of records in which none is `measured`, when `conduct-ts kpi` aggregates them, then it
  reports `measured=0` with the `partial` and `unavailable` counts and computes no average.

#### Negative Paths

- Given a mixed set of `measured` and `partial` records, when the aggregate runs, then the averages
  are computed only over the `measured` ones and the reported sample count matches that number.
- Given a hand-edited or malformed `## Time` block, when the parser reads it, then it degrades to a
  recognized state rather than throwing.
- Given the new reason field on a record, when an older reader that does not know the field parses
  it, then the fields it does know are unaffected.

### Done When

- [ ] Round-trip tests cover both historical record shapes against the current parser.
- [ ] A regression test pins that a zero-measured aggregate reports its counts and emits no average
      line.
- [ ] `docs/reference/cli.md` and `docs/reference/artifacts.md` describe the reason field and the
      `## Time` block's current contract.
