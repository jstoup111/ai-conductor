**Status:** Accepted

# Stories: trace-root-span-records-no-run-outcome-a-halted-ru

Source: jstoup111/ai-conductor#1978. Track: technical (no PRD). Tier: S.

Approach (approved): bus-derived run outcome. `loop_halt` flips to `otel: true` in
`EVENT_SINKS`; the `SpanManager` records `conductor.run.outcome` on the `conductor.run` root
span — `complete` via `feature_complete`, `halted` via `loop_halt`, and `terminated` as the
force-close default when no terminal event was observed. Span OK/ERROR status semantics are
unchanged: a halted run closes OK; only incomplete step spans carry ERROR.

Terminal-event audit (balanced scope, resolved here): `loop_halt` is the single canonical
halt carrier — every irrecoverable HALT path routes through `emitLoopHalt` (69 call sites in
`conductor.ts`), including rebase-conflict halts ("a `conflict_halt` outcome here drives the
loop to HALT"). The remaining terminal-ish events map as follows and gain no `otel: true` flag:
`rebase_conflict_halt` (supplementary detail; the ensuing `loop_halt` carries the outcome),
`auto_park` / `credentials_park` / `operator_park_boundary` (daemon-side park lifecycle — the
dispatch ends without a run outcome, correctly labeled `terminated`), `loop_converged`
(mid-run convergence, not terminal). This mapping is a deliverable: it must be recorded in the
`SpanManager` module documentation so the next reader does not re-derive it.

## Story 1: Completed run records outcome complete

**Requirement:** #1978 desired outcome 3 (outcome readable in a trace listing)

As an operator charting runs in Tempo, I want a completed run's root span to carry
`conductor.run.outcome=complete` so that I can count finished runs without opening traces.

### Acceptance Criteria

#### Happy Path
- Given an OTel-enabled run with an open `conductor.run` span, when `feature_complete` is emitted, then the exported root span carries attribute `conductor.run.outcome` = `complete` and status OK

#### Negative Paths
- Given no run span was ever opened (no step event arrived), when `feature_complete` is emitted, then no span is created, nothing throws, and no outcome attribute is exported anywhere

### Done When
- [ ] Test asserts the exported `conductor.run` span from a `step_started` → `step_completed` → `feature_complete` sequence has `conductor.run.outcome` = `complete` and `SpanStatusCode.OK`
- [ ] Test asserts a bare `feature_complete` with no prior step event exports zero spans and emits no warning beyond existing behavior

## Story 2: Halted run records outcome halted

**Requirement:** #1978 desired outcomes 2 and 3 (root closes on halt; halted distinguishable)

As an operator triaging a daemon, I want a halted run's root span to close with
`conductor.run.outcome=halted` so that halted runs are separable from completed ones in a
trace listing.

### Acceptance Criteria

#### Happy Path
- Given an OTel-enabled run with an open `conductor.run` span, when `loop_halt` is emitted, then the root span ends with attribute `conductor.run.outcome` = `halted` and status OK (a halt is a legitimate outcome, not a span error)
- Given a `loop_halt` event carrying `step`, `reason`, and `haltClass`, when the root span closes, then those values are recorded as `conductor.run.halt.step`, `conductor.run.halt.reason`, and `conductor.run.halt.class` attributes (absent fields omitted)
- Given `loop_halt` is declared `otel: true` in `EVENT_SINKS`, when the visualizer receives it, then `handleEvent` handles it explicitly (no silent fall-through — adr-2026-07-26 exhaustiveness)

#### Negative Paths
- Given no run span exists (halt before any step event), when `loop_halt` is emitted, then the handler warns and no-ops without throwing
- Given the run span already closed via `feature_complete`, when a late `loop_halt` arrives, then the recorded outcome remains `complete` and no second end() is issued on the root span

### Done When
- [ ] Test asserts a `step_started` → `loop_halt` sequence exports a root span with `conductor.run.outcome` = `halted`, status OK, and halt attributes matching the event fields
- [ ] Test asserts `loop_halt` before any span opens produces a warning and zero exported spans
- [ ] Test asserts `feature_complete` followed by `loop_halt` exports exactly one root span with outcome `complete`
- [ ] `EVENT_SINKS.loop_halt.otel` is `true` and the event-sink exhaustiveness check passes

## Story 3: Terminated run defaults to outcome terminated on force-close

**Requirement:** #1978 desired outcomes 2 and 3 (every terminal path closes the root; distinguishable)

As an operator, I want a run killed by SIGINT/SIGTERM or an error exit to export
`conductor.run.outcome=terminated` so that abrupt terminations are separable from both
completed and halted runs.

### Acceptance Criteria

#### Happy Path
- Given an open run span and no `feature_complete` or `loop_halt` observed, when `forceCloseAll` runs (via `stop()`), then the root span ends with `conductor.run.outcome` = `terminated` and status OK, and still-open step spans keep today's ERROR + `conductor.incomplete=true` close behavior

#### Negative Paths
- Given the run already closed with outcome `halted`, when `stop()` subsequently runs `forceCloseAll`, then the exported root span's outcome remains `halted` (the terminated default never overwrites an observed outcome)

### Done When
- [ ] Test asserts `step_started` → `stop()` exports a root span with outcome `terminated`, status OK, and the step span with ERROR + `conductor.incomplete=true` (unchanged)
- [ ] Test asserts `loop_halt` → `stop()` exports outcome `halted`, not `terminated`

## Story 4: Step spans keep closing at step completion (regression pin)

**Requirement:** #1978 desired outcomes 1 and 4 (pin step-close; in-progress distinguishable)

As an operator watching a live dispatch, I want step spans to keep exporting at step
completion while the root span stays open until a terminal state, so that an in-progress run
remains identifiable (root unexported) without regressing step visibility.

### Acceptance Criteria

#### Happy Path
- Given an OTel-enabled run mid-dispatch, when `step_completed` is emitted for an open step, then that step span is ended and exported while the `conductor.run` root span remains open and unexported

#### Negative Paths
- Given a run with two completed steps and no terminal event, when the exporter's finished spans are inspected before `stop()`, then exactly the two step spans are present and no span named `conductor.run` — and no span anywhere carries a `conductor.run.outcome` attribute

### Done When
- [ ] Test (regression pin) asserts step spans export at `step_completed` before any terminal event, the root span exports only after the terminal event, and `conductor.run.outcome` appears on no span until then

## Story 5: Outcome taxonomy and terminal-event mapping are documented at the seam

**Requirement:** #1978 desired outcome 3 + balanced-scope audit

As a maintainer touching the OTel module, I want the outcome taxonomy and the audited
terminal-event mapping recorded where the code lives so that future terminal-ish events get a
deliberate mapping instead of an accidental `terminated`.

### Acceptance Criteria

#### Happy Path
- Given the delivered change, when reading the `SpanManager` module documentation, then it states the three outcome values, which bus event produces each, and that park-lifecycle events (`auto_park`, `credentials_park`, `operator_park_boundary`) and `rebase_conflict_halt` intentionally map to the `terminated` default / the ensuing `loop_halt` respectively

#### Negative Paths
- Given a future event flipped to `otel: true` without a `handleEvent` case, when the event-sink exhaustiveness contract's existing check runs, then it fails rather than silently dropping the event (pinned by the Story 2 exhaustiveness criterion; no new mechanism)

### Done When
- [ ] The `span-manager.ts` module header documents the outcome taxonomy, the bus event producing each value, and the audited terminal-event mapping above
