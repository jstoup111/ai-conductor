# Implementation Plan: Feature 4.1 — Telemetry + Structured Event Log

**Date:** 2026-05-01
**Design:** `.docs/specs/2026-05-01-wave-c-second-visualizer-and-telemetry.md`
**Stories:** `.docs/stories/wave-c-telemetry-event-log.md`
**Conflict check:** Skipped (Small tier)
**Worktree:** branch off main, PR to main, runs concurrently with Feature 3.2

## Summary

Adds an observability layer: every ConductorEvent is persisted with a timestamp to
`.pipeline/events.jsonl` (newline-delimited JSON, replayable). Tracks per-step timing
and retry counts from existing event bus. Adds optional `tokenUsage` to `InvokeResult`
(populated by ClaudeProvider and RecorderProvider). Adds `conduct --report` subcommand
that renders step durations, retry hotspots, and token spend tables from the event log.
17 tasks.

## Prerequisites

- `ConductorEventEmitter` in `src/conductor/src/ui/events.ts` (Wave A) — EventPersister subscribes to it
- `InvokeResult` in `src/conductor/src/execution/llm-provider.ts` — gets optional field
- `RecorderProvider` in `plugins/recorder-provider/index.ts` (Wave B) — gets tokenUsage
- `CLIOptions` in `src/conductor/src/cli.ts` — gets `--report` flag
- Feature 3.2 NOT required (disjoint files)

## Tasks

### Task 1: Add optional tokenUsage field to InvokeResult
**Story:** 4.1-1 (infrastructure — backwards-compatible type extension)
**Type:** infrastructure

**Steps:**
1. Write failing test: create a value `{ success: true, output: 'x', exitCode: 0,
   tokenUsage: { input: 10, output: 5 } }` and assert it satisfies `InvokeResult` type
   at compile time (TypeScript type test)
2. Verify RED (TypeScript compile error — field not yet in type)
3. Add to `InvokeResult` in `src/conductor/src/execution/llm-provider.ts`:
   ```ts
   tokenUsage?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
   ```
4. Verify GREEN
5. Commit: `feat(execution): add optional tokenUsage field to InvokeResult`

**Files:**
- `src/conductor/src/execution/llm-provider.ts`

**Dependencies:** none

---

### Task 2: ClaudeProvider parses token usage from stream-json output
**Story:** 4.1-1 (happy path — ClaudeProvider populates tokenUsage)
**Type:** happy-path

**Steps:**
1. Write failing test: mock Claude CLI output stream that includes a `usage` event
   `{"type":"usage","input_tokens":100,"output_tokens":50}`, assert that the returned
   `InvokeResult.tokenUsage` has `{ input: 100, output: 50 }`
2. Verify RED
3. In `src/conductor/src/execution/claude-provider.ts`, parse the `--output-format stream-json`
   stream lines for `type === 'usage'` events; accumulate input_tokens / output_tokens /
   cache_creation_input_tokens / cache_read_input_tokens; attach to returned `InvokeResult`
4. Verify GREEN
5. Commit: `feat(execution): ClaudeProvider parses tokenUsage from stream-json output`

**Files:**
- `src/conductor/src/execution/claude-provider.ts`

**Dependencies:** Task 1

---

### Task 3: RecorderProvider synthesizes deterministic tokenUsage
**Story:** 4.1-1 (happy path — RecorderProvider populates tokenUsage for stable test fixtures)
**Type:** happy-path

**Steps:**
1. Write failing test: call `recorderProvider.invoke(options)` → returned
   `InvokeResult.tokenUsage` has `{ input: 10, output: 5 }` (deterministic)
2. Verify RED
3. In `plugins/recorder-provider/index.ts`, add `tokenUsage: { input: 10, output: 5 }`
   to the returned `InvokeResult` from `invoke()` and `invokeInteractive()`
