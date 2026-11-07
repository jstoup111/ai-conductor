# Architecture Review: One daemon feature lifecycle, run only in the child executor (#3333)
**Date:** 2026-11-07
**Mode:** Full (Tier L)
**Inputs reviewed:** explore output and operator-confirmed scope
(`.docs/track/daemon-still-carries-two-feature-executors-in-proc.md`), the approved diagram
(`.docs/architecture/daemon-still-carries-two-feature-executors-in-proc.md`),
`adr-2026-10-15-per-dispatch-engine-pinned-executor`, `adr-2026-08-27-daemon-dispatcher-executor-seam`,
a line-by-line comparison of the in-process runner (`runConductorInWorktree`, `beginFeatureRun`,
`runSetupTriage` in `src/conductor/src/daemon-cli.ts`, and `makeFeatureRunnerDeps` in
`engine/daemon-deps.ts`) with the child runtime (`engine/executor-child-runtime.ts`), and a
cross-provider source review of the first version of this spec
**Verdict:** APPROVED WITH CONDITIONS

## Technical intent

The daemon runs every dispatched feature one way: the per-dispatch engine-pinned child executor,
and that executor runs the same feature lifecycle the in-process runner runs today. Operator
decisions:

1. *(2026-10-24)* Delete the in-process adapter (`createInProcessFeatureExecutor` and
   `InProcessFeatureExecutorDeps` in `engine/feature-executor.ts`), the `executor_isolation`
   selection and its in-process log line in `daemon-cli.ts`, and the key from `types/config.ts`,
   the known top-level key set, and validation in `engine/config.ts`. Add no retired-key entry,
   warning, targeted error, or migration. A config that still sets the key fails with the generic
   `Unknown top-level key: "executor_isolation"`.
2. *(2026-10-24)* Replace the daemon-cli `opts.runFeature` composition-test bypass with an optional
   `executorFork` option passed through to `createChildProcessFeatureExecutor`'s existing `fork`
   dependency.
