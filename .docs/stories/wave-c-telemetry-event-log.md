# Stories: Feature 4.1 — Telemetry + Structured Event Log

**Design doc:** `.docs/specs/2026-05-01-wave-c-second-visualizer-and-telemetry.md`
**Wave:** C (Gap §8 — observability layer)
**Status:** Accepted
**Complexity:** Small

---

## Story 4.1-1: tokenUsage optional field on InvokeResult

As a harness developer, I want LLM providers to optionally report token counts per
invocation so that the report command can surface token spend per step.

### Acceptance Criteria

#### Happy Path
- Given ClaudeProvider successfully invokes the Claude CLI with `--output-format stream-json`,
  when the output contains a usage event with input/output token counts, then the returned
  InvokeResult has `tokenUsage: { input: N, output: M }` populated
- Given RecorderProvider invokes, when it returns a canned response, then it also returns
  a deterministic `tokenUsage: { input: 10, output: 5 }` suitable for stable test fixtures

#### Negative Paths
- Given an LLMProvider that does not set `tokenUsage` on InvokeResult (third-party plugin),
  when the EventPersister processes a step that used it, then `tokenUsage` is simply absent
  from the persisted event — no error thrown, no crash

### Done When
- [ ] `InvokeResult` in `src/conductor/src/execution/llm-provider.ts` has
  `tokenUsage?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }`
- [ ] `ClaudeProvider.invoke()` populates `tokenUsage` when usage data is present in stream-json
- [ ] `RecorderProvider.invoke()` populates `tokenUsage` with deterministic synthesized counts
- [ ] Existing tests for ClaudeProvider and RecorderProvider still pass (no breaking change)

---

## Story 4.1-2: EventPersister appends every ConductorEvent to .pipeline/events.jsonl

As a harness operator, I want every conductor event persisted with a timestamp to
.pipeline/events.jsonl so that I can replay and inspect runs after the fact.

### Acceptance Criteria

#### Happy Path
- Given the EventPersister is wired to the ConductorEventEmitter before a run,
  when the conductor emits any ConductorEvent, then the event is appended as a
  single JSON line with a `ts` (ISO 8601) field to `.pipeline/events.jsonl`
- Given multiple events are emitted, when the run completes, then every line in
  events.jsonl parses as valid JSON and the count equals the number of events emitted
- Given the events.jsonl file does not exist, when the first event is emitted,
  then the file is created (including any missing parent directories)

#### Negative Paths
- Given the .pipeline/ directory is on a read-only filesystem, when an event is
  emitted, then the EventPersister throws EventPersistError with the file path and
  the underlying OS error — the conductor still terminates cleanly (error is caught
  at startup initialization, not mid-run)

### Done When
- [ ] `src/conductor/src/engine/event-persister.ts` exists with `EventPersister` class
- [ ] `EventPersister` subscribes to the `ConductorEventEmitter` as a listener (no
  modification to emission sites in conductor.ts / step-runners.ts)
- [ ] Each persisted line: `JSON.stringify({ ...event, ts: isoString }) + '\n'`
- [ ] File created on first event; parent directories created recursively
- [ ] Unit tests in `test/engine/event-persister.test.ts` pass

---

## Story 4.1-3: EventPersister is wired to the event bus without modifying emission sites

As a harness architect, I want the event persister to subscribe as a listener so
that removing or disabling it has zero effect on conductor behavior.

### Acceptance Criteria

#### Happy Path
- Given the EventPersister is initialized and registered before conductor.run() is called,
  when the conductor emits step_started, step_completed, and step_failed events,
  then all appear in events.jsonl without any change to conductor.ts, step-runners.ts,
  or gates.ts emission lines

#### Negative Paths
- Given the EventPersister is NOT initialized (disabled or missing), when the conductor
  runs, then events.jsonl is not created and the conductor runs normally with no error

### Done When
- [ ] `grep -r "EventPersister" src/conductor/src/engine/conductor.ts` returns zero matches
  (wiring happens in src/conductor/src/index.ts only)
- [ ] `grep -r "EventPersister" src/conductor/src/engine/step-runners.ts` returns zero matches
- [ ] `src/conductor/src/index.ts` creates an EventPersister and calls `.start()` before
  `conductor.run()` and `.stop()` after

---

## Story 4.1-4: conduct --report renders step durations table

