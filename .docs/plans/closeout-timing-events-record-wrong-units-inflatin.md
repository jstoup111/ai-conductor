# Implementation Plan: closeout timing events record wrong units (#2049)

**Date:** 2026-10-10
**Design:** none — technical track, Tier S (`.docs/track/closeout-timing-events-record-wrong-units-inflatin.md`, `.docs/complexity/closeout-timing-events-record-wrong-units-inflatin.md`)
**Stories:** `.docs/stories/closeout-timing-events-record-wrong-units-inflatin.md`
**Conflict check:** Skipped — tier S per `.docs/complexity/closeout-timing-events-record-wrong-units-inflatin.md`

## Summary

Replaces the caller-timed `ai-conductor closeout-event <obligation> <started-at> <ended-at>` with a
`start`/`end` bracket whose two timestamps come from the command's own clock, and routes every
closeout-duration reader through one shared trust check, in 8 tasks.

## Technical Approach

Governing design: `adr-2026-08-08-pipeline-owned-closeout-timestamps` stays in force unchanged —
closeout telemetry is `ConductorEvent`s written by a pipeline-side command to the pipeline-owned
sibling ledger `.pipeline/pipeline-events.jsonl`, tailed onto the bus by `CloseoutEventTail`, and
never persisted into `.pipeline/events.jsonl`. This plan changes only who supplies the timestamps and
how readers judge them. Event-spine check: the start occurrence is a new variant of the existing
`ConductorEvent` union written to the existing sibling ledger in the same schema (exception A, a
separate process with no bus access) — no new channel, file, or format.

- **Shared trust check (Task 1).** New pure module `src/conductor/src/engine/closeout-trust.ts` exporting
  `closeoutDurationMs(event: { startedAt: unknown; endedAt: unknown; ts: unknown }): number | undefined`
  and the constants `CLOSEOUT_EPOCH_FLOOR_MS = 1577836800000` (2020-01-01T00:00:00.000Z) and
  `CLOSEOUT_FUTURE_SKEW_MS = 60000`. It returns `endedAt - startedAt` only when `startedAt`, `endedAt`
  and `ts` are all `Number.isSafeInteger`, both timestamps are `>= CLOSEOUT_EPOCH_FLOOR_MS` and
  `<= ts + CLOSEOUT_FUTURE_SKEW_MS`, and `endedAt > startedAt`; otherwise `undefined`. Nanosecond
  values (~1.788e18) exceed the ceiling; the `startedAt == endedAt` shape fails the strict ordering.
  No reader may compute `endedAt - startedAt` itself after this change.
- **Readers (Tasks 2–4).** `closeoutDurations` in `src/conductor/src/engine/build-tail-rollup.ts` returns
  `undefined` (window/rollup `partial`, no closeout total) when any `pipeline_closeout` record in scope is
  untrusted — the existing degradation path, now also reached by unit/ordering errors, so a trusted
  record is never summed alongside an untrusted one. The daemon log (`renderDaemonEvent` in
  `src/conductor/src/daemon-cli.ts`) and the terminal UI (`src/conductor/src/ui/terminal-renderer.ts`) render
  `closeout <obligation> (<N>ms)` for trusted records and `closeout <obligation> (duration unavailable)`
  otherwise. OTel `onPipelineCloseout` in `src/conductor/src/engine/otel/metrics.ts` skips the histogram for
  an untrusted record; `onPipelineCloseout` in `src/conductor/src/engine/otel/span-manager.ts` still adds the
  span event but omits `durationMs` when untrusted.
- **Start occurrence (Task 5).** Add union member `{ type: 'pipeline_closeout_started'; obligation: <same
  five-obligation union as pipeline_closeout>; ts: number }` to `src/conductor/src/types/events.ts`, add it
  to `ExternalPipelineEvent` in `src/conductor/src/engine/closeout-events.ts`, and give it the `EVENT_SINKS`
  row `{ render: false, persist: false, audit: false, otel: false }` in `src/conductor/src/engine/event-sinks.ts`
  (it is bookkeeping for the pairing, not a rendered measurement). `build-tail-rollup.ts` already filters on
  `type === 'pipeline_closeout'`, so the new record contributes nothing to a rollup.
