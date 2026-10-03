# Implementation Plan: Daemon records that a build is not advancing HEAD but never acts on it

**Date:** 2026-10-02
**Stories:** .docs/stories/daemon-records-that-a-build-is-not-advancing-head-.md
**Conflict check:** Clean as of 2026-10-02

## Summary

Classify every build-progress emission into three activity states. Record a once-per-episode `build_active_stall` condition when a build stays active without moving for a per-project bound. When a project opts in, end that provider attempt through a dispatcher-owned abort that the Claude and Codex adapters honour. 13 tasks.

## Technical Approach

- **Config (Task 1):** `build_progress` gains `active_stall_minutes` (default 45) and `active_stall_action` (`warn` default, or `end_attempt`). Validation and resolution sit beside the existing `quiet_minutes` code in `engine/config.ts`, and the consumer registry names the watcher.
- **Schema (Task 2):** `activity` is a closed union on `build_progress` / `build_no_progress`. `build_active_stall` is the one new `ConductorEvent` kind, and `build_stall.reason` gains `active_stall`. Everything travels the existing spine (emitter → persister → `.pipeline/events.jsonl`), and the terminal renderer and OTel subscribe as for the sibling kinds.
- **Watcher (Tasks 3–5):** `BuildProgressWatcher` classifies each emission from the tick's change flag and the dispatch-owned step heartbeat age against `quiet_minutes`, reusing `readStepHeartbeat` and `heartbeatBelongsToDispatch`. A second fire-once episode beside `quietFired`, re-armed on every change, emits `build_active_stall`. Under `end_attempt` it calls an injected `endAttempt` callback. The watcher never touches a process, and a `quiet` tick never fires (adr-2026-07-30 decision 8).
- **Dispatch (Tasks 7, 9, 10):** the per-attempt build block in `conductor.ts` owns one `AbortController`. It hands `endAttempt` to the watcher and threads the signal through `StepRunOptions.abortSignal` → `step-runners.ts` → `executeProviderCandidates`. An attempt ended this way is classified `active_stall` unless the existing pinned-count-and-HEAD rule applies first. The existing retry, remediation and HALT machinery is otherwise untouched.
- **Providers (Tasks 8, 11–13):** candidate iteration stops once the signal is aborted. Claude and Codex forward the signal as execa `cancelSignal` (SIGTERM, then SIGKILL after the default grace) and map cancellation to a plain unsuccessful result that no rate-limit, auth or session classifier matches. Pi already honours the signal.
- **Rendering (Task 6):** `daemon.log`, TTY and OTel cases for the new event follow the `build_no_progress` warning pattern.

## Prerequisites

- None.

## Tasks

### Task 1: Validate and resolve the two new `build_progress` keys
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/build-progress-config.test.ts`: an absent block resolves `active_stall_minutes` 45 and `active_stall_action` `warn`; `{ active_stall_minutes: 90, active_stall_action: "end_attempt" }` loads and resolves to exactly those values; `0`, `-5` and `"x"` for `active_stall_minutes` each fail naming `build_progress.active_stall_minutes` and a positive number; `active_stall_action: kill` fails naming `build_progress.active_stall_action` with `warn` and `end_attempt`; `poll_seconds: 600` with `active_stall_minutes: 5` fails saying `poll_seconds` must not exceed the active-stall bound; an unknown key `active_stall_minuts` is reported exactly as other unknown `build_progress` keys are today.
2. Verify RED.
3. Implement in `src/conductor/src/types/config.ts` (`BuildProgressConfig` gains `active_stall_minutes?: number` and `active_stall_action?: 'warn' | 'end_attempt'`; the resolved type carries both as required) and `src/conductor/src/engine/config.ts` (append both names to the `build_progress` known-key list; add validation beside the existing `quiet_minutes` checks, mirroring their message shape; add the `poll_seconds` vs bound check mirroring the existing `poll_seconds` vs `quiet_minutes` check; `resolveBuildProgressConfig` defaults 45 and `warn`). Pattern: the `quiet_minutes` validation and the `poll_seconds` comparison in `validateBuildProgressConfig`-style code in `engine/config.ts` (search `build_progress.quiet_minutes must be a positive number`). Keep their traits: positive finite numbers only, messages name the dotted key path, validation never mutates its input.
4. Declare the production consumer (`BuildProgressWatcher`) for both keys in `src/conductor/test/engine/config-consumer-registry.ts`.
5. Verify GREEN and commit.

**Done when:**
- `resolveBuildProgressConfig` returns `active_stall_minutes: 45` and `active_stall_action: 'warn'` for a config with neither key, and for a config setting both `validateConfig` accepts it without error and resolution returns exactly `90` and `'end_attempt'`, as asserted in `test/build-progress-config.test.ts`.
- `validateConfig` rejects `active_stall_minutes` of `0`, `-5` and a non-number with an error naming `build_progress.active_stall_minutes` as needing a positive number.
- `validateConfig` rejects `active_stall_action: kill` with an error naming `build_progress.active_stall_action` and its allowed values `warn` and `end_attempt`.
- `validateConfig` rejects `poll_seconds: 600` with `active_stall_minutes: 5` with an error stating `poll_seconds` must not exceed the active-stall bound, and reports an unknown `active_stall_minuts` key through the same unknown-key path as any other unknown `build_progress` key.
- The `build_progress` known-key list holds exactly `poll_seconds`, `quiet_minutes`, `heartbeat_minutes`, `enabled`, `active_stall_minutes`, `active_stall_action`, and `test/engine/config-consumer-registry.ts` declares the watcher as the consumer of both new keys.

**Files:** src/conductor/src/types/config.ts; src/conductor/src/engine/config.ts; src/conductor/test/build-progress-config.test.ts; src/conductor/test/engine/config-consumer-registry.ts

**Dependencies:** none

### Task 2: Event schema: `activity`, `build_active_stall`, and the `active_stall` stall reason
**Story:** 1
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/event-sinks.test.ts` and `src/conductor/test/progress-event-coverage.test.ts`: the sink table declares `build_active_stall` as render, persist and otel; the persisted event-type list and the terminal renderer's subscribed kinds include `build_active_stall`; a typed fixture of `build_stall` with reason `active_stall` compiles and the OTel stall metric records it under `reason=active_stall`.
2. Verify RED.
3. Implement in `src/conductor/src/types/events.ts`: export `BuildActivity = 'quiet' | 'active-committing' | 'active-not-committing'`; add `activity: BuildActivity` to `build_progress` and `build_no_progress`; add `build_active_stall { step, minutes, resolved, total, lastCommitAt?, lastActivityAt?, action: 'warn' | 'end_attempt', featureSlug? }`; widen `build_stall.reason` to `'no_task_progress' | 'halt_marker' | 'active_stall'`. Register the new kind in `src/conductor/src/engine/event-sinks.ts`, the persister type list, and the subscribed-kinds list in `src/conductor/src/ui/terminal-renderer.ts`. Add a no-op metrics-listener entry if the listener table is exhaustive.
4. Verify GREEN and commit.