3. *(2026-10-24)* `runDaemon`'s feature-execution dependency becomes exactly one of
   `{ runFeature }` (the core's unit-test injection) or `{ featureExecution }`.
4. *(2026-10-24)* Delete the daemon-log feature-ownership context (`withDaemonLogFeatureOwnership`
   and its `AsyncLocalStorage` store in `engine/daemon-log.ts`).
5. *(2026-11-07)* **Parity before removal.** The child runtime skips behavior that only the
   in-process runner performs (inventory below). Move that lifecycle into one engine module and
   make the child run it, then delete the in-process path. Moving the runner is chosen over porting
   each gap separately, so one implementation exists.
6. *(2026-11-07)* **Stacked delivery.** Slice 1 delivers parity, and slice 2 delivers decisions 1–4.

## Parity inventory (verified 2026-11-07)

Each row is behavior the in-process runner performs and the child runtime does not. Line numbers
are on the planning base and are rediscovery hints only.

| # | Behavior | In-process | Child | Production evidence |
|---|---|---|---|---|
| 1 | Operator-park check before REKICK is consumed | `daemon-cli.ts` `runConductorInWorktree` | absent | — |
| 2 | Stacked-state preflight and recovery (`runDaemonRekickStackPreflight`, consume or rearm REKICK, `prepareResume`) | same | absent | — |
| 3 | REKICK rebase-first resume (`resumeRebaseFirst`, merged-PR guard) | same | absent: REKICK is read only to classify the dispatch | `.worktrees/path-policy-still-decides-feature-ownership-by-fol/.pipeline/REKICK`, written 2026-11-03 12:35Z, survived five later child dispatches |
| 4 | Mechanical `Closes «sourceRef»` on the implementation PR (`closeIssueOnImplementationMerge`) | same | absent. Clean PRs get `Closes` only when the `/pr` prose carries it | — |
| 5 | `AuditTrailWriter` on the feature bus | same | absent | the same worktree has 61 `gate_verdict` events and no `gate_pass`/`gate_fail` audit record; an in-process run on 2026-10-11 recorded 30 and 12 |
| 6 | Self-host `skillNameRoot` (worktree copy) for StepRunner, prepare and triage | `skillNameRootFor` | always `resolveHarnessRoot()` | — |
| 7 | Managed-session context and observation preparation | `beginFeatureRun` | absent from `providerExecution` | — |
| 8 | Merged user and project config (`loadMergedConfig`) | daemon startup | `loadConfig` (project only) | — |
| 9 | `onProviderSuppressed` emits `provider_suppressed` | `createProviderExecution` | absent | — |
| 10 | `dispatchStartTimeoutSeconds`, `teardownTimeoutSeconds` and `daemon_verbose` on prepare, forced prepare and teardown | `makeFeatureRunnerDeps`, `createForcedSetupPrepare` | not passed | — |
| 11 | `CONDUCT_SETUP_TRIAGE_KILLSWITCH` | `runSetupTriage` | absent | — |
| 12 | `.memory` setup and `memory_setup` event (`observeMemorySetup`) | `makeFeatureRunnerDeps.prepareWorktree` | absent | — |
| 13 | False-ship escalation PR (`escalateBuildFailure`) and `.pipeline/QUARANTINE` (`surfaceQuarantineRef`) | `makeFeatureRunnerDeps` | not supplied, so skipped | — |
| 14 | `feature_dispatch_started`/`ended` carry `kind`, `tier`, `haltClass` and `step` | `makeRunFeature` | the supervisor emits `kind: 'initial'` only, with no tier, halt class or step; parked maps to `halted` | — |
| 15 | OTel visualizer context: persisted session id, harness version, `sourceRef`, awaited stop and flush | `beginFeatureRun` | `runId: executor-«slug»`, `harnessVersion: 'unknown'`, no `sourceRef`, unawaited stop | — |
| 16 | Feature-logged park-marker read errors and `diagnosticLog` | `runConductorInWorktree` | silent | — |

Intentional differences that stay: the visualizer's pinned `engineVersion` (10-15 D4), the removed
ownership context (decision 4), and per-child provider discovery (the child needs its own
registry). Already covered in the child: rate-limit, availability, live-boundary and worktree-lock
brokering; shutdown and abort; dispatch lease admission (#3480); state seeding (#3331); outcome and
deferred terminal effects.

## Design

**One lifecycle module.** A new `engine/daemon-feature-lifecycle.ts` holds the body of
`runConductorInWorktree`, moved verbatim: state seed, StepRunner, `AuditTrailWriter`, Conductor
construction, operator-park check, stack preflight, `resumeRebaseFirst`, `conductor.run`, and the
`Closes` link. It also holds the setup-triage dispatcher (`runSetupTriage`, including its kill
switch) and its helpers: `runDaemonRekickStackPreflight`, `restackResolverForStepRunner`,
`createForcedSetupPrepare`, `prepareDaemonFeatureManagedSessionContext` and
`createWorkOrderGitRunner`. Supervisor-owned services reach it through one explicit context:
config, base branch, self-host flag, rate-limit episode, provider availability, live-boundary
coordinator, worktree lifecycle, effective concurrency, abort registration, a shutdown predicate,
the owner gh runner, and an optional pinned engine version. In slice 1 both adapters call it:
`daemon-cli.ts` passes its real services, and the child passes the broker proxies.

**The child builds its lifecycle from `makeFeatureRunnerDeps`.** `runExecutorChildFeature` stops
assembling its own prepare, triage, conductor and teardown closures. It calls
`makeFeatureRunnerDeps` with the moved `runSetupTriage` and the shared conductor runner, keeping
only its child-owned overrides (pre-created worktree, child bus as the runner scope, deferred
terminal effects). That closes rows 10–13 by construction. The child loads config with
`loadMergedConfig` and the installed harness version (row 8). Its `ProviderExecutionContext` gains
`onProviderSuppressed`, emitting on the child bus (forwarded with `root` scope, 10-15 D4), the
managed-session context and observation preparer, and `diagnosticLog` (rows 7, 9, 16).

**Dispatch telemetry stays supervisor-owned (10-15 D4).** Before the fork, the supervisor classifies
the dispatch kind with `classifyDispatchKind`, from root-readable state: whether
`.worktrees/«slug»` exists, and whether its `.pipeline/REKICK` exists. It takes the tier from the
WorkOrder. On a halted outcome it takes `haltClass` from `readHaltSidecarClassification` on the
worktree and the halting step from the last `loop_halt` event forwarded on the proxy bus, as
`makeRunFeature` does from its own bus. It maps `parked` to `terminated`. The IPC protocol does not
change. The child's per-dispatch visualizer on the proxy bus uses the worktree's persisted
`conduct-session-id`, the installed harness version, and the order's `sourceRef`. It is stopped
and flushed at collection (rows 14, 15).

**Test boundary.** The in-memory fork replaces only OS process creation, with three required
deviations from the parity test's `FixtureChild`:

- `send` invokes its callback after delivery, so the child's outcome flush resolves.
- Each in-memory child gets its own console sink. One test process cannot hold two
  process-global console tees.
- The child's `moduleDir` is taken from the forked module path, so its reported engine identity
  matches the pin.

`runDaemonMode` gains an optional engine-root option (conductor root and own engine directory),
which defaults to the module-derived values. Tests use it to point the pin at a temp store whose
version ids match `VERSION_ID_PATTERN`. `AI_CONDUCTOR_ENGINE_STORE` alone does not move the
`dist` link that `resolveEnginePin` reads. Tests that run the production child runtime stub the
provider boundary at its adapters (installed-provider discovery and model probes), not the
lifecycle.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Every moved function already runs in the daemon process today (verified). |
| Prerequisites | #3377 shipped in #3406 (verified). The dispatch lease (#3480) and the shared state seed (#3331) are on the base (verified). |
| Integration surface | `daemon-cli.ts`, `index.ts`, the child runtime, `executor-child.ts`, `child-feature-executor.ts`, `daemon-deps.ts`, the new lifecycle module, `feature-executor.ts`, `daemon-log.ts`, config type and validation. The IPC protocol messages and version are unchanged. |
| Data implications | None persisted. `executor_isolation` never shipped in a release and no registered config sets it (verified 2026-10-24). No migration. |
| Performance | Each child already loads the engine. It now also prepares a managed-session context and the audit writer, which the in-process path did per feature. Neutral. |
| Worktree isolation | No new port, process or shared resource. |
| Layering | Verified: `test/structural/layer-ratchet.ts` forbids engine → entry (`daemon-cli.ts`, `index.ts`) and allows engine → execution. Every moved helper lands in `engine/`. The ratchet's allowlist may only shrink, so no new entry is added. |

## Complexity

High: one module moves across a process boundary, and about fifteen test files change. It is
bounded by doing the move as a pure relocation first (both adapters call it), and by giving each
parity row its own test through the child path. The estimate is 29 tasks, below the 30-task ceiling.
The operator chose two stacked slices in one spec rather than two specs.

## Alignment

- **adr-2026-10-15-per-dispatch-engine-pinned-executor (APPROVED).** D1 already requires the child
  to run `runConductorInWorktree`; the child drifted from it. A2's "inventory is complete"
  assumption is falsified by the parity inventory. D4 does not say what the supervisor's dispatch
  events carry. These get additive 2026-11-07 notes, alongside the 2026-10-24 notes for the
  retired lever. The structural decision (a child process per dispatch) stands, so the ADR is not
  superseded.
- **adr-2026-08-27-daemon-dispatcher-executor-seam (APPROVED).** D1 and D8 keep their 2026-10-24
  notes. No further change.
- **Dependency-type change (`runDaemon`).** The one-of shape removes the "both runner and executor"
  state. It is not a new pattern.
- **Production DI defaults.** `executorFork` and the engine-root option default to Node's
  `child_process.fork` and the module-derived root. Production never registers the in-memory fork.
- **Docs.** `docs/reference/configuration.md`, `docs/runbooks/daemon-recovery.md`,
  `docs/guides/running-the-daemon.md`, `docs/guides/self-hosting.md` and `docs/reference/artifacts.md`
  describe only the child executor. Links to `#executor_isolation` are retargeted. The template
  block is removed.

## Domain Integrity

- The lifecycle context is a named type with required members. A missing supervisor service is a
  compile error, not a silent default.
- Dispatch kind stays the existing closed union (`initial | resume | rekick`) from
  `classifyDispatchKind`. The parked → `terminated` mapping uses the existing exhaustive status
  switch.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| `engine/daemon-feature-lifecycle.ts` `runDaemonFeatureConductor` and `runDaemonSetupTriage` | Slice 1: `daemon-cli.ts`'s `runConductorInWorktree`/`runSetupTriage` delegate to them, and the child runtime passes them to `makeFeatureRunnerDeps`. Slice 2: only the child runtime |
| Moved helpers (`createWorkOrderGitRunner`, `prepareDaemonFeatureManagedSessionContext`, `createForcedSetupPrepare`, `runDaemonRekickStackPreflight`, `restackResolverForStepRunner`) | Imported from their engine module by `daemon-cli.ts`, `index.ts` and the lifecycle module. `daemon-cli.ts` re-exports nothing |
| `createExecutorChildRuntime({ projectRoot })` | The `executor-child` branch of `src/index.ts`, for its `admitDispatch`, `createWorktree` and `run` |
| Supervisor dispatch classification and halt-record read | `createChildProcessFeatureExecutor`'s existing `feature_dispatch_started`/`ended` emission |
| Child visualizer context | `daemon-cli.ts`'s `attachChildFeatureOtelVisualizer`, passed to the broker |
| daemon-cli `executorFork` and engine-root options | Passed to `createChildProcessFeatureExecutor` and `createWorkOrder`. Production passes neither |
| Single `FeatureExecutor` (slice 2) | Built unconditionally in `runDaemonMode` and passed as `featureExecution` to `runDaemon` |

No new config key, event type, CLI subcommand, hook or job. Removed in slice 2: the
`executor_isolation` key, `createInProcessFeatureExecutor`, `InProcessFeatureExecutorDeps`,
`withDaemonLogFeatureOwnership`, the daemon-cli `runFeature` option, and the in-process log line.

**Early overlap scan (advisory, 2026-11-07).** Two features are in flight:
`flatten-refused-restack-halt-prescribes-a-recovery` and
`task-dependency-gate-is-a-presence-check-unorderab`. Neither builds executor composition. Any
`daemon-cli.ts` overlap resolves at rebase. Non-blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The relocation changes behavior in the in-process path during slice 1 | Technical | Medium | High | Slice 1's first lifecycle task is a pure move: the existing in-process daemon tests pass unchanged before any child task starts |
| A parity row is fixed in code but untested, so it drifts again | Technical | Medium | High | Each inventory row has a test that dispatches through the child path and asserts the behavior at its adapter |
| The child now runs the REKICK rebase and the `Closes` edit, which are root-checkout git and GitHub mutations | Security | Low | High | Both run against the feature worktree and the feature's guarded mutation context, exactly as in-process. The live-boundary proxy keeps fingerprinting the root checkout |
| A test stubs below the broker and proves nothing child-specific | Technical | Medium | Medium | The fork replaces only process creation; provider stubs sit at adapters, never at the lifecycle |
| Two concurrent in-memory children cross-contaminate console capture | Technical | High | Medium | Per-child console sink in the fixture. The production per-process tee is covered by its own unit test |
| Docs anchor links to `#executor_isolation` break | Integration | High | Low | Retarget every link; a repo-wide search outside `.docs/` must return nothing |

## Conditions

1. Slice 1's relocation task lands as a pure move, with the existing in-process daemon tests
   unchanged and green.
2. Every parity inventory row 1–16 is asserted by a test that dispatches through the production
   child runtime.
3. Test-only typing checks use `npm run typecheck:test`. `npm run typecheck` excludes `test/`.

## ADRs Created

None. The governing decision exists: adr-2026-10-15 D1 already says the child runs the whole
per-feature path. Additive 2026-11-07 notes on 10-15 D1, D4 and A2 record that one engine module
holds that path, how the supervisor fills its dispatch events, and that A2's inventory was
incomplete. These sit beside the 2026-10-24 notes on 10-15 D1, A2, Consequences and Follow-up
Actions, and on 08-27 D1 and D8.