- **CLI (Tasks 6–7).** `src/conductor/src/engine/closeout-cli.ts`: `detectCloseoutEventCommand` parses
  `closeout-event <action> <obligation>` into `{ kind, action, obligation, extraArgs }`; commander
  registration in `src/conductor/src/cli.ts` becomes `closeout-event <action> <obligation>`.
  `dispatchCloseoutEventCommand` validates action (`start` or `end`, else exit 1 naming both forms — this
  also catches the legacy `closeout-event evaluator <n> <n>` shape, whose first operand is not an action),
  refuses any extra positional argument the same way, validates the obligation against the existing list,
  then: `start` appends `{ type: 'pipeline_closeout_started', obligation, ts: now() }`; `end` reads the
  sibling ledger line by line (skipping lines that fail `JSON.parse`), tracks per obligation the `ts` of
  the latest `pipeline_closeout_started` not followed by a `pipeline_closeout` for that obligation, and —
  if one is open and `now() > startTs` — appends `{ type: 'pipeline_closeout', obligation, startedAt:
  startTs, endedAt: now(), ts: now() }` (one `now()` reading). No open start: exit 1, "no open start for
  <obligation>". `now() <= startTs`: exit 1 naming the non-positive elapsed time. Every refusal returns
  before `appendCloseoutEvent`, so the ledger is untouched.
- **Skill contract (Task 8).** `skills/pipeline/SKILL.md` batch-boundary enforcement: record
  `ai-conductor closeout-event start evaluator` immediately before dispatching the evaluator and
  `ai-conductor closeout-event end evaluator` after the `review.json` stat check; on a refused end, halt
  with the existing message, then start, re-dispatch the evaluator, and end. The predicate
  `pipeline_closeout_gate_contract_holds` in `test/test_harness_integrity.sh` gains clauses for both
  commands plus a fixture that restores the timestamp form.
- **Fixture migration.** Existing tests use non-epoch closeout fixtures (`startedAt: 100, endedAt: 140`,
  `15/20`, `1/2`) which the trust check rejects by design. Each task migrates the fixtures in the test
  files it lists to epoch-ms values (base `1_788_000_000_000`) and keeps the original assertion intent.

Sequencing: the trust check (1) unblocks the four readers (2–4) in parallel; the union member (5) is
independent; the CLI (6, then 7) needs the union member and the rollup; the skill text (8) names the
final CLI forms.

## Prerequisites

- None. No migration, config key, or dependency changes. Existing on-disk records are not rewritten.

## Tasks

