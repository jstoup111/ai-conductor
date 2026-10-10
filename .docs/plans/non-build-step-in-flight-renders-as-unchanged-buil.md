# Implementation Plan: Non-build step in flight renders as unchanged build progress

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/non-build-step-in-flight-renders-as-unchanged-buil.md`)
**Stories:** .docs/stories/non-build-step-in-flight-renders-as-unchanged-buil.md
**Conflict check:** Not required (Tier S)

## Summary

Make every running non-build lifecycle step visibly alive. A new `step_in_flight` event is emitted
at each `build_progress.heartbeat_minutes` interval while a serial non-build step or a `validation`
group member is executing, and the daemon log renders it. `conduct daemon status` lists each
in-progress feature's open steps, derived from its persisted events. Six tasks: event + render,
ticker, serial seam, group-member seam, in-flight fold, status section.

## Technical Approach

- **Event spine (verdict: extend the union, no exception, no ADR).** The concern is an occurrence
  ("step X is still executing at time T"), so it becomes a `ConductorEvent` variant, emitted on the
  shared emitter by the engine, which knows the step is in flight. It does not infer that from
  state. Shape: `{ type: 'step_in_flight'; step: StepName; elapsedMs: number; featureSlug?: string }`.
  Sink: `{ render: true, persist: true, audit: false, otel: false }`. It carries no
  `executionContext`, so the execution-lifecycle tracker (`engine/execution-lifecycle.ts`), which
  pairs only start/terminal events, is unaffected. `daemon status` reads the existing merged
  ledger (`readMergedFeatureEvents`, `engine/build-tail-rollup.ts:198`). It adds no sidecar.
- **Interval and switch reuse `build_progress`.** `resolveBuildProgressConfig`
  (`engine/config.ts:3688`) supplies `heartbeat_minutes` (default 5) and `enabled`. No new config
  key, so there is no settings schema change and no migration.
- **Ticker.** New `src/conductor/src/engine/step-in-flight-ticker.ts`: `StepInFlightTicker` with
  options `{ events, step, startedAtMs, featureSlug?, config?, now? }`. `start()` is a no-op when
  already started or when `enabled` is false. Otherwise it sets an unref'd `setInterval` of
  `heartbeat_minutes * 60_000`. Each tick emits
  `{ type: 'step_in_flight', step, elapsedMs: now() - startedAtMs, featureSlug }` unless
  `stopped`. `stop()` is idempotent, sets `stopped`, and clears the interval. This mirrors
  `BuildProgressWatcher`'s lifecycle contract (`engine/build-progress-watcher.ts:233-305`).
- **Serial seam** (`engine/conductor.ts`). Capture `stepStartedAtMs = Date.now()` where the serial
  `step_started` is emitted (`:9031-9036`), before the retry loop, so elapsed time spans retries.
  Beside the existing `buildWatcher` construction (`:9488-9509`), construct and `start()` a ticker
  when `step.name !== 'build'` and `resolveBuildProgressConfig(this.config).enabled`. Call its
  `stop()` at both existing `buildWatcher?.stop()` sites: the protected-artifact early exit
  (`:9570`) and the attempt `finally` (`:9775`). `test_suite` dispatches through this seam
  (`:9562-9565`). The build path is untouched.
- **Group-member seam** (`engine/conductor.ts`, validation fan-out `:7303-7336`). Inside each
  member thunk, the `lifecycleObserver.onAdmitted` callback constructs and starts a ticker for
  `member.name`, with `startedAtMs` at admission. `onSettled` stops it, and a `try/finally` around
  that thunk's `runGroupBranch` await also stops it, so a throwing branch cannot leak a timer. An
  auth-recovery redispatch runs a fresh thunk with a fresh ticker. Config-declared `parallel:`
  groups (`runParallelGroupViaCore`, `:14235`) are out of scope (track scope boundary).
- **In-flight fold** (`engine/daemon-dashboard.ts`). Export a pure function
  `inFlightSteps(events: readonly BuildTailEvent[]): Array<{ step: string; startedAtMs: number }>`.
  It walks the timestamp-ordered events: `step_started` opens `step` at `ts`. `step_completed`,
  `step_failed`, `step_interrupted`, and `step_refused` for the same `step` close it. Every other
  type, including `step_retry`, leaves it unchanged. It returns open steps in start order.
  `scanInheritedState` already reads each worktree's merged events (`:597-607`). It sets
  `InProgressEntry.inFlight` from that read and leaves the field absent when the read is
  `undefined` or throws.
- **Status section** (`engine/daemon-observe-cli.ts`). `renderInFlightSection(repoPath, out, clock)`
  reuses `scanInheritedState`, as the sibling sections do (`:582-638`). It prints
  `  IN FLIGHT [<slug>]: <step> running <formatHeartbeatAge(clock().getTime() - startedAtMs)>`
  per open step. `runDaemonStatus` calls it only when `row.liveness === 'running'`.
- **Already met on main, regression-pinned only:** the build watcher stops when `build` settles,
  and validation members emit their own `step_started` (#2514). See the track artifact.

## Prerequisites

- None.

## Tasks

### Task 1: `step_in_flight` event, sink declaration, and daemon-log rendering
**Story:** Story 1 (happy 1–2 rendering)
**Type:** infrastructure

**Steps:**
1. Write failing tests. In `src/conductor/test/daemon-render-progress.test.ts`, `renderDaemonEvent({ type: 'step_in_flight', step: 'test_suite', elapsedMs: 393_000, featureSlug: 'feat-x' })` with `chalk.level = 0` yields exactly one line equal to `· ▶ test_suite running 6m33s · feat-x`, and a `prd_audit` event yields a line naming `prd_audit`. In `src/conductor/test/event-sink-registry.test.ts`, `EVENT_SINKS.step_in_flight` equals `{ render: true, persist: true, audit: false, otel: false }`.
2. Verify RED.
3. Add the variant to the `ConductorEvent` union in `src/conductor/src/types/events.ts`, with a doc comment naming its emitter and its interval key. Add the sink entry in `src/conductor/src/engine/event-sinks.ts`. Add a `case 'step_in_flight'` in `renderDaemonEventUnsafe` (`src/conductor/src/daemon-cli.ts`) rendering `${dot} ${chalk.cyan('▶')} ${event.step} running ${formatHeartbeatAge(event.elapsedMs)}${slug}`, where `slug` is ` · <featureSlug>` when present.
4. Verify GREEN; commit "feat(events): add step_in_flight heartbeat event and daemon rendering".

**Done when:**
- [test] `daemon-render-progress.test.ts` asserts `renderDaemonEvent` turns a `step_in_flight` event for `test_suite` with `elapsedMs: 393000` into exactly one line `· ▶ test_suite running 6m33s · feat-x`.
- [test] `daemon-render-progress.test.ts` asserts a `step_in_flight` event for `prd_audit` renders one line containing `▶ prd_audit running`.
- [test] `event-sink-registry.test.ts` asserts `EVENT_SINKS.step_in_flight` is `{ render: true, persist: true, audit: false, otel: false }`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — `step_in_flight` variant
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `src/conductor/src/daemon-cli.ts` — render case
- `src/conductor/test/daemon-render-progress.test.ts` — render assertions
- `src/conductor/test/event-sink-registry.test.ts` — sink assertion

**Dependencies:** none

### Task 2: `StepInFlightTicker` emits at each interval until stopped
**Story:** Story 1 (happy 1; negative 1, 2, 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/step-in-flight-ticker.test.ts`. Use `vi.useFakeTimers()`, an injected `now`, and a recording emitter with `heartbeat_minutes: 5`. (a) After `start()`, advancing 5 minutes emits one `step_in_flight` for `test_suite` whose `elapsedMs` equals `now() - startedAtMs`. Advancing another 5 minutes emits a second one. (b) Calling `stop()` at 4 minutes and then advancing 20 minutes emits nothing. (c) Calling `stop()` after the first emission and then advancing 20 minutes emits no further event. (d) With `build_progress: { enabled: false }`, `start()` followed by advancing 20 minutes emits nothing. (e) `stop()` before `start()`, and `stop()` twice, both return without throwing.
2. Verify RED.
3. Implement `StepInFlightTicker` in `src/conductor/src/engine/step-in-flight-ticker.ts` per Technical Approach, resolving config through `resolveBuildProgressConfig`.
4. Verify GREEN; commit "feat(engine): add StepInFlightTicker".