**Done when:**
- `build_progress` and `build_no_progress` in the `ConductorEvent` union each declare a required `activity` field typed as the closed union `quiet`, `active-committing`, `active-not-committing`.
- `build_active_stall` is a member of the `ConductorEvent` union carrying step, minutes, resolved, total, lastCommitAt, lastActivityAt, action and featureSlug, and `event-sinks.ts` declares it rendered, persisted and exported to OTel, as asserted in `test/engine/event-sinks.test.ts`.
- `build_stall` reason is the closed union `no_task_progress`, `halt_marker`, `active_stall`, and the OTel stall metric records an `active_stall` stall under `reason=active_stall` alone.
- The persisted event-type list and the terminal renderer subscribed-kinds list both contain `build_active_stall`, as asserted in `test/progress-event-coverage.test.ts`.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/event-persister.ts; src/conductor/src/ui/terminal-renderer.ts; src/conductor/src/engine/otel/metrics-listener.ts; src/conductor/test/engine/event-sinks.test.ts; src/conductor/test/progress-event-coverage.test.ts

**Dependencies:** none

### Task 3: Watcher classifies every emission as quiet, active-committing or active-not-committing
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/build-progress-watcher.test.ts` using the existing injected clock, events recorder and heartbeat fixtures: a HEAD-change tick emits `build_progress` with `activity: "active-committing"`; a no-movement heartbeat-period emission with a dispatch-owned heartbeat younger than `quiet_minutes` carries `active-not-committing`; `build_no_progress` with a heartbeat older than `quiet_minutes` carries `quiet`; `build_no_progress` with a seconds-old dispatch-owned heartbeat still fires exactly once for the episode and carries `active-not-committing`; a heartbeat from an earlier dispatch yields `quiet`; a missing or unreadable heartbeat yields `quiet` with resolved, total and lastCommitAt still present; a failed HEAD probe tick does not emit `active-committing` on that probe alone.
2. Verify RED.
3. Implement in `src/conductor/src/engine/build-progress-watcher.ts`: one private `classifyActivity(changed)` that returns `active-committing` for a change tick, else reads the step heartbeat through the existing `readStepHeartbeat` and `heartbeatBelongsToDispatch` path and returns `active-not-committing` when it belongs to this dispatch and its age is below `quiet_minutes`, else `quiet`; read errors return `quiet`. Stamp the result on every `build_progress` and `build_no_progress` emission. Pattern: the existing `lastActivityAt` read in the quiet-episode branch (search `heartbeatBelongsToDispatch`). Keep its traits: a read failure never aborts the tick or suppresses the emission.
4. Verify GREEN and commit.

**Done when:**
- `BuildProgressWatcher` stamps `activity: "active-committing"` on the `build_progress` emitted by a tick that observes a HEAD change, as asserted in `test/build-progress-watcher.test.ts`.
- A no-movement heartbeat-period `build_progress` or a `build_no_progress` carries `activity: "active-not-committing"` when the dispatch-owned step heartbeat is younger than `quiet_minutes`, and `activity: "quiet"` when that heartbeat is older, belongs to an earlier dispatch, or is missing or unreadable.
- A `build_no_progress` emitted while the dispatch-owned heartbeat is seconds old still fires exactly once for the episode and carries `activity: "active-not-committing"`.
- A tick whose heartbeat read fails still emits its resolved, total and lastCommitAt fields, and a tick whose HEAD probe fails emits no `activity: "active-committing"` on the strength of that probe and neither re-arms the movement baseline nor resets the quiet or active-stall episode.

**Files:** src/conductor/src/engine/build-progress-watcher.ts; src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Task 2

### Task 4: Warn action: one `build_active_stall` per active-not-committing episode
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/build-progress-watcher.test.ts`: with `active_stall_minutes: 45` and default action, 45 minutes of `active-not-committing` since the last movement emits exactly one `build_active_stall` with `action: "warn"`, minutes, resolved, total, lastCommitAt, lastActivityAt and featureSlug; later `active-not-committing` ticks in the same episode emit none; when the bound elapses on a `quiet` tick nothing is emitted on that tick; after movement and a second full bound a second event is emitted; the injected `endAttempt` callback is never invoked under `warn`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/build-progress-watcher.ts`: add optional `endAttempt?: (reason: 'active_stall') => void` to `BuildProgressWatcherOptions`; track `activeStallFired` beside `quietFired`, re-armed wherever `lastChangeAt` is bumped; on a no-movement tick classified `active-not-committing` with `now - lastChangeAt >= active_stall_minutes`, emit `build_active_stall` once and, only when the action is `end_attempt`, call `endAttempt`. Pattern: the quiet-episode fire-once state machine (`quietFired` / `lastChangeAt`). Keep its traits: fire once per episode, any change re-arms, nothing fires before a baseline tick exists.
4. Verify GREEN and commit.

**Done when:**
- With `active_stall_action` unset and `active_stall_minutes: 45`, `BuildProgressWatcher` emits exactly one `build_active_stall` with `action: "warn"`, minutes, resolved, total, lastCommitAt, lastActivityAt and featureSlug once `active-not-committing` has held for `active_stall_minutes` since the last movement, as asserted in `test/build-progress-watcher.test.ts`.
- Later ticks that remain `active-not-committing` in the same episode emit no further `build_active_stall`.
- A tick classified `quiet` emits no `build_active_stall` even when the bound has elapsed.
- After a movement re-arms the episode and the bound elapses again, a second `build_active_stall` is emitted.
- Under `active_stall_action: warn` the watcher never invokes its `endAttempt` callback.

**Files:** src/conductor/src/engine/build-progress-watcher.ts; src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Tasks 1, 3

### Task 5: Bound and clearing rules protect real work
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/build-progress-watcher.test.ts` driven by the resolved config passed to the watcher: with `active_stall_minutes: 120`, 60 minutes of `active-not-committing` emits no `build_active_stall` and no `endAttempt` call; with a 45-minute bound, a commit at minute 40 makes the next tick `active-committing` and no event fires at minute 45, only 45 minutes after the commit; with `end_attempt` and a stale heartbeat beyond the bound, `endAttempt` is never invoked; with `end_attempt`, a task-progress change without a new commit before the bound clears the episode and no `endAttempt` call happens at the original deadline.
2. Verify RED.
3. Implement any missing re-arm in `src/conductor/src/engine/build-progress-watcher.ts` so that every change tick, task delta or HEAD move, resets the active-stall clock; read the bound only from the watcher's resolved `build_progress` config. No quiet path may call `endAttempt`.
4. Verify GREEN and commit.