### Task 1: Shared closeout trust check
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/closeout-trust.test.ts`: a trusted two-minute pair (`startedAt 1788044947584`, `endedAt 1788045067584`, `ts 1788045067790`) returns 120000; each #2049 shape returns `undefined` — both-nanosecond (`1788044947584758500`/`1788045067588425500`), mixed (`1788012400000`/`178801157372296540`), equal (`1788012086561`/`1788012086561`), reversed, non-integer (`1788012086561.5`), below floor (`100`/`140`), and `endedAt` more than 60000 ms after `ts`; a non-number field returns `undefined`.
2. Verify RED.
3. Implement `closeoutDurationMs`, `CLOSEOUT_EPOCH_FLOOR_MS`, and `CLOSEOUT_FUTURE_SKEW_MS` in `src/conductor/src/engine/closeout-trust.ts` exactly as the Technical Approach states (pure, no imports from fs).
4. Verify GREEN.
5. Commit: "feat(closeout): add shared closeout timing trust check".

**Done when:**
- [test] `closeoutDurationMs` returns 120000 for the trusted two-minute pair whose values are safe integers within [1577836800000, ts + 60000] with endedAt > startedAt.
- [test] `closeoutDurationMs` returns `undefined` for the both-nanosecond, mixed ms/ns, equal, reversed, non-integer, below-floor, beyond-skew, and non-number fixtures.

**Files likely touched:**
- `src/conductor/src/engine/closeout-trust.ts` — new trust function and constants
- `src/conductor/test/closeout-trust.test.ts` — new unit tests

**Dependencies:** none

### Task 2: build-tail rollup judges closeout records through the trust check
**Story:** 3
**Type:** happy-path

**Steps:**
1. Migrate the closeout fixtures in `src/conductor/test/build-tail-rollup.test.ts` and `src/conductor/test/build-tail-cli.test.ts` to epoch-ms values that pass `closeoutDurationMs`, keeping each test's assertion intent.
2. Write failing tests: (a) `dispatchBuildTailCommand` over a worktree whose merged ledgers hold one build window with trusted `evaluator` records of 120000 ms and 30000 ms prints a window closeout line `Closeout: 150000ms (evaluator=150000ms)`; (b) a window holding a nanosecond-pair record, and separately an equal-pair record, prints `Build tail rollup: partial` and no `Closeout:` millisecond total; (c) a window holding one trusted and one untrusted record prints `Build tail rollup: partial` and does not print the trusted record's duration as a closeout total; (d) a ledger with no closeout records renders output byte-identical to a literal expected string captured from the pre-change renderer (closeout `unrecorded`); (e) adding a raw `{"type":"pipeline_closeout_started","obligation":"evaluator","ts":…}` line to the sibling ledger leaves the rollup output of (a) and (d) byte-identical; (f) replaying the six-record sample from #2049 (verbatim values) prints no millisecond closeout figure.
3. Verify RED.
4. Implement: in `closeoutDurations` (`src/conductor/src/engine/build-tail-rollup.ts`) replace the inline type/ordering check and `endedAt - startedAt` with `closeoutDurationMs(event)`; an `undefined` result returns `undefined` from `closeoutDurations` (existing `partial` path), and the obligation-name string check stays.
5. Verify GREEN.
6. Commit: "fix(build-tail): reject untrusted closeout records instead of summing them".

**Done when:**
- [test] `dispatchBuildTailCommand` on a window with trusted evaluator records of 120000 ms and 30000 ms prints `Closeout: 150000ms (evaluator=150000ms)`.
- [test] `dispatchBuildTailCommand` on a window containing a nanosecond-pair record, on one containing an equal-pair record, and on one mixing a trusted with an untrusted record each prints `Build tail rollup: partial` with no `Closeout:` millisecond total, so the trusted record's duration is not reported as the window total.
- [test] With no closeout records the output is byte-identical to a literal expected string captured from the pre-change renderer for the same ledger (closeout `unrecorded`), and adding a `pipeline_closeout_started` line leaves the rendered output byte-identical, as asserted by the no-closeout and started-record tests.
- [test] Replaying the six #2049 sample records through `dispatchBuildTailCommand` prints no millisecond closeout figure for any of the five untrusted records.
- `closeoutDurations` in `build-tail-rollup.ts` contains no `endedAt - startedAt` expression and obtains every duration from `closeoutDurationMs`.

**Files likely touched:**
- `src/conductor/src/engine/build-tail-rollup.ts` — use the trust check
- `src/conductor/test/build-tail-rollup.test.ts` — fixture migration and new cases
- `src/conductor/test/build-tail-cli.test.ts` — fixture migration and CLI-rendered cases

**Dependencies:** Task 1

### Task 3: Daemon log and terminal UI render the trusted duration or "duration unavailable"
**Story:** 3
**Type:** happy-path

**Steps:**
1. Migrate the `pipeline_closeout` fixtures in `src/conductor/test/engine/daemon-cli.test.ts` and `src/conductor/test/ui/terminal-renderer.test.ts` to trusted epoch-ms values.
2. Write failing tests: a trusted 120000 ms `evaluator` record renders `· ✓ closeout evaluator (120000ms)` through `renderDaemonEvent` and a line containing `closeout evaluator (120000ms)` through the terminal renderer; the mixed ms/ns record (`1788012400000`/`178801157372296540`) renders `· ✓ closeout evaluator (duration unavailable)` through `renderDaemonEvent` and a line containing `closeout evaluator (duration unavailable)` through the terminal renderer.
3. Verify RED.
4. Implement: both `pipeline_closeout` cases call `closeoutDurationMs(event)` and render `(<N>ms)` when defined, `(duration unavailable)` when `undefined`.
5. Verify GREEN.
6. Commit: "fix(closeout): render untrusted closeout durations as unavailable".

**Done when:**
- [test] `renderDaemonEvent` renders `· ✓ closeout evaluator (120000ms)` for the trusted 120000 ms record and `· ✓ closeout evaluator (duration unavailable)` for the mixed ms/ns record.
- [test] The terminal renderer's `pipeline_closeout` line contains `closeout evaluator (120000ms)` for the trusted record and `closeout evaluator (duration unavailable)` for the mixed ms/ns record.
- Neither `daemon-cli.ts` nor `terminal-renderer.ts` contains `event.endedAt - event.startedAt`; both obtain the figure from `closeoutDurationMs`.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — `pipeline_closeout` log line
- `src/conductor/src/ui/terminal-renderer.ts` — `pipeline_closeout` region line
- `src/conductor/test/engine/daemon-cli.test.ts` — fixture migration and cases
- `src/conductor/test/ui/terminal-renderer.test.ts` — fixture migration and cases

**Dependencies:** Task 1

### Task 4: OTel export records only trusted closeout durations
**Story:** 3
**Type:** happy-path

**Steps:**
1. Migrate `pipeline_closeout` fixtures in `src/conductor/test/engine/otel/metrics.test.ts`, `src/conductor/test/engine/otel/span-manager.test.ts`, and `src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts` (currently `startedAt: 1, endedAt: 2`) to trusted epoch-ms values.
2. Write failing tests: a trusted 120000 ms record makes `onPipelineCloseout` record 120000 on the closeout duration histogram and makes the span-manager's `pipeline_closeout` span event carry `durationMs: 120000`; an untrusted (nanosecond-pair) record makes the histogram record nothing and the span event carry `obligation`, `startedAt`, `endedAt` but no `durationMs` attribute.
3. Verify RED.
4. Implement: `metrics.ts` `onPipelineCloseout` records only when `closeoutDurationMs(event)` is defined; `span-manager.ts` includes `durationMs` only when defined.
5. Verify GREEN.
6. Commit: "fix(otel): export only trusted closeout durations".

**Done when:**
- [test] `onPipelineCloseout` in `metrics.ts` records 120000 on the closeout duration histogram for the trusted record and records nothing for the nanosecond-pair record, as asserted by the metrics tests.
- [test] The span-manager `pipeline_closeout` span event carries `durationMs` 120000 for the trusted record and omits `durationMs` for the nanosecond-pair record.
- The daemon-otel-parity acceptance fixture uses trusted epoch-ms values and its existing parity assertions still pass.
- Neither `metrics.ts` nor `span-manager.ts` contains `event.endedAt - event.startedAt`; both obtain the duration from `closeoutDurationMs`.

**Files likely touched:**
- `src/conductor/src/engine/otel/metrics.ts` — guarded histogram record
- `src/conductor/src/engine/otel/span-manager.ts` — conditional `durationMs`
- `src/conductor/test/engine/otel/metrics.test.ts` — fixture migration and cases
- `src/conductor/test/engine/otel/span-manager.test.ts` — fixture migration and cases
- `src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts` — fixture migration

**Dependencies:** Task 1

### Task 5: Closeout-started occurrence joins the event union
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/event-sinks.test.ts`, `EVENT_SINKS.pipeline_closeout_started` equals `{ render: false, persist: false, audit: false, otel: false }` and `renderedEventTypes()`/`persistedEventTypes()` exclude it; in `src/conductor/test/closeout-tail.test.ts`, a `pipeline_closeout_started` line appended through `appendCloseoutEvent` is re-emitted once by `CloseoutEventTail` and never written to `.pipeline/events.jsonl` by `EventPersister`; add the type to the completeness table in `src/conductor/test/integration/audit-trail-completeness.integration.test.ts` as `not-audited-by-design` with a fixture.
2. Verify RED.
3. Implement the union member in `src/conductor/src/types/events.ts`, the `ExternalPipelineEvent` member in `src/conductor/src/engine/closeout-events.ts`, and the `EVENT_SINKS` row in `src/conductor/src/engine/event-sinks.ts`; add the type to any exhaustive event-type list the compiler or the tests require (for example the handled-type list in `src/conductor/src/ui/terminal-renderer.ts` only if its test requires every type).
4. Verify GREEN.
5. Commit: "feat(closeout): add pipeline_closeout_started event variant".