4. Verify GREEN
5. Commit: `feat(recorder): RecorderProvider synthesizes deterministic tokenUsage`

**Files:**
- `plugins/recorder-provider/index.ts`

**Dependencies:** Task 1

---

### Task 4: Third-party provider without tokenUsage does not crash EventPersister
**Story:** 4.1-1 (negative path — graceful degradation for missing tokenUsage)
**Type:** negative-path

**Steps:**
1. Write failing test: create a minimal `LLMProvider` whose `invoke()` returns
   `{ success: true, output: 'ok', exitCode: 0 }` (no `tokenUsage`); feed a
   step_completed event (without tokenUsage) to EventPersister → no error thrown,
   line is written without a `tokenUsage` field
2. Verify RED
3. Confirm EventPersister serializes the raw event without checking for tokenUsage
   (persists event fields as-is; no crash)
4. Verify GREEN
5. Commit: `test(execution): missing tokenUsage on InvokeResult is gracefully ignored`

**Files:**
- `test/engine/event-persister.test.ts` (new — will grow with Tasks 5–8)

**Dependencies:** Task 1

---

### Task 5: EventPersister class — subscribes and appends JSON lines
**Story:** 4.1-2 (happy path — core persistence)
**Type:** happy-path

**Steps:**
1. Write failing tests:
   (a) `new EventPersister('.pipeline/events.jsonl')` — after `start()`, emitting a
       `step_started` event on the bus → file contains one line that is valid JSON
       with the event fields plus a `ts` ISO 8601 string
   (b) Two events emitted → two lines in the file
   (c) Line count equals number of events emitted
2. Verify RED
3. Create `src/conductor/src/engine/event-persister.ts`:
   - `EventPersister` class
   - `constructor(filePath: string, emitter: ConductorEventEmitter)`
   - `start(): void` — subscribes to all ConductorEvent types on the emitter
   - `stop(): void` — unsubscribes all handlers
   - Handler: `(event) => fs.appendFileSync(filePath, JSON.stringify({...event, ts}) + '\n')`
4. Verify GREEN
5. Commit: `feat(telemetry): EventPersister subscribes to event bus and appends JSON lines`

**Files:**
- `src/conductor/src/engine/event-persister.ts` (new)
- `test/engine/event-persister.test.ts`

**Dependencies:** Task 4

---

### Task 6: EventPersister creates file and parent directories on first write
**Story:** 4.1-2 (happy path — parent dir creation)
**Type:** happy-path

**Steps:**
1. Write failing test: use a temp dir path like `tmpdir/subdir/events.jsonl` where
   `subdir` does not exist → after emitting one event, file exists and is parseable
2. Verify RED
3. Add `fs.mkdirSync(path.dirname(filePath), { recursive: true })` before first
   `appendFileSync` call (called once in `start()` or lazily on first write)
4. Verify GREEN
5. Commit: `feat(telemetry): EventPersister creates parent directories for events.jsonl`

**Files:**
- `src/conductor/src/engine/event-persister.ts`

**Dependencies:** Task 5

---

### Task 7: EventPersister write-permission error → EventPersistError
**Story:** 4.1-2 (negative path — write failure)
**Type:** negative-path

**Steps:**
1. Write failing test: point EventPersister at a path in a read-only directory;
   emit one event → `EventPersistError` thrown containing the file path and the
   OS error message (not a raw `EACCES` stack trace exposed to the conductor)
2. Verify RED
3. Add `try/catch` around `appendFileSync`; catch OS errors, wrap in
   `EventPersistError(filePath, originalError)` and re-throw
4. Verify GREEN
5. Commit: `feat(telemetry): EventPersistError wraps write-permission failures`