**Done when:**
- With `active_stall_minutes: 120` the watcher emits no `build_active_stall` and makes no `endAttempt` call after 60 minutes of `active-not-committing`, as asserted in `test/build-progress-watcher.test.ts`.
- A commit observed at minute 40 of a 45-minute bound makes the next emission carry `activity: "active-committing"` and moves the earliest `build_active_stall` to 45 minutes after that commit.
- With `active_stall_action: end_attempt` and a heartbeat stale for longer than the bound, the watcher never invokes `endAttempt`.
- With `active_stall_action: end_attempt`, a task-progress change without a new commit before the bound clears the episode so no `endAttempt` call occurs at the original deadline.

**Files:** src/conductor/src/engine/build-progress-watcher.ts; src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Task 4

### Task 6: Render `build_active_stall` and the activity label in daemon log, TTY and OTel
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/daemon-render-progress.test.ts` and `src/conductor/test/ui/terminal-renderer.test.ts`: `build_active_stall` renders one warning line naming the step, the feature slug, the minutes active without movement and the action; a `build_no_progress` fixture with no `activity` field renders byte-identically to today.
2. Verify RED.
3. Implement a `build_active_stall` case in `renderDaemonEvent` in `src/conductor/src/daemon-cli.ts`, in `src/conductor/src/ui/terminal-renderer.ts`, and in `src/conductor/src/engine/otel/otel-visualizer.ts` (span event like `build_no_progress`). Pattern: the `build_no_progress` warning case in `daemon-cli.ts` (yellow glyph, `[slug]` tagging). Keep its traits: feature-owned lines carry the slug, legacy payloads render unchanged.
4. Verify GREEN and commit.

**Done when:**
- `renderDaemonEvent` renders a `build_active_stall` event as one `daemon.log` warning line naming the step, the feature slug, the minutes active without movement and the action taken, as asserted in `test/daemon-render-progress.test.ts`.
- The terminal renderer renders `build_active_stall` and `OtelVisualizer` records it as a span event, as asserted in `test/ui/terminal-renderer.test.ts`.
- A `build_no_progress` fixture without an `activity` field renders byte-identically to the line rendered before this change.

**Files:** src/conductor/src/daemon-cli.ts; src/conductor/src/ui/terminal-renderer.ts; src/conductor/src/engine/otel/otel-visualizer.ts; src/conductor/test/daemon-render-progress.test.ts; src/conductor/test/ui/terminal-renderer.test.ts

**Dependencies:** Task 2

### Task 7: Thread a per-attempt abort signal from the build dispatch into provider execution
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners-abort-signal.test.ts` with an injected `providerExecutor` recorder: `stepRunner.run('build', state, { abortSignal })` passes that exact signal as `abortSignal` to the provider executor; a run without `abortSignal` passes none.
2. Verify RED.
3. Implement: add `abortSignal?: AbortSignal` to `StepRunOptions` in `src/conductor/src/engine/conductor.ts`; in `src/conductor/src/engine/step-runners.ts` forward `opts.abortSignal` into the ordinary `providerExecutor` call that the build step uses (the one taking `request.dispatch`), and nowhere else.
4. Verify GREEN and commit.