**Done when:**
- [test] `EVENT_SINKS.pipeline_closeout_started` is `{ render: false, persist: false, audit: false, otel: false }` and neither `renderedEventTypes()` nor `persistedEventTypes()` includes it, so the daemon log and terminal UI (which subscribe via `renderedEventTypes()`) and the OTel export never receive it.
- [test] A `pipeline_closeout_started` record appended via `appendCloseoutEvent` is re-emitted exactly once by `CloseoutEventTail` and is absent from `.pipeline/events.jsonl` afterward.
- `pipeline_closeout_started` is a member of the `ConductorEvent` union and of `ExternalPipelineEvent`, carrying `obligation` (the five-obligation union) and `ts`, and `tsc` passes.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new union member
- `src/conductor/src/engine/closeout-events.ts` — `ExternalPipelineEvent` member
- `src/conductor/src/engine/event-sinks.ts` — sink row
- `src/conductor/test/engine/event-sinks.test.ts` — sink assertions
- `src/conductor/test/closeout-tail.test.ts` — tail re-emission case
- `src/conductor/test/integration/audit-trail-completeness.integration.test.ts` — completeness row

**Dependencies:** none

### Task 6: `closeout-event start` and `end` stamp both timestamps from the command's clock
**Story:** 1
**Type:** happy-path

