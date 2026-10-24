# Implementation Plan: The daemon runs every feature in one executor

**Date:** 2026-10-24
**Design:** [architecture review](../decisions/architecture-review-2026-10-24-daemon-still-carries-two-feature-executors-in-proc.md) (technical track, no PRD)
**Stories:** .docs/stories/daemon-still-carries-two-feature-executors-in-proc.md
**Conflict check:** Clean as of 2026-10-24
**Source:** jstoup111/ai-conductor#3333

## Summary

This plan removes the daemon's in-process feature executor, as though it never existed. The
per-dispatch engine-pinned child executor becomes the only way the daemon runs a feature. Daemon
tests reach that path through an injected in-memory fork instead of a supervisor-side runner. The
work is fourteen tasks.

## Technical Approach

- **Sequencing.** This spec is blocked by #3377, which is being built now. BUILD starts from a base
  that already contains #3377's shared daemon-process bootstrap, `makeExecutorChildRun`, and its
  trailer tests. Wherever this plan names the `executor-child` entry composition, it means the
  composition on that base.
- **Executor-child runtime factory (Task 1).** The `executor-child` branch of `src/conductor/src/index.ts`
  builds its `withExecutorBrokerProxies` input inline: `createWorktree` through `makeFeatureRunnerDeps`,
  and `run`. Move that composition into one exported factory in
  `src/conductor/src/engine/executor-child-runtime.ts`,
  `createExecutorChildRuntime({ projectRoot })`, returning `{ createWorktree, run }`. `index.ts` calls
  it, so the production child and the test fork compose the child identically. This is a pure move;
  the child's behavior does not change.
- **In-memory fork fixture (Task 1).** `src/conductor/test/fixtures/in-memory-executor-fork.ts`
  exports `createInMemoryExecutorFork(options)`. It returns a function with the
  `ChildFeatureExecutorDeps['fork']` signature. Each call creates an in-memory child port, the
  `FixtureChild` shape now in `executor-parity.integration.test.ts`, and on the next microtask runs
  the real `runExecutorChild(port, withExecutorBrokerProxies(port, input))`. `input` defaults to
  `createExecutorChildRuntime({ projectRoot })`; a test may override `run` alone.
  `options.handshake: 'silent'` makes a child that never sends its hello, and
  `options.protocolVersion` makes a child that reports another version. The fixture also exports
  `useTempEngineStore()`. It creates a temp store with `dist` → `dist-versions/«id»`, points
  `ENGINE_STORE_ENV_VAR` at it, and restores the variable on teardown, so the supervisor's
  `engineDirForOrder` resolves a real directory. The fixture replaces only OS process creation.
- **Scheduler dependency (Task 3).** `DaemonDeps` in `src/conductor/src/engine/daemon.ts` keeps its
  shared fields. Feature execution becomes a one-of: `{ runFeature; featureExecution?: never }` or
  `{ featureExecution; runFeature?: never }`. Dispatch keeps its current branch on `featureExecution`.
  `engine/daemon.ts` unit tests keep injecting `runFeature` unchanged.
- **Daemon composition (Task 4).** In `runDaemonMode` (`src/conductor/src/daemon-cli.ts`), delete
  the in-process executor construction, the `executor_isolation` selection, the in-process startup
  log line, and the supervisor-side `makeRunFeature(deps)` fallback runner. Build only the child
  executor, always pass `featureExecution: { createWorkOrder, executor }` to `runDaemon`, and wire
  `stopChildExecutors` and `abortChildBroker` unconditionally. `DaemonModeOptions.runFeature` is
  replaced by `executorFork?: ChildFeatureExecutorDeps['fork']`, passed straight to
  `createChildProcessFeatureExecutor`. Production passes nothing, so Node's `child_process.fork`
  stays the default.
- **Removals.**
  - `createInProcessFeatureExecutor` and `InProcessFeatureExecutorDeps` in
    `engine/feature-executor.ts` (Task 8). The `FeatureExecutor` contract and outcome types stay.
  - The `executor_isolation` key from `types/config.ts`, `CONFIG_CONSUMER_KEY_SETS.top`, and
    validation in `engine/config.ts`, with no retired-key entry (Task 9). The
    `templates/project-config.yml.template` explanation block goes with it, because
    `config-template.test.ts` rejects a block for a key the validator does not accept.
  - `withDaemonLogFeatureOwnership` and its `AsyncLocalStorage` store in `engine/daemon-log.ts`
    (Task 10). `formatDaemonConsoleTeeLine` and `createOwnershipAwareDaemonLogger` keep only their
    unowned branches.
- **Tests.** Every daemon test that set `executor_isolation: in-process`, or passed `runFeature` to
  `runDaemonMode`, moves onto the in-memory fork (Tasks 6 and 7). This includes any #3377 trailer
  test that dispatches in-process; its subject is deleted with the mode. A test whose assertion does
  not depend on the executor may instead state that in a comment and run with the child executor
  composed. The executor parity test checks the child executor against the fixture's expected
  results (Task 2).