**Done when:**
- [test] `step-in-flight-ticker.test.ts` asserts that a started ticker emits one `step_in_flight` naming its step at each 5-minute interval, with `elapsedMs` equal to injected `now()` minus `startedAtMs`.
- [test] `step-in-flight-ticker.test.ts` asserts zero emissions when `stop()` is called before the first interval elapses, and none after `stop()` follows an emission.
- [test] `step-in-flight-ticker.test.ts` asserts `start()` with `build_progress.enabled: false` emits nothing across 20 minutes, and that `stop()` is idempotent and safe before `start()`.

**Files likely touched:**
- `src/conductor/src/engine/step-in-flight-ticker.ts` — new ticker
- `src/conductor/test/engine/step-in-flight-ticker.test.ts` — unit tests

**Dependencies:** Task 1

### Task 3: Serial non-build steps run a ticker for each attempt
**Story:** Story 1 (happy 1, 3; negative 1, 2, 3, 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/conductor-step-in-flight.test.ts`, modeled on `src/conductor/test/conductor-build-progress.test.ts`. They drive a `Conductor` with a fake step runner, record every event from its emitter, and use fake timers with `build_progress.heartbeat_minutes: 5`.
   (a) `test_suite` blocks until 11 minutes have been advanced, then resolves. The recorded events contain two `step_in_flight` with `step: 'test_suite'`, and none after `test_suite`'s `step_completed`.
   (b) In separate cases, `test_suite` resolves successfully at 2 minutes, resolves with a failed result (`success: false`, `max_retries: 1`) at 2 minutes, rejects at 2 minutes, or resolves at 2 minutes with a `refusal` result. Neither case records a `step_in_flight`, and advancing 20 more minutes records none.
   (c) The run executes `build` (resolving after 11 minutes, task status 1/1) then `test_suite` (blocking 11 minutes). No `step_in_flight` names `build`. No `build_progress` event follows `build`'s `step_completed`. `step_in_flight` events name `test_suite`.
   (d) With `build_progress.enabled: false`, `test_suite` blocking 11 minutes records no `step_in_flight`.
2. Verify RED.
3. In `src/conductor/src/engine/conductor.ts`, capture `stepStartedAtMs` at the serial `step_started` emission. Construct and start a `StepInFlightTicker` beside the `buildWatcher` for non-build steps when enabled, passing `featureSlug: state.feature_desc`. Stop it at both `buildWatcher?.stop()` sites.
4. Verify GREEN; commit "feat(engine): heartbeat serial non-build steps while in flight".

**Done when:**
- [test] `conductor-step-in-flight.test.ts` asserts a `test_suite` step blocking 11 minutes yields exactly two `step_in_flight` events naming `test_suite` and none after its `step_completed`.
- [test] `conductor-step-in-flight.test.ts` asserts a `test_suite` step that completes, returns a failed result, rejects, or returns a refusal result at 2 minutes yields no `step_in_flight`, and none after a further 20 minutes.
- [test] `conductor-step-in-flight.test.ts` asserts that for `build` then `test_suite`, no `step_in_flight` names `build`, no `build_progress` follows `build`'s `step_completed`, and `step_in_flight` names `test_suite`.
- [test] `conductor-step-in-flight.test.ts` asserts `build_progress.enabled: false` yields no `step_in_flight` for an 11-minute `test_suite`.
- [test] The existing `conductor-build-progress.test.ts` watcher assertions pass unchanged, so `build` keeps its `BuildProgressWatcher` and its `build_progress` lines.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — serial seam start/stop
- `src/conductor/test/engine/conductor-step-in-flight.test.ts` — engine tests

**Dependencies:** Task 2

### Task 4: Validation-group members each run their own ticker
**Story:** Story 1 (happy 2; negative 1, 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-groups-and-signals.test.ts`. Reuse the existing auto-mode validation-group fixture (`built-in validation group engagement`) with fake timers and `build_progress.heartbeat_minutes: 5`.
   (a) `manual_test` and `prd_audit` both block until 6 minutes have been advanced. The recorded events contain one `step_in_flight` naming `manual_test` and one naming `prd_audit`. None names `validation`. After the join, advancing 20 more minutes records no further `step_in_flight`.
   (b) `prd_audit` throws at 1 minute while `manual_test` blocks for 6 minutes. No `step_in_flight` names `prd_audit`, and `manual_test` still gets its own.
2. Verify RED.
3. In the validation fan-out member thunk, start a `StepInFlightTicker` for `member.name` in `lifecycleObserver.onAdmitted`. Stop it in `onSettled` and in a `try/finally` around the thunk's `runGroupBranch` await.
4. Verify GREEN; commit "feat(engine): heartbeat each validation-group member under its own name".

**Done when:**
- [test] `conductor-groups-and-signals.test.ts` asserts two concurrently blocked members yield one `step_in_flight` naming `manual_test` and one naming `prd_audit`, and none naming `validation`.
- [test] `conductor-groups-and-signals.test.ts` asserts no `step_in_flight` is recorded after the group join across a further 20 minutes.
- [test] `conductor-groups-and-signals.test.ts` asserts a `prd_audit` branch that throws at 1 minute yields no `step_in_flight` naming `prd_audit`, while `manual_test` still yields its own.
- [test] The existing `conductor-groups-and-signals.test.ts` group-path, join, and resume assertions pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — group-member seam start/stop
- `src/conductor/test/engine/conductor-groups-and-signals.test.ts` — member heartbeat cases

**Dependencies:** Task 2

### Task 5: In-flight fold over a feature's merged events
**Story:** Story 2 (happy 1–3; negative 1, 2, 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-dashboard.test.ts`.
   (a) `inFlightSteps` over `step_started(build)`, `step_completed(build)`, `step_started(test_suite)` returns exactly `[{ step: 'test_suite', startedAtMs: <its ts> }]`.
   (b) Two unterminated `step_started` events for `manual_test` and `prd_audit` return both, in start order.
   (c) For each of `step_completed`, `step_failed`, `step_interrupted`, and `step_refused` following `step_started(test_suite)`, the result is empty.
   (d) `step_started(test_suite)` followed by two `step_retry(test_suite)` returns `test_suite` with the original `startedAtMs`.
   (e) `scanInheritedState` over a fixture worktree whose `.pipeline/events.jsonl` has an unterminated `test_suite` sets `inFlight` on that in-progress entry. A sibling fixture whose ledger has one malformed line leaves `inFlight` absent, and the scan still returns both entries.
2. Verify RED.
3. Implement `inFlightSteps`. Add an optional `inFlight?: Array<{ step: string; startedAtMs: number }>` to `InProgressEntry`. Populate it in `scanInheritedState` from the already-read merged events for that slug.
4. Verify GREEN; commit "feat(daemon): derive in-flight steps from the feature event ledger".

**Done when:**
- [test] `daemon-dashboard.test.ts` asserts `inFlightSteps` returns only `test_suite` after a completed `build`, and both `manual_test` and `prd_audit` when both are unterminated.
- [test] `daemon-dashboard.test.ts` asserts each of `step_completed`, `step_failed`, `step_interrupted`, `step_refused` closes the step, and `step_retry` keeps it open with its original `startedAtMs`.
- [test] `daemon-dashboard.test.ts` asserts `scanInheritedState` sets `inFlight` from a worktree ledger, and omits it for a malformed ledger without dropping either entry.

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — `inFlightSteps`, `InProgressEntry.inFlight`, scan population
- `src/conductor/test/engine/daemon-dashboard.test.ts` — fold and scan tests

**Dependencies:** none

### Task 6: `conduct daemon status` prints in-flight steps for a running daemon
**Story:** Story 2 (happy 1–3; negative 1, 2, 3, 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts` through `runDaemonStatus`. Use a temp registry, a live-pid kill probe, an injected clock, and fixture worktrees under `<repo>/.worktrees/<slug>/` with `.pipeline/conduct-state.json` and `.pipeline/events.jsonl`.
   (a) Feature A's ledger is `build` started, `build` completed, `test_suite` started at T, with the clock at T+6m33s. The output contains `IN FLIGHT [A]: test_suite running 6m33s` and no `IN FLIGHT [A]: build` line.
   (b) Feature B has unterminated `manual_test` and `prd_audit`. The output has one `IN FLIGHT [B]` line for each.
   (c) Feature C's `test_suite` is closed in turn by each of the four terminal types. There is no `IN FLIGHT [C]` line.
   (d) Feature D has `test_suite` started then `step_retry`. Its line remains, with elapsed time from the `step_started`.
   (e) The same fixtures with a dead-pid kill probe (`stale`), and with no pidfile (`stopped`), print no `IN FLIGHT` line.
   (f) Feature E has a malformed ledger line. The command returns code 0, prints the status row and feature A's line, and prints no `IN FLIGHT [E]` line.
2. Verify RED.
3. Add `renderInFlightSection(repoPath, out, clock)` in `src/conductor/src/engine/daemon-observe-cli.ts`, reusing `scanInheritedState` and `formatHeartbeatAge`. Call it from `runDaemonStatus` only when `row.liveness === 'running'`.
4. Verify GREEN; commit "feat(daemon): show in-flight steps in daemon status".

**Done when:**
- [test] `daemon-observe-cli.test.ts` asserts `runDaemonStatus` with a running daemon prints `IN FLIGHT [A]: test_suite running 6m33s` and no in-flight line naming `build` after `build` completed.
- [test] `daemon-observe-cli.test.ts` asserts two unterminated `validation` members print `IN FLIGHT [B]: manual_test running` and `IN FLIGHT [B]: prd_audit running` lines, and steps closed by any of the four terminal types print none.
- [test] `daemon-observe-cli.test.ts` asserts a retried, unterminated step stays listed with elapsed time from its `step_started`, and a `stale` or `stopped` daemon prints no `IN FLIGHT` line.
- [test] `daemon-observe-cli.test.ts` asserts a malformed ledger returns code 0, prints the status row and other features' in-flight lines, and prints no in-flight line for that feature.

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — `renderInFlightSection`, liveness-gated call
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — status tests

**Dependencies:** Task 5

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─┬─▶ Task 3
                  └─▶ Task 4
Task 5 ─▶ Task 6
```

Tasks 3 and 4 both edit `conductor.ts` in separate regions. BUILD may serialize them on file
overlap.

## Integration Points

- After Task 3: a daemon run of any serial non-build step longer than the interval prints running
  lines (Story 1 through `Conductor` → emitter → `renderDaemonEvent`).
- After Task 6: `conduct daemon status` (CLI entry `runDaemonStatus`) shows in-flight steps
  (Story 2).

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon-dispatched feature whose `test_suite` step is still executing one `build_progress.heartbeat_minutes` interval after that step started, when the interval elapses, then the feature's daemon log receives a line `▶ test_suite running <elapsed>` that names `test_suite` and gives the time since that step started, and another such line follows at each later interval while the step is still executing. | 1, 2, 3 | "a `test_suite` step blocking 11 minutes yields exactly two `step_in_flight` events naming `test_suite` and none after its `step_completed`" | diff-local |
| Story 1 happy: Given the `validation` group dispatches `manual_test` and `prd_audit` concurrently and both are still executing one interval after admission, when the interval elapses, then the daemon log receives one running line naming `manual_test` and one naming `prd_audit`, each under its own step name and neither under the group's first member's name. | 1, 4 | "two concurrently blocked members yield one `step_in_flight` naming `manual_test` and one naming `prd_audit`, and none naming `validation`" | diff-local |
| Story 1 happy: Given a feature whose `build` step has settled and whose `test_suite` step is now executing, when heartbeat intervals elapse during `test_suite`, then the running lines name `test_suite` and no `build_progress` event for that feature is emitted after `build` settled. | 3 | "no `build_progress` follows `build`'s `step_completed`, and `step_in_flight` names `test_suite`" | diff-local |
| Story 1 negative: Given a non-build step that settles (completes, fails, is refused, or throws) before one interval has elapsed since it started, when the step settles, then no running line is ever emitted for that step attempt. | 2, 3, 4 | "a `test_suite` step that completes, returns a failed result, rejects, or returns a refusal result at 2 minutes yields no `step_in_flight`, and none after a further 20 minutes" | diff-local |
| Story 1 negative: Given a non-build step that settled after one or more running lines, when later intervals elapse, then no further running line names that step attempt. | 2, 3, 4 | "yields exactly two `step_in_flight` events naming `test_suite` and none after its `step_completed`" | diff-local |
| Story 1 negative: Given `build_progress.enabled: false`, when a non-build step runs longer than the interval, then no running line is emitted for it. | 2, 3 | "`build_progress.enabled: false` yields no `step_in_flight` for an 11-minute `test_suite`" | diff-local |
| Story 1 negative: Given the `build` step is executing, when heartbeat intervals elapse, then no running line of this kind is emitted for `build`, and its existing `▶ build N/M` progress lines are emitted as before. | 3 | "The existing `conductor-build-progress.test.ts` watcher assertions pass unchanged, so `build` keeps its `BuildProgressWatcher` and its `build_progress` lines" | diff-local |
| Story 2 happy: Given a running daemon and an in-progress feature whose persisted events contain `step_started` for `test_suite` with no later terminal event for `test_suite`, when the operator runs `conduct daemon status`, then the output contains `IN FLIGHT [<slug>]: test_suite running <elapsed>` with the elapsed time measured from that `step_started` timestamp. | 5, 6 | "prints `IN FLIGHT [A]: test_suite running 6m33s`" | diff-local |
| Story 2 happy: Given a running daemon and an in-progress feature whose persisted events show `build` started then `step_completed` for `build`, followed by `step_started` for `test_suite`, when the operator runs `conduct daemon status`, then the feature's in-flight output names `test_suite` and contains no in-flight line naming `build`. | 5, 6 | "no in-flight line naming `build` after `build` completed" | diff-local |
| Story 2 happy: Given a running daemon and an in-progress feature whose persisted events contain unterminated `step_started` events for both `manual_test` and `prd_audit`, when the operator runs `conduct daemon status`, then the output contains one `IN FLIGHT [<slug>]` line naming `manual_test` and one naming `prd_audit`. | 5, 6 | "two unterminated `validation` members print `IN FLIGHT [B]: manual_test running` and `IN FLIGHT [B]: prd_audit running` lines" | diff-local |
| Story 2 negative: Given an in-progress feature whose latest event for a step after its `step_started` is `step_completed`, `step_failed`, `step_interrupted`, or `step_refused`, when the operator runs `conduct daemon status`, then no in-flight line names that step. | 5, 6 | "steps closed by any of the four terminal types print none" | diff-local |
| Story 2 negative: Given a step whose `step_started` is followed by `step_retry` events and no terminal event, when the operator runs `conduct daemon status`, then that step is still listed as in flight, with elapsed time measured from its `step_started`. | 5, 6 | "a retried, unterminated step stays listed with elapsed time from its `step_started`" | diff-local |
| Story 2 negative: Given the repository's daemon liveness is `stale` or `stopped`, when the operator runs `conduct daemon status`, then no `IN FLIGHT` line is printed for that repository even if a feature's events contain an unterminated `step_started`. | 6 | "a `stale` or `stopped` daemon prints no `IN FLIGHT` line" | diff-local |
| Story 2 negative: Given an in-progress feature whose `.pipeline/events.jsonl` contains a malformed line, when the operator runs `conduct daemon status`, then the command still exits 0, prints the repository status row and the other features' in-flight lines, and prints no in-flight line for that feature. | 5, 6 | "a malformed ledger returns code 0, prints the status row and other features' in-flight lines, and prints no in-flight line for that feature" | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-5: In daemon-dashboard.ts, make inFlightSteps pair starts and terminals by executionContext.executionId when the event has one, and fall back to step-name pairing only for context-free events. A late terminal from an older execution must not close a newer execution of the same step. Add RED tests to daemon-dashboard.test.ts: (a) two executions of one step, where the terminal for the first leaves the second open; (b) legacy context-free events still pair by name. Keep the existing Task 5 fold and scan assertions unchanged.
**Gate:** as-built
**Rationale:** Verified (95%): inFlightSteps at src/conductor/src/engine/daemon-dashboard.ts:597-614 keys its Map by event.step alone. ADR adr-2026-09-10-shared-step-lifecycle-telemetry Decision 2 already says how to fix this: pair by executionContext.executionId (ExecutionContext is in src/types/events.ts:249), scoped to the feature's ledger, and keep step-name pairing only for context-free legacy events. This is conforming implementation drift, and the architecture stays authoritative, so no architectural decision or human input is needed. Plan Task 5 (in-flight fold over a feature's merged events) owns inFlightSteps and its tests in daemon-dashboard.test.ts, so it admits the repair. The Task 5 coverage that must survive: closing on completed/failed/interrupted/refused, keeping the open entry and its original startedAtMs across step_retry, start-order rendering, and scanInheritedState population. Sibling consumers outside daemon-dashboard.ts are not admitted by Task 5 and are excluded.
**Governing clause:** adr-2026-09-10-shared-step-lifecycle-telemetry decision 2
**Done when:**
- adr-2026-09-10-shared-step-lifecycle-telemetry decision 2 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-5 is complete.
