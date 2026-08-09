# Implementation Plan: BUILD post-task tail telemetry

**Date:** 2026-08-08
**Stories:** .docs/stories/build-post-task-tail-telemetry.md
**Conflict check:** Clean as of 2026-08-08

Stem: build-post-task-tail-telemetry
Track: technical
Tier: M

## Summary

Makes the `build` step's interior measurable in 20 tasks: additive tick provenance on
`build_progress`, a closeout `ConductorEvent` emitted by the pipeline's own process into a
single-writer sibling ledger, an engine tail that re-emits it onto the live bus, a fail-closed
batch-boundary gate, explicit daemon/UI/OTel subscribers, and an intra-step rollup plus its
reporting surface and committed baseline. No latency reduction is in scope.

## Technical Approach

Four seams, sequenced so nothing blocks on machinery that does not yet exist.

**Seam 1 — tick provenance (T1-T4).** `build_progress` gains two optional fields,
`tickReason: 'task-delta' | 'head-moved' | 'heartbeat'` and `headMoved: boolean`. Strictly
additive on both the type and inside `BuildProgressWatcher.tick()`; no restructuring, because
that file and `types/events.ts` are co-touched by ~35 open spec branches and any reshaping turns
every rebase into a manual merge. The whole point is that today an absent `commitCount` cannot be
told apart from "HEAD did not move" — heartbeat ticks hard-code it to `undefined`
(`build-progress-watcher.ts:376`) — so `headMoved` must be an explicit value, never an omission.

**Seam 2 — closeout events from the pipeline's process (T5-T8).** A new member of the existing
`ConductorEvent` union, written by a `conduct-ts` subcommand the pipeline's closeout obligations
call. It appends to `.pipeline/pipeline-events.jsonl`. **One writer per ledger file is
non-negotiable:** `parseLedger` (`timing-rollup.ts:26-39`) returns `null` on a single malformed
line and degrades *every* rollup over that ledger to `partial`, and `appendFileSync` is atomic
only under `PIPE_BUF` (4096 bytes) while existing `step_completed` records routinely exceed it.
A cross-process append to `.pipeline/events.jsonl` would therefore be whole-ledger corruption
that stays invisible until read. Sibling ledgers are already established practice here —
`.pipeline/otel.jsonl` and `.pipeline/audit-trail/events.jsonl` both exist with their own single
writers. The subcommand must succeed with no conductor running, which is what keeps an inline
`pipeline` run instrumented.

**Seam 3 — tail and re-emit (T9-T11).** The engine tails the sibling ledger and re-emits onto the
live bus so `daemon-cli.ts`, the UI renderers, and `otel-visualizer.ts` see closeout obligations
without their own file access. Lifecycle mirrors `BuildProgressWatcher` exactly — `.unref()`'d
interval, stopped in a `finally`, same dispatch scope — which is the pattern
adr-2026-07-10 already established for this leak hazard. Offset tracking must skip a truncated
trailing line (a write in flight) rather than re-emitting a partial record.

> **Amended 2026-08-09 by #1176:** Re-emission alone does not make a new event visible. Tasks
> 18-20 explicitly add the existing-spine daemon-log and terminal-UI render paths plus the OTel
> subscription, span event, and duration metric. `pipeline_closeout` remains `persist: false` in
> `EVENT_SINKS`, preserving `EventPersister` as the sole writer of `.pipeline/events.jsonl`.

**Seam 4 — gate, rollup, report (T12-T17).** The gate extension lands **after** the emitter, so
no in-flight build can block on an event nothing yet produces. `computeBuildTailRollup` follows
`timing-rollup.ts`'s shape: a pure reader returning
`{ state: 'measured' | 'partial' | 'unavailable' }`. Re-entry classification keys off the
**first** observed tick — a window whose first tick already reads `resolved == total` is a
re-entry, not a first-pass window with a zero-length task segment (19 of 24 measured windows are
re-entries; conflating them is what makes the naive metric wrong). A missing closeout event
reports `unrecorded`, never zero.