**Steps:**
1. Replace the positional-timestamp tests in `src/conductor/test/closeout-cli.test.ts` with failing tests using an injected `now`: `start evaluator` at T1 appends exactly one `pipeline_closeout_started` record (`obligation: 'evaluator'`, `ts: T1`) and exits 0; `end evaluator` at T2 = T1 + 120000 appends exactly one `pipeline_closeout` (`startedAt: T1`, `endedAt: T2`, `ts: T2`), exits 0, and `closeoutDurationMs` of it is 120000; starts at T1 and T3 then `end` at T4 records `startedAt: T3`; open starts for `summary` and `evaluator` then `end evaluator` appends only an `evaluator` record and a following `end summary` pairs with the `summary` start; an open start whose `ts` exceeds the end's `now()` exits 1 with a stderr message naming the non-positive elapsed time and leaves the ledger byte-identical. Keep the per-obligation `it.each` over the five obligations, now as start/end pairs.
2. Update `src/conductor/test/acceptance/build-post-task-tail-telemetry.acceptance.test.ts` to drive `detectCloseoutEventCommand` + `dispatchCloseoutEventCommand` with `['node','conduct-ts','closeout-event','start','evaluator']` and `['node','conduct-ts','closeout-event','end','evaluator']` (and the same for `summary`) under an injected clock, with no conductor running, asserting both record kinds land in `.pipeline/pipeline-events.jsonl`, `.pipeline/events.jsonl` is not created or changed by the commands, and `readBuildWindows` reports the closeout durations equal to the injected clock gaps.
3. Verify RED.
4. Implement in `src/conductor/src/engine/closeout-cli.ts` per the Technical Approach (detect `<action> <obligation>`, `start` append, `end` ledger scan tolerant of unparseable lines, single `now()` reading for `endedAt` and `ts`); change the commander registration in `src/conductor/src/cli.ts` to `closeout-event <action> <obligation>` with description "Record the start or end of a pipeline closeout obligation".
5. Verify GREEN.
6. Commit: "feat(closeout): stamp closeout timing from the recording command".

**Done when:**
- [test] `dispatchCloseoutEventCommand` for `start evaluator` exits 0 and appends exactly one `pipeline_closeout_started` record with obligation `evaluator` and `ts` equal to the injected `now()` reading.
- [test] `end evaluator` at T2 after a start at T1 exits 0 and appends exactly one `pipeline_closeout` record with obligation `evaluator`, `startedAt` T1, `endedAt` T2 and `ts` T2, and with T2 - T1 = 120000 `closeoutDurationMs` of that record is 120000, so the test asserts the record is a trusted closeout record (all three values safe integers in [1577836800000, ts + 60000] and endedAt > startedAt).
- [test] With starts at T1 and T3 and no end between, `end evaluator` at T4 records `startedAt` T3; with open `summary` and `evaluator` starts, `end evaluator` appends only an `evaluator` record and a later `end summary` still pairs with the `summary` start.
- [test] When the open start's `ts` is later than the end's `now()`, `end evaluator` exits 1, writes a stderr message naming the non-positive elapsed time, and leaves the sibling ledger byte-identical.
- [test] The acceptance test drives the `start evaluator` and `end evaluator` argv forms through `detectCloseoutEventCommand` with no conductor running, and asserts both records land in `.pipeline/pipeline-events.jsonl` while `.pipeline/events.jsonl` is not created or changed.

**Files likely touched:**
- `src/conductor/src/engine/closeout-cli.ts` — start/end command
- `src/conductor/src/cli.ts` — commander registration
- `src/conductor/test/closeout-cli.test.ts` — rewritten CLI tests
- `src/conductor/test/acceptance/build-post-task-tail-telemetry.acceptance.test.ts` — start/end argv flow

**Dependencies:** Task 2, Task 5

