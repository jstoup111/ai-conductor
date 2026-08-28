# Implementation Plan: trace-root-span-records-no-run-outcome-a-halted-ru

**Date:** 2026-08-27
**Stories:** .docs/stories/trace-root-span-records-no-run-outcome-a-halted-ru.md
**Conflict check:** Skipped (tier S)

## Summary

Record a searchable terminal outcome (`conductor.run.outcome` = `complete` | `halted` |
`terminated`) on the `conductor.run` root span, derived from bus events, in 6 tasks.

## Technical Approach

The `SpanManager` gains a private `runOutcome` field and a single private
`closeRunSpan(outcome)` helper that sets `conductor.run.outcome`, closes the root span with
status OK, and nulls it. `onFeatureComplete` calls it with `complete`. A new `onLoopHalt`
handler calls it with `halted` and first records `conductor.run.halt.step`,
`conductor.run.halt.reason`, and `conductor.run.halt.class` from the event (absent fields
omitted). `forceCloseAll` calls it with `terminated` only when no outcome was already
recorded; once the root span is closed, later terminal events are ignored (warn-free for
force-close, warn for an orphan `loop_halt` with no run span, matching existing orphan
handling). Span OK/ERROR status semantics are unchanged everywhere: incomplete step spans
keep ERROR + `conductor.incomplete=true`; the root span always closes OK.

Wiring follows the event-sink registry: `EVENT_SINKS.loop_halt.otel` flips to `true` in
`src/conductor/src/engine/event-sinks.ts`, and `OtelVisualizer.handleEvent` adds a
synchronous `case 'loop_halt'` delegating to `spanManager.onLoopHalt` (no await — ADR-014
hot-path rule). Existing unit suites are the test seam: `InMemorySpanExporter`-backed tests
in `src/conductor/test/engine/otel/span-manager.test.ts` and
`src/conductor/test/engine/otel/otel-visualizer.test.ts` — follow their existing
emit-events-then-assert-finished-spans pattern (search hint: existing `forceCloseAll` and
`feature_complete` describe blocks).

Sequencing: pin current behavior first (Task 1), introduce outcome tracking on the existing
complete path (Task 2), add the halt handler (Tasks 3–4), wire the bus (Task 5), then the
terminated default plus the module-header taxonomy documentation (Task 6).

## Prerequisites

None — all seams exist on main (#1973 merged).

## Tasks

### Task 1: Regression-pin step-close-at-completion and unexported root
**Story:** story-4
**Type:** happy-path

**Steps:**
1. Write test in the span-manager suite: emit `step_started`/`step_completed` for two steps with no terminal event; assert exactly the two step spans are finished, no finished span is named `conductor.run`, and no finished span carries a `conductor.run.outcome` attribute
2. Verify it passes against current code (pin, not RED — this asserts existing behavior)
3. Commit with message: "test(otel): pin step-close-at-completion and unexported root span"

**Done when:**
- [ ] New test asserts two finished step spans, zero finished `conductor.run` spans, and zero `conductor.run.outcome` attributes before any terminal event
- [ ] Full span-manager suite passes

**Files likely touched:**
- src/conductor/test/engine/otel/span-manager.test.ts — new regression-pin test

**Dependencies:** none

### Task 2: Outcome tracking with complete on feature_complete
**Story:** story-1
**Type:** happy-path

**Steps:**
1. Write failing test: `step_started` → `step_completed` → `feature_complete` exports a `conductor.run` span with attribute `conductor.run.outcome` = `complete` and status OK
2. Write failing-safe negative test: bare `feature_complete` with no prior step event exports zero spans and does not throw (extends the existing no-span behavior — may already pass)
3. Verify the attribute test fails (RED)
4. Implement: add private `runOutcome` field and `closeRunSpan(outcome)` helper to `SpanManager`; route `onFeatureComplete` through it with `complete`
5. Verify tests pass (GREEN)
6. Commit with message: "feat(otel): record conductor.run.outcome=complete on feature_complete"

**Done when:**
- [ ] Test asserts the exported root span carries `conductor.run.outcome` = `complete` and `SpanStatusCode.OK`
- [ ] Test asserts a bare `feature_complete` exports zero spans and throws nothing
- [ ] `onFeatureComplete` closes the root span only via the shared `closeRunSpan` helper

**Files likely touched:**
- src/conductor/src/engine/otel/span-manager.ts — outcome field, closeRunSpan helper, onFeatureComplete
- src/conductor/test/engine/otel/span-manager.test.ts — outcome tests

**Dependencies:** none

### Task 3: onLoopHalt closes the run span as halted with halt attributes
**Story:** story-2
**Type:** happy-path

**Steps:**
1. Write failing test: `step_started` then `onLoopHalt({type:'loop_halt', step:'build', reason:'…', haltClass:'plan-gap'})` exports a root span with `conductor.run.outcome` = `halted`, status OK, and attributes `conductor.run.halt.step`/`conductor.run.halt.reason`/`conductor.run.halt.class` equal to the event fields; a second variant with only `reason` asserts the optional attributes are absent
2. Verify RED
3. Implement: `SpanManager.onLoopHalt` — close any still-open step spans with today's incomplete semantics is NOT done here (leave open steps untouched; `stop()`'s forceCloseAll owns them); record halt attributes, then `closeRunSpan('halted')`
4. Verify GREEN
5. Commit with message: "feat(otel): close run span as halted on loop_halt"

