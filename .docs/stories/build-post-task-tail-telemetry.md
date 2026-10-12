**Status:** Accepted

# Stories: BUILD post-task tail telemetry

**Source:** intake jstoup111/ai-conductor#1176
**Track:** technical (no PRD — these stories are the acceptance-criteria artifact)
**Tier:** M
**Authoritative design:** `.docs/decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md` D2 and `.docs/decisions/adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry.md` (APPROVED)

Because there is no PRD, each story cites the intake **outcome** it serves and the **ADR
decision** that governs it, so the coherence mapping has a chain to follow:

| Id | Intake outcome |
|---|---|
| **O1** | Post-task BUILD latency is measured separately from task execution latency |
| **O4** | Required quality contracts remain satisfied with explicit durable evidence |
| **O6** | Negative path: missing, stale, or failed evidence still blocks progression |

Intake outcome "p95 post-task tail reduced ≥50%" is deliberately **absent**: the metric as
written conflates kickback remediation with closeout ceremony (measured: ~197 of 202 tail-minutes
are real rework), so it is re-targeted as an ADR follow-up rather than specified here.

---

## Story 1: Build progress ticks declare why they fired

**Requirement:** O1 — piece 1 (tick provenance)

As an operator analysing a build after the fact, I want every `build_progress` event to say why
it fired and whether HEAD moved, so that I can tell "the session committed nothing" from "this
was only a heartbeat" without reading prose summaries.

### Acceptance Criteria

#### Happy Path
- Given a running `build` step where the resolved task count changes between polls, when the watcher emits `build_progress`, then the event carries `tickReason: 'task-delta'` and an explicit `headMoved` boolean.
- Given a running `build` step where the task counts are unchanged but git HEAD advanced, when the watcher emits `build_progress`, then the event carries `tickReason: 'head-moved'`, `headMoved: true`, and the existing `commitCount`.
- Given a running `build` step with no observed change for the configured heartbeat period, when the watcher emits its heartbeat `build_progress`, then the event carries `tickReason: 'heartbeat'` and `headMoved: false`.
- Given any emitted `build_progress`, when it is persisted to `.pipeline/events.jsonl`, then `tickReason` and `headMoved` are present on the persisted record.

#### Negative Paths
- Given the git HEAD probe throws or exits non-zero, when the watcher completes that tick, then the event still emits with `headMoved: false` and the tick is not aborted — matching the existing degrade-in-place behaviour rather than skipping the tick.
- Given a heartbeat tick, when a consumer reads the event, then `headMoved: false` is present as an explicit value and is distinguishable from an absent `commitCount` — the ambiguity that today makes an absent `commitCount` unreadable.
- Given an existing `build_progress` consumer (`daemon-cli.ts`, `ui/create-renderer.ts`, `ui/subscriber.ts`, `otel/otel-visualizer.ts`, `event-sinks.ts`, `daemon.ts`), when it receives an event carrying the two new fields, then it renders exactly as it did before — the fields are additive and optional.
- Given a ledger written before this change (no `tickReason`), when it is read by any consumer or rollup, then the absence is tolerated and reported as unknown provenance, never defaulted to `'heartbeat'`.

### Done When
- [ ] `build_progress` in `src/conductor/src/types/events.ts` declares an optional `tickReason` whose values are `'task-delta'`, `'head-moved'`, and `'heartbeat'`, and an optional `headMoved` boolean
- [ ] A test asserts all three `tickReason` values are produced by the corresponding watcher conditions
- [ ] A test asserts a failed HEAD probe still emits with `headMoved: false` and does not abort the tick
- [ ] `git diff` on `build-progress-watcher.ts` shows only additive changes inside `tick()` — no restructuring (review Condition 4)

---

## Story 2: External events are written to the pipeline-owned sibling ledger without a conductor

**Requirement:** O1, O4 — piece 2 (ADR D2)

As the harness, I want each operator-recorded external event to be written as a real
`ConductorEvent` to the pipeline-owned sibling ledger by the recording command's own process, so that
the record exists even when no conductor is driving the feature.

### Acceptance Criteria

#### Happy Path
- Given `ai-conductor build-review accept` records an accepted finding, when it completes, then one `build_review_disposition_accepted` `ConductorEvent` is appended as one JSON line to `.pipeline/pipeline-events.jsonl` carrying a `ts`.
- Given `ai-conductor kickback-budget raise` authorizes an adjustment, when it completes, then one `kickback_budget_adjustment_authorized` `ConductorEvent` is appended as one JSON line to `.pipeline/pipeline-events.jsonl`.
- Given either command runs with no conductor process running, when it completes, then the event is written successfully — no engine, daemon, bus connection, or IPC channel is required.
- Given each sibling-ledger event kind, when it is declared, then it is a member of the existing `ConductorEvent` union in `types/events.ts` and of the `ExternalPipelineEvent` admitted set — the same schema as every other event, not a bespoke record shape.