- **Docs.** `docs/` updates for the removed key and mode travel in the BUILD diff under HARNESS
  "Docs track features" and are verified at `finish`. They are not plan tasks.

**Focused local pattern: in-memory child fork** (repeated in Tasks 1, 2, 5, 6, 7 and 11). The fake
replaces only process creation. It returns a `ForkedExecutor` whose IPC port runs the real
`runExecutorChild` (hello, WorkOrder receipt, outcome) against the real broker. It fits because it
is the existing proof of child behavior, and it keeps the production broker path under test.
Allowed variation: tests may override the child's `run`, but never the broker or the handshake.
Search hints: `FixtureChild` and `runChildProcess` in
`src/conductor/test/engine/executor-parity.integration.test.ts`; `ForkedExecutor` and
`createChildProcessFeatureExecutor` in `src/conductor/src/engine/child-feature-executor.ts`;
`runExecutorChild` and `withExecutorBrokerProxies` in `src/conductor/src/engine/executor-child.ts`.

## Prerequisites

- #3377 has shipped (land dependency). If BUILD finds `makeExecutorChildRun` absent from
  `executor-child-runtime.ts`, the base predates #3377 and BUILD must stop rather than re-implement it.

## Tasks

### Task 1: Executor-child runtime factory and in-memory fork fixture
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test `src/conductor/test/fixtures/in-memory-executor-fork.test.ts`: a `createChildProcessFeatureExecutor` with `fork: createInMemoryExecutorFork({ projectRoot, run })` and a real `createExecutorBroker` executes one order. Assert that the broker receives the child's hello, the child's `run` receives the dispatched WorkOrder, and the executor returns the `run` outcome. A second case uses `handshake: 'silent'` and asserts no hello reaches the broker.
2. Verify RED.
3. Move the `executor-child` branch's inline `createWorktree`/`run` composition from `src/conductor/src/index.ts` into `createExecutorChildRuntime({ projectRoot })` in `executor-child-runtime.ts`, and call it from `index.ts`. Build the fixture as described in Technical Approach. Pattern: replace only process creation; reuse the parity test's `FixtureChild` port shape; never stub the broker or handshake.
4. Verify GREEN; commit.

**Done when:**
- [test] `in-memory-executor-fork.test.ts` shows `createInMemoryExecutorFork` reaching the real `runExecutorChild` and broker: hello received, WorkOrder delivered to `run`, and the `run` outcome returned by `execute`.
- [test] The `handshake: 'silent'` case delivers no hello to the broker.
- The `executor-child` branch of `src/conductor/src/index.ts` obtains its `createWorktree` and `run` only from `createExecutorChildRuntime({ projectRoot })`.
- `useTempEngineStore()` points `ENGINE_STORE_ENV_VAR` at a temp store whose `dist` resolves to `dist-versions/«id»`, and restores the variable on teardown.

**Files likely touched:**
- src/conductor/src/engine/executor-child-runtime.ts — export `createExecutorChildRuntime`
- src/conductor/src/index.ts — executor-child branch calls the factory
- src/conductor/test/fixtures/in-memory-executor-fork.ts — new shared fixture
- src/conductor/test/fixtures/in-memory-executor-fork.test.ts — fixture contract test

**Dependencies:** none

### Task 2: Executor parity test checks the child against fixture expectations
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Rewrite `src/conductor/test/engine/executor-parity.integration.test.ts` to drive the child executor through `createInMemoryExecutorFork` with the existing completed, rate-limited, and halted fixture runs. Replace each in-process comparison with literal expected values: the ordered step sequence, the ledger event types, the terminal status, and the terminal effects. Pattern: in-memory fork replaces only process creation.
2. Run it against the current child executor; it must pass (the expectations describe current behavior).
3. Commit.

**Done when:**
- [test] The clean run asserts the literal step sequence `step_started:memory, step_completed:memory, step_started:build, step_completed:build`, ledger event types, status `done`, and the `markProcessed`/`enrollWatch`/`sweep` effects.
- [test] The rate-limited run waits on the daemon-wide episode, completes after it clears, and records the same step sequence as the clean run.
- [test] The halted run asserts the halt marker, the ledger, and a collected `halted` outcome equal to the fixture's expected halt.
- `executor-parity.integration.test.ts` no longer imports from `src/conductor/src/engine/feature-executor.ts` anything other than types.

**Files likely touched:**
- src/conductor/test/engine/executor-parity.integration.test.ts — child-only, fixture-expected assertions

**Dependencies:** Task 1