**Documentation.** No documentation tasks appear below. This repository routes reader-facing
documentation through its `maintain-documentation` custom step, and the `plan` skill prohibits
documentation tasks in plans. `docs/reference/cli.md` (two new subcommands) and
`docs/reference/artifacts.md` (the new sibling ledger) are the affected pages for that step to
pick up. `CHANGELOG.md` and `VERSION` are bot-owned and must not be touched; release metadata
goes in the PR body.

## Prerequisites

- None. #1101's step-level timing already ships `activeInterval` (`startedAtMs` + `durationMs`)
  on `step_completed`, which supplies build-window end times.

## Tasks

### Task 1: Declare tick-provenance fields on `build_progress`
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing test: a `build_progress` object carrying `tickReason: 'heartbeat'` and `headMoved: false` typechecks and round-trips through the persister.
2. Verify test fails (RED)
3. Implement: add `tickReason?: 'task-delta' | 'head-moved' | 'heartbeat'` and `headMoved?: boolean` to the `build_progress` member. Additive only — do not reorder or retype existing fields.
4. Verify test passes (GREEN)
5. Commit: "feat(events): declare tickReason and headMoved on build_progress"

**Files likely touched:**
- src/conductor/src/types/events.ts — two optional fields on the existing member

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 2: Emit `task-delta` and `head-moved` provenance from change-driven ticks
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: a tick where the resolved count changed emits `tickReason: 'task-delta'`; a tick where only HEAD advanced emits `tickReason: 'head-moved'` with `headMoved: true` and the existing `commitCount`.
2. Verify test fails (RED)
3. Implement: set the two fields on the change-driven emission path in `tick()`. No restructuring of the existing change-detection logic.
4. Verify test passes (GREEN)
5. Commit: "feat(watcher): stamp provenance on change-driven build_progress ticks"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — set fields on the change-driven emit

**Wired-into:** src/conductor/src/engine/build-progress-watcher.ts#tick
**Dependencies:** Task 1

### Task 3: Emit `heartbeat` provenance with explicit `headMoved: false`
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: a heartbeat emission (no observed change, heartbeat period elapsed) carries `tickReason: 'heartbeat'` and `headMoved: false` as a present value, not an omitted field.
2. Verify test fails (RED)
3. Implement: set both fields on the heartbeat emission path, which today hard-codes `commitCount: undefined`.
4. Verify test passes (GREEN)
5. Commit: "feat(watcher): stamp heartbeat provenance with explicit headMoved"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — heartbeat emission path

**Wired-into:** same as Task 2
**Dependencies:** Task 1

### Task 4: A failed HEAD probe still emits, with `headMoved: false`
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: with a git runner that throws, the tick still emits `build_progress` with `headMoved: false` and is not aborted.
2. Verify test fails (RED)
3. Implement: ensure the existing degrade-in-place catch sets `headMoved: false` rather than leaving it undefined.
4. Verify test passes (GREEN)
5. Commit: "fix(watcher): failed HEAD probe emits headMoved false rather than omitting it"

**Files likely touched:**
- src/conductor/src/engine/build-progress-watcher.ts — HEAD-probe catch path

**Wired-into:** same as Task 2
**Dependencies:** Task 3

### Task 5: Declare the closeout member of the `ConductorEvent` union
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing test: a closeout event carrying an obligation name, start, end, and `ts` typechecks as a `ConductorEvent`.
2. Verify test fails (RED)
3. Implement: add the closeout member to the union. Additive only.
4. Verify test passes (GREEN)
5. Commit: "feat(events): declare the build closeout event"