### Task 7: `closeout-event` refuses caller-timed, unpaired, and unknown requests without writing
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/closeout-cli.test.ts`, each snapshotting the sibling ledger bytes (or its absence) before and after through one shared helper: `closeout-event evaluator 1788012400000 1788012400000`, `closeout-event evaluator 1788044947584758500 1788045067588425500`, `closeout-event stop evaluator`, and `closeout-event start evaluator 1788012400000` each exit 1 with a stderr message naming the `start` and `end` forms; `end evaluator` with no open start, and a second `end evaluator` after one end closed the start, each exit 1 with stderr "no open start for evaluator"; `start retro` exits 1 printing the valid obligation list; a ledger with a malformed line preceding a valid open start still lets `end evaluator` record the closeout pairing that start.
2. Verify RED.
3. Implement the refusals in `dispatchCloseoutEventCommand`, each returning before `appendCloseoutEvent`.
4. Verify GREEN.
5. Commit: "fix(closeout): refuse caller-timed and unpaired closeout requests".

**Done when:**
- [test] The two legacy caller-timed forms, the unknown action `stop evaluator`, and `start evaluator` with an extra timestamp operand each exit 1 with a stderr message naming the `start` and `end` forms, so neither command accepts a timestamp argument.
- [test] `end evaluator` with no open start, and a second `end evaluator` after one end closed the start, each exit 1 with a stderr message stating no open start exists for `evaluator`.
- [test] `start retro` exits 1 and prints the valid obligation list to stderr.
- [test] For every refused request above, the shared byte-snapshot helper finds the sibling ledger byte-identical before and after the call (an absent ledger stays absent).
- [test] A sibling ledger with a malformed line before a valid open start still lets `end evaluator` append the closeout record pairing that start.

**Files likely touched:**
- `src/conductor/src/engine/closeout-cli.ts` — refusal branches
- `src/conductor/test/closeout-cli.test.ts` — refusal tests

**Dependencies:** Task 6

### Task 8: Pipeline evaluator gate brackets the evaluator with start and end
**Story:** 4
**Type:** happy-path

**Steps:**
1. Extend `pipeline_closeout_gate_contract_holds` in `test/test_harness_integrity.sh` with `grep -qF 'ai-conductor closeout-event start evaluator'`, `grep -qF 'ai-conductor closeout-event end evaluator'`, and a negative clause `! grep -qE 'closeout-event evaluator <started-at|<started-at-ms>|<ended-at-ms>'`; add a fixture made by `sed` that restores `ai-conductor closeout-event evaluator <started-at-ms> <ended-at-ms>` in place of the end instruction, asserting the predicate rejects it. Run the integrity script's closeout section to see RED against the current skill.
2. Edit `skills/pipeline/SKILL.md` batch-boundary enforcement: a step immediately before the evaluator dispatch to run `ai-conductor closeout-event start evaluator`; step 4 becomes `ai-conductor closeout-event end evaluator` run after the `review.json` stat check, followed by the existing verification sentence; add to the closeout hard-gate paragraph that a refused end (no open start) halts with `Batch N blocked: missing recorded closeout event for evaluator`, and recovery is to run `start`, re-dispatch the evaluator, and run `end` — never a back-to-back start and end. Keep every existing clause the predicate checks verbatim.
3. Verify GREEN with `bash test/test_harness_integrity.sh` filtered to the pipeline closeout assertions.
4. Commit: "docs(pipeline): bracket the evaluator with stamped closeout start and end".

**Done when:**
- `skills/pipeline/SKILL.md` instructs `ai-conductor closeout-event start evaluator` immediately before the evaluator dispatch and `ai-conductor closeout-event end evaluator` after the `review.json` stat check, and contains no `<started-at-ms>` or `<ended-at-ms>` or other timestamp passed to `closeout-event`.
- `skills/pipeline/SKILL.md` directs a refused end to halt with `Batch N blocked: missing recorded closeout event for evaluator` and to record a new start, re-dispatch the evaluator, and record the end rather than a back-to-back start and end.
- [test] `pipeline_closeout_gate_contract_holds` in `test/test_harness_integrity.sh` passes on the edited skill, still requires the `pipeline_closeout` obligation match, other-obligation, independent `review.json`, halt-message and both non-substitutability clauses, and rejects the restored-timestamp fixture.

**Files likely touched:**
- `skills/pipeline/SKILL.md` — evaluator closeout bracket and recovery
- `test/test_harness_integrity.sh` — closeout gate predicate and fixture

**Dependencies:** Task 7

## Task Dependency Graph

```
Task 1 ──┬─▶ Task 2 ──┐
         ├─▶ Task 3   ├─▶ Task 6 ─▶ Task 7 ─▶ Task 8
         └─▶ Task 4   │