**Files:**
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/src/types/errors.ts` (new EventPersistError class, or add to existing errors)

**Dependencies:** Task 5

---

### Task 8: Wire EventPersister in index.ts (not in conductor.ts/step-runners.ts)
**Story:** 4.1-3 (happy path + negative path — correct wiring location)
**Type:** happy-path

**Steps:**
1. Write failing test (grep-based): after wiring,
   `grep -r "EventPersister" src/conductor/src/engine/conductor.ts` returns 0 matches
   `grep -r "EventPersister" src/conductor/src/engine/step-runners.ts` returns 0 matches
2. Verify RED (wiring does not yet exist — 0 matches pass trivially; add positive wiring test)
3. In `src/conductor/src/index.ts`, after event bus init and before `conductor.run()`:
   ```ts
   const persister = new EventPersister(eventsLogPath, events);
   persister.start();
   ```
   And in cleanup:
   ```ts
   persister.stop();
   ```
4. Add test: with EventPersister absent (disabled), conductor runs, events.jsonl NOT created,
   no error thrown — confirm existing conductor path is unaffected
5. Verify GREEN
6. Commit: `feat(telemetry): wire EventPersister in index.ts before conductor.run()`

**Files:**
- `src/conductor/src/index.ts`

**Dependencies:** Task 6

---

### Task 9: report-renderer reads events.jsonl and renders step durations table
**Story:** 4.1-4 (happy path — step durations table)
**Type:** happy-path

**Steps:**
1. Write failing test: feed a fixture events.jsonl with step_started + step_completed pairs
   for steps "brainstorm" (500ms gap) and "plan" (100ms gap) → `renderReport(lines)` returns
   a string containing "Step Durations" header and "brainstorm" before "plan" (sorted descending)
2. Verify RED
3. Create `src/conductor/src/engine/report-renderer.ts`:
   - `renderReport(eventsJsonlPath: string): string` — reads all lines, parses events,
     derives step durations from `step_started`/`step_completed` pairs
   - Renders "Step Durations" table: columns `Step`, `Duration (ms)`, sorted descending
   - Steps with no `step_completed` show `—`
4. Verify GREEN
5. Commit: `feat(telemetry): report-renderer renders step durations table sorted descending`

**Files:**
- `src/conductor/src/engine/report-renderer.ts` (new)
- `test/engine/report-renderer.test.ts` (new)

**Dependencies:** Task 5 (understands event schema)

---

### Task 10: report-renderer — missing events.jsonl exits with message + code 1
**Story:** 4.1-4 (negative path — missing log file)
**Type:** negative-path

**Steps:**
1. Write failing test: call `renderReport('/nonexistent/path/events.jsonl')` →
   throws `ReportError` with message "No event log found at /nonexistent/..." and
   a `exitCode: 1` property
2. Verify RED
3. Add existence check at top of `renderReport()`; throw `ReportError` if not found
4. Verify GREEN
5. Commit: `feat(telemetry): renderReport throws ReportError for missing events.jsonl`

**Files:**
- `src/conductor/src/engine/report-renderer.ts`

**Dependencies:** Task 9

---

### Task 11: report-renderer — retry hotspots table
**Story:** 4.1-5 (happy path — retry table)
**Type:** happy-path

**Steps:**
1. Write failing tests:
   (a) Fixture with step_retry events → "Retry Hotspots" section shows step name,
       retry count, most common reason
   (b) Fixture with NO step_retry events → "No retries recorded" message (not empty table)
2. Verify RED
3. Add retry hotspots section to `renderReport()`: aggregate `step_retry` events by step,
   count total retries, find most common reason; render after step durations
4. Verify GREEN
5. Commit: `feat(telemetry): report-renderer adds retry hotspots table`

**Files:**
- `src/conductor/src/engine/report-renderer.ts`

**Dependencies:** Task 9

---

### Task 12: Retry step with no completion shown with retry count + "(failed)" notation
**Story:** 4.1-5 (negative path — failed step in retry table)
**Type:** negative-path

**Steps:**
1. Write failing test: fixture has step_retry events for "plan" + step_failed event but
   no step_completed for "plan" → retry table row for "plan" shows retry count with "(failed)"
   annotation; does NOT disappear from the table
2. Verify RED
3. Add failed-step annotation logic to retry hotspot rendering
4. Verify GREEN
5. Commit: `test(telemetry): failed-step-with-retries shown as (failed) in retry table`

**Files:**
- `src/conductor/src/engine/report-renderer.ts`

**Dependencies:** Task 11

---

### Task 13: report-renderer — token spend table (with graceful degradation)
**Story:** 4.1-6 (happy + negative paths — token table)
**Type:** happy-path

**Steps:**
1. Write failing tests:
   (a) Fixture with step_completed events that include tokenUsage → "Token Spend" section
       shows step, input tokens, output tokens columns; only steps with tokenUsage appear
   (b) Fixture with NO tokenUsage on any event → "No token data recorded" message
2. Verify RED
3. Add token spend section to `renderReport()`: collect `tokenUsage` from step_completed
   events (the field may need to be threaded into the event — see Task 14 below);
   if no rows, emit the empty message
4. Verify GREEN
5. Commit: `feat(telemetry): report-renderer adds token spend table with graceful degradation`

**Files:**
- `src/conductor/src/engine/report-renderer.ts`

**Dependencies:** Task 11

> **Note on tokenUsage in events:** `step_completed` does not currently carry tokenUsage.
> EventPersister persists raw ConductorEvents as-is. If `step_completed` doesn't yet carry
> tokenUsage, the report can read it from the event immediately before `step_completed`
> (the `InvokeResult` isn't directly on the event). Simplest approach: extend the
> `step_completed` event type to carry an optional `tokenUsage` field, and have the
> conductor/step-runner set it when available. This is a small, backwards-compatible
> addition to `src/conductor/src/types/events.ts`. Decide during implementation and
> keep it minimal.

---

### Task 14: conduct --report flag in cli.ts and branches in index.ts
**Story:** 4.1-4 (infrastructure — CLI subcommand wiring)
**Type:** infrastructure

**Steps:**
1. Write failing test: parse `['--report']` via `parseArgs()` → returned `CLIOptions`
   has `report: true`; verify it does NOT trigger a Claude session (no `invoke()` called)
2. Verify RED
3. In `src/conductor/src/cli.ts`: add `report: boolean` to `CLIOptions`, add
   `--report` option to Commander (`program.option('--report', 'Print run summary')`)
4. In `src/conductor/src/index.ts`: check `opts.report` early (after registry init is
   not needed) — if true, call `renderReport(eventsLogPath)`, print result, exit 0
5. Verify GREEN
6. Commit: `feat(cli): add conduct --report subcommand for run summary`

**Files:**
- `src/conductor/src/cli.ts`
- `src/conductor/src/index.ts`

**Dependencies:** Task 10 (renderReport exists and throws correctly)

---

### Task 15: Integration test — full conductor run produces valid events.jsonl
**Story:** 4.1-7 (happy path — end-to-end event log)
**Type:** happy-path

**Steps:**
1. Write failing integration test: run minimal conductor sequence (at least 2 steps),
   read `.pipeline/events.jsonl` → all lines parse as valid JSON, all `type` values
   are members of ConductorEvent union, all lines have a `ts` field (ISO 8601)
2. Verify RED
3. No new code — validates Task 8's wiring end-to-end
4. Verify GREEN
5. Commit: `test(telemetry): integration test — conductor produces well-formed events.jsonl`

**Files:**
- `test/integration/event-persister-e2e.test.ts` (new)

**Dependencies:** Task 8

---

### Task 16: Integration test — events before SIGINT are present and parseable
**Story:** 4.1-7 (negative path — interrupted run resilience)
**Type:** negative-path

**Steps:**
1. Write failing test: simulate mid-run interruption by starting the EventPersister,
   emitting 5 events, then calling `persister.stop()` abruptly; read the file →
   exactly 5 lines, all valid JSON (no partial lines)
2. Verify RED
3. `appendFileSync` is synchronous — the only risk is a partial write from a literal
   SIGINT during the appendFileSync call. Confirm `appendFileSync` is atomic for
   typical line lengths (<4KB). Add a test-level SIGINT simulation (process.kill) if
   the test framework allows; otherwise, test the "stop mid-session" scenario
4. Verify GREEN
5. Commit: `test(telemetry): events before stop() are present and parseable (interrupt resilience)`

**Files:**
- `test/integration/event-persister-e2e.test.ts`

**Dependencies:** Task 15

---

### Task 17: CHANGELOG entry and VERSION check
**Story:** N/A — PR gate
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md [Unreleased] > Added`:
   - "Feature 4.1: EventPersister — every ConductorEvent persisted to .pipeline/events.jsonl
     (newline-delimited JSON, replayable)"
   - "Feature 4.1: conduct --report subcommand — renders step durations, retry hotspots,
     and token spend tables from events.jsonl"
   - "Feature 4.1: Optional tokenUsage field on InvokeResult — ClaudeProvider parses from
     stream-json; RecorderProvider synthesizes deterministic counts"
