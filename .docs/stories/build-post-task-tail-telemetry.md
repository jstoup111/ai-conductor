**Status:** Accepted

# Stories: BUILD post-task tail telemetry

**Source:** intake jstoup111/ai-conductor#1176
**Track:** technical (no PRD — these stories are the acceptance-criteria artifact)
**Tier:** M
**Authoritative design:** `.docs/decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md` (APPROVED)

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
- [ ] `build_progress` in `src/conductor/src/types/events.ts` declares `tickReason?: 'task-delta' | 'head-moved' | 'heartbeat'` and `headMoved?: boolean`
- [ ] A test asserts all three `tickReason` values are produced by the corresponding watcher conditions
- [ ] A test asserts a failed HEAD probe still emits with `headMoved: false` and does not abort the tick
- [ ] `git diff` on `build-progress-watcher.ts` shows only additive changes inside `tick()` — no restructuring (review Condition 4)

---

## Story 2: Closeout obligations emit events from the pipeline's own process

**Requirement:** O1, O4 — piece 2 (ADR D1, D2)

As the harness, I want each closeout obligation to record its completion as a real
`ConductorEvent` written by the pipeline's own process, so that the closeout timeline exists
even when `pipeline` runs inline with no conductor driving it.

### Acceptance Criteria

#### Happy Path
- Given a closeout obligation has completed, when the pipeline invokes the new `conduct-ts` closeout primitive naming that obligation, then a closeout `ConductorEvent` is appended as one JSON line to `.pipeline/pipeline-events.jsonl` carrying the obligation name, its start and end, and a `ts`.
- Given the primitive is invoked with no conductor process running, when it completes, then the event is written successfully — no engine, daemon, bus connection, or IPC channel is required.
- Given several obligations complete in sequence, when each invokes the primitive, then the sibling ledger contains one line per obligation in completion order.
- Given the closeout event kind, when it is declared, then it is a member of the existing `ConductorEvent` union in `types/events.ts` — the same schema as every other event, not a bespoke record shape.

#### Negative Paths
- Given the primitive is invoked, when it writes, then it writes **only** to `.pipeline/pipeline-events.jsonl` and never to `.pipeline/events.jsonl` — a test asserts the engine ledger is byte-identical before and after (review Condition 2; `parseLedger` fails closed on one malformed line, so a cross-process interleaved append would degrade every rollup over the engine ledger).
- Given `.pipeline/` does not yet exist, when the primitive is invoked, then it creates the directory and writes, rather than failing.
- Given the primitive is invoked with an unrecognised or empty obligation name, when it runs, then it exits non-zero with a message naming the accepted obligations and writes nothing.
- Given the sibling ledger already contains lines from an earlier build window, when the primitive is invoked again, then it appends — it never truncates or rewrites prior lines.
- Given two obligations complete near-simultaneously in the same pipeline process, when both invoke the primitive, then each event lands as its own complete, parseable line.

### Done When
- [ ] A closeout event kind is a member of the `ConductorEvent` union in `src/conductor/src/types/events.ts`
- [ ] A new `conduct-ts` subcommand appends that event to `.pipeline/pipeline-events.jsonl`
- [ ] A test asserts `.pipeline/events.jsonl` is unmodified by the primitive
- [ ] A test asserts the primitive succeeds with no conductor/daemon running
- [ ] A test asserts an unknown obligation name exits non-zero and writes nothing
- [ ] `docs/reference/cli.md` documents the new subcommand

---

## Story 3: Closeout events reach the live bus and its existing consumers

**Requirement:** O1 — piece 2 (ADR D1)

As an operator watching a running build, I want closeout obligations to appear in the daemon log
and other live consumers as they happen, so that closeout is not a second telemetry channel
visible only in a post-hoc report.

### Acceptance Criteria