**Files likely touched:**
- src/conductor/src/types/events.ts — new union member

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 6: Append closeout events to the single-writer sibling ledger
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: appending two closeout events produces two parseable lines in `.pipeline/pipeline-events.jsonl`, in order — and `.pipeline/events.jsonl` is byte-identical before and after.
2. Verify test fails (RED)
3. Implement: an appender that creates `.pipeline/` when absent and appends one JSON line per event. It must never open `.pipeline/events.jsonl`.
4. Verify test passes (GREEN)
5. Commit: "feat(pipeline): append closeout events to the pipeline-owned sibling ledger"

**Files likely touched:**
- src/conductor/src/engine/closeout-events.ts — new appender module
- src/conductor/test/closeout-events.test.ts — new test

**Wired-into:** none (inert until src/conductor/src/engine/closeout-cli.ts)
**Dependencies:** Task 5

### Task 7: Expose the appender as a `conduct-ts` subcommand
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test: invoking the subcommand with a valid obligation name writes the event, with no conductor or daemon process running.
2. Verify test fails (RED)
3. Implement: the subcommand plus its registration in the CLI command table.
4. Verify test passes (GREEN)
5. Commit: "feat(cli): add the closeout-event subcommand"

**Files likely touched:**
- src/conductor/src/engine/closeout-cli.ts — new subcommand
- src/conductor/src/cli.ts — command-table registration

> **Wired-into:** src/conductor/src/cli.ts#commandTable
>
> **Amended 2026-08-09 by #1176:** `commandTable` does not exist in `cli.ts`; the effective
> production registration anchor is the real `createProgram` function below.

**Wired-into:** src/conductor/src/cli.ts#createProgram
**Dependencies:** Task 6

### Task 8: Reject an unknown or empty obligation name without writing
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test: an unknown obligation name exits non-zero, names the accepted obligations, and leaves the sibling ledger unchanged; an empty name behaves the same.
2. Verify test fails (RED)
3. Implement: validate against the accepted obligation set before any write.
4. Verify test passes (GREEN)
5. Commit: "feat(cli): reject unknown closeout obligation names fail-closed"

**Files likely touched:**
- src/conductor/src/engine/closeout-cli.ts — argument validation

**Wired-into:** same as Task 7
**Dependencies:** Task 7

### Task 9: Read the sibling ledger with offset tracking, skipping a partial trailing line
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test: given a ledger whose final line lacks a trailing newline, the reader returns only the complete lines; once the line completes, a subsequent read returns it exactly once.
2. Verify test fails (RED)
3. Implement: an incremental reader tracking a byte offset and yielding only newline-terminated records.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): incremental sibling-ledger reader skips partial trailing lines"

**Files likely touched:**
- src/conductor/src/engine/closeout-tail.ts — new reader
- src/conductor/test/closeout-tail.test.ts — new test

**Wired-into:** none (inert until src/conductor/src/engine/conductor.ts)
**Dependencies:** Task 5

### Task 10: Re-emit tailed closeout events onto the live bus
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test: with the tail attached to a build dispatch, a closeout event written to the sibling ledger is observed by a bus subscriber exactly once across successive polls.
2. Verify test fails (RED)
3. Implement: poll the reader on an interval and emit each new record; wire start/stop into the same dispatch scope as `BuildProgressWatcher`, with `.unref()` on the interval.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): re-emit pipeline closeout events onto the live bus"

**Files likely touched:**
- src/conductor/src/engine/closeout-tail.ts — polling + emit
- src/conductor/src/engine/conductor.ts — lifecycle in the build dispatch scope

> **Wired-into:** src/conductor/src/engine/conductor.ts#runStep
>
> **Amended 2026-08-09 by #1176:** `runStep` does not exist in `conductor.ts`; the effective
> lifecycle anchor is the real `Conductor.run` method below.

**Wired-into:** src/conductor/src/engine/conductor.ts#Conductor.run
**Dependencies:** Task 9