### Task 3: The scheduler accepts exactly one feature-execution dependency
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-feature-execution-deps.test.ts`. A type-level case uses `@ts-expect-error` on a `DaemonDeps` literal supplying both `runFeature` and `featureExecution`, and on one supplying neither; literals supplying exactly one typecheck. A runtime case runs `runDaemon` with `featureExecution` and asserts its `executor.execute` receives the built WorkOrder for the claimed item, while a spy standing in for a runner is never called.
2. Verify RED (`npm run typecheck` reports the unused `@ts-expect-error`).
3. Make feature execution a one-of on `DaemonDeps` in `src/conductor/src/engine/daemon.ts`. Make `runDaemonMode` pass exactly one: `featureExecution` when no `opts.runFeature` is given, otherwise `runFeature` (Task 4 then removes `opts.runFeature`). Drop the unused member from any test literal that supplies both.
4. Verify GREEN; commit.

**Done when:**
- [test] `daemon-feature-execution-deps.test.ts` typechecks only because `DaemonDeps` rejects both-supplied and neither-supplied literals, as its `@ts-expect-error` lines assert.
- [test] With `featureExecution` composed, `runDaemon` calls `executor.execute` with the claimed item's WorkOrder, and no supervisor-side feature runner is invoked for that feature.
- `runDaemonMode` passes `runDaemon` exactly one of `runFeature` or `featureExecution`.

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — one-of feature-execution dependency
- src/conductor/src/daemon-cli.ts — pass exactly one member
- src/conductor/test/engine/daemon-feature-execution-deps.test.ts — new
- src/conductor/test/engine/daemon-maintenance.test.ts — drop the unused member if both are supplied
- src/conductor/test/engine/park-dispatch-enumeration.test.ts — same
- src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts — same

**Dependencies:** none

### Task 4: Daemon composition builds only the child executor
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Add `src/conductor/test/engine/daemon-child-dispatch.integration.test.ts` with failing cases. (a) `runDaemonMode` with `useTempEngineStore()` pinned to `v1` and `executorFork: createInMemoryExecutorFork({ projectRoot })` dispatches one fixture feature. Assert the fork is called exactly once, the WorkOrder carries `engineVersionId` `v1`, the feature worktree's `.pipeline/events.jsonl` records `executor_started` with `engineVersionId` `v1`, the broker receives that child's hello, the production `createExecutorChildRuntime` `run` receives the WorkOrder, and terminal effects apply only after the claim is released. (b) Two features run in flight under `daemon_concurrency: 2`; SIGTERM makes each in-memory child port receive a `stop` message and calls the broker's `abortAll` before `runDaemonMode` resolves. In `src/conductor/test/engine/daemon-cli-executor-wiring.test.ts`, delete the rollback case with its subject. Add a case with no `executorFork` and `node:child_process` `fork` mocked, verifying the production adapter reaches the mock: a dispatch pinned to `v1` calls the mocked `fork` with a module path inside the temp store's `dist-versions/v1` directory. Pattern: in-memory fork replaces only process creation.
2. Verify RED.
3. In `runDaemonMode`, apply the Daemon composition changes in Technical Approach. Replace `DaemonModeOptions.runFeature` with `executorFork`, and delete the remaining `opts.runFeature` branch from Task 3.
4. Verify GREEN; commit.

**Done when:**
- [test] `daemon-child-dispatch.integration.test.ts` shows `runDaemonMode` dispatching a claimed feature through exactly one fork call, whose WorkOrder carries `engineVersionId` `v1`, whose feature worktree `.pipeline/events.jsonl` records `executor_started` with `engineVersionId` `v1`, and whose terminal effects apply only after the claim is released.
- [test] In that dispatch the broker receives the in-memory child's hello and the production `createExecutorChildRuntime` `run` receives the WorkOrder, so the dispatch passes through a real broker attachment and the real executor-child runtime.
- [test] With no `executorFork` and `node:child_process` `fork` mocked, `daemon-cli-executor-wiring.test.ts` shows a dispatch pinned to `v1` launching the child through the mocked Node `fork` with a module path inside the temp store's `dist-versions/v1` directory.
- [test] SIGTERM with two features in flight makes each of the two in-memory child ports receive a `stop` message and calls the broker's `abortAll` before `runDaemonMode` resolves.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — single composition; `executorFork` option
- src/conductor/test/engine/daemon-cli-executor-wiring.test.ts — rollback case removed; default-fork case
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — new

**Dependencies:** Task 1, Task 3

### Task 14: Daemon composition options select nothing and name no executor mode
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Add cases to `src/conductor/test/engine/daemon-cli-executor-wiring.test.ts`. (a) With `createChildProcessFeatureExecutor` mocked, `runDaemonMode` with an empty project config constructs it once, and an injected `executorFork` arrives as its `fork`. (b) The startup log captured by the test's `log` sink contains no line matching `executor isolation` or `per-dispatch engine pinning is disabled`. (c) A `@ts-expect-error` literal passes `runFeature` to `DaemonModeOptions`.
2. Run GREEN (Task 4 provides the behavior); commit.

**Done when:**
- [test] `daemon-cli-executor-wiring.test.ts` shows `runDaemonMode` constructs the child executor with no config input selecting it, and passes an injected `executorFork` through as its `fork`.
- [test] The same suite asserts the startup log contains no line naming an executor isolation mode or disabled per-dispatch pinning.
- [test] A `@ts-expect-error` case shows `DaemonModeOptions` rejects a `runFeature` member.

**Files likely touched:**
- src/conductor/test/engine/daemon-cli-executor-wiring.test.ts — composition-option cases

**Dependencies:** Task 4

### Task 5: Handshake failures stay inside child executors
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Add failing cases to `daemon-child-dispatch.integration.test.ts`. (a) `executorFork` yields a `handshake: 'silent'` child, with short `dispatch_start_timeout_seconds`. Assert the outcome is `error` with reason exactly `executor missing startup handshake`, the claim is released, the fork was called exactly once (a missing handshake is not relaunched), and a feature-runner spy passed to the fixture's `run` was never called. (b) The first child reports a different `protocolVersion`. Assert the fork is called a second time with the supervisor's own engine directory, the relaunched child completes the feature, and the feature-runner spy runs only inside the relaunched child. Pattern: in-memory fork replaces only process creation.
2. Run them; if the production behavior already holds, they pass on first run and no source change is needed.
3. Commit.

**Done when:**
- [test] A child that never sends its hello ends the dispatch `error` with reason `executor missing startup handshake`, releases the claim, forks exactly once with no relaunch, and never invokes the feature runner.
- [test] A protocol mismatch terminates the first child and relaunches the dispatch through the fork pinned to the supervisor's engine directory, that child completes the feature, and the feature runner is never invoked outside a forked child.
- [test] The handshake-timeout case runs through the production `createChildProcessFeatureExecutor` handshake, not a test bypass, because the fixture injects only `fork`.

**Files likely touched:**
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — negative cases

**Dependencies:** Task 4

### Task 6: Daemon tests that passed a feature runner use the in-memory fork
**Story:** Story 3
**Type:** refactor

**Steps:**
1. For every test that passes `runFeature` to `runDaemonMode` (on the planning base: `test/engine/daemon-cli.test.ts`, `test/engine/daemon-restart-wiring.test.ts`, `test/acceptance/daemon-lifecycle-controls.test.ts`, `test/acceptance/no-daemon-level-metrics-queue-depth-halts-and-gate.acceptance.test.ts`, `test/daemon-otel-wiring.test.ts`; re-find them on the BUILD base with `grep -rlE "runDaemonMode" | xargs grep -l "runFeature"`), pass `executorFork: createInMemoryExecutorFork({ projectRoot, run })` instead. Move the old `runFeature` body into the child `run`, which returns the same `FeatureExecutionOutcome`. Use `useTempEngineStore()`. Pattern: in-memory fork replaces only process creation; override only `run`.
2. Each test keeps its original assertions; run them GREEN.
3. Commit.

**Done when:**
- No test under `src/conductor/test` passes a `runFeature` member to `runDaemonMode`, as `npm run typecheck` enforces through the Task 4 option type.
- [test] Each retargeted test passes with its original assertions while dispatching through `createInMemoryExecutorFork`.

**Files likely touched:**
- src/conductor/test/engine/daemon-cli.test.ts
- src/conductor/test/engine/daemon-restart-wiring.test.ts
- src/conductor/test/acceptance/daemon-lifecycle-controls.test.ts
- src/conductor/test/acceptance/no-daemon-level-metrics-queue-depth-halts-and-gate.acceptance.test.ts
- src/conductor/test/daemon-otel-wiring.test.ts

**Dependencies:** Task 4

### Task 7: Daemon tests that pinned in-process execution run the child path
**Story:** Story 3
**Type:** refactor

**Steps:**
1. For every test whose fixture config sets `executor_isolation` (on the planning base: `test/daemon-otel-wiring.test.ts`, `test/acceptance/daemon-otel-parity.acceptance.test.ts`, `test/acceptance/export-failure-visible-without-changing-run.acceptance.test.ts`, `test/engine/daemon-cli-skill-name-root.test.ts`, `test/engine/daemon-mode-feature-log.integration.test.ts`, `test/engine/daemon-state-refusal-event.test.ts`, plus any #3377 test; re-find them on the BUILD base with `grep -rl executor_isolation src/conductor/test`), remove the key. Dispatch through `executorFork: createInMemoryExecutorFork({ projectRoot })` with `useTempEngineStore()`. Their existing `daemon-runner.js` `makeRunFeature` mocks then run inside the in-memory child, because the fixture's default `run` is the production `createExecutorChildRuntime`. Pattern: in-memory fork replaces only process creation.
2. A test whose subject is the in-process dispatch itself (for example a #3377 case asserting the trailer in an in-process dispatch) is deleted with that subject. A test whose assertion does not depend on the executor at all gets a one-line comment naming why, and runs with the child executor composed.
3. Run GREEN with original assertions; commit.

**Done when:**
- No fixture config or config literal under `src/conductor/test` sets `executor_isolation`, except the Task 9 rejection cases.
- [test] Each retargeted test passes with its original assertions while dispatching through `createInMemoryExecutorFork` with the production `createExecutorChildRuntime`.
- [test] Each test kept without the fork carries a comment naming why its assertion is executor-independent, and passes with the child executor composed by `runDaemonMode`.

**Files likely touched:**
- src/conductor/test/daemon-otel-wiring.test.ts
- src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts
- src/conductor/test/acceptance/export-failure-visible-without-changing-run.acceptance.test.ts
- src/conductor/test/engine/daemon-cli-skill-name-root.test.ts
- src/conductor/test/engine/daemon-mode-feature-log.integration.test.ts
- src/conductor/test/engine/daemon-state-refusal-event.test.ts

**Dependencies:** Task 4

### Task 8: Delete the in-process executor adapter
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Delete `createInProcessFeatureExecutor` and `InProcessFeatureExecutorDeps` from `src/conductor/src/engine/feature-executor.ts`, and the adapter case in `src/conductor/test/engine/feature-executor.test.ts`. Keep the module-boundary case: the module is order-only and free of daemon root-state imports.
2. Run `npm run typecheck` and the scoped tests for `feature-executor`, `executor-parity`, and `daemon-child-dispatch`.
3. Commit.

**Done when:**
- `npm run typecheck` passes with `feature-executor.ts` exporting only the `FeatureExecutor` contract and its outcome and effect types.
- [test] `feature-executor.test.ts`'s module-boundary case passes: the executor module stays order-only with no daemon root-state imports.
- [test] `daemon-child-dispatch.integration.test.ts` still dispatches through the child executor after the deletion.

**Files likely touched:**
- src/conductor/src/engine/feature-executor.ts — adapter removed
- src/conductor/test/engine/feature-executor.test.ts — adapter case removed

**Dependencies:** Task 2, Task 4, Task 7

### Task 9: A config naming executor_isolation fails as an unknown key
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Replace the `executor_isolation` cases in `src/conductor/test/engine/config.test.ts` with failing cases. With the key absent, `validateConfig` returns ok with no executor-isolation warning, no `deprecatedKeys` entry, and no `executor_isolation` property, and `emitDeprecatedConfigKeyEvents` on that result emits no `config_deprecated_key` event. For each of `in-process`, `child`, `thread`, `''`, `true`, `1`, `null`, and `{}`, it returns `ok: false` with the error message exactly `Unknown top-level key: "executor_isolation"`, and `emitDeprecatedConfigKeyEvents` on that result emits nothing. Add a daemon-level case to `daemon-child-dispatch.integration.test.ts`: a project config containing `executor_isolation: in-process` makes `runDaemonMode` fail at config load and never call the fork.
2. Verify RED.
3. Remove the key from `HarnessConfig` in `src/conductor/src/types/config.ts`, from `CONFIG_CONSUMER_KEY_SETS.top`, and from validation in `src/conductor/src/engine/config.ts`. Add no `RETIRED_TOP_LEVEL_KEYS` entry. Remove its row from `test/engine/config-consumer-registry.ts` and its explanation block from `templates/project-config.yml.template`.
4. Verify GREEN, including `config-template.test.ts`; commit.

**Done when:**
- [test] `config.test.ts` asserts `validateConfig` rejects `executor_isolation` set to each of `in-process`, `child`, `thread`, `''`, `true`, `1`, `null`, and `{}` with exactly `Unknown top-level key: "executor_isolation"`; the rejection comes from the unknown-top-level-key check by key name before any value is read, so no value is accepted.
- [test] For each of those rejected configs, the result carries no warnings and `emitDeprecatedConfigKeyEvents` emits no `config_deprecated_key` event, so no retired-key warning or deprecation event is produced for the key.
- [test] `config.test.ts` asserts a config without the key loads with no executor-isolation warning, no `executor_isolation` field, and no `config_deprecated_key` event from `emitDeprecatedConfigKeyEvents`.
- [test] `daemon-child-dispatch.integration.test.ts` shows `runDaemonMode` with that key in project config fails at load and never invokes the executor fork, so no feature is claimed.
- [test] `config-template.test.ts` passes, with the template carrying no `executor_isolation` block and the consumer registry carrying no entry for the key.

**Files likely touched:**
- src/conductor/src/types/config.ts — key removed
- src/conductor/src/engine/config.ts — key removed from known keys and validation
- src/conductor/test/engine/config.test.ts — rejection cases
- src/conductor/test/engine/config-consumer-registry.ts — entry removed
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — load-failure case
- templates/project-config.yml.template — block removed

**Dependencies:** Task 4, Task 7

### Task 10: Supervisor log lines stay unattributed without the ownership context
**Story:** Story 4
**Type:** refactor

**Steps:**
1. In `src/conductor/test/engine/daemon-log.test.ts`, replace the `withDaemonLogFeatureOwnership` cases with failing-first cases. `formatDaemonConsoleTeeLine('warn', m)` renders the unprefixed supervisor form, called both while an unrelated promise chain is in flight and outside one. `createOwnershipAwareDaemonLogger(log)` forwards every line to `log` unchanged.
2. Delete `withDaemonLogFeatureOwnership` and the `featureOwnership` store from `src/conductor/src/engine/daemon-log.ts`. Reduce `formatDaemonConsoleTeeLine` and `createOwnershipAwareDaemonLogger` to their unowned branches, and remove the import from `daemon-cli.ts`.
3. Verify GREEN; commit.

**Done when:**
- [test] `daemon-log.test.ts` asserts `formatDaemonConsoleTeeLine` renders a supervisor `console.warn` with no feature slug tag while features are in flight.
- [test] `daemon-log.test.ts` asserts `createOwnershipAwareDaemonLogger` renders a daemon-wide event through the plain daemon logger with no feature slug tag.
- `npm run typecheck` passes with `engine/daemon-log.ts` holding no `AsyncLocalStorage` feature-ownership store.

**Files likely touched:**
- src/conductor/src/engine/daemon-log.ts — ownership context removed
- src/conductor/src/daemon-cli.ts — import removed
- src/conductor/test/engine/daemon-log.test.ts — ownership cases replaced

**Dependencies:** Task 4

### Task 11: Concurrent child output keeps per-feature attribution in daemon.log
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Add a failing-first case to `daemon-child-dispatch.integration.test.ts` with `daemon_concurrency: 2`. `executorFork: createInMemoryExecutorFork({ projectRoot, run })` runs `feature-a` and `feature-b`. Each child's `run` writes a feature log line and a `console.warn` naming its own slug, while the supervisor writes a `console.warn` during the overlap. Read `.daemon/daemon.log`. Pattern: in-memory fork replaces only process creation.
2. If the broker's forwarded-log path already satisfies it, the case passes with no source change; otherwise fix the forwarding in `src/conductor/src/engine/executor-broker.ts`.
3. Commit.

**Done when:**
- [test] Every daemon.log line from `feature-a`'s child (feature log and forwarded `console.warn`) carries only `feature-a`'s slug tag, every line from `feature-b`'s child carries only `feature-b`'s, and none of them is unprefixed.
- [test] The supervisor `console.warn` written during the overlap appears in daemon.log with no feature slug tag, so it is never attributed to `feature-a` or `feature-b`.

**Files likely touched:**
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — concurrency attribution case
- src/conductor/src/engine/executor-broker.ts — only if forwarding needs a fix

**Dependencies:** Task 4, Task 10

### Task 12: A test that still sets the retired key fails at load
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Add a case to `src/conductor/test/fixtures/in-memory-executor-fork.test.ts`. A daemon test fixture that writes `executor_isolation: in-process` into `.ai-conductor/config.yml` and calls `runDaemonMode` with `executorFork` gets the config load error `Unknown top-level key: "executor_isolation"`, and the fork is never called.
2. Run GREEN (Task 9 provides the behavior); commit.

**Done when:**
- [test] A daemon test fixture whose config sets `executor_isolation` fails at config load with `Unknown top-level key: "executor_isolation"` and never calls the injected executor fork, so no execution path is silently selected.
- [test] The same fixture with the key removed dispatches through the injected executor fork, so the load failure is caused by the key alone.

**Files likely touched:**
- src/conductor/test/fixtures/in-memory-executor-fork.test.ts — stale-fixture case

**Dependencies:** Task 9

### Task 13: A test fork that never sends hello hits the production timeout
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Add a case to `src/conductor/test/fixtures/in-memory-executor-fork.test.ts`. A `createChildProcessFeatureExecutor` with `fork: createInMemoryExecutorFork({ handshake: 'silent' })` and `dispatchStartTimeoutMs: 50` returns an `error` outcome after the timeout, and the fixture's `run` is never invoked. Pattern: in-memory fork replaces only process creation.
2. Run GREEN; commit.

**Done when:**
- [test] With a silent in-memory child, `createChildProcessFeatureExecutor.execute` returns an `error` outcome through its own dispatch-start timeout handling, and the child's `run` is never invoked.
- [test] That outcome's reason is exactly `executor missing startup handshake`, set by the executor's start-timeout timer, and the fork is called once.

**Files likely touched:**
- src/conductor/test/fixtures/in-memory-executor-fork.test.ts — silent-child timeout case

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ─┬─> Task 2 ─────────────────────┐
        ├─> Task 13                      │
        └─┐                              v
Task 3 ───┴─> Task 4 ─┬─> Task 5        Task 8 (also after Task 7)
                      ├─> Task 6
                      ├─> Task 7 ─┬─> Task 8
                      │           └─> Task 9 ─> Task 12
                      ├─> Task 10 ─> Task 11 (also after Task 4)
                      └─> Task 14
```