**Done when:**
- [ ] Test asserts outcome `halted`, status OK, and halt attributes matching event fields, with absent optional fields omitted
- [ ] `onLoopHalt` does not end or mutate open step spans (asserted: a step left open at halt is still closed by `forceCloseAll` with ERROR + `conductor.incomplete=true`)

**Files likely touched:**
- src/conductor/src/engine/otel/span-manager.ts — onLoopHalt
- src/conductor/test/engine/otel/span-manager.test.ts — halt tests

**Dependencies:** 2

### Task 4: onLoopHalt negative paths — orphan halt and late halt
**Story:** story-2
**Type:** negative-path

**Steps:**
1. Write failing test: `onLoopHalt` with no run span ever opened calls the warning callback and exports zero spans without throwing
2. Write failing test: `feature_complete` then `loop_halt` exports exactly one root span whose outcome is `complete` and issues no second end() (assert finished-span count and outcome value)
3. Verify RED
4. Implement: guard clauses in `onLoopHalt` (no run span → warn + return) and in `closeRunSpan` (already-closed → return)
5. Verify GREEN
6. Commit with message: "feat(otel): guard loop_halt orphan and post-complete arrivals"

**Done when:**
- [ ] Test asserts orphan `loop_halt` warns once and exports zero spans
- [ ] Test asserts complete-then-halt exports exactly one root span with outcome `complete`

**Files likely touched:**
- src/conductor/src/engine/otel/span-manager.ts — guards
- src/conductor/test/engine/otel/span-manager.test.ts — negative tests

**Dependencies:** 3

### Task 5: Wire loop_halt through EVENT_SINKS and the visualizer switch
**Story:** story-2
**Type:** infrastructure

**Steps:**
1. Write failing test in the visualizer suite: emitting `loop_halt` on the bus through a started `OtelVisualizer` exports a root span with outcome `halted` (proves end-to-end wiring, not just the SpanManager unit)
2. Verify RED (the sink is still `otel: false`, so the visualizer never receives the event)
3. Implement: flip `loop_halt` to `otel: true` in `EVENT_SINKS`; add synchronous `case 'loop_halt'` to `OtelVisualizer.handleEvent` delegating to `spanManager.onLoopHalt`
4. Verify GREEN; run the event-sink exhaustiveness check/suite to confirm no otel-declared event is unhandled
5. Commit with message: "feat(otel): subscribe visualizer to loop_halt"

**Done when:**
- [ ] `EVENT_SINKS.loop_halt.otel` is `true` and the exhaustiveness check passes
- [ ] Visualizer-level test asserts a bus-emitted `loop_halt` reaches the exporter as a root span with outcome `halted`
- [ ] The new `handleEvent` case is synchronous (no await in the handler path)

**Files likely touched:**
- src/conductor/src/engine/event-sinks.ts — loop_halt otel flag
- src/conductor/src/engine/otel/otel-visualizer.ts — handleEvent case
- src/conductor/test/engine/otel/otel-visualizer.test.ts — wiring test

**Dependencies:** 3

### Task 6: terminated default in forceCloseAll, never overwriting, plus taxonomy header
**Story:** story-3
**Type:** happy-path

**Steps:**
1. Write failing test: `step_started` then `forceCloseAll()` exports a root span with `conductor.run.outcome` = `terminated`, status OK, and the step span with ERROR + `conductor.incomplete=true` (unchanged)
2. Write failing test: `onLoopHalt` then `forceCloseAll()` exports outcome `halted`, not `terminated`, with exactly one root span
3. Verify RED
4. Implement: `forceCloseAll` routes its run-span close through `closeRunSpan('terminated')`; the already-closed guard from Task 4 makes the halted case a no-op
5. Update the `span-manager.ts` header comment with the outcome taxonomy (three values, producing event for each) and the audited terminal-event mapping (rebase-conflict halts arrive via loop_halt; park-lifecycle events intentionally fall to the terminated default) — this satisfies story-5's module-documentation criterion
6. Verify GREEN
7. Commit with message: "feat(otel): default run outcome to terminated on force-close"

**Done when:**
- [ ] Test asserts force-close with no observed outcome exports outcome `terminated`, status OK, and unchanged incomplete-step semantics
- [ ] Test asserts halt-then-stop exports outcome `halted` on exactly one root span
- [ ] The span-manager module header names all three outcome values, their producing events, and the audited mapping for rebase-conflict and park-lifecycle events

**Files likely touched:**
- src/conductor/src/engine/otel/span-manager.ts — forceCloseAll, header docs
- src/conductor/test/engine/otel/span-manager.test.ts — terminated tests

**Dependencies:** 4

## Task Dependency Graph

```
Task 1 (pin)          [independent]
Task 2 (complete) ──> Task 3 (halted) ──> Task 4 (halt guards) ──> Task 6 (terminated + docs header)
                                     └──> Task 5 (bus wiring)
```

## Integration Points

- After Task 5: a real bus emission of `loop_halt` is observable end-to-end at the exporter.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done when block
- [ ] Dependencies are explicit and acyclic