**Done when:**
- `stepRunner.run('build', state, { abortSignal })` passes that same `AbortSignal` instance to the provider executor as `abortSignal`, as asserted in `test/engine/step-runners-abort-signal.test.ts`.
- A build run without `abortSignal` passes no `abortSignal` to the provider executor.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/step-runners.ts; src/conductor/test/engine/step-runners-abort-signal.test.ts

**Dependencies:** none

### Task 8: Provider execution invokes no further candidate after the attempt is aborted
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/provider-execution-abort.test.ts`: two configured candidates; the first invocation is aborted mid-run through `abortSignal` and returns an unsuccessful result; `executeProviderCandidates` returns without invoking the second candidate.
2. Verify RED (or record the existing behaviour if already green and keep the test as the guard).
3. Implement in `src/conductor/src/engine/provider-execution.ts`: in the ordinary candidate loop, stop iterating when `abortSignal?.aborted` after an invocation returns, mirroring the prepared-candidate `cancelledPreparedCandidateResult` check.
4. Verify GREEN and commit.

**Done when:**
- `executeProviderCandidates` with two candidates whose first invocation is aborted through `abortSignal` returns that unsuccessful result without invoking the second candidate, as asserted in `test/engine/provider-execution-abort.test.ts`.
- The second candidate's invoke function records zero calls in that test.

**Files:** src/conductor/src/engine/provider-execution.ts; src/conductor/test/engine/provider-execution-abort.test.ts

**Dependencies:** none

### Task 9: Build dispatch ends an attempt on `endAttempt` and records `active_stall`
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/conductor-build-progress.test.ts` through `Conductor` with a scripted step runner that blocks until its `abortSignal` fires, a fake clock, and `active_stall_action: end_attempt`, `active_stall_minutes: 30`: after 30 minutes of active-not-committing ticks the events contain one `build_active_stall` with `action: "end_attempt"`, the runner observed its signal aborted, and exactly one `build_stall` with reason `active_stall`; the attempt counts against the retry budget; the next attempt starts with a fresh watcher whose episode starts from that attempt's own baseline.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`, inside the per-attempt build block that constructs `BuildProgressWatcher`: create one `AbortController` per attempt; pass `endAttempt` to the watcher as a function that aborts the controller once; pass `abortSignal: controller.signal` on every build-step `stepRunner.run` call in that block; at attempt end, when the controller was aborted by `endAttempt`, set `stalled = 'active_stall'`, emit `build_stall` with reason `active_stall`, and set the stall reason text naming the bound; let the existing retry accounting count the attempt. Do not register this controller with `registerAbortController`.
4. Verify GREEN and commit.

**Done when:**
- With `active_stall_action: end_attempt` and a 30-minute bound, a `Conductor` build attempt that stays active-not-committing yields one `build_active_stall` with `action: "end_attempt"` and the step runner observes its `abortSignal` aborted, as asserted in `test/conductor-build-progress.test.ts`.
- That ended attempt yields exactly one `build_stall` with reason `active_stall`, its `build_active_stall` carries `minutes: 30`, and the attempt has exactly one terminal step outcome.
- The ended attempt counts as one attempt against the build retry budget, and when budget remains the next attempt runs under a new watcher whose active-stall episode starts from that attempt's baseline.
- The per-attempt controller is never passed to `registerAbortController`.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/conductor-build-progress.test.ts

**Dependencies:** Tasks 2, 4, 7

### Task 10: Ending is idempotent, warn never ends, and pinned attempts keep the existing stall rule
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/conductor-build-progress.test.ts`: two consecutive ended attempts with HEAD and resolved count pinned classify the second as `no_task_progress` and follow the existing remediation/HALT path; an `endAttempt` invoked after the attempt completed leaves the result unchanged and records no `build_stall`; `endAttempt` invoked twice aborts once and records one `build_stall`; under `active_stall_action: warn` the attempt runs to completion, the runner never sees an aborted signal, and no stall reason is recorded; with `build_progress.enabled: false` no `activity`-carrying event and no `build_active_stall` is produced.
2. Verify RED.
3. Implement the guards in `src/conductor/src/engine/conductor.ts`: `endAttempt` checks an attempt-settled flag and the controller's `aborted` state before aborting; the active-stall classification applies only when `endAttempt` aborted a still-running attempt; the existing `attempt >= 2` count-and-HEAD-pinned rule takes precedence and is evaluated first so a second pinned ended attempt classifies as `no_task_progress`.
4. Verify GREEN and commit.

**Done when:**
- Two consecutive ended attempts with HEAD and resolved count pinned classify the second as `no_task_progress` and enter the existing remediation and HALT path, as asserted in `test/conductor-build-progress.test.ts`.
- An `endAttempt` call after the attempt has completed leaves that attempt's result unchanged and records no `build_stall`, and a second `endAttempt` call for one attempt aborts once and records exactly one `build_stall`.
- Under `active_stall_action: warn` the step runner never observes an aborted `abortSignal`, the attempt runs to completion, and no `active_stall` stall reason is recorded for that attempt.
- With `build_progress.enabled: false` the run emits no `activity` classification and no `build_active_stall` event.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/conductor-build-progress.test.ts

**Dependencies:** Task 9

### Task 11: Claude adapter terminates its subprocess on abort
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/claude-provider-abort.test.ts` with the injectable `subprocessFactory`: an `abortSignal` reaches the factory as execa `cancelSignal`; on abort the fake subprocess rejects as canceled and the invocation resolves `success: false` without awaiting session completion; the options do not set `forceKillAfterDelay: false`; an already-aborted signal spawns nothing; the aborted result has no `rateLimited`, `authFailure` or `sessionExpired` signal; an invocation without `abortSignal` passes no `cancelSignal`.
2. Verify RED.
3. Implement in `src/conductor/src/execution/claude-provider.ts`: before spawning, return the aborted-invocation result when `abortSignal?.aborted`; pass `cancelSignal: abortSignal` into the execa options only when present; map an execa `isCanceled` rejection to `{ success: false }` with a cancellation message that bypasses the rate-limit, auth and session-expiry classifiers. Pattern: `pi-provider.ts` `abortedInvocationResult` (search `abortedInvocationResult`). Keep its traits: pre-aborted means no spawn; an abort yields one unsuccessful result.
4. Verify GREEN and commit.