## Integration Points

- After Task 4: a daemon dispatch runs end to end through `runDaemonMode`, the child executor, the
  broker, and the real executor-child runtime inside one test process.
- After Task 9: a project config naming the retired key cannot start the daemon.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a valid project config and a built engine version `v1` current in the engine store, when the daemon starts and claims a feature, then it builds a WorkOrder pinned to `v1`, forks exactly one child executor for that feature, and the feature's `.pipeline/events.jsonl` records `executor_started` with `engineVersionId` `v1`. | 4 | "dispatching a claimed feature through exactly one fork call, whose WorkOrder carries `engineVersionId` `v1`, whose feature worktree `.pipeline/events.jsonl` records `executor_started` with `engineVersionId` `v1`" | diff-local |
| Story 1 happy: Given the daemon has started, when its startup log is read, then it contains no line naming an executor isolation mode or saying that per-dispatch engine pinning is disabled. | 14 | "The same suite asserts the startup log contains no line naming an executor isolation mode or disabled per-dispatch pinning." | diff-local |
| Story 1 happy: Given two features in flight under `daemon_concurrency: 2`, when the daemon receives SIGTERM, then each child executor receives a stop request and the broker aborts pending coordination calls before the supervisor exits. | 4 | "SIGTERM with two features in flight makes each of the two in-memory child ports receive a `stop` message and calls the broker's `abortAll` before `runDaemonMode` resolves." | diff-local |
| Story 1 negative: Given a dispatch whose child never sends its hello within the dispatch-start timeout, when the timeout expires, then the dispatch ends with an `error` outcome whose reason is `executor missing startup handshake`, the claim is released, no relaunch is attempted, and no step of that feature runs inside the supervisor process. | 5 | "A child that never sends its hello ends the dispatch `error` with reason `executor missing startup handshake`, releases the claim, forks exactly once with no relaunch, and never invokes the feature runner." | diff-local |
| Story 1 negative: Given a child that reports a protocol version different from the supervisor's, when the supervisor reads its hello, then it terminates that child and relaunches the dispatch as a child pinned to the supervisor's own engine directory, never inside the supervisor process. | 5 | "that child completes the feature, and the feature runner is never invoked outside a forked child." | diff-local |
| Story 1 negative: Given the daemon scheduler is composed with a feature executor, when a feature is dispatched, then the executor runs it and no supervisor-side feature runner is invoked for it. | 3 | "With `featureExecution` composed, `runDaemon` calls `executor.execute` with the claimed item's WorkOrder, and no supervisor-side feature runner is invoked for that feature." | diff-local |
| Story 2 happy: Given a project `.ai-conductor/config.yml` with no `executor_isolation` key, when the config loads, then it loads with no warning about executor isolation, no `config_deprecated_key` event, and no executor-isolation field in the loaded config. | 9 | "`config.test.ts` asserts a config without the key loads with no executor-isolation warning, no `executor_isolation` field, and no `config_deprecated_key` event from `emitDeprecatedConfigKeyEvents`." | diff-local |
| Story 2 negative: Given a project config containing `executor_isolation: in-process`, when the config loads, then loading fails with exactly `Unknown top-level key: "executor_isolation"` and the daemon claims no feature. | 9 | "`daemon-child-dispatch.integration.test.ts` shows `runDaemonMode` with that key in project config fails at load and never invokes the executor fork, so no feature is claimed." | diff-local |
| Story 2 negative: Given a project config containing `executor_isolation: child`, when the config loads, then loading fails with the same `Unknown top-level key: "executor_isolation"` error; no value of the key is accepted. | 9 | "the rejection comes from the unknown-top-level-key check by key name before any value is read, so no value is accepted." | diff-local |
| Story 2 negative: Given a project config containing `executor_isolation` with any value, when the config loads, then no `config_deprecated_key` event and no retired-key warning is emitted for it. | 9 | "the result carries no warnings and `emitDeprecatedConfigKeyEvents` emits no `config_deprecated_key` event, so no retired-key warning or deprecation event is produced for the key." | diff-local |
| Story 3 happy: Given a daemon composition test that injects an in-memory fork, when it dispatches a fixture feature, then the dispatch passes through WorkOrder creation, the child executor, a real broker attachment and the real executor-child runtime, and the feature's terminal effects apply only after its claim is released. | 4 | "so the dispatch passes through a real broker attachment and the real executor-child runtime." | diff-local |
| Story 3 happy: Given any daemon test that formerly pinned in-process execution in its config fixture, when it runs, then it dispatches through the injected fork, or the test file states why its assertion does not depend on the executor and the test passes with the child executor composed. | 7 | "and passes with the child executor composed by `runDaemonMode`." | diff-local |
| Story 3 happy: Given the daemon is composed with no injected fork, when a feature is dispatched, then the child executor launches the child with Node's process fork from the pinned engine directory. | 4 | "launching the child through the mocked Node `fork` with a module path inside the temp store's `dist-versions/v1` directory." | diff-local |
| Story 3 negative: Given a daemon test that injects an in-memory fork whose child never sends its hello, when it dispatches a feature, then the test observes the production handshake-timeout handling and an `error` outcome, not a bypass that skips the handshake. | 13, 5 | "With a silent in-memory child, `createChildProcessFeatureExecutor.execute` returns an `error` outcome through its own dispatch-start timeout handling, and the child's `run` is never invoked." | diff-local |
| Story 3 negative: Given a daemon composition caller that supplies a feature runner function in place of a fork, when the code is typechecked, then it fails because the daemon accepts no such option. | 14 | "A `@ts-expect-error` case shows `DaemonModeOptions` rejects a `runFeature` member." | diff-local |
| Story 3 negative: Given a daemon test whose fixture config still sets `executor_isolation`, when it runs, then it fails at config load with the unknown-key error rather than silently selecting an execution path. | 12 | "never calls the injected executor fork, so no execution path is silently selected." | diff-local |
| Story 4 happy: Given a feature running in its child executor, when the child writes a feature log line or a `console.warn`, then `.daemon/daemon.log` shows that line carrying the feature's slug tag. | 11 | "Every daemon.log line from `feature-a`'s child (feature log and forwarded `console.warn`) carries only `feature-a`'s slug tag, every line from `feature-b`'s child carries only `feature-b`'s, and none of them is unprefixed." | diff-local |
| Story 4 happy: Given supervisor code writes a `console.warn` while features are in flight, when the line reaches `.daemon/daemon.log`, then it is rendered as a supervisor line with no feature slug tag. | 10, 11 | "`daemon-log.test.ts` asserts `formatDaemonConsoleTeeLine` renders a supervisor `console.warn` with no feature slug tag while features are in flight." | diff-local |
| Story 4 happy: Given a daemon-wide bus event outside any feature, when the global subscriber renders it, then the line is rendered by the plain daemon logger with no feature slug tag. | 10 | "`daemon-log.test.ts` asserts `createOwnershipAwareDaemonLogger` renders a daemon-wide event through the plain daemon logger with no feature slug tag." | diff-local |
| Story 4 negative: Given two features `feature-a` and `feature-b` in flight at once, each writing console output from its child, when `.daemon/daemon.log` is read, then every line from `feature-a` carries only `feature-a`'s tag, every line from `feature-b` carries only `feature-b`'s tag, and none of them is unprefixed. | 11 | "Every daemon.log line from `feature-a`'s child (feature log and forwarded `console.warn`) carries only `feature-a`'s slug tag, every line from `feature-b`'s child carries only `feature-b`'s, and none of them is unprefixed." | diff-local |
| Story 4 negative: Given supervisor console output written while `feature-a` is in flight, when it is rendered, then it never carries `feature-a`'s slug tag. | 11 | "The supervisor `console.warn` written during the overlap appears in daemon.log with no feature slug tag, so it is never attributed to `feature-a` or `feature-b`." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D1 | task | task-14, task-8 | `daemon-cli-executor-wiring.test.ts` shows `runDaemonMode` constructs the child executor with no config input selecting it |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D2 | task | task-4 | whose WorkOrder carries `engineVersionId` `v1` |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D3 | task | task-5 | A protocol mismatch terminates the first child and relaunches the dispatch through the fork pinned to the supervisor's engine directory |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D4 | task | task-11 | carries only `feature-a`'s slug tag, every line from `feature-b`'s child carries only `feature-b`'s |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D5 | task | task-4 | makes each of the two in-memory child ports receive a `stop` message and calls the broker's `abortAll` before `runDaemonMode` resolves. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D6 | no-change | none | Executor records and GC protection (`.daemon/executors/«slug».json`, `readLiveReferencedVersionIds`) are written by the child executor path this feature keeps; no task touches them. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D7 | no-change | none | The supervisor restart policy and `supervisor_max_stale_hours` are independent of executor selection; no task changes them. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D8 | no-change | none | The self-host cadence rebuild job is unaffected by removing the in-process adapter; no task touches daemon maintenance. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D9 | existing | none | The child emits `executor_started { slug, engineVersionId, protocolVersion, supervisorEngineVersionId }` (`src/conductor/src/engine/executor-child.ts`), now on every dispatch because the child is the only executor. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D10 | no-change | none | Records #2392's single-spec delivery decision; this plan is fourteen tasks and carries no scope exception. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D1 | task | task-14, task-8 | passes an injected `executorFork` through as its `fork` |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D2 | existing | none | `buildWorkOrder` in `src/conductor/src/engine/work-order.ts` builds the serializable WorkOrder the child executor already receives over IPC; unchanged. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D3 | no-change | none | WorkClaims dispatch authority is unchanged; claims are acquired and released by `runDaemon` exactly as before. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D4 | existing | none | `resolveDaemonBaseSha` pins the base SHA into each WorkOrder at claim time in `runDaemonMode`; unchanged. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D5 | no-change | none | Maintenance policies run on the dispatcher side regardless of executor; no task touches them. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D6 | no-change | none | Live-boundary windows are brokered for child executors already (adr-2026-10-15 D4); no task changes them. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D7 | no-change | none | `daemon_concurrency` is unchanged; Task 11 runs at `daemon_concurrency: 2` without altering the key. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D8 | task | task-10, task-11 | `daemon-log.test.ts` asserts `formatDaemonConsoleTeeLine` renders a supervisor `console.warn` with no feature slug tag while features are in flight. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