### Task 11: Stop the tail when the build step settles or rejects
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing test: when the build step rejects, no interval survives; when the sibling ledger is absent, the tail polls without throwing or emitting a spurious event.
2. Verify test fails (RED)
3. Implement: stop the tail in a `finally`; treat a missing ledger as "no data, poll again".
4. Verify test passes (GREEN)
5. Commit: "fix(engine): stop the closeout tail on build settle and tolerate an absent ledger"

**Files likely touched:**
- src/conductor/src/engine/closeout-tail.ts — missing-file tolerance
- src/conductor/src/engine/conductor.ts — finally-stop

**Wired-into:** same as Task 10
**Dependencies:** Task 10

### Task 12: Require the recorded closeout event at the batch boundary
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing test: an obligation that completed with no recorded event blocks the batch boundary naming that obligation; an empty `review.json` still blocks independently; an event for a *different* obligation does not satisfy the check.
2. Verify test fails (RED)
3. Implement: extend the existing batch-boundary gate alongside the existing non-empty `review.json` stat-check. Additive — the existing condition is not weakened or replaced.
4. Verify test passes (GREEN)
5. Commit: "feat(pipeline): batch boundary requires the recorded closeout event"

**Files likely touched:**
- skills/pipeline/SKILL.md — gate extension in the quality-gates section

**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

### Task 13: Merge both ledgers by `ts` and extract build windows
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing test: given an engine ledger and a sibling ledger, windows are extracted from `step_started`/`step_completed` pairs for `build`, with closeout events interleaved in `ts` order; a window with zero `build_progress` ticks is represented rather than dropped.
2. Verify test fails (RED)
3. Implement: the merge and window-extraction half of the new module.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): merge engine and pipeline ledgers into build windows"

**Files likely touched:**
- src/conductor/src/engine/build-tail-rollup.ts — new module
- src/conductor/test/build-tail-rollup.test.ts — new test

**Wired-into:** none (inert until src/conductor/src/engine/build-tail-cli.ts)
**Dependencies:** Task 5

### Task 14: Decompose each window and classify first-pass vs re-entry
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing test: a window whose first observed tick reads `resolved < total` is first-pass with its task segment ending at the first `resolved == total` tick; a window whose **first** tick already reads `resolved == total` is a re-entry, not a zero-length task segment; post-resolution ticks with `headMoved: true` classify as remediation, not closeout.
2. Verify test fails (RED)
3. Implement: segment attribution and the classification rule; return `{ state: 'measured' }` with per-obligation durations.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): decompose build windows into task, remediation, and closeout"

**Files likely touched:**
- src/conductor/src/engine/build-tail-rollup.ts — decomposition and classification

**Wired-into:** same as Task 13
**Dependencies:** Task 13

### Task 15: Degrade to `partial`/`unavailable` instead of lying or throwing
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing test: a malformed line in either ledger yields `partial` without throwing; an obligation with no event reports `unrecorded` and `unrecorded` is not equal to a zero duration in the output type; a closeout event whose end precedes its start yields `partial`; an unterminated window yields `partial` without corrupting neighbouring windows; no `build` window at all yields `unavailable`.
2. Verify test fails (RED)
3. Implement: the degradation paths, following `timing-rollup.ts`'s fail-closed `parseLedger` policy.
4. Verify test passes (GREEN)
5. Commit: "feat(engine): fail-closed degradation for the build tail rollup"

**Files likely touched:**
- src/conductor/src/engine/build-tail-rollup.ts — degradation handling

**Wired-into:** same as Task 13
**Dependencies:** Task 14

### Task 16: Expose the rollup as a deterministic reporting subcommand
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing test: the subcommand renders the per-window decomposition and aggregate distribution; two runs over an unchanged ledger produce byte-identical output; a path with no ledger reports `unavailable` and exits cleanly with no stack trace.
2. Verify test fails (RED)
3. Implement: the renderer and subcommand, registered in the CLI command table. No wall-clock field in the output.
4. Verify test passes (GREEN)
5. Commit: "feat(cli): add the build tail rollup reporting subcommand"