**Done when:**
- A Claude invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false` without waiting for the session to finish, as asserted in `test/execution/claude-provider-abort.test.ts`.
- A Claude invocation whose `abortSignal` is already aborted spawns no subprocess.
- An aborted Claude result carries no `rateLimited`, `authFailure` or `sessionExpired` signal.
- A Claude invocation without `abortSignal` passes no `cancelSignal` option to its subprocess.
- With a real child process that ignores SIGTERM, aborting a Claude invocation still terminates the child by SIGKILL after the execa grace period and the invocation resolves `success: false`, as asserted in `test/execution/claude-provider-abort.test.ts`.
- An aborted Claude result is classified by the retry path as an ordinary failure that consumes the retry budget, never taking the rate-limit, authentication or session-expired recovery path that leaves the budget untouched.
- A Claude invocation without `abortSignal` behaves exactly as before: its subprocess options, result fields and classification are identical to the pre-change adapter for the same scripted output.

**Files:** src/conductor/src/execution/claude-provider.ts; src/conductor/test/execution/claude-provider-abort.test.ts

**Dependencies:** none

### Task 12: Codex adapter terminates its subprocess on abort
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/codex-provider-abort.test.ts` with the injectable `subprocessFactory`, mirroring Task 11's cases for Codex.
2. Verify RED.
3. Implement in `src/conductor/src/execution/codex-provider.ts` (`invoke` and `spawnCodex`) the same three changes as Task 11. Pattern: `pi-provider.ts` `abortedInvocationResult`.
4. Verify GREEN and commit.

**Done when:**
- A Codex invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false`, as asserted in `test/execution/codex-provider-abort.test.ts`.
- A Codex invocation whose `abortSignal` is already aborted spawns no subprocess.
- An aborted Codex result carries no `rateLimited`, `authFailure` or `sessionExpired` signal.
- A Codex invocation without `abortSignal` passes no `cancelSignal` option to its subprocess.
- With a real child process that ignores SIGTERM, aborting a Codex invocation still terminates the child by SIGKILL after the execa grace period and the invocation resolves `success: false`, as asserted in `test/execution/codex-provider-abort.test.ts`.
- An aborted Codex result is classified by the retry path as an ordinary failure that consumes the retry budget, never taking the rate-limit, authentication or session-expired recovery path that leaves the budget untouched.
- A Codex invocation without `abortSignal` behaves exactly as before: its subprocess options, result fields and classification are identical to the pre-change adapter for the same scripted output.

**Files:** src/conductor/src/execution/codex-provider.ts; src/conductor/test/execution/codex-provider-abort.test.ts

**Dependencies:** none

### Task 13: Pi adapter abort behaviour is unchanged
**Story:** 6
**Type:** verification

**Steps:**
1. Run the existing Pi abort tests unchanged and confirm they pass against this branch; complete with an empty commit carrying `Evidence: skipped existing Pi abort coverage unchanged`.

**Done when:**
- The existing Pi provider abort tests that assert `abortedInvocationResult` for a pre-aborted and a mid-run abort pass unchanged.
- `src/conductor/src/execution/pi-provider.ts` has no diff on this branch.

**Files:** none

**Verify-only:** yes

**Dependencies:** none

## Task Dependency Graph

```text
Task 1 ─┐
Task 2 ─┼─> Task 3 ─> Task 4 ─> Task 5
        │            └─> Task 9 ─> Task 10
        └─> Task 6
