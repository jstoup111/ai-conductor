# Implementation Plan: Child-executed features keep their closing OTel telemetry at shutdown

**Date:** 2026-11-07
**Design:** none (technical track, Tier S — see `.docs/track/child-executed-features-lose-closing-otel-telemetr.md`)
**Stories:** .docs/stories/child-executed-features-lose-closing-otel-telemetr.md
**Conflict check:** Not required (Tier S)

## Summary

Keep a child dispatch's closing telemetry flowing through daemon shutdown and dispatch end
(#3645). The broker's `abortAll` stops detaching each child's event bus, so events a child emits
while closing its executions after SIGTERM still reach its visualizer. Ending a child dispatch keeps
its visualizer visible to SIGHUP until its export settles, and flushes daemon metrics after
`feature_dispatch_ended`. Six tasks.

## Technical Approach

- **Verified shape (the #3333 build branch at `3ca39353b9`; this spec is blocked by #3333).**
  - `daemonSigtermHandler` in `src/conductor/src/daemon-cli.ts` calls `abortChildBroker?.()` (which is `executorBroker.abortAll()`), then `await stopChildExecutors?.()` (`childExecutor.stopAll()`).
  - In `src/conductor/src/engine/executor-broker.ts`, each `attach` registers its `close` in `attachments`, and `abortAll` calls every `close`. `close` sets `closed`, rejects pending rate-limit clears, live-boundary opens and worktree acquires with the reason, releases held windows and locks, and then detaches the renderer and awaits the visualizer hook. Once `closed` is set, `onMessage` forwards only `request` messages and drops events.
  - `createChildProcessFeatureExecutor` (`src/conductor/src/engine/child-feature-executor.ts`) calls `attachment.close()` from `finish()` when the child exits. `execute` then emits `feature_dispatch_ended` on the root bus and resolves its outcome. `stopAll` sends `stop` to every running child, waits `teardownTimeoutMs × children`, then SIGKILLs any child still running.
  - `attachChildFeatureOtelVisualizer` in `daemon-cli.ts` adds the visualizer to `activeDispatchVisualizers`. Its returned hook deletes the visualizer from that set *before* awaiting `visualizer.stop()`. `installDaemonOtelSighupHandler` stops only the visualizers still in that set.
  - `const executor = childExecutor;` in `daemon-cli.ts` is the executor `runDaemon` dispatches through. No daemon metric flush follows a child dispatch. `wireDaemonOtel` returns `null` when OTel is disabled. Its `flush()` is time-bounded and never rejects: `guardMetricLifecycle` catches and reports through `renderer_error`.
  - Visualizer `stop()` is idempotent (`stopped ??=` in `src/conductor/src/engine/otel/wire.ts`), so the SIGHUP handler joining an in-flight stop is safe.
- **Broker (Story 1).** Split the per-attachment `close` into `abortCoordination(reason)` and the full close. `abortCoordination` sets `closed`, rejects every pending coordination call with the reason, and releases held windows and locks. The full close runs `abortCoordination`, sets a new `detached` flag, detaches the renderer, awaits the visualizer hook, and removes the port. `attachments` holds `abortCoordination`, so `abortAll` refuses coordination without detaching. `onMessage` gates on `detached` instead of `closed`. Each child's own `finish()` remains the only path to the full close. The SIGTERM handler order does not change.
- **Dispatch end (Story 2).** Add exported `stopDispatchVisualizer(visualizer, active)` in `daemon-cli.ts`: it awaits `visualizer.stop()` and deletes from `active` in a `finally`. `attachChildFeatureOtelVisualizer`'s hook calls it. Replace `const executor = childExecutor;` with an executor whose `execute` awaits `childExecutor.execute(order)` and, in a `finally`, awaits `daemonOtel?.flush()`. `feature_dispatch_ended` is emitted inside `childExecutor.execute` before it resolves, so the flush follows that event and precedes the scheduler receiving the outcome.
- **Not changed:** `stopAll`'s fixed full-allowance wait, the child `'exit'`-versus-final-IPC-message race, and the SIGTERM handler's call order.
- **Reference prototype.** Local ref `ref/child-otel-shutdown-hotfix` (`4a3e7d1057`) implements the broker split and a SIGHUP test. Its flush placement, inside the visualizer hook and before `feature_dispatch_ended`, is wrong and must not be copied.
- **Test patterns.** Broker cases follow `test/engine/executor-broker.test.ts`: the in-memory `pair()` port and `brokerFixture()`, with `createRateLimitEpisodeProxy` for a pending clear. SIGHUP cases follow `test/daemon-sighup-otel.test.ts` (`processProbe()`, `awaitStop: (stop) => stop`). Daemon composition cases follow `test/engine/daemon-cli-executor-wiring.test.ts`, which mocks `createChildProcessFeatureExecutor`; add a `vi.mock` of `../../src/engine/otel/wire.js` for `wireDaemonOtel`. SIGTERM integration follows the two-feature SIGTERM case in `test/engine/daemon-child-dispatch.integration.test.ts` with `createInMemoryExecutorFork`.

## Prerequisites

- #3333 merged to main. Re-verify every citation above against merged main before BUILD.

## Tasks

### Task 1: abortAll refuses coordination without detaching the child's bus
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/executor-broker.test.ts`. Attach `'b'` with engine identity `'v1'` and an `attachFeatureOtelVisualizer` hook that records its stop. Leave a child rate-limit clear pending, then call `broker.abortAll()`. Assert the clear rejects with `executor broker aborted` and the hook has not stopped. Send a `bot_co_author_skipped` feature event from the child and assert it is delivered on `attachment.events`. Then `await attachment.close()` and assert the hook stopped exactly once.
2. Verify RED.
3. Implement the `abortCoordination` and full-close split described in Technical Approach. `attachments` holds `abortCoordination`, and `onMessage` gates on `detached`.
4. Verify GREEN; commit.

**Done when:**
- [test] After `broker.abortAll()`, the pending child rate-limit clear rejects with `executor broker aborted` and a later child feature event is still delivered on that attachment's `events` bus.
- [test] The attachment's `attachFeatureOtelVisualizer` hook is not stopped by `abortAll` and is stopped exactly once by that attachment's own `close()`.

**Files likely touched:**
- src/conductor/src/engine/executor-broker.ts — split abort from detach
- src/conductor/test/engine/executor-broker.test.ts — abort-keeps-forwarding case

**Dependencies:** none

### Task 2: A collected child's events are dropped and an unresponsive child is still killed
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Add a case to `src/conductor/test/engine/executor-broker.test.ts`. Attach two children, `'a'` and `'b'`, to one broker. Each gets an `attachFeatureOtelVisualizer` hook whose recording visualizer subscribes to the feature bus it is handed and records every event. After `'a'`'s own `close()` settles, child `'a'` sends a feature event. Assert no listener on `'a'`'s `events` receives it and neither recording visualizer records it.
2. Confirm the existing `stopAll` SIGKILL case in `src/conductor/test/engine/child-feature-executor.test.ts` and the two-executor force-release case in `src/conductor/test/engine/daemon-cli.test.ts` still pass unchanged. If the broker change broke either, fix the production code, not the test.
3. Commit.

**Done when:**
- [test] After attachment `'a'`'s own `close()`, a feature event sent by child `'a'` is not delivered on `'a'`'s `events` bus and is recorded by neither the `'a'` nor the `'b'` recording visualizer on the same broker.
- [test] The existing `child-feature-executor.test.ts` `stopAll` case still shows a child that ignores `stop` receives SIGKILL after its teardown allowance.
- [test] The existing `daemon-cli.test.ts` two-executor force-release case still shows the daemon releases its lock and exits.

**Files likely touched:**
- src/conductor/test/engine/executor-broker.test.ts — post-close drop case

**Dependencies:** Task 1

### Task 3: A daemon SIGTERM delivers each child's closing events to its visualizer
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Extend the two-feature SIGTERM case in `src/conductor/test/engine/daemon-child-dispatch.integration.test.ts` (`daemon_concurrency: 2`). When each in-memory child receives `stop`, it sends its whole closing sequence: three feature-scope events naming its slug, `step_interrupted`, then `loop_halt`, then `feature_complete`. Together these stand for the events `closeOpenExecutionsForShutdown` emits. Mock `wireOtelVisualizer` through a `vi.mock` of `../../src/engine/otel/wire.js` so each dispatch gets a recording visualizer. It subscribes to the feature bus it is handed, records every event it receives under its slug, and returns an idempotent `stop()`. Allowed variation: add a small option to `src/conductor/test/fixtures/in-memory-executor-fork.ts` that lets a test reply to a supervisor `stop`.
2. Verify the case fails when `abortAll` is temporarily restored to call the full close, then passes on Task 1's broker.
3. Commit.

**Done when:**
- [test] On daemon SIGTERM with two in-flight child dispatches, every event of each child's post-stop closing sequence (`step_interrupted`, `loop_halt`, `feature_complete`) is delivered, in order and with none missing, on that dispatch's supervisor feature bus and recorded by that dispatch's recording OTel visualizer, for both slugs.
- [test] The same SIGTERM case still records a `stop` for each child and exactly one `abortAll`, so the daemon SIGTERM reaches the broker abort Task 1 tests.

**Files likely touched:**
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — SIGTERM closing-event case
- src/conductor/test/fixtures/in-memory-executor-fork.ts — reply-on-stop option

**Dependencies:** Task 1

### Task 4: An ending dispatch's visualizer stays visible to SIGHUP until its export settles
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/daemon-sighup-otel.test.ts`. Use a visualizer whose idempotent `stop()` returns one deferred promise. Call `stopDispatchVisualizer(visualizer, active)`, then fire the SIGHUP listener from `processProbe()`. Assert the handler calls that visualizer's `stop()` and has not called `kill` while the export is pending. Resolve it, then assert `kill(481, 'SIGHUP')` and that `active` no longer holds the visualizer. Add a second case: after `stopDispatchVisualizer` settles, a SIGHUP does not call that visualizer's `stop()` again and re-raises SIGHUP.
2. Verify RED.
3. Implement exported `stopDispatchVisualizer` in `src/conductor/src/daemon-cli.ts`: await `stop()`, delete from `active` in a `finally`. Make `attachChildFeatureOtelVisualizer`'s returned hook call it with `activeDispatchVisualizers`.
4. Verify GREEN; commit.

**Done when:**
- [test] While a dispatch visualizer's stop started by `stopDispatchVisualizer` is pending, `installDaemonOtelSighupHandler`'s handler calls that visualizer's `stop()` and does not call `kill` until the stop resolves.
- [test] After `stopDispatchVisualizer` settles, the visualizer is absent from the active set and a later SIGHUP neither calls its `stop()` again nor waits on it before calling `kill(481, 'SIGHUP')`.
- `attachChildFeatureOtelVisualizer`'s returned hook removes its visualizer from `activeDispatchVisualizers` only after `visualizer.stop()` settles, through `stopDispatchVisualizer`.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — stopDispatchVisualizer and hook
- src/conductor/test/daemon-sighup-otel.test.ts — SIGHUP join and post-stop cases

**Dependencies:** none

### Task 5: Daemon metrics flush after each child dispatch ends
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/daemon-cli-executor-wiring.test.ts`. Mock `wireDaemonOtel` from `../../src/engine/otel/wire.js` to return a fake whose `flush` records a call and resolves a test-held deferred. The mocked child executor's `execute` records `feature_dispatch_ended` immediately before resolving `done`. Run `runDaemonMode` with one backlog item. Assert the recorded order is `feature_dispatch_ended` then `flush`. While the flush deferred is pending, assert the scheduler has not yet recorded the feature's completion. Use the daemon's existing per-feature completion observation, for example its completion log line or claim release. Release the deferred and assert the completion is recorded.
2. Verify RED.
3. Implement: replace `const executor = childExecutor;` in `src/conductor/src/daemon-cli.ts` with an executor whose `execute` awaits `childExecutor.execute(order)` and, in a `finally`, awaits `daemonOtel?.flush()`.
4. Verify GREEN; commit.

**Done when:**
- [test] Through `runDaemonMode`, the daemon OTel `flush()` is called after the child executor records `feature_dispatch_ended` for the dispatch.
- [test] Through `runDaemonMode`, the scheduler does not record the dispatch's completion until that `flush()` resolves, and records it after.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — flushing executor wrapper
- src/conductor/test/engine/daemon-cli-executor-wiring.test.ts — flush ordering case

**Dependencies:** none

### Task 6: With OTel disabled a child dispatch ends without a flush
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Add a case to `src/conductor/test/engine/daemon-cli-executor-wiring.test.ts` where the mocked `wireDaemonOtel` returns `null`. The mocked child executor resolves `{ slug, status: 'done' }`. Assert the scheduler records that outcome for the slug, and that no flush function was invoked: the mock exposes a spy that a non-null return would have carried.
2. Run; fix if needed; commit.

**Done when:**
- [test] With `wireDaemonOtel` returning `null`, `runDaemonMode` records the child executor's `done` outcome for the slug unchanged.
- [test] With `wireDaemonOtel` returning `null`, no daemon metric flush is invoked for the dispatch.

**Files likely touched:**
- src/conductor/test/engine/daemon-cli-executor-wiring.test.ts — OTel-disabled case

**Dependencies:** Task 5

## Task Dependency Graph

```
Task 1 ─┬─> Task 2
        └─> Task 3
Task 4
Task 5 ───> Task 6
```

## Integration Points

- After Task 3: a daemon SIGTERM with two child dispatches delivers each child's closing events to its visualizer bus.
- After Task 5: a finished child dispatch's metrics are flushed before the scheduler records it.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given two child dispatches in flight under `daemon_concurrency: 2` with OTel enabled, when the daemon receives SIGTERM, then the events each child emits while closing its open executions reach that dispatch's supervisor feature bus and its OTel visualizer. | 3 | "On daemon SIGTERM with two in-flight child dispatches, every event of each child's post-stop closing sequence (`step_interrupted`, `loop_halt`, `feature_complete`) is delivered, in order and with none missing, on that dispatch's supervisor feature bus and recorded by that dispatch's recording OTel visualizer, for both slugs." | diff-local |
| Story 1 happy: Given a child dispatch whose rate-limit clear is pending on the supervisor, when the daemon receives SIGTERM, then that pending call is rejected with reason `executor broker aborted` and the child's later feature events are still forwarded. | 1, 3 | "After `broker.abortAll()`, the pending child rate-limit clear rejects with `executor broker aborted` and a later child feature event is still delivered on that attachment's `events` bus." | diff-local |
| Story 1 negative: Given a child that ignores the stop request, when its teardown allowance expires, then the supervisor kills it with SIGKILL and the daemon still releases its lock and exits. | 2 | "The existing `child-feature-executor.test.ts` `stopAll` case still shows a child that ignores `stop` receives SIGKILL after its teardown allowance." | diff-local |
| Story 1 negative: Given a child dispatch that the supervisor has already collected, when that child sends a further feature event, then the broker drops the event and no visualizer records it. | 2 | "After attachment `'a'`'s own `close()`, a feature event sent by child `'a'` is not delivered on `'a'`'s `events` bus and is recorded by neither the `'a'` nor the `'b'` recording visualizer on the same broker." | diff-local |
| Story 2 happy: Given a child dispatch with OTel enabled, when the supervisor collects it, then daemon metrics are flushed after `feature_dispatch_ended` is emitted and before the dispatch's outcome is returned to the daemon scheduler. | 5 | "Through `runDaemonMode`, the scheduler does not record the dispatch's completion until that `flush()` resolves, and records it after." | diff-local |
| Story 2 happy: Given a child dispatch whose visualizer is still exporting when the dispatch ends, when SIGHUP arrives, then the SIGHUP handler waits for that export to finish before it re-raises SIGHUP. | 4 | "While a dispatch visualizer's stop started by `stopDispatchVisualizer` is pending, `installDaemonOtelSighupHandler`'s handler calls that visualizer's `stop()` and does not call `kill` until the stop resolves." | diff-local |
| Story 2 negative: Given a child dispatch whose visualizer stop has finished, when SIGHUP arrives afterwards, then that visualizer is no longer in the active dispatch set and the handler does not wait on it. | 4 | "After `stopDispatchVisualizer` settles, the visualizer is absent from the active set and a later SIGHUP neither calls its `stop()` again nor waits on it before calling `kill(481, 'SIGHUP')`." | diff-local |
| Story 2 negative: Given OTel is disabled, when a child dispatch ends, then no metric flush is attempted and the dispatch's outcome is returned unchanged. | 6 | "With `wireDaemonOtel` returning `null`, no daemon metric flush is invoked for the dispatch." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