Task 5 ───────────────┘
```

## Integration Points

- After Task 2: `ai-conductor build-tail` refuses to sum untrusted closeout records.
- After Task 6: the `closeout-event start`/`end` argv flow writes stamped records that `build-tail` decomposes.
- After Task 8: a pipeline session following the shipped skill produces engine-stamped evaluator closeout timing.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an empty sibling ledger, when `ai-conductor closeout-event start evaluator` runs, then it exits 0 and appends exactly one closeout-started record for obligation `evaluator` whose `ts` is the command's own current millisecond clock reading. | 6 | "`dispatchCloseoutEventCommand` for `start evaluator` exits 0 and appends exactly one `pipeline_closeout_started` record with obligation `evaluator` and `ts` equal to the injected `now()` reading." | diff-local |
| Story 1 happy: Given an open start for `evaluator` recorded at clock time T1, when `ai-conductor closeout-event end evaluator` runs at clock time T2, then it exits 0 and appends exactly one `pipeline_closeout` record with obligation `evaluator`, `startedAt` equal to T1, `endedAt` equal to T2, and `ts` equal to T2. | 6 | "`end evaluator` at T2 after a start at T1 exits 0 and appends exactly one `pipeline_closeout` record with obligation `evaluator`, `startedAt` T1, `endedAt` T2 and `ts` T2" | diff-local |
| Story 1 happy: Given an open start for `evaluator` recorded 120000 ms before `end evaluator` runs, when the end is recorded, then the record's duration is 120000 ms and it is a trusted closeout record. | 6 | "with T2 - T1 = 120000 `closeoutDurationMs` of that record is 120000, so the test asserts the record is a trusted closeout record" | diff-local |
| Story 1 happy: Given two `start evaluator` invocations at T1 and then T3 with no end between them, when `end evaluator` runs at T4, then the recorded `startedAt` is T3, the most recent open start. | 6 | "With starts at T1 and T3 and no end between, `end evaluator` at T4 records `startedAt` T3" | diff-local |
| Story 1 happy: Given an open start for `summary` and an open start for `evaluator`, when `end evaluator` runs, then only an `evaluator` record is appended and the `summary` start stays open. | 6 | "with open `summary` and `evaluator` starts, `end evaluator` appends only an `evaluator` record and a later `end summary` still pairs with the `summary` start" | diff-local |
| Story 1 happy: Given no conductor or daemon is running, when the start and end commands run in a bare pipeline session, then both records are written to `.pipeline/pipeline-events.jsonl` and nothing is written to `.pipeline/events.jsonl`. | 6 | "asserts both records land in `.pipeline/pipeline-events.jsonl` while `.pipeline/events.jsonl` is not created or changed" | diff-local |
| Story 1 negative: Given an open start for `evaluator` whose recorded `ts` is later than the end command's clock reading, when `end evaluator` runs, then it exits 1, prints a stderr message naming the non-positive elapsed time, and appends nothing. | 6 | "When the open start's `ts` is later than the end's `now()`, `end evaluator` exits 1, writes a stderr message naming the non-positive elapsed time, and leaves the sibling ledger byte-identical." | diff-local |
| Story 2 happy: Given a refused recording request, when the sibling ledger is read afterward, then its byte content is identical to its content before the request. | 7 | "For every refused request above, the shared byte-snapshot helper finds the sibling ledger byte-identical before and after the call (an absent ledger stays absent)." | diff-local |
| Story 2 negative: Given the former caller-timed form, when `ai-conductor closeout-event evaluator 1788012400000 1788012400000` runs, then it exits 1, prints a stderr message naming the `start` and `end` forms, and appends nothing. | 7 | "The two legacy caller-timed forms, the unknown action `stop evaluator`, and `start evaluator` with an extra timestamp operand each exit 1 with a stderr message naming the `start` and `end` forms" | diff-local |
| Story 2 negative: Given the former caller-timed form with nanosecond values, when `ai-conductor closeout-event evaluator 1788044947584758500 1788045067588425500` runs, then it exits 1 and appends nothing. | 7 | "The two legacy caller-timed forms, the unknown action `stop evaluator`, and `start evaluator` with an extra timestamp operand each exit 1" | diff-local |
| Story 2 negative: Given no open start for `evaluator`, when `ai-conductor closeout-event end evaluator` runs, then it exits 1, prints a stderr message stating that no open start exists for `evaluator`, and appends nothing. | 7 | "`end evaluator` with no open start, and a second `end evaluator` after one end closed the start, each exit 1 with a stderr message stating no open start exists for `evaluator`." | diff-local |
| Story 2 negative: Given an open start for `evaluator` that one `end evaluator` has already closed, when a second `end evaluator` runs, then it exits 1 with the no-open-start message and appends nothing. | 7 | "a second `end evaluator` after one end closed the start, each exit 1 with a stderr message stating no open start exists for `evaluator`." | diff-local |
| Story 2 negative: Given an unrecognized obligation, when `ai-conductor closeout-event start retro` runs, then it exits 1, prints the valid obligation list to stderr, and appends nothing. | 7 | "`start retro` exits 1 and prints the valid obligation list to stderr." | diff-local |
| Story 2 negative: Given an unrecognized action, when `ai-conductor closeout-event stop evaluator` runs, then it exits 1, prints a stderr message naming the `start` and `end` forms, and appends nothing. | 7 | "the unknown action `stop evaluator`, and `start evaluator` with an extra timestamp operand each exit 1 with a stderr message naming the `start` and `end` forms" | diff-local |
| Story 2 negative: Given a sibling ledger containing a malformed line, when `end evaluator` runs with an otherwise valid open start, then the malformed line does not prevent the open start from being found and the end is recorded. | 7 | "A sibling ledger with a malformed line before a valid open start still lets `end evaluator` append the closeout record pairing that start." | diff-local |
| Story 3 happy: Given a build window containing trusted `evaluator` records of 120000 ms and 30000 ms, when `ai-conductor build-tail` renders it, then the window's closeout reads 150000ms with `evaluator=150000ms`. | 2 | "`dispatchBuildTailCommand` on a window with trusted evaluator records of 120000 ms and 30000 ms prints `Closeout: 150000ms (evaluator=150000ms)`." | diff-local |
| Story 3 happy: Given a trusted `evaluator` record of 120000 ms, when the daemon log and the terminal UI render it, then both lines read `closeout evaluator (120000ms)`, the same value build-tail attributes to that record. | 3, 2 | "`renderDaemonEvent` renders `· ✓ closeout evaluator (120000ms)` for the trusted 120000 ms record" | diff-local |
| Story 3 happy: Given a trusted `evaluator` record of 120000 ms, when the OTel export receives it, then the closeout duration histogram records 120000 and the build span event carries `durationMs` 120000. | 4 | "The span-manager `pipeline_closeout` span event carries `durationMs` 120000 for the trusted record" | diff-local |
| Story 3 happy: Given a ledger with no closeout records, when `ai-conductor build-tail` renders it, then closeout is still reported as unrecorded exactly as before this change. | 2 | "With no closeout records the output is byte-identical to a literal expected string captured from the pre-change renderer for the same ledger (closeout `unrecorded`)" | diff-local |
| Story 3 happy: Given a closeout-started record in the sibling ledger, when any of the four readers processes the merged ledgers, then it contributes no duration and changes no rollup state. | 2, 5 | "adding a `pipeline_closeout_started` line leaves the rendered output byte-identical" | diff-local |
| Story 3 negative: Given a record with `startedAt` 1788044947584758500 and `endedAt` 1788045067588425500, when `ai-conductor build-tail` renders a ledger containing it, then the rollup state is `partial` and no closeout duration total is rendered. | 2 | "`dispatchBuildTailCommand` on a window containing a nanosecond-pair record, on one containing an equal-pair record, and on one mixing a trusted with an untrusted record each prints `Build tail rollup: partial` with no `Closeout:` millisecond total" | diff-local |
| Story 3 negative: Given a record whose `startedAt` equals its `endedAt`, when `ai-conductor build-tail` renders a ledger containing it, then the rollup state is `partial` and no closeout duration total is rendered. | 2 | "on one containing an equal-pair record, and on one mixing a trusted with an untrusted record each prints `Build tail rollup: partial` with no `Closeout:` millisecond total" | diff-local |
| Story 3 negative: Given a record with millisecond `startedAt` 1788012400000 and nanosecond `endedAt` 178801157372296540, when the daemon log and the terminal UI render it, then both lines read `closeout evaluator (duration unavailable)`. | 3 | "The terminal renderer's `pipeline_closeout` line contains `closeout evaluator (120000ms)` for the trusted record and `closeout evaluator (duration unavailable)` for the mixed ms/ns record." | diff-local |
| Story 3 negative: Given an untrusted record, when the OTel export receives it, then the closeout duration histogram records nothing for it and the span event omits `durationMs`. | 4 | "records nothing for the nanosecond-pair record" | diff-local |
| Story 3 negative: Given one trusted and one untrusted record in the same build window, when `ai-conductor build-tail` renders it, then the trusted record's duration is not reported as the window's closeout total and the rollup state is `partial`. | 2 | "so the trusted record's duration is not reported as the window total" | diff-local |
| Story 4 happy: Given the shipped `skills/pipeline/SKILL.md`, when its batch-boundary enforcement is read, then it instructs `ai-conductor closeout-event start evaluator` immediately before the evaluator dispatch and `ai-conductor closeout-event end evaluator` after the `review.json` stat check. | 8 | "`skills/pipeline/SKILL.md` instructs `ai-conductor closeout-event start evaluator` immediately before the evaluator dispatch and `ai-conductor closeout-event end evaluator` after the `review.json` stat check" | diff-local |
| Story 4 happy: Given the shipped `skills/pipeline/SKILL.md`, when the harness integrity suite checks its evaluator closeout-event gate clauses, then the required `pipeline_closeout` obligation match, the other-obligation clause, the independent `review.json` gate, the exact halt message, and both non-substitutability clauses still pass. | 8 | "still requires the `pipeline_closeout` obligation match, other-obligation, independent `review.json`, halt-message and both non-substitutability clauses" | diff-local |
| Story 4 negative: Given an orchestrator whose `end evaluator` is refused because no start is open, when it follows `skills/pipeline/SKILL.md`, then the skill directs it to halt with `Batch N blocked: missing recorded closeout event for evaluator` and to record a new start, re-dispatch the evaluator, and record the end rather than recording a start and end back to back. | 8 | "`skills/pipeline/SKILL.md` directs a refused end to halt with `Batch N blocked: missing recorded closeout event for evaluator` and to record a new start, re-dispatch the evaluator, and record the end rather than a back-to-back start and end." | diff-local |
| Story 4 negative: Given the shipped `skills/pipeline/SKILL.md`, when it is searched for the former caller-timed form, then no instruction passes `<started-at-ms>` or `<ended-at-ms>` or any other timestamp to `closeout-event`. | 8 | "contains no `<started-at-ms>` or `<ended-at-ms>` or other timestamp passed to `closeout-event`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