#### Happy Path
- Given a `build` step is running under the conductor, when the pipeline appends a closeout event to the sibling ledger, then the engine's tail re-emits that event onto the live bus.
- Given the event is re-emitted, when the existing subscribers receive it, then `daemon-cli.ts`, the UI renderers, and `otel/otel-visualizer.ts` each handle it through their normal event path.
- Given the `build` step settles, when the step's promise resolves or rejects, then the tail is stopped in a `finally`, mirroring the `BuildProgressWatcher` lifecycle.
- Given the tail's interval, when it is created, then it is `.unref()`'d so it never holds the process open.

#### Negative Paths
- Given the sibling ledger does not exist (no closeout has run yet), when the tail polls, then it treats this as "no data, poll again" and does not throw or emit a spurious event.
- Given the sibling ledger contains a truncated or malformed final line (a write in flight), when the tail polls, then it skips that line without re-emitting it and picks it up once complete — it never re-emits a partial record onto the bus.
- Given the tail has already re-emitted a line, when it polls again, then it does not re-emit that line a second time.
- Given the `build` step throws, when the step unwinds, then the tail is still stopped — a test asserts no interval survives a failed step.
- Given a `build` step runs with the tail disabled or unavailable, when the step completes, then the closeout events are still durably present in the sibling ledger for the rollup to read — live re-emission is a convenience, never the system of record.

### Done When
- [ ] The tail is started and stopped inside the same dispatch scope as `BuildProgressWatcher`, with an `.unref()`'d interval and a `finally` stop
- [ ] A test asserts a closeout event written to the sibling ledger is observed by a bus subscriber
- [ ] A test asserts a partial trailing line is not re-emitted, then is re-emitted once complete
- [ ] A test asserts no duplicate re-emission across successive polls
- [ ] A test asserts the tail is stopped when the build step rejects

---

## Story 4: A missing closeout event blocks the batch boundary

**Requirement:** O4, O6 — piece 2 (ADR D3)

As the harness, I want a completed closeout obligation with no recorded event to fail the batch
boundary, so that telemetry cannot silently degrade through a forgotten emission.

### Acceptance Criteria

#### Happy Path
- Given an obligation completed and its event was recorded, when the batch-boundary gate runs, then the gate passes and the next batch proceeds.
- Given the gate's existing non-emptiness stat-check on `review.json` passes, when the new event check also passes, then both conditions are satisfied and the boundary clears.

#### Negative Paths
- Given an obligation completed but no corresponding event was recorded, when the batch-boundary gate runs, then the gate **BLOCKS** the pipeline with a message naming the obligation — the same fail-closed treatment an empty `review.json` receives today.
- Given `review.json` is missing or empty, when the gate runs, then it still blocks for that existing reason — the new check is additive and does not weaken or replace the existing one.
- Given the sibling ledger exists but contains only events for other obligations, when the gate runs for this obligation, then it blocks — presence of *an* event is not presence of *this* obligation's event.
- Given a build in flight that started before this feature shipped, when it reaches a batch boundary, then it is not retroactively blocked by a gate for an event the running session had no way to emit (review Condition 1 — the emitter ships before the gate).

### Done When
- [ ] `skills/pipeline/SKILL.md`'s batch-boundary gate requires the recorded closeout event alongside the existing `review.json` stat-check
- [ ] A test asserts the gate blocks when the obligation's event is absent, naming the obligation
- [ ] A test asserts the gate still blocks on an empty `review.json` independently
- [ ] The plan sequences the Story 2 emitter strictly before this gate change

---

## Story 5: A build window decomposes into task, remediation, and closeout time

**Requirement:** O1 — piece 3 (ADR D4)

As an operator deciding whether a latency fix is worth building, I want each `build` window
broken into task execution, kickback remediation, and closeout, so that a proposed optimisation
can be judged against measured time rather than intuition.

### Acceptance Criteria