#### Negative Paths
- Given the sibling-ledger writer runs, when it writes, then it writes **only** to `.pipeline/pipeline-events.jsonl` and never to `.pipeline/events.jsonl` — a test asserts the engine ledger is byte-identical before and after (review Condition 2; `parseLedger` fails closed on one malformed line, so a cross-process interleaved append would degrade every rollup over the engine ledger).
- Given `.pipeline/` does not yet exist, when the sibling-ledger writer runs, then it creates the directory and writes, rather than failing.
- Given `ai-conductor` is invoked with a closeout-recording subcommand naming any obligation, when it dispatches, then it exits non-zero with an unknown-command error and writes nothing to either ledger.
- Given the sibling ledger already contains lines from an earlier build window, when the writer runs again, then it appends — it never truncates or rewrites prior lines.

### Done When
- [ ] Every event kind written to `.pipeline/pipeline-events.jsonl` is a member of the `ExternalPipelineEvent` union drawn from `src/conductor/src/types/events.ts`, and that union contains no closeout obligation kind
- [ ] A test asserts `.pipeline/events.jsonl` is unmodified by the sibling-ledger writer
- [ ] A test asserts the writer succeeds with no conductor/daemon running
- [ ] `docs/reference/cli.md` documents no closeout-recording subcommand

---

## Story 3: Admitted external events reach the live bus and its existing consumers

**Requirement:** O1 — piece 2 (ADR D2)

As an operator watching a running build, I want admitted external events from the sibling ledger to
appear on the live bus as they happen, so that the sibling ledger is not a second telemetry channel
visible only in a post-hoc report.

### Acceptance Criteria

#### Happy Path
- Given a `build` step is running under the conductor, when an admitted external event is appended to the sibling ledger, then the engine's tail re-emits that event onto the live bus.
- Given the event is re-emitted, when the existing subscribers receive it, then each handles it through its normal event path.
- Given the `build` step settles, when the step's promise resolves or rejects, then the tail is stopped in a `finally`, mirroring the `BuildProgressWatcher` lifecycle.
- Given the tail's interval, when it is created, then it is `.unref()`'d so it never holds the process open.

#### Negative Paths
- Given the sibling ledger does not exist (no external event has been written yet), when the tail polls, then it treats this as "no data, poll again" and does not throw or emit a spurious event.
- Given the sibling ledger contains a truncated or malformed final line (a write in flight), when the tail polls, then it skips that line without re-emitting it and picks it up once complete — it never re-emits a partial record onto the bus.
- Given the sibling ledger contains a well-formed leftover `pipeline_closeout` line, when the tail polls, then it emits one `pipeline_tail_diagnostic` with reason `unadmitted-type`, the ledger path, and the line's byte offset, re-emits nothing for that line, and keeps polling.
- Given the tail has already re-emitted a line, when it polls again, then it does not re-emit that line a second time.
- Given the `build` step throws, when the step unwinds, then the tail is still stopped — a test asserts no interval survives a failed step.
- Given a `build` step runs with the tail disabled or unavailable, when the step completes, then the external events are still durably present in the sibling ledger for report readers — live re-emission is a convenience, never the system of record.

### Done When
- [ ] The tail is started and stopped inside the same dispatch scope as `BuildProgressWatcher`, with an `.unref()`'d interval and a `finally` stop
- [ ] A test asserts an admitted external event written to the sibling ledger is observed by a bus subscriber
- [ ] A test asserts a well-formed record of an unadmitted type yields one `unadmitted-type` diagnostic and no re-emission
- [ ] A test asserts a partial trailing line is not re-emitted, then is re-emitted once complete
- [ ] A test asserts no duplicate re-emission across successive polls
- [ ] A test asserts the tail is stopped when the build step rejects

---

## Story 4: A batch boundary waits on no recorded closeout event

**Requirement:** O4, O6 — piece 2 (ADR D2)

As the harness, I want the `/pipeline` batch boundary to block only on checks that still run, so that
progression never depends on a telemetry record no skill produces.

### Acceptance Criteria

#### Happy Path
- Given a batch whose `/simplify`, linter, and `BATCH_AFFECTED_TESTS` checks are satisfied, when the batch-boundary gate runs, then the gate passes and the next batch proceeds with no closeout record in `.pipeline/pipeline-events.jsonl`.

#### Negative Paths
- Given a batch whose `BATCH_AFFECTED_TESTS` result set contains a failing test that is not an expected RED test, when the batch-boundary gate runs, then it still blocks the pipeline until the failure is fixed.
- Given a batch boundary with no batch review artifact under `.pipeline/audit-trail/` and no closeout record, when the gate runs, then it does not treat either absence as a blocker and issues no `Batch N blocked` message for it.
- Given a build in flight whose session still follows older `/pipeline` text and invokes a closeout-recording subcommand, when the CLI rejects it with an unknown-command error, then the existing halt and re-dispatch path reloads the current skill text.