**Files likely touched:**
- src/conductor/src/engine/build-tail-cli.ts — new subcommand and renderer
- src/conductor/src/cli.ts — command-table registration

> **Wired-into:** src/conductor/src/cli.ts#commandTable
>
> **Amended 2026-08-09 by #1176:** `commandTable` does not exist in `cli.ts`; the effective
> production registration anchor is the real `createProgram` function below.

**Wired-into:** src/conductor/src/cli.ts#createProgram
**Dependencies:** Task 15

### Task 17: Commit the baseline with its coverage stated
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Run the Task 16 subcommand over the existing worktree corpus.
2. Write the rendered result to a committed baseline document that states its own coverage explicitly: how many windows were measured, how many obligations were `unrecorded`, and that the historical corpus predates closeout events.
3. Verify the document names its coverage rather than implying completeness.
4. Commit: "docs(baseline): record the measured build tail baseline"

**Files likely touched:**
- .docs/baselines/build-post-task-tail-telemetry.md — new baseline artifact

**Wired-into:** none (no new production surface)
**Dependencies:** Task 16

### Task 18: Render re-emitted closeout events in daemon and terminal UI paths
**Story:** Story 3 — existing live subscribers handle the re-emitted event
**Type:** happy-path

**Steps:**
1. Write failing tests: `pipeline_closeout` is in the rendered sink set but not the persisted set; the daemon renderer logs the obligation and duration; `TerminalSubscriber` forwards the event; and `createRenderer` writes the same closeout detail to its live region.
2. Verify tests fail (RED)
3. Implement: set only `EVENT_SINKS.pipeline_closeout.render` to `true`, keep `persist: false`, add the event to `TerminalSubscriber.start()`, and add explicit daemon and terminal renderer cases with obligation and elapsed milliseconds.
4. Verify tests pass (GREEN)
5. Commit: "feat(ui): render pipeline closeout events on live subscribers"

**Files likely touched:**
- src/conductor/src/engine/event-sinks.ts — enable render routing while retaining `persist: false`
- src/conductor/src/daemon-cli.ts — daemon-log rendering case
- src/conductor/src/ui/subscriber.ts — terminal subscription
- src/conductor/src/ui/create-renderer.ts — terminal live-region rendering case
- src/conductor/test/engine/event-sinks.test.ts — sink routing assertions
- src/conductor/test/engine/daemon-cli.test.ts — daemon rendering assertion
- src/conductor/test/ui/subscriber.test.ts — terminal subscription assertion
- src/conductor/test/ui/create-renderer.test.ts — terminal rendering assertion

**Wired-into:** src/conductor/src/daemon-cli.ts#renderedEventTypes, src/conductor/src/ui/subscriber.ts#TerminalSubscriber.start, src/conductor/src/ui/create-renderer.ts#createRenderer
**Dependencies:** Task 10

### Task 19: Export closeout obligations through the OTel visualizer
**Story:** Story 3 — `otel/otel-visualizer.ts` handles the re-emitted event through its normal path
**Type:** happy-path

**Steps:**
1. Write failing tests: after `OtelVisualizer.start()`, emitting `pipeline_closeout` adds a `pipeline_closeout` event with obligation/timing attributes to the active build span and records its duration in a closeout histogram tagged by obligation.
2. Verify tests fail (RED)
3. Implement: subscribe to `pipeline_closeout` in `OtelVisualizer.start()`, dispatch it synchronously in `handleEvent()`, add a `SpanManager` handler that targets the active build span or run span, and add a `MetricsRecorder` closeout-duration histogram. Do not await exporters on the event path.
4. Verify tests pass (GREEN)
5. Commit: "feat(otel): export pipeline closeout telemetry"

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — subscription and synchronous dispatch
- src/conductor/src/engine/otel/span-manager.ts — closeout span-event handler
- src/conductor/src/engine/otel/metrics.ts — closeout duration histogram
- src/conductor/test/engine/otel/otel-visualizer.test.ts — subscription/export assertion
- src/conductor/test/engine/otel/span-manager.test.ts — span-event attributes and orphan fallback
- src/conductor/test/engine/otel/metrics.test.ts — duration metric and obligation tag