2. Read current VERSION — confirm 0.99.x
3. Present VERSION to user for approval (CLAUDE.md gate)
4. Run `test/test_harness_integrity.sh` — baseline must pass
5. Commit: `chore: CHANGELOG entry for Feature 4.1 telemetry + structured event log`

**Files:**
- `CHANGELOG.md`

**Dependencies:** Tasks 1–16 all passing

---

## Task Dependency Graph

```
T1 (tokenUsage type) → T2 (Claude parses) 
                     → T3 (Recorder synthesizes)
                     → T4 (missing tokenUsage no-op)

T4 → T5 (EventPersister core) → T6 (parent dirs) → T7 (write-error)
                               → T6              → T8 (wire index.ts) → T15 (e2e) → T16 (SIGINT)

T5 → T9 (step durations)   → T10 (missing log)
   → T9                    → T11 (retry table) → T12 (failed step)
                           → T11               → T13 (token table)

T10 → T14 (--report CLI)

T17 (changelog) — last
```

## Integration Points

- After Task 8: EventPersister wired — `events.jsonl` appears on any conductor run
- After Task 13: All three report sections render correctly from fixture files
- After Task 14: `conduct --report` is a first-class subcommand

## Coverage Check

| Story | Criterion | Task(s) |
|-------|-----------|---------|
| 4.1-1 happy | ClaudeProvider populates tokenUsage | T2 |
| 4.1-1 happy | RecorderProvider synthesizes tokenUsage | T3 |
| 4.1-1 negative | missing tokenUsage no crash | T4 |
| 4.1-2 happy | events.jsonl created, each line valid JSON + ts | T5, T6 |
| 4.1-2 happy | file created including parent dirs | T6 |
| 4.1-2 negative | write permission → EventPersistError | T7 |
| 4.1-3 happy | EventPersister in index.ts not conductor.ts | T8 |
| 4.1-3 negative | absent persister → no error, no file | T8 |
| 4.1-4 happy | step durations table sorted descending | T9 |
| 4.1-4 happy | steps with no completion show "—" | T9 |
| 4.1-4 negative | missing events.jsonl → exit 1 + message | T10 |
| 4.1-5 happy | retry hotspots table with count + reason | T11 |
| 4.1-5 happy | no retries → "No retries recorded" | T11 |
| 4.1-5 negative | failed step with retries shown | T12 |
| 4.1-6 happy | token spend table (only steps with data) | T13 |
| 4.1-6 negative | no token data → "No token data recorded" | T13 |
| 4.1-7 happy | events.jsonl well-formed after full run | T15 |
| 4.1-7 negative | interrupted run: events before interrupt parseable | T16 |

All 18 criteria covered. ✅
