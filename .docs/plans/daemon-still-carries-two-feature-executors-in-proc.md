# Implementation Plan: The daemon runs every feature in one executor, with one lifecycle

**Date:** 2026-11-07
**Design:** [architecture review](../decisions/architecture-review-2026-10-24-daemon-still-carries-two-feature-executors-in-proc.md) (technical track, no PRD)
**Stories:** .docs/stories/daemon-still-carries-two-feature-executors-in-proc.md
**Conflict check:** Clean as of 2026-11-07 (.docs/conflicts/daemon-still-carries-two-feature-executors-in-proc.md)
**Source:** jstoup111/ai-conductor#3333
**Scope-exception:** Operator decisions 6 and 7 of 2026-11-07 in the architecture review: deliver parity and removal as one spec of 36 tasks in two stacked slices rather than two specs, because removal is only safe once parity has shipped on the same branch stack, and a separate spec would add an intake and PR boundary with no independent value.

## Summary

The daemon's child executor, the production default, skips seventeen behaviors that only the
in-process runner performs (the architecture review's parity inventory). Slice 1 moves the
in-process lifecycle into one engine module and makes the child run it, with a test through the
child path for every inventory row. Slice 2 then removes the in-process executor, the
`executor_isolation` key and the supervisor-side test bypass. The plan has 36 tasks in two stacked
slices of 26 and 10.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | The child runs the shared daemon feature lifecycle | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26 |
| 2 | One feature executor | 27, 28, 29, 30, 31, 32, 33, 34, 35, 36 |

## Technical Approach

- **Base.** BUILD starts from a base that contains #3377 (shipped in #3406), the feature dispatch
  lease (#3480) and the shared state seed (#3331). Line numbers in this plan are rediscovery hints.
- **The lifecycle module (Tasks 1, 2).** `src/conductor/src/engine/daemon-feature-lifecycle.ts`
  receives, moved verbatim from `src/conductor/src/daemon-cli.ts`: the `runConductorInWorktree`
  body as `runDaemonFeatureConductor(context, worktree, item, …)`, `runSetupTriage` as
  `runDaemonSetupTriage`, and the helpers `runDaemonRekickStackPreflight`,
  `restackResolverForStepRunner`, `createForcedSetupPrepare`,
  `prepareDaemonFeatureManagedSessionContext` and `createWorkOrderGitRunner`. `DaemonFeatureLifecycleContext`
  is a named type with required members. The one allowed non-verbatim edit is importing
  `ConductorEventEmitter` from `engine/conductor-event-emitter.ts`, not `ui/events.ts`, because the
  layer ratchet checks type imports. Task 2 replaces the supervisor-local reads with context members:
  `registerConductor`, `registerAbortController`, `isShutdownRequested`, `flushFeatureEvents`,
  `engineVersionId` and the canonical `projectRoot`.
- **The child runtime (Tasks 3, 6, 7, 8).** `createExecutorChildRuntime({ projectRoot, processServices })`
  in `engine/executor-child-runtime.ts` returns `{ admitDispatch, createWorktree, run }`;
  `processServices` is `'install' | 'inherited'`. `makeRunFeature` gains a required
  `dispatchAdmission: 'acquire' | 'admitted'`. The WorkOrder gains an optional `baseBranch`. Task 8
  makes `runExecutorChildFeature` call `makeFeatureRunnerDeps` with the lifecycle module, keeping
  only its overrides: the pre-created worktree, the child bus, deferred terminal effects,
  `dispatchAdmission: 'admitted'`, and the order bindings (`prepareWorktree` receives the order;
  `runSetupTriage` receives `order.baseSha`).
- **The test boundary (Tasks 4, 5).** `src/conductor/test/fixtures/in-memory-executor-fork.ts`
  exports `createInMemoryExecutorFork(options)` with the `ChildFeatureExecutorDeps['fork']`
  signature, and `useTempEngineStore()`. The fork's port invokes `send`'s callback after delivery,
  gives each child its own console sink, derives the child's `moduleDir` from the forked module path,
  and composes the runtime with `processServices: 'inherited'` after installing the services once per
  test process. `runDaemonMode` gains an optional `engineRoot` option (conductor root and own engine
  directory) that defaults to the module-derived values. Store fixtures use ids matching
  `VERSION_ID_PATTERN`, such as `20261107T000000Z-0123456789ab`.
- **Parity tests (Tasks 9–26).** Every inventory row is asserted in
  `src/conductor/test/engine/executor-child-lifecycle.integration.test.ts`, which dispatches
  through `createChildProcessFeatureExecutor` with the in-memory fork and the production runtime.
  Provider boundaries are stubbed at their adapters (installed-provider discovery, model probes,
  the `gh` and git runners), never at the lifecycle.
- **Supervisor telemetry (Tasks 24, 25).** `createChildProcessFeatureExecutor` classifies the
  dispatch with `classifyDispatchKind` before the fork, reads `haltClass` with
  `readHaltSidecarClassification`, takes `step` from the last forwarded `loop_halt`, and maps
  `parked` to `terminated`. The broker's `attachFeatureOtelVisualizer` takes a visualizer context and
  returns `{ stop(): Promise<void> }`, awaited before `feature_dispatch_ended`.
- **Removal (Tasks 27–36).** As approved in operator decisions 1–4: the `runDaemon` one-of
  dependency, child-only composition with `executorFork`, deletion of `createInProcessFeatureExecutor`
  and the supervisor's lifecycle adapter, the config key, and the daemon-log ownership context.
- **Unchanged tests.** "Unchanged" means unchanged behavioral assertions. Retargeting an import
  from `daemon-cli.ts` to the lifecycle module is allowed. Find the retarget set by search on the
  BUILD base: every test importing a moved helper or mocking `makeRunFeature`, for example
  `daemon-cli-skill-name-root.test.ts` and `stack-preflight-wiring.sweepG4.test.ts`.
- **Typing checks.** Test-only typing is checked with `npm run typecheck:test`; `npm run typecheck`
  excludes `test/`.
- **Docs.** `docs/` updates for the removed key and mode travel in the BUILD diff under HARNESS
  "Docs track features" and are verified at `finish`. They are not plan tasks.

**Focused local pattern: in-memory child fork** (Tasks 5, 9–29, 36). The fake replaces only OS
process creation. Its port runs the real `runExecutorChild(port, withExecutorBrokerProxies(port, input))`
against the real broker. It fits because the existing executor parity test proves child behavior
this way. Allowed variation: a test may override the child's `run` only in Slice 2 retarget tasks;
parity tests never override it. Search hints: `FixtureChild` in
`src/conductor/test/engine/executor-parity.integration.test.ts`; `ForkedExecutor` and
`createChildProcessFeatureExecutor` in `src/conductor/src/engine/child-feature-executor.ts`;
`runExecutorChild` and `withExecutorBrokerProxies` in `src/conductor/src/engine/executor-child.ts`.

## Prerequisites

- #3377, #3480 and #3331 are on the base. If `makeExecutorChildDispatchAdmission` is absent from
  `executor-child-runtime.ts`, the base predates #3480 and BUILD stops.

## Task Dependency Graph

```text
Slice 1
1 ─ 2 ─┐
3 ─ 5 ─┼─ 8 ─┬─ 9, 10, 11, 12            (Story 2 rows)
6 ─────┤     ├─ 13, 14, 15, 16, 17       (Story 3 rows)
7 ─────┘     ├─ 18, 19, 20, 21, 22, 23   (Story 4 rows)
4 ─ 5        └─ 26
5 ─ 24, 25
Slice 2
27 ─ 28 ─┬─ 29
8 ── 28  ├─ 30 ─┐
         ├─ 31 ─┼─ 32
         │      └─ 33 ─ 34
         └─ 35 ─ 36
```

## Integration Points

- After Task 8: the child runs the shared lifecycle, and the in-process executor still runs it too.
- After Task 26: every inventory row is asserted through the child path.
- After Task 32: the child executor is the only feature executor.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D1 | task | task-8, task-28, task-32 | `runExecutorChildFeature` obtains its prepare, triage, conductor and teardown only from `makeFeatureRunnerDeps` and the lifecycle module |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D2 | task | task-28 | whose WorkOrder carries `engineVersionId` `20261107T000000Z-0123456789ab` |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D3 | task | task-29 | A protocol mismatch terminates the first child and relaunches the dispatch through the fork pinned to the supervisor's engine directory |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D4 | task | task-24, task-25, task-21, task-36 | emits `feature_dispatch_started` with `kind` `rekick` and the WorkOrder's `tier` |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D5 | task | task-26, task-28 | the wait is aborted, `closeOpenExecutionsForShutdown` is called, and the outcome is `parked` with the stop reason |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D6 | no-change | none | Executor records and GC protection are written by the child executor path this feature keeps; no task touches them. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D7 | no-change | none | The supervisor restart policy is independent of executor selection; no task changes it. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D8 | no-change | none | The self-host cadence rebuild job is unaffected; no task touches daemon maintenance. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D9 | existing | none | The child emits `executor_started` in `src/conductor/src/engine/executor-child.ts`, now on every dispatch. |
| adr-2026-10-15-per-dispatch-engine-pinned-executor#D10 | no-change | none | Records #2392's single-spec delivery decision; this plan carries its own scope exception. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D1 | task | task-28, task-32 | passes an injected `executorFork` through as its `fork` |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D2 | task | task-7 | `createWorkOrder` sets `baseBranch` to the daemon's configured base branch |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D3 | no-change | none | WorkClaims dispatch authority is unchanged. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D4 | existing | none | `resolveDaemonBaseSha` pins the base SHA into each WorkOrder at claim time; Task 8 keeps the child bound to it. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D5 | no-change | none | Maintenance policies run on the dispatcher side; no task touches them. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D6 | no-change | none | Live-boundary windows are already brokered for child executors; no task changes them. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D7 | no-change | none | `daemon_concurrency` is unchanged. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D8 | task | task-35, task-36 | `daemon-log.test.ts` asserts `formatDaemonConsoleTeeLine` renders a supervisor `console.warn` with no feature slug tag while features are in flight. |

## Tasks

### Task 1: The daemon feature lifecycle moves into one engine module
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Create `src/conductor/src/engine/daemon-feature-lifecycle.ts` and move into it, verbatim, the items listed in Technical Approach. `runConductorInWorktree` and `runSetupTriage` in `daemon-cli.ts` become one-line delegates passing a `DaemonFeatureLifecycleContext` built from the daemon's own services. `index.ts` and `daemon-cli.ts` import the moved helpers from the engine module; nothing is re-exported from `daemon-cli.ts`.
2. Import `ConductorEventEmitter` from `engine/conductor-event-emitter.ts` in the new module.
3. Retarget test imports of the moved helpers (search, per Technical Approach), changing no assertion.
4. Run `npm run typecheck`, `npm run typecheck:test`, the layer ratchet and the daemon test files that import the moved helpers; commit.

**Done when:**
- [test] The existing in-process daemon tests pass with unchanged behavioral assertions after the move.
- [test] `test/structural/layer-ratchet.ts` passes with no allowlist entry added for `engine/daemon-feature-lifecycle.ts`.
- `daemon-cli.ts` holds no body for `runConductorInWorktree` or `runSetupTriage` other than a call into `engine/daemon-feature-lifecycle.ts`.

**Files likely touched:**
- src/conductor/src/engine/daemon-feature-lifecycle.ts — new; moved lifecycle and helpers
- src/conductor/src/daemon-cli.ts — delegates and imports
- src/conductor/src/index.ts — helper imports
- src/conductor/test/engine/stack-preflight-wiring.sweepG4.test.ts — import retarget
- src/conductor/test/engine/daemon-cli-skill-name-root.test.ts — import retarget if needed

**Dependencies:** none

### Task 2: Supervisor-local state becomes adapter-owned lifecycle context
**Story:** Story 5
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-feature-lifecycle.test.ts`: calling `runDaemonFeatureConductor` with a stub context and a fixture conductor factory calls `context.registerConductor` with the conductor and its returned unregister after the run; passes `context.registerAbortController` to the conductor; reads `context.isShutdownRequested()`; calls `context.flushFeatureEvents` before finish publication; uses `context.engineVersionId` for finish publication; and reads the operator-park marker under `context.projectRoot`, not under the worktree path.
2. Verify RED.
3. Replace the moved body's reads of `activeConductors`, `allWaitSignals`, `shutdownRequested`, `featureEventFlushers` and the module engine version with those context members, and add `projectRoot`. The `daemon-cli.ts` delegate supplies the daemon's existing state.
4. Verify GREEN with the in-process daemon tests unchanged; commit.

**Done when:**
- [test] `daemon-feature-lifecycle.test.ts` shows the conductor registered through `context.registerConductor` and unregistered after the run, and abort controllers registered through `context.registerAbortController`.
- [test] The same suite shows finish publication uses `context.engineVersionId` after `context.flushFeatureEvents` resolves.
- [test] The same suite shows the operator-park marker is read under `context.projectRoot` when the worktree path differs.
- [test] The existing in-process daemon tests pass with unchanged behavioral assertions.

**Files likely touched:**
- src/conductor/src/engine/daemon-feature-lifecycle.ts — context members
- src/conductor/src/daemon-cli.ts — supplies the context
- src/conductor/test/engine/daemon-feature-lifecycle.test.ts — new

**Dependencies:** Task 1

### Task 3: The executor-child runtime is one factory with a process-services mode
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/executor-child-runtime-factory.test.ts`: `createExecutorChildRuntime({ projectRoot, processServices: 'install' })` calls `installDaemonProcessServices` once; with `'inherited'` it calls it never; both return `admitDispatch`, `createWorktree` and `run`. A type case uses `@ts-expect-error` on a call omitting `processServices`.
2. Verify RED.
3. Move the `executor-child` branch's inline composition from `src/conductor/src/index.ts` into the factory; `index.ts` calls it with `'install'`.
4. Verify GREEN, including `npm run typecheck:test`; commit.

**Done when:**
- [test] `executor-child-runtime-factory.test.ts` shows `processServices: 'install'` installs the daemon process services once and `processServices: 'inherited'` installs none.
- The `executor-child` branch of `src/conductor/src/index.ts` obtains `admitDispatch`, `createWorktree` and `run` only from `createExecutorChildRuntime` with `processServices: 'install'`.

**Files likely touched:**
- src/conductor/src/engine/executor-child-runtime.ts — factory
- src/conductor/src/index.ts — calls the factory
- src/conductor/test/engine/executor-child-runtime-factory.test.ts — new

**Dependencies:** none

### Task 4: runDaemonMode takes an engine-root option, and tests get a valid temp engine store
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/daemon-engine-root-option.test.ts`: with `useTempEngineStore()` creating `dist` → `dist-versions/20261107T000000Z-0123456789ab`, `runDaemonMode({ engineRoot })` pointing at it, and `createChildProcessFeatureExecutor` mocked to record its executions, a dispatched feature's WorkOrder carries `engineVersionId` `20261107T000000Z-0123456789ab`. A second case shows `useTempEngineStore()` restores `ENGINE_STORE_ENV_VAR` on teardown.
2. Verify RED.
3. Add the optional `engineRoot` option to `DaemonModeOptions`, defaulting to the module-derived conductor root and engine directory, and pass it to `resolveEnginePin`. Add `useTempEngineStore()` to the fixture module.
4. Verify GREEN; commit.

**Done when:**
- [test] `daemon-engine-root-option.test.ts` shows a dispatch under `runDaemonMode({ engineRoot })` carries `engineVersionId` `20261107T000000Z-0123456789ab` from the temp store.
- [test] `useTempEngineStore()` restores `ENGINE_STORE_ENV_VAR` to its prior value on teardown.
- With no `engineRoot`, `runDaemonMode` resolves the pin from the module-derived root, as before.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — `engineRoot` option
- src/conductor/test/fixtures/in-memory-executor-fork.ts — `useTempEngineStore`
- src/conductor/test/engine/daemon-engine-root-option.test.ts — new

**Dependencies:** none

### Task 5: The in-memory fork runs the production child runtime
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/fixtures/in-memory-executor-fork.test.ts`. (a) `createChildProcessFeatureExecutor` with `fork: createInMemoryExecutorFork({ projectRoot })` and a real `createExecutorBroker` executes one order with a fixture conductor; the broker receives the hello, the production runtime's `run` receives the order, and `execute` returns the child's outcome. (b) Two children run concurrently, each writing a `console.warn` naming its slug; each line is captured only in its own child's sink, and the bot co-author resolver installed before both is still installed after. (c) `handshake: 'silent'` delivers no hello and `execute` returns `error` with reason `executor missing startup handshake`. (d) The child reports the engine id of the forked module path.
2. Verify RED.
3. Build the fixture as described in Technical Approach. Pattern: in-memory child fork.
4. Verify GREEN; commit.

**Done when:**
- [test] `in-memory-executor-fork.test.ts` shows the broker receiving the child's hello, the production `createExecutorChildRuntime` running the order, and `execute` returning the child's outcome.
- [test] Two concurrent in-memory children each capture only their own `console.warn`, and the bot co-author resolver installed before both is the one installed after both finish.
- [test] A `handshake: 'silent'` child delivers no hello, and `execute` returns `error` with reason `executor missing startup handshake`.
- [test] The in-memory child reports as its engine the version id of the forked module path.

**Files likely touched:**
- src/conductor/test/fixtures/in-memory-executor-fork.ts — fork fixture
- src/conductor/test/fixtures/in-memory-executor-fork.test.ts — new

**Dependencies:** Task 3, Task 4

### Task 6: makeRunFeature takes an explicit dispatch admission mode
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-runner-dispatch-admission.test.ts`: for a slug with durable child state, `makeRunFeature({ …, dispatchAdmission: 'acquire' })` acquires the lease and parks with `feature-lease-held` when another live holder owns it; `dispatchAdmission: 'admitted'`, run while the test itself holds the lease, runs the conductor and never calls `acquireFeatureDispatchLease`. A type case shows omitting the member fails `npm run typecheck:test`.
2. Verify RED.
3. Add the required member to `FeatureRunnerDeps`; `makeFeatureRunnerDeps` supplies `'acquire'`; in `'admitted'` mode skip acquisition and the parked-after-lease check.
4. Verify GREEN; commit.

**Done when:**
- [test] `daemon-runner-dispatch-admission.test.ts` shows `dispatchAdmission: 'admitted'` runs the conductor for a durable-child slug whose lease the caller holds, without calling `acquireFeatureDispatchLease`.
- [test] The same suite shows `dispatchAdmission: 'acquire'` still parks with `feature-lease-held` when another live holder owns the lease.

**Files likely touched:**
- src/conductor/src/engine/daemon-runner.ts — admission mode
- src/conductor/src/engine/daemon-deps.ts — supplies `'acquire'`
- src/conductor/test/engine/daemon-runner-dispatch-admission.test.ts — new

**Dependencies:** none

### Task 7: The WorkOrder carries the supervisor's base branch
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/work-order.test.ts`: `buildWorkOrder` with `baseBranch: 'trunk'` round-trips `baseBranch` through JSON; an order without it stays valid. In `executor-child-runtime` tests, a child given an order with `baseBranch: 'trunk'` resolves `trunk`, and one without falls back to `originDefaultBranch`.
2. Verify RED.
3. Add optional `baseBranch` to `WorkOrder` and `BuildWorkOrderInput`, leave `WORK_ORDER_SCHEMA_VERSION` at 1, set it in `createWorkOrder` from the daemon's configured base branch, and make the child prefer it.
4. Verify GREEN; commit.

**Done when:**
- [test] `createWorkOrder` sets `baseBranch` to the daemon's configured base branch, and the field round-trips through JSON with `WORK_ORDER_SCHEMA_VERSION` still 1.
- [test] A child given an order without `baseBranch` uses `originDefaultBranch`, as before this change.

**Files likely touched:**
- src/conductor/src/engine/work-order.ts — optional field
- src/conductor/src/daemon-cli.ts — `createWorkOrder` sets it
- src/conductor/src/engine/executor-child-runtime.ts — prefers it
- src/conductor/test/engine/work-order.test.ts — cases

**Dependencies:** none

### Task 8: The child builds its lifecycle from makeFeatureRunnerDeps and the shared module
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Create `src/conductor/test/engine/executor-child-lifecycle.integration.test.ts` with failing cases through the in-memory fork. (a) A stacked slug with durable child state and no other holder: the dispatch acquires the lease once, runs the conductor, and does not return `parked` with `feature-lease-held`. (b) The order is built with base `B1`; the test advances the configured base to `B2` before setup; worktree setup and forced setup triage both receive `B1`.
2. Verify RED.
3. In `runExecutorChildFeature`, replace the hand-built prepare, triage, conductor and teardown closures with `makeFeatureRunnerDeps` plus the lifecycle module, keeping only the overrides in Technical Approach. Supply the child's context: `waitControllers`, `signal.aborted`, `sessionTail.flush`, the order's pinned id and the child's `projectRoot`. Pattern: in-memory child fork.
4. Verify GREEN; commit.

**Done when:**
- [test] A stacked dispatch through the child acquires the feature dispatch lease once, runs the conductor, and does not return `parked` with reason `feature-lease-held`.
- [test] With the order built at base `B1` and the configured base advanced to `B2` before setup, the child's worktree setup and forced setup triage both use `B1`.
- `runExecutorChildFeature` obtains its prepare, triage, conductor and teardown only from `makeFeatureRunnerDeps` and the lifecycle module.

**Files likely touched:**
- src/conductor/src/engine/executor-child-runtime.ts — shared lifecycle composition
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — new

**Dependencies:** Task 2, Task 5, Task 6, Task 7

### Task 9: A parked REKICK feature stays parked in the child (row 1)
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Add a case to `executor-child-lifecycle.integration.test.ts`: a worktree with `.pipeline/REKICK`, operator-parked after claim; the child dispatch returns `parked`, the fixture conductor's `run` is never called, and `.pipeline/REKICK` still exists. Pattern: in-memory child fork.
2. Run; fix the composition if it fails; commit.

**Done when:**
- [test] An operator-parked REKICK feature dispatched through the child returns `parked`, the conductor never runs, and `.pipeline/REKICK` is still present.
- [test] The same feature, unparked, dispatches through the child and runs the conductor, so the park marker alone caused the skip.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 1

**Dependencies:** Task 8

### Task 10: The child runs the stacked-state preflight (row 2)
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Add cases: a stacked REKICK feature runs `runDaemonRekickStackPreflight` before `resumeRebaseFirst`; when the preflight refuses, the dispatch halts with the preflight's detail, never `loop ended without DONE or HALT marker`, and `resumeRebaseFirst` is never called. Stub at the git runner. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A stacked REKICK dispatch through the child runs the stack preflight before `resumeRebaseFirst`.
- [test] A refused stack preflight halts the child dispatch with the preflight's detail, never `loop ended without DONE or HALT marker`, and `resumeRebaseFirst` is never called.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 2

**Dependencies:** Task 8

### Task 11: The child resumes a REKICK feature rebase-first (row 3)
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Add a case: a worktree with `.pipeline/REKICK` dispatched through the child calls `resumeRebaseFirst` before the conductor's first step and consumes `.pipeline/REKICK`. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A REKICK dispatch through the child calls `resumeRebaseFirst` before the conductor's first step, and `.pipeline/REKICK` no longer exists afterwards.
- [test] A dispatch of the same worktree without `.pipeline/REKICK` never calls `resumeRebaseFirst`.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 3

**Dependencies:** Task 8

### Task 12: The child targets the configured base branch (row 17)
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Add cases: with the daemon's base branch `trunk` in the order, a REKICK child dispatch rebases onto `trunk` and finish publication targets `trunk`; with no `baseBranch` in the order, the child uses the origin default. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A REKICK child dispatch whose order carries `baseBranch` `trunk` rebases onto `trunk`, and its finish publication targets `trunk`.
- [test] A child dispatch whose order has no `baseBranch` uses the origin default branch.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 17

**Dependencies:** Task 8

### Task 13: The child links the source issue on the implementation PR (row 4)
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add cases with the `gh` runner stubbed: an order with `sourceRef` `jstoup111/ai-conductor#42` whose run records an implementation PR leads to a PR body edit carrying `Closes jstoup111/ai-conductor#42`; an order with no `sourceRef` leads to no `Closes` edit. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A child dispatch with `sourceRef` `jstoup111/ai-conductor#42` edits the implementation PR body to carry `Closes jstoup111/ai-conductor#42`.
- [test] A child dispatch with no `sourceRef` makes no `Closes` edit.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 4

**Dependencies:** Task 8

### Task 14: The child writes the gate audit trail (row 5)
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add a case: the fixture conductor emits a satisfied and an unsatisfied `gate_verdict`; after the run the feature's audit trail holds one `gate_pass` and one `gate_fail` record. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A child dispatch emitting a satisfied and an unsatisfied `gate_verdict` leaves a `gate_pass` and a `gate_fail` record in the feature's audit trail.
- [test] The audit records are written under the feature worktree's `.pipeline`, not under the supervisor's root checkout.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 5

**Dependencies:** Task 8

### Task 15: The child prepares the feature's memory (row 12)
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Add a case: a child dispatch's worktree preparation runs the `.memory` setup and records a `memory_setup` event on the feature bus. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A child dispatch runs the `.memory` setup during worktree preparation and records a `memory_setup` event on the feature bus.
- [test] The `memory_setup` event is forwarded to the supervisor on the feature scope, so it lands in the feature's `.pipeline/events.jsonl`.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 12

**Dependencies:** Task 8

### Task 16: The child escalates a false ship and surfaces quarantine (row 13)
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Add cases: a run that converges DONE but fails the ship-eligibility guard calls `escalateBuildFailure` and ends `halted`; a setup triage returning `quarantined-pass` calls `surfaceQuarantineRef` before the conductor runs. Stub at the `gh` and git runners. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A child dispatch that converges DONE but fails the ship-eligibility guard calls `escalateBuildFailure` and ends `halted`.
- [test] A child dispatch whose setup triage returns `quarantined-pass` surfaces the quarantine evidence before the conductor runs.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 13

**Dependencies:** Task 8

### Task 17: The child logs park-marker read errors and passes diagnosticLog (row 16)
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Add cases: an unreadable operator-park marker writes the read error to the feature log and the dispatch continues; the child's provider execution context carries `diagnosticLog`. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A child dispatch whose operator-park marker cannot be read writes the read error to the feature log and continues to the conductor.
- [test] The child's provider execution context carries a `diagnosticLog` that writes to the feature log.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 16

**Dependencies:** Task 8

### Task 18: The child uses the worktree skill root, and forced prepare does too (row 6)
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing cases: a self-host child dispatch passes the worktree skill copy as `skillNameRoot` to the StepRunner, setup prepare, forced setup prepare and setup triage. A unit case in `daemon-feature-lifecycle.test.ts` shows `createForcedSetupPrepare` passes the worktree skill root for a self-host feature, never `resolveHarnessRoot()`.
2. Verify RED (forced prepare passes none today).
3. Pass `skillNameRoot` from `createForcedSetupPrepare` in the shared module.
4. Verify GREEN; commit.

**Done when:**
- [test] A self-host child dispatch passes the worktree skill copy as `skillNameRoot` to its StepRunner, setup prepare, forced setup prepare and setup triage.
- [test] `createForcedSetupPrepare` passes the worktree skill root for a self-host feature and never the installed harness root.

**Files likely touched:**
- src/conductor/src/engine/daemon-feature-lifecycle.ts — forced prepare skill root
- src/conductor/test/engine/daemon-feature-lifecycle.test.ts — unit case
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 6

**Dependencies:** Task 8

### Task 19: The child prepares a managed-session context (row 7)
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Add a case: the child's provider execution context carries a managed-session context and an observation preparer produced by `prepareDaemonFeatureManagedSessionContext`, with the repository root distinct from the worktree path. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A child dispatch's provider execution context carries a prepared managed-session context and observation preparer whose repository root is the project root, not the worktree path.
- [test] The managed-session context's worktree root is the feature worktree path.

**Files likely touched:**
- src/conductor/src/engine/executor-child-runtime.ts — provider execution context
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 7

**Dependencies:** Task 8

### Task 20: The child loads merged user and project config (row 8)
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write a failing case: a user config sets `dispatch_start_timeout_seconds` and the project config does not; the child's prepare and teardown receive the user's value. Pattern: in-memory child fork.
2. Verify RED.
3. Make the child load `loadMergedConfig` and the installed harness version.
4. Verify GREEN; commit.

**Done when:**
- [test] With `dispatch_start_timeout_seconds` set only in user config, a child dispatch's prepare and teardown use the user's value.
- [test] With the same key set in both user and project config, the child uses the project value.

**Files likely touched:**
- src/conductor/src/engine/executor-child-runtime.ts — merged config
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 8

**Dependencies:** Task 8

### Task 21: A provider suppressed in the child reaches the root bus (row 9)
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write a failing case: a provider suppressed during a child dispatch produces exactly one `provider_suppressed` event on the supervisor's root bus. Pattern: in-memory child fork.
2. Verify RED.
3. Add `onProviderSuppressed` to the child's provider execution context, emitting on the child bus.
4. Verify GREEN; commit.

**Done when:**
- [test] A provider suppressed during a child dispatch produces exactly one `provider_suppressed` event on the supervisor's root bus.
- [test] The forwarded `provider_suppressed` event carries the suppressed provider's id and is not duplicated on the feature scope.

**Files likely touched:**
- src/conductor/src/engine/executor-child-runtime.ts — `onProviderSuppressed`
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 9

**Dependencies:** Task 8

### Task 22: The child passes setup and teardown timeouts and verbosity (row 10)
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Add a case: with `daemon_verbose: true` and configured `dispatch_start_timeout_seconds` and `teardown_timeout_seconds`, the child's prepare, forced prepare and teardown each receive those values. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] With `daemon_verbose: true` and configured setup and teardown timeouts, the child's prepare, forced prepare and teardown each receive the timeouts and the verbose flag.
- [test] With `daemon_verbose` unset, the child's prepare, forced prepare and teardown receive the verbose flag as false.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 10

**Dependencies:** Task 8

### Task 23: The setup-triage kill switch applies in the child (row 11)
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Add a case: with `CONDUCT_SETUP_TRIAGE_KILLSWITCH` set and a failing setup, no setup-triage session is dispatched and triage returns `park` with output `setup-triage disabled by env killswitch`. Restore the variable after. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] With `CONDUCT_SETUP_TRIAGE_KILLSWITCH` set, a failing child setup dispatches no triage session and triage returns `park` with output `setup-triage disabled by env killswitch`.
- [test] With the variable unset, the same failing setup dispatches one setup-triage session.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — row 11

**Dependencies:** Task 8

### Task 24: Supervisor dispatch events carry kind, tier, halt class and step (row 14)
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing cases in `src/conductor/test/engine/child-feature-executor.test.ts` through the in-memory fork: a worktree with `.pipeline/REKICK` gives `feature_dispatch_started` `kind` `rekick` and the order's `tier`; no worktree gives `kind` `initial`; a child halting at `build_review` with halt class `needs-human` gives `feature_dispatch_ended` outcome `halted`, `haltClass` `needs-human` and `step` `build_review`; a `parked` outcome gives `terminated`.
2. Verify RED.
3. Implement the supervisor classification described in Technical Approach.
4. Verify GREEN; commit.

**Done when:**
- [test] A child dispatch of a worktree carrying `.pipeline/REKICK` emits `feature_dispatch_started` with `kind` `rekick` and the WorkOrder's `tier`.
- [test] A child dispatch with no feature worktree emits `feature_dispatch_started` with `kind` `initial`.
- [test] A child halting at `build_review` with halt class `needs-human` emits `feature_dispatch_ended` with outcome `halted`, `haltClass` `needs-human` and `step` `build_review`.
- [test] A `parked` child outcome emits `feature_dispatch_ended` with outcome `terminated`.

**Files likely touched:**
- src/conductor/src/engine/child-feature-executor.ts — dispatch classification
- src/conductor/test/engine/child-feature-executor.test.ts — cases

**Dependencies:** Task 5

### Task 25: The child dispatch's trace context matches in-process (row 15)
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing cases: a resumed feature whose worktree holds `conduct-session-id` `s1` is traced with run id `s1`, `service.version` set to the installed released harness version, `conductor.engine.version` set to the order's pinned `engineVersionId`, and the order's `sourceRef`, and the visualizer's `stop()` resolves before `feature_dispatch_ended` is emitted; an initial dispatch uses a fresh run id.
2. Verify RED.
3. Change `attachFeatureOtelVisualizer` in `executor-broker.ts` to take the visualizer context and return `{ stop(): Promise<void> }`; `daemon-cli.ts`'s `attachChildFeatureOtelVisualizer` builds the context; `createChildProcessFeatureExecutor` awaits `stop()` at collection.
4. Verify GREEN; commit.

**Done when:**
- [test] A resumed child dispatch whose worktree holds `conduct-session-id` `s1` is traced with run id `s1`, `service.version` set to the installed released harness version, `conductor.engine.version` set to the order's pinned `engineVersionId`, and the order's `sourceRef`.
- [test] The visualizer's `stop()` resolves before `feature_dispatch_ended` is emitted.
- [test] An initial child dispatch is traced with a fresh run id.

**Files likely touched:**
- src/conductor/src/engine/executor-broker.ts — attach hook shape
- src/conductor/src/engine/child-feature-executor.ts — awaited stop
- src/conductor/src/daemon-cli.ts — visualizer context
- src/conductor/test/engine/child-feature-executor.test.ts — cases

**Dependencies:** Task 5

### Task 26: The child keeps its shutdown contract on the shared lifecycle
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Add a case to `executor-child-lifecycle.integration.test.ts`: a child dispatch waiting on a rate-limit episode receives a stop; the wait is aborted, `closeOpenExecutionsForShutdown` is called on the registered conductor, and the outcome is `parked` with the stop reason. Pattern: in-memory child fork.
2. Run; fix if needed; commit.

**Done when:**
- [test] A child dispatch stopped while waiting on a rate limit: the wait is aborted, `closeOpenExecutionsForShutdown` is called, and the outcome is `parked` with the stop reason.
- [test] A stop received before the conductor starts returns `parked` with the stop reason and never runs the conductor.

**Files likely touched:**
- src/conductor/test/engine/executor-child-lifecycle.integration.test.ts — shutdown

**Dependencies:** Task 8

### Task 27: The scheduler accepts exactly one feature-execution dependency
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-feature-execution-deps.test.ts`: `@ts-expect-error` on `DaemonDeps` literals supplying both `runFeature` and `featureExecution`, and neither; a runtime case shows `featureExecution` receives the claimed item's WorkOrder and a runner spy is never called.
2. Verify RED (`npm run typecheck:test` reports the unused `@ts-expect-error`).
3. Make feature execution a one-of on `DaemonDeps` in `engine/daemon.ts`; `runDaemonMode` passes exactly one.
4. Verify GREEN; commit.

**Done when:**
- [test] `daemon-feature-execution-deps.test.ts` typechecks only because `DaemonDeps` rejects both-supplied and neither-supplied literals, as its `@ts-expect-error` lines assert.
- [test] With `featureExecution` composed, `runDaemon` passes the claimed item's WorkOrder to `executor.execute`, and no supervisor-side feature runner is invoked.

**Files likely touched:**
- src/conductor/src/engine/daemon.ts — one-of dependency
- src/conductor/src/daemon-cli.ts — passes exactly one
- src/conductor/test/engine/daemon-feature-execution-deps.test.ts — new

**Dependencies:** none

### Task 28: Daemon composition builds only the child executor
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/daemon-child-dispatch.integration.test.ts`. (a) `runDaemonMode` with `useTempEngineStore()` at `20261107T000000Z-0123456789ab` and `executorFork: createInMemoryExecutorFork({ projectRoot })` dispatches one feature: the fork is called once, the WorkOrder and `executor_started` carry that id. (b) The startup log has no line matching `executor isolation` or `per-dispatch engine pinning is disabled`. (c) SIGTERM with two features in flight sends each in-memory child a `stop` and calls the broker's `abortAll` before `runDaemonMode` resolves. (d) In `daemon-cli-executor-wiring.test.ts`, with no `executorFork` and `node:child_process` `fork` mocked, a dispatch calls the mocked `fork` with a module path inside the temp store's version directory. (e) `@ts-expect-error` on `DaemonModeOptions` with `runFeature`.
2. Verify RED.
3. In `runDaemonMode`, delete the in-process executor construction, the `executor_isolation` selection and log line, and the supervisor-side fallback runner; build only the child executor; replace `DaemonModeOptions.runFeature` with `executorFork`.
4. Verify GREEN; commit.

**Done when:**
- [test] `daemon-child-dispatch.integration.test.ts` shows `runDaemonMode` dispatching a claimed feature through exactly one fork call, whose WorkOrder carries `engineVersionId` `20261107T000000Z-0123456789ab` and whose `.pipeline/events.jsonl` records `executor_started` with it.
- [test] The same suite asserts the startup log contains no line naming an executor isolation mode or disabled per-dispatch pinning.
- [test] SIGTERM with two features in flight makes each in-memory child receive a `stop` message and calls the broker's `abortAll` before `runDaemonMode` resolves.
- [test] With no `executorFork` and `node:child_process` `fork` mocked, a dispatch launches the child through the mocked Node `fork` with a module path inside the pinned version directory.
- [test] `daemon-cli-executor-wiring.test.ts` shows `runDaemonMode` passes an injected `executorFork` through as its `fork`, and a `@ts-expect-error` case shows `DaemonModeOptions` rejects a `runFeature` member.

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — single composition; `executorFork`
- src/conductor/test/engine/daemon-cli-executor-wiring.test.ts — default-fork and option cases
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — new

**Dependencies:** Task 8, Task 27

### Task 29: Handshake failures stay inside child executors
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Add cases to `daemon-child-dispatch.integration.test.ts`. (a) A `handshake: 'silent'` child under a short `dispatch_start_timeout_seconds` ends `error` with reason exactly `executor missing startup handshake`, the claim is released, the fork is called once, and no feature step runs in the supervisor. (b) A first child reporting another `protocolVersion` is terminated and the dispatch relaunches through the fork with the supervisor's engine directory. Pattern: in-memory child fork.
2. Run; commit.

**Done when:**
- [test] A child that never sends its hello ends the dispatch `error` with reason `executor missing startup handshake`, releases the claim, forks exactly once, and runs no feature step in the supervisor.
- [test] A protocol mismatch terminates the first child and relaunches the dispatch through the fork pinned to the supervisor's engine directory.

**Files likely touched:**
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — negative cases

**Dependencies:** Task 28

### Task 30: Daemon tests that passed a feature runner use the in-memory fork
**Story:** Story 8
**Type:** refactor

**Steps:**
1. Find every test that passes `runFeature` to `runDaemonMode` (`grep -rlE "runDaemonMode" src/conductor/test | xargs grep -l "runFeature"`). Pass `executorFork: createInMemoryExecutorFork({ projectRoot, run })` instead, moving the old body into the child `run`. Use `useTempEngineStore()`. Pattern: in-memory child fork.
2. Run GREEN with original assertions; commit.

**Done when:**
- No test under `src/conductor/test` passes a `runFeature` member to `runDaemonMode`, as `npm run typecheck:test` enforces through the Task 28 option type.
- [test] Each retargeted test passes with its original assertions while dispatching through `createInMemoryExecutorFork`.

**Files likely touched:**
- src/conductor/test/engine/daemon-cli.test.ts
- src/conductor/test/engine/daemon-restart-wiring.test.ts
- src/conductor/test/acceptance/daemon-lifecycle-controls.test.ts
- src/conductor/test/daemon-otel-wiring.test.ts

**Dependencies:** Task 28

### Task 31: Daemon tests that pinned in-process execution run the child path
**Story:** Story 8
**Type:** refactor

**Steps:**
1. Find every test whose fixture config sets `executor_isolation` (`grep -rl executor_isolation src/conductor/test`). Remove the key and dispatch through `createInMemoryExecutorFork({ projectRoot })` with the production runtime. A test whose subject is the in-process dispatch itself is deleted with it. A test whose assertion does not depend on the executor gets a one-line comment saying why. Pattern: in-memory child fork.
2. Run GREEN with original assertions; commit.

**Done when:**
- No fixture config or config literal under `src/conductor/test` sets `executor_isolation`, except the Task 33 and Task 34 rejection cases.
- [test] Each retargeted test passes with its original assertions while dispatching through `createInMemoryExecutorFork` with the production `createExecutorChildRuntime`, or carries a comment naming why its assertion is executor-independent.

**Files likely touched:**
- src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts
- src/conductor/test/engine/daemon-cli-skill-name-root.test.ts
- src/conductor/test/engine/daemon-mode-feature-log.integration.test.ts
- src/conductor/test/engine/daemon-state-refusal-event.test.ts

**Dependencies:** Task 28

### Task 32: Delete the in-process executor and the supervisor's lifecycle adapter
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Delete `createInProcessFeatureExecutor` and `InProcessFeatureExecutorDeps` from `engine/feature-executor.ts`, and the `daemon-cli.ts` delegates and context that only the in-process path used. Rewrite `executor-parity.integration.test.ts` to assert the child's clean, rate-limited and halted fixture runs against literal expected step sequences, ledger event types and outcomes, with no in-process comparison.
2. Run `npm run typecheck`, `npm run typecheck:test` and the scoped tests; commit.

**Done when:**
- `npm run typecheck` passes with `feature-executor.ts` exporting only the `FeatureExecutor` contract and its outcome and effect types, and no `daemon-cli.ts` caller of `runDaemonFeatureConductor` remaining.
- [test] `executor-parity.integration.test.ts` asserts the child's clean, rate-limited and halted runs against literal expected values and imports only types from `feature-executor.ts`.
- [test] `executor-child-lifecycle.integration.test.ts` passes unchanged after the deletion.

**Files likely touched:**
- src/conductor/src/engine/feature-executor.ts — adapter removed
- src/conductor/src/daemon-cli.ts — in-process lifecycle adapter removed
- src/conductor/test/engine/feature-executor.test.ts — adapter case removed
- src/conductor/test/engine/executor-parity.integration.test.ts — child-only expectations

**Dependencies:** Task 30, Task 31

### Task 33: A config naming executor_isolation fails as an unknown key
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Replace the `executor_isolation` cases in `src/conductor/test/engine/config.test.ts`. With the key absent, `validateConfig` returns ok with no executor-isolation warning, no `executor_isolation` property, and `emitDeprecatedConfigKeyEvents` emits nothing. For each of `in-process`, `child`, `thread`, `''`, `true`, `1`, `null` and `{}`, it returns `ok: false` with exactly `Unknown top-level key: "executor_isolation"`, and emits nothing. Add a case to `daemon-child-dispatch.integration.test.ts`: a project config with `executor_isolation: in-process` makes `runDaemonMode` fail at load and never call the fork.
2. Verify RED.
3. Remove the key from `types/config.ts`, `CONFIG_CONSUMER_KEY_SETS.top` and validation in `engine/config.ts`, with no retired-key entry; remove its consumer-registry row and its block in `templates/project-config.yml.template`.
4. Verify GREEN, including `config-template.test.ts`; commit.

**Done when:**
- [test] `config.test.ts` asserts a config without the key loads with no executor-isolation warning, no `executor_isolation` field, and no `config_deprecated_key` event from `emitDeprecatedConfigKeyEvents`.
- [test] `config.test.ts` asserts `validateConfig` rejects `executor_isolation` set to each of `in-process`, `child`, `thread`, `''`, `true`, `1`, `null` and `{}` with exactly `Unknown top-level key: "executor_isolation"`, and `emitDeprecatedConfigKeyEvents` emits no event for any of them.
- [test] `daemon-child-dispatch.integration.test.ts` shows `runDaemonMode` with `executor_isolation: in-process` in project config fails at load and never invokes the executor fork, so no feature is claimed.

**Files likely touched:**
- src/conductor/src/types/config.ts — key removed
- src/conductor/src/engine/config.ts — key removed
- src/conductor/test/engine/config.test.ts — rejection cases
- src/conductor/test/engine/config-consumer-registry.ts — entry removed
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — load-failure case
- templates/project-config.yml.template — block removed

**Dependencies:** Task 31

### Task 34: A daemon test fixture that still sets the retired key fails at load
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Add a case to `in-memory-executor-fork.test.ts`: a daemon fixture writing `executor_isolation: in-process` into `.ai-conductor/config.yml` and calling `runDaemonMode` with `executorFork` gets `Unknown top-level key: "executor_isolation"`, and the fork is never called; with the key removed the same fixture dispatches through the fork.
2. Run GREEN; commit.

**Done when:**
- [test] A daemon test fixture whose config sets `executor_isolation` fails at config load with `Unknown top-level key: "executor_isolation"` and never calls the injected executor fork.
- [test] With the key removed, the same fixture dispatches through the injected executor fork, so the load failure is caused by the key alone.

**Files likely touched:**
- src/conductor/test/fixtures/in-memory-executor-fork.test.ts — stale-fixture case

**Dependencies:** Task 33

### Task 35: Supervisor log lines stay unattributed without the ownership context
**Story:** Story 9
**Type:** refactor

**Steps:**
1. In `src/conductor/test/engine/daemon-log.test.ts`, replace the `withDaemonLogFeatureOwnership` cases: `formatDaemonConsoleTeeLine('warn', m)` renders the unprefixed supervisor form with and without an unrelated promise chain in flight; `createOwnershipAwareDaemonLogger(log)` forwards every line unchanged.
2. Delete `withDaemonLogFeatureOwnership` and its store from `engine/daemon-log.ts`, reduce the two helpers to their unowned branches, and remove the import from `daemon-cli.ts`.
3. Verify GREEN; commit.

**Done when:**
- [test] `daemon-log.test.ts` asserts `formatDaemonConsoleTeeLine` renders a supervisor `console.warn` with no feature slug tag while features are in flight.
- [test] `daemon-log.test.ts` asserts `createOwnershipAwareDaemonLogger` renders a daemon-wide event through the plain daemon logger with no feature slug tag.

**Files likely touched:**
- src/conductor/src/engine/daemon-log.ts — ownership context removed
- src/conductor/src/daemon-cli.ts — import removed
- src/conductor/test/engine/daemon-log.test.ts — cases replaced

**Dependencies:** Task 28

### Task 36: Concurrent child output keeps per-feature attribution in daemon.log
**Story:** Story 9
**Type:** happy-path

**Steps:**
1. Add a case to `daemon-child-dispatch.integration.test.ts` with `daemon_concurrency: 2`: children for `feature-a` and `feature-b` each write a feature log line and a `console.warn` naming their slug while the supervisor writes a `console.warn`. Read `.daemon/daemon.log`. Pattern: in-memory child fork.
2. If forwarding already satisfies it, no source change; otherwise fix `engine/executor-broker.ts`. Commit.

**Done when:**
- [test] Every daemon.log line from `feature-a`'s child carries only `feature-a`'s slug tag, every line from `feature-b`'s child carries only `feature-b`'s, and none of them is unprefixed.
- [test] The supervisor `console.warn` written during the overlap appears in daemon.log with no feature slug tag.

**Files likely touched:**
- src/conductor/test/engine/daemon-child-dispatch.integration.test.ts — attribution case
- src/conductor/src/engine/executor-broker.ts — only if forwarding needs a fix

**Dependencies:** Task 35

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic, and no slice-1 task depends on a slice-2 task
- [ ] Tasks do not invalidate each other's fixtures or assertions