Task 7 ─────────────────> Task 9
Task 8, Task 11, Task 12, Task 13 (independent)
```

## Integration Points

- After Task 5: the watcher alone produces the full classification and warn-mode condition on the spine.
- After Task 9: `Conductor` ends a real build attempt end to end, which is the Wiring Surface integration owner for the dispatcher seam.
- After Tasks 11–12: an ended attempt stops the Claude or Codex child process.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a build attempt whose progress tick observes a HEAD change, when the tick emits `build_progress`, then the event carries `activity: "active-committing"`. | 3 | "`BuildProgressWatcher` stamps `activity: "active-committing"` on the `build_progress` emitted by a tick that observes a HEAD change, as asserted in `test/build-progress-watcher.test.ts`." | diff-local |
| Story 1 happy: Given a build attempt with no movement since the last tick and a fresh heartbeat, when the heartbeat-period `build_progress` is emitted, then the event carries `activity: "active-not-committing"`. | 3 | "A no-movement heartbeat-period `build_progress` or a `build_no_progress` carries `activity: "active-not-committing"` when the dispatch-owned step heartbeat is younger than `quiet_minutes`, and `activity: "quiet"` when that heartbeat is older, belongs to an earlier dispatch, or is missing or unreadable." | diff-local |
| Story 1 happy: Given a build attempt with no movement and a step heartbeat older than `quiet_minutes`, when `build_no_progress` is emitted at the quiet threshold, then the event carries `activity: "quiet"`. | 3 | "A no-movement heartbeat-period `build_progress` or a `build_no_progress` carries `activity: "active-not-committing"` when the dispatch-owned step heartbeat is younger than `quiet_minutes`, and `activity: "quiet"` when that heartbeat is older, belongs to an earlier dispatch, or is missing or unreadable." | diff-local |
| Story 1 happy: Given a build attempt with no movement whose step heartbeat is only seconds old when the quiet threshold elapses, when `build_no_progress` is emitted, then the warning still fires exactly once for the episode and carries `activity: "active-not-committing"`. | 3 | "A `build_no_progress` emitted while the dispatch-owned heartbeat is seconds old still fires exactly once for the episode and carries `activity: "active-not-committing"`." | diff-local |
| Story 1 negative: Given a build attempt with no movement whose step heartbeat belongs to an earlier dispatch, when the heartbeat-period `build_progress` is emitted, then the event carries `activity: "quiet"`, not `active-not-committing`. | 3 | "A no-movement heartbeat-period `build_progress` or a `build_no_progress` carries `activity: "active-not-committing"` when the dispatch-owned step heartbeat is younger than `quiet_minutes`, and `activity: "quiet"` when that heartbeat is older, belongs to an earlier dispatch, or is missing or unreadable." | diff-local |
| Story 1 negative: Given the step heartbeat file is missing or unreadable, when a no-movement tick emits, then the event carries `activity: "quiet"` and the tick still emits its existing resolved, total and lastCommitAt fields. | 3 | "A tick whose heartbeat read fails still emits its resolved, total and lastCommitAt fields, and a tick whose HEAD probe fails emits no `activity: "active-committing"` on the strength of that probe and neither re-arms the movement baseline nor resets the quiet or active-stall episode." | diff-local |
| Story 1 negative: Given a tick whose HEAD probe fails, when the tick emits, then the failed probe is not treated as movement and the event does not carry `activity: "active-committing"` on the strength of that probe alone. | 3 | "A tick whose heartbeat read fails still emits its resolved, total and lastCommitAt fields, and a tick whose HEAD probe fails emits no `activity: "active-committing"` on the strength of that probe and neither re-arms the movement baseline nor resets the quiet or active-stall episode." | diff-local |
| Story 2 happy: Given `active_stall_action` is unset and `active_stall_minutes` is 45, when a build attempt stays `active-not-committing` for 45 minutes since its last movement, then exactly one `build_active_stall` event is emitted with `action: "warn"`, the elapsed minutes, resolved, total, lastCommitAt, lastActivityAt and featureSlug. | 4 | "With `active_stall_action` unset and `active_stall_minutes: 45`, `BuildProgressWatcher` emits exactly one `build_active_stall` with `action: "warn"`, minutes, resolved, total, lastCommitAt, lastActivityAt and featureSlug once `active-not-committing` has held for `active_stall_minutes` since the last movement, as asserted in `test/build-progress-watcher.test.ts`." | diff-local |
| Story 2 happy: Given a `build_active_stall` with `action: "warn"` was emitted, when the attempt continues, then the provider attempt keeps running to completion and no `active_stall` stall reason is recorded for it. | 10 | "Under `active_stall_action: warn` the step runner never observes an aborted `abortSignal`, the attempt runs to completion, and no `active_stall` stall reason is recorded for that attempt." | diff-local |
| Story 2 happy: Given a `build_active_stall` event is emitted, when the daemon renders it, then `daemon.log` gains one warning line naming the step, the feature slug, the minutes active without movement and the action taken. | 6 | "`renderDaemonEvent` renders a `build_active_stall` event as one `daemon.log` warning line naming the step, the feature slug, the minutes active without movement and the action taken, as asserted in `test/daemon-render-progress.test.ts`." | diff-local |
| Story 2 negative: Given a `build_active_stall` was already emitted for the current episode, when later ticks remain `active-not-committing`, then no further `build_active_stall` event is emitted for that episode. | 4 | "Later ticks that remain `active-not-committing` in the same episode emit no further `build_active_stall`." | diff-local |
| Story 2 negative: Given a build attempt that alternates between quiet and active ticks without movement, when the bound elapses while the latest tick is `quiet`, then no `build_active_stall` is emitted on that tick. | 4 | "A tick classified `quiet` emits no `build_active_stall` even when the bound has elapsed." | diff-local |
| Story 2 negative: Given `build_progress.enabled` is false, when a build attempt runs with no movement for longer than the bound, then no `activity` classification and no `build_active_stall` event are produced. | 10 | "With `build_progress.enabled: false` the run emits no `activity` classification and no `build_active_stall` event." | diff-local |
| Story 3 happy: Given `active_stall_action: end_attempt` and `active_stall_minutes: 30`, when a build attempt stays `active-not-committing` for 30 minutes, then a `build_active_stall` with `action: "end_attempt"` is emitted and the running provider attempt is ended. | 9 | "With `active_stall_action: end_attempt` and a 30-minute bound, a `Conductor` build attempt that stays active-not-committing yields one `build_active_stall` with `action: "end_attempt"` and the step runner observes its `abortSignal` aborted, as asserted in `test/conductor-build-progress.test.ts`." | diff-local |
| Story 3 happy: Given an attempt was ended this way and the existing no-task-progress rule does not classify it, when the build dispatch evaluates the attempt's outcome, then exactly one `build_stall` is emitted with reason `active_stall`, and the 30-minute bound is carried by that attempt's `build_active_stall` event. | 9 | "That ended attempt yields exactly one `build_stall` with reason `active_stall`, its `build_active_stall` carries `minutes: 30`, and the attempt has exactly one terminal step outcome." | diff-local |
| Story 3 happy: Given an attempt was ended this way and retry budget remains, when the dispatch continues, then the next attempt starts under the existing retry rules and its own fresh progress episode. | 9 | "The ended attempt counts as one attempt against the build retry budget, and when budget remains the next attempt runs under a new watcher whose active-stall episode starts from that attempt's baseline." | diff-local |
| Story 3 negative: Given two consecutive ended attempts in which neither HEAD nor the resolved-task count moved, when the second ends, then the build is classified by the existing no-task-progress stall rule and follows its existing remediation and HALT path, not a new loop. | 10 | "Two consecutive ended attempts with HEAD and resolved count pinned classify the second as `no_task_progress` and enter the existing remediation and HALT path, as asserted in `test/conductor-build-progress.test.ts`." | diff-local |
| Story 3 negative: Given an attempt was ended this way, when the provider execution has further fallback candidates configured, then no further candidate is invoked for that attempt. | 8 | "`executeProviderCandidates` with two candidates whose first invocation is aborted through `abortSignal` returns that unsuccessful result without invoking the second candidate, as asserted in `test/engine/provider-execution-abort.test.ts`." | diff-local |
| Story 3 negative: Given the end request arrives after the attempt has already completed, when it is applied, then the completed attempt's result is unchanged and no `build_stall` is recorded for it. | 10 | "An `endAttempt` call after the attempt has completed leaves that attempt's result unchanged and records no `build_stall`, and a second `endAttempt` call for one attempt aborts once and records exactly one `build_stall`." | diff-local |
| Story 3 negative: Given the end request is issued twice for the same attempt, when the second is applied, then the attempt is ended only once and only one `build_stall` is recorded. | 10 | "An `endAttempt` call after the attempt has completed leaves that attempt's result unchanged and records no `build_stall`, and a second `endAttempt` call for one attempt aborts once and records exactly one `build_stall`." | diff-local |
| Story 4 happy: Given `active_stall_minutes: 120` in a project's config, when that project's build attempt is `active-not-committing` for 60 minutes, then no `build_active_stall` is emitted and the attempt is not ended. | 5 | "With `active_stall_minutes: 120` the watcher emits no `build_active_stall` and makes no `endAttempt` call after 60 minutes of `active-not-committing`, as asserted in `test/build-progress-watcher.test.ts`." | diff-local |
| Story 4 happy: Given an attempt is `active-not-committing` for 40 minutes against a 45-minute bound, when it then commits, then the next tick carries `activity: "active-committing"` and the bound restarts from that movement. | 5 | "A commit observed at minute 40 of a 45-minute bound makes the next emission carry `activity: "active-committing"` and moves the earliest `build_active_stall` to 45 minutes after that commit." | diff-local |
| Story 4 happy: Given a `build_active_stall` with `action: "warn"` was emitted, when the attempt later moves and then stays `active-not-committing` for the bound again, then a second `build_active_stall` is emitted for the new episode. | 4 | "After a movement re-arms the episode and the bound elapses again, a second `build_active_stall` is emitted." | diff-local |
| Story 4 negative: Given `active_stall_action: end_attempt` and a provider whose heartbeat is stale for longer than the bound, when no movement occurs, then the attempt is not ended, because quiet output never authorises ending an attempt. | 5 | "With `active_stall_action: end_attempt` and a heartbeat stale for longer than the bound, the watcher never invokes `endAttempt`." | diff-local |
| Story 4 negative: Given `active_stall_action: end_attempt`, when a task-progress change without a new commit is observed before the bound, then the episode is cleared and the attempt is not ended at the original deadline. | 5 | "With `active_stall_action: end_attempt`, a task-progress change without a new commit before the bound clears the episode so no `endAttempt` call occurs at the original deadline." | diff-local |
| Story 5 happy: Given a config with no `active_stall_minutes` or `active_stall_action`, when the build progress config resolves, then the bound is 45 minutes and the action is `warn`. | 1 | "`resolveBuildProgressConfig` returns `active_stall_minutes: 45` and `active_stall_action: 'warn'` for a config with neither key, and for a config setting both `validateConfig` accepts it without error and resolution returns exactly `90` and `'end_attempt'`, as asserted in `test/build-progress-config.test.ts`." | diff-local |
| Story 5 happy: Given `active_stall_minutes: 90` and `active_stall_action: end_attempt`, when the config loads, then it loads without error and resolves to exactly those values. | 1 | "`resolveBuildProgressConfig` returns `active_stall_minutes: 45` and `active_stall_action: 'warn'` for a config with neither key, and for a config setting both `validateConfig` accepts it without error and resolution returns exactly `90` and `'end_attempt'`, as asserted in `test/build-progress-config.test.ts`." | diff-local |
| Story 5 negative: Given `active_stall_minutes: 0`, `-5`, or a non-number, when the config loads, then validation fails with a message naming `build_progress.active_stall_minutes` as needing a positive number. | 1 | "`validateConfig` rejects `active_stall_minutes` of `0`, `-5` and a non-number with an error naming `build_progress.active_stall_minutes` as needing a positive number." | diff-local |
| Story 5 negative: Given `active_stall_action: kill`, when the config loads, then validation fails with a message naming `build_progress.active_stall_action` and its allowed values `warn` and `end_attempt`. | 1 | "`validateConfig` rejects `active_stall_action: kill` with an error naming `build_progress.active_stall_action` and its allowed values `warn` and `end_attempt`." | diff-local |
| Story 5 negative: Given `poll_seconds: 600` and `active_stall_minutes: 5`, when the config loads, then validation fails with a message that `poll_seconds` must not exceed the active-stall bound. | 1 | "`validateConfig` rejects `poll_seconds: 600` with `active_stall_minutes: 5` with an error stating `poll_seconds` must not exceed the active-stall bound, and reports an unknown `active_stall_minuts` key through the same unknown-key path as any other unknown `build_progress` key." | diff-local |
| Story 5 negative: Given an unknown key such as `active_stall_minuts` in `build_progress`, when the config loads, then it is reported the same way other unknown `build_progress` keys are reported today. | 1 | "`validateConfig` rejects `poll_seconds: 600` with `active_stall_minutes: 5` with an error stating `poll_seconds` must not exceed the active-stall bound, and reports an unknown `active_stall_minuts` key through the same unknown-key path as any other unknown `build_progress` key." | diff-local |
| Story 6 happy: Given a Claude build invocation receives an abort signal while its subprocess runs, when the signal fires, then the subprocess is sent a termination signal and the invocation returns an unsuccessful result instead of waiting for the session to finish. | 11 | "A Claude invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false` without waiting for the session to finish, as asserted in `test/execution/claude-provider-abort.test.ts`." | diff-local |
| Story 6 happy: Given a Codex build invocation receives an abort signal while its subprocess runs, when the signal fires, then the subprocess is sent a termination signal and the invocation returns an unsuccessful result. | 12 | "A Codex invocation with `abortSignal` passes it to its execa subprocess as `cancelSignal` without setting `forceKillAfterDelay: false`, and on abort resolves `success: false`, as asserted in `test/execution/codex-provider-abort.test.ts`." | diff-local |
| Story 6 happy: Given a Pi build invocation receives an abort signal, when the signal fires, then its existing aborted-invocation behaviour is unchanged. | 13 | "The existing Pi provider abort tests that assert `abortedInvocationResult` for a pre-aborted and a mid-run abort pass unchanged." | diff-local |
| Story 6 negative: Given a provider subprocess ignores the termination signal, when the grace period elapses, then it is forcibly killed and the invocation still returns. | 11, 12 | "With a real child process that ignores SIGTERM, aborting a Claude invocation still terminates the child by SIGKILL after the execa grace period and the invocation resolves `success: false`, as asserted in `test/execution/claude-provider-abort.test.ts`." | diff-local |
| Story 6 negative: Given an abort signal that is already aborted before the invocation starts, when a Claude or Codex invocation is requested, then no subprocess is spawned. | 11, 12 | "A Claude invocation whose `abortSignal` is already aborted spawns no subprocess." | diff-local |
| Story 6 negative: Given a Claude or Codex invocation ended by its abort signal, when its result is classified, then it is reported as neither rate-limited, authentication-failed nor session-expired, so it never takes a recovery path that leaves the retry budget untouched. | 11, 12 | "An aborted Claude result carries no `rateLimited`, `authFailure` or `sessionExpired` signal." | diff-local |
| Story 6 negative: Given an invocation that receives no abort signal, when it runs, then Claude and Codex behave exactly as before, with no cancellation option forwarded. | 11, 12 | "A Claude invocation without `abortSignal` passes no `cancelSignal` option to its subprocess." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-10-intra-step-build-progress-events#D1 | existing | none | `build_progress` and `build_no_progress` are already members of the `ConductorEvent` union in `types/events.ts`; this feature only adds a field to each. |
| adr-2026-07-10-intra-step-build-progress-events#D2 | existing | none | The watcher already surfaces `noEvidenceAttempts` from the task-evidence sidecar on every emission; unchanged here. |
| adr-2026-07-10-intra-step-build-progress-events#D3 | existing | none | `conductor.ts` already constructs `BuildProgressWatcher` only for the build step, starts it before dispatch and stops it in a `finally`; unchanged here. |
| adr-2026-07-10-intra-step-build-progress-events#D4 | task | task-10 | classify the second as `no_task_progress` and enter the existing remediation and HALT path |
| adr-2026-07-10-intra-step-build-progress-events#D5 | task | task-6 | `renderDaemonEvent` renders a `build_active_stall` event as one `daemon.log` warning line |
| adr-2026-07-10-intra-step-build-progress-events#D6 | existing | none | The `ui_renderer` plugin seam already receives every subscribed kind; Task 2 adds `build_active_stall` to the subscribed-kinds list with no plugin change. |
| adr-2026-07-10-intra-step-build-progress-events#D7 | task | task-1 | The `build_progress` known-key list holds exactly `poll_seconds`, `quiet_minutes`, `heartbeat_minutes`, `enabled`, `active_stall_minutes`, `active_stall_action` |
| adr-2026-07-10-intra-step-build-progress-events#D8 | task | task-4 | emits exactly one `build_active_stall` with `action: "warn"` |
| adr-2026-07-10-intra-step-build-progress-events#D9 | task | task-9 | the step runner observes its `abortSignal` aborted |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D1 | no-change | none | Preparation state entry is untouched; the active-stall end applies only to an attempt that has already spawned and is running. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D2 | no-change | none | The spawn-permit contract is untouched; adapters still validate the permit before any spawn, and a pre-aborted invocation spawns nothing at all. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D3 | no-change | none | Spawn still moves the attempt to running; no lifecycle state is added or changed. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D4 | no-change | none | Output silence keeps no termination authority: a quiet tick never arms or fires the active-stall bound (Task 5 asserts a stale heartbeat never ends an attempt). |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D5 | no-change | none | Preparation timeout and its revocation are untouched; the active-stall end is not a preparation timeout and consults no process discovery. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D6 | no-change | none | The one lifecycle replacement and its persisted recovery count are untouched; an ended build attempt is counted only by the build retry budget. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D7 | no-change | none | Clean-completion reset and provider fallback inside an active lifecycle attempt are unchanged; Task 8 stops candidate iteration only for an aborted build attempt. |
| adr-2026-07-30-provider-preparation-lifecycle-supervision#D8 | task | task-5 | the watcher never invokes `endAttempt` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