#### Happy Path
- Given a ledger containing a complete `build` window, when `computeBuildTailRollup` runs, then it returns `{ state: 'measured' }` carrying the task-execution, remediation, and closeout segments plus per-obligation durations.
- Given a window whose first observed tick reads `resolved < total`, when the rollup classifies it, then it is a **first-pass** window and the task-execution segment ends at the first `resolved == total` tick.
- Given a window whose **first** observed tick already reads `resolved == total`, when the rollup classifies it, then it is a **re-entry** window — not a first-pass window with a zero-length task-execution segment. (19 of 24 measured windows are re-entries; conflating the two is what makes the naive "time after tasks resolve" metric wrong.)
- Given ticks after full resolution that carry `headMoved: true`, when the rollup attributes that time, then it is classified as **remediation**, not closeout.
- Given both ledgers are present, when the rollup reads them, then it merges the engine and pipeline ledgers by `ts` into one ordered view.

#### Negative Paths
- Given either ledger contains a malformed line, when the rollup runs, then it returns `{ state: 'partial' }` — it does not throw, and it does not silently drop the affected window.
- Given a `build` window with **zero** `build_progress` ticks (observed in 4 of 28 real windows), when the rollup processes it, then the window is reported with an explicit unknown/partial decomposition rather than crashing or being omitted without trace.
- Given a corpus with no closeout events at all (the historical baseline), when the rollup runs, then each obligation is reported as **`unrecorded`** and never as a zero duration — treating absence as zero reproduces the exact under-counting bug this feature exists to fix.
- Given a `build` window that was started but never terminated (no `step_completed` / `step_failed`), when the rollup runs, then that window is `partial` and does not corrupt the totals of neighbouring windows.
- Given no `build` window exists in the ledger at all, when the rollup runs, then it returns `{ state: 'unavailable' }` rather than an empty `measured` result.
- Given a closeout event whose end precedes its start, when the rollup reads it, then the window degrades to `partial` rather than contributing a negative duration.

### Done When
- [ ] `computeBuildTailRollup` returns a discriminated union `{ state: 'measured' | 'partial' | 'unavailable' }`, matching `timing-rollup.ts`
- [ ] A test asserts first-pass vs re-entry classification from the first observed tick
- [ ] A test asserts a malformed line yields `partial`, not a throw
- [ ] A test asserts an obligation with no event reports `unrecorded`, and that `unrecorded` is not equal to a zero duration in the output type
- [ ] A test asserts a zero-tick window is represented rather than dropped
- [ ] A test asserts a negative-duration event degrades the window to `partial`

---

## Story 6: The rollup is runnable and its output is committed as a baseline

**Requirement:** O1 — pieces 3 and 4

As an operator, I want to run the decomposition over the existing corpus and commit the result,
so that any future latency claim has a fixed reference point to be measured against.

### Acceptance Criteria

#### Happy Path
- Given a worktree with a ledger, when the operator runs the new `conduct-ts` reporting subcommand, then it prints the per-window decomposition and the aggregate distribution.
- Given the subcommand is run across the existing corpus, when it completes, then its output is committed as a baseline document that states its own coverage explicitly — how many windows were measured, and how many obligations were `unrecorded`.
- Given the baseline is read later, when a reader inspects it, then it is unambiguous that the historical corpus predates closeout events and is therefore weaker than steady-state data.

#### Negative Paths
- Given a path with no ledger, when the subcommand runs, then it reports `unavailable` and exits cleanly with a clear message — it does not throw a stack trace.
- Given a ledger the rollup grades `partial`, when the subcommand renders it, then the partial state is shown explicitly and is not presented as a complete measurement.
- Given the corpus contains windows with zero closeout events, when the baseline is produced, then those obligations appear as `unrecorded` in the committed output rather than as zeros that would understate closeout time.
- Given the subcommand is run twice on an unchanged ledger, when the outputs are compared, then they are identical — the computation is deterministic and contains no wall-clock-dependent field.

### Done When
- [ ] A `conduct-ts` reporting subcommand renders the rollup, registered in the CLI command table
- [ ] `docs/reference/cli.md` documents the subcommand
- [ ] A committed baseline document exists, stating window count and `unrecorded` coverage
- [ ] A test asserts a missing ledger yields a clean `unavailable` result, not a throw
- [ ] A test asserts two runs over the same ledger produce identical output