As a harness operator, I want `conduct --report` to print step durations sorted
descending so that I can see where time was spent in the last run.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/events.jsonl` contains step_started and step_completed pairs,
  when `conduct --report` is invoked, then stdout shows a "Step Durations" table with
  columns: step name, duration (ms), sorted from longest to shortest
- Given some steps have no step_completed event (e.g., interrupted run),
  when `conduct --report` runs, then those steps show "—" (no duration) and the
  table still renders without error

#### Negative Paths
- Given `.pipeline/events.jsonl` does not exist, when `conduct --report` is run,
  then it exits with a clear message "No event log found at .pipeline/events.jsonl" and
  exit code 1 (not a stack trace)

### Done When
- [ ] `conduct --report` subcommand exists in cli.ts and src/conductor/src/index.ts
  (branches to report path without starting a conductor session)
- [ ] "Step Durations" table rendered to stdout with step, duration_ms columns
- [ ] Rows sorted descending by duration_ms
- [ ] Missing log → exit 1 with human-readable message
- [ ] Unit test in `test/engine/report-renderer.test.ts` asserts table output for
  a fixture events.jsonl

---

## Story 4.1-5: conduct --report renders retry hotspots table

As a harness operator, I want `conduct --report` to show which steps retried so
that I can identify flaky or problematic steps.

### Acceptance Criteria

#### Happy Path
- Given events.jsonl contains step_retry events, when `conduct --report` runs,
  then a "Retry Hotspots" table appears with columns: step name, retry count, most
  common reason
- Given no step_retry events in the log, when `conduct --report` runs, then the
  retry table shows "No retries recorded" (not an error, not an empty table with headers only)

#### Negative Paths
- Given events.jsonl has step_retry events for a step that has no step_completed event
  (step eventually failed), when `conduct --report` runs, then that step still appears
  in the retry table with its retry count — it is NOT silently dropped

### Done When
- [ ] "Retry Hotspots" section rendered after Step Durations in the --report output
- [ ] Each row: step name, total retry count, most common reason string
- [ ] Steps with retries but no completion shown with retry count and "(failed)" notation
- [ ] Zero retries → "No retries recorded" message

---

## Story 4.1-6: conduct --report renders token spend table

As a harness operator, I want `conduct --report` to show token spend per step so
that I can identify expensive steps and optimize prompts.

### Acceptance Criteria

#### Happy Path
- Given events.jsonl contains step_completed events with tokenUsage populated,
  when `conduct --report` runs, then a "Token Spend" table shows step name,
  input tokens, output tokens, cache read tokens (if present)
- Given some steps have tokenUsage and others do not (e.g., skipped steps or
  providers that don't report), when `conduct --report` runs, then only steps
  with tokenUsage appear in the token table — others are silently omitted (graceful degradation)

#### Negative Paths
- Given no step in events.jsonl has tokenUsage, when `conduct --report` runs,
  then the token table shows "No token data recorded" instead of an empty table

### Done When
- [ ] "Token Spend" section rendered after Retry Hotspots in the --report output
- [ ] Rows only for steps with tokenUsage data
- [ ] Zero token data → "No token data recorded" message
- [ ] Unit test in `test/engine/report-renderer.test.ts` covers both populated and empty cases

---

## Story 4.1-7: End-to-end conductor run produces replayable events.jsonl

As a harness operator, I want to verify that a full conductor session produces
a valid, replayable events.jsonl so that post-mortems and tooling work on real data.

### Acceptance Criteria

#### Happy Path
- Given a full conductor session runs at least 2 steps, when the session completes,
  then `.pipeline/events.jsonl` exists and every line is valid JSON with a `ts` field
- Given events.jsonl from a completed run, when each line is parsed and the `type`
  field is checked against the ConductorEvent union, then all type values are valid
  (no unknown event types)

#### Negative Paths
- Given a run that is interrupted mid-session (SIGINT simulation), when events.jsonl
  is inspected, then all events emitted before the interrupt are present and parseable
  (no partially-written lines, no corruption)

### Done When
- [ ] Integration test in `test/integration/event-persister-e2e.test.ts` runs a minimal
  conductor sequence and asserts events.jsonl is well-formed
- [ ] All lines parse as valid JSON
- [ ] All `type` values are members of the ConductorEvent type union
- [ ] `ts` field present on every line and is a valid ISO 8601 string