### Done When
- [ ] `skills/pipeline/SKILL.md`'s batch-boundary gate requires no recorded closeout event and no batch review artifact stat-check
- [ ] A test asserts the gate still blocks on a failing non-RED affected test
- [ ] The harness integrity suite's batch-boundary contract check passes with no closeout-gate clause

---

## Story 5: A build window decomposes into task execution and post-resolution ticks

**Requirement:** O1 — piece 3 (ADR D4)

As an operator deciding whether a latency fix is worth building, I want each `build` window
broken into its classification, task execution, and classified post-resolution ticks, so that a
proposed optimisation can be judged against measured time rather than intuition.

### Acceptance Criteria

#### Happy Path
- Given a ledger containing a complete `build` window, when `computeBuildTailRollup` runs, then it returns `{ state: 'measured' }` whose window carries its classification, task-execution segment, and post-resolution ticks and no closeout segment.
- Given a window whose first observed tick reads `resolved < total`, when the rollup classifies it, then it is a **first-pass** window and the task-execution segment ends at the first `resolved == total` tick.
- Given a window whose **first** observed tick already reads `resolved == total`, when the rollup classifies it, then it is a **re-entry** window — not a first-pass window with a zero-length task-execution segment. (19 of 24 measured windows are re-entries; conflating the two is what makes the naive "time after tasks resolve" metric wrong.)
- Given ticks after full resolution that carry `headMoved: true`, when the rollup classifies them, then they are labelled **remediation**, and ticks with `headMoved: false` are labelled `closeout`.
- Given both ledgers are present, when the rollup reads them, then it merges the engine and pipeline ledgers by `ts` into one ordered view.

#### Negative Paths
- Given either ledger contains a malformed line, when the rollup runs, then it returns `{ state: 'partial' }` — it does not throw, and it does not silently drop the affected window.
- Given a `build` window with **zero** `build_progress` ticks (observed in 4 of 28 real windows), when the rollup processes it, then the window is reported with an explicit unknown/partial decomposition rather than crashing or being omitted without trace.
- Given a merged ledger containing leftover `pipeline_closeout` records, when the rollup runs, then those records are ignored and change no window's state or segments.
- Given a `build` window that was started but never terminated (no `step_completed` / `step_failed`), when the rollup runs, then that window is `partial` and does not corrupt the totals of neighbouring windows.
- Given no completed `build` window exists in the merged ledger, including one that holds only leftover closeout records, when the rollup runs, then it returns `{ state: 'unavailable' }` rather than an empty `measured` or a closeout-only `partial` result.

### Done When
- [ ] `computeBuildTailRollup` returns a union discriminated by `state` over `measured`, `partial`, and `unavailable`, matching `timing-rollup.ts`
- [ ] A test asserts first-pass vs re-entry classification from the first observed tick
- [ ] A test asserts a malformed line yields `partial`, not a throw
- [ ] A test asserts a ledger with leftover closeout records and no completed build window yields `unavailable`
- [ ] A test asserts a zero-tick window is represented rather than dropped
- [ ] A test asserts a window needs no closeout segment to be `measured`

---

## Story 6: The rollup is runnable and its output is committed as a baseline

**Requirement:** O1 — pieces 3 and 4

As an operator, I want to run the decomposition over the existing corpus and commit the result,
so that any future latency claim has a fixed reference point to be measured against.

### Acceptance Criteria

#### Happy Path
- Given a worktree with a ledger, when the operator runs the `conduct-ts build-tail` reporting subcommand, then it prints the per-window decomposition and the aggregate distribution with no closeout duration line.
- Given the subcommand is run across the existing corpus, when it completes, then its output is committed as a baseline document that states its own coverage explicitly — how many ledgers were measured, partial, and unavailable.
- Given the baseline is read later, when a reader inspects it, then it is unambiguous which windows are measured and that post-resolution `remediation` and `closeout` tick counts are tick labels, not durations.

#### Negative Paths
- Given a path with no ledger, when the subcommand runs, then it reports `unavailable` and exits cleanly with a clear message — it does not throw a stack trace.
- Given a ledger the rollup grades `partial`, when the subcommand renders it, then the partial state is shown explicitly and is not presented as a complete measurement.
- Given the corpus contains leftover closeout records, when the subcommand renders it, then no closeout duration or obligation appears in the output.
- Given the subcommand is run twice on an unchanged ledger, when the outputs are compared, then they are identical — the computation is deterministic and contains no wall-clock-dependent field.

### Done When
- [ ] A `conduct-ts` reporting subcommand renders the rollup, registered in the CLI command table
- [ ] `docs/reference/cli.md` documents the subcommand
- [ ] A committed baseline document exists, stating window count and partial and unavailable coverage
- [ ] A test asserts a missing ledger yields a clean `unavailable` result, not a throw
- [ ] A test asserts two runs over the same ledger produce identical output