**Wired-into:** src/conductor/src/engine/otel/otel-visualizer.ts#OtelVisualizer.start
**Dependencies:** Task 10

### Task 20: Prove the tail reaches every production live consumer without a second writer
**Story:** Story 3 — end-to-end live-consumer acceptance path and durable-ledger negative path
**Type:** infrastructure

**Steps:**
1. Write failing production-wiring tests: a real `CloseoutEventTail` re-emission reaches the daemon-render set, terminal subscriber/renderer, and OTel visualizer; the same test proves `pipeline_closeout` remains excluded from `persistedEventTypes()` and `.pipeline/events.jsonl` stays unchanged.
2. Verify tests fail (RED)
3. Implement only the test seams needed to exercise the named production subscribers together; do not add a second persister or bypass `ConductorEventEmitter`.
4. Verify tests pass (GREEN)
5. Commit: "test(engine): cover closeout tail production subscribers"

**Files likely touched:**
- src/conductor/test/closeout-tail.test.ts — tail-to-bus integration coverage
- src/conductor/test/engine/daemon-cli.test.ts — daemon subscriber wiring coverage
- src/conductor/test/ui/subscriber.test.ts — terminal forwarding coverage
- src/conductor/test/ui/create-renderer.test.ts — terminal output coverage
- src/conductor/test/engine/otel/otel-visualizer.test.ts — OTel subscriber coverage
- src/conductor/test/engine/event-sinks.test.ts — single-writer routing regression assertion

**Wired-into:** none (no new production surface)
**Dependencies:** Task 18, Task 19

## Task Dependency Graph

```
Task 1 ──┬─▶ Task 2 ──┐
         └─▶ Task 3 ──┴─▶ Task 4          (Story 1, independent branch)

Task 5 ──┬─▶ Task 6 ──▶ Task 7 ──▶ Task 8 ──▶ Task 12   (Stories 2, 4)
         │
         ├─▶ Task 9 ──▶ Task 10 ──┬─▶ Task 11            (Story 3 lifecycle)
         │                         ├─▶ Task 18 ──┐
         │                         └─▶ Task 19 ──┴─▶ Task 20  (Story 3 consumers)
         │
         └─▶ Task 13 ──▶ Task 14 ──▶ Task 15 ──▶ Task 16 ──▶ Task 17  (Stories 5, 6)
```

Acyclic. Task 12 (the gate) depends transitively on Task 7 via Task 8, which enforces the
binding "emitter before gate" ordering. The Story 1 branch is independent of everything else and
may run first or in parallel.

## Integration Points

- **After Task 4:** ledger records carry usable tick provenance — the ceremony-vs-remediation
  ambiguity is gone end-to-end for new builds.
- **After Task 8:** an inline `pipeline` run with no conductor produces a complete closeout
  timeline in the sibling ledger.
- **After Task 11:** closeout events are re-emitted exactly once and the tail has bounded lifecycle.
- **After Task 16:** the full decomposition is runnable against any worktree.
- **After Task 20:** re-emitted closeout obligations are visible in the daemon log, terminal UI,
  and OTel span/metric export without adding a second persistence writer.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (Tasks 4, 8, 11, 12, 15)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Emitter (Task 7/8) strictly precedes the gate (Task 12)
- [ ] No task appends to `.pipeline/events.jsonl`
- [ ] Edits to `types/events.ts` and `build-progress-watcher.ts` are additive only
- [ ] No task references intake #1176's ≥50% p95 reduction
- [ ] Story 3 live-consumer coverage maps to Tasks 18-20
- [ ] `pipeline_closeout` remains excluded from `persistedEventTypes()`
- [ ] No terminal catch-all validation task
