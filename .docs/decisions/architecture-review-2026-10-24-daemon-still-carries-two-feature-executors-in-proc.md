# Architecture Review: Retire the in-process feature executor (#3333)
**Date:** 2026-10-24
**Mode:** Lightweight (Tier M): Feasibility and Alignment, plus the required Wiring Surface
**Inputs reviewed:** explore output and operator-confirmed scope
(`.docs/track/daemon-still-carries-two-feature-executors-in-proc.md`), the approved diagram
(`.docs/architecture/daemon-still-carries-two-feature-executors-in-proc.md`),
`adr-2026-10-15-per-dispatch-engine-pinned-executor`, `adr-2026-08-27-daemon-dispatcher-executor-seam`
**Verdict:** APPROVED

## Technical intent

The daemon runs every dispatched feature one way: the per-dispatch engine-pinned child executor.
The work proceeds as though the in-process path never existed. Operator decisions, 2026-10-24:

1. Delete the in-process adapter (`createInProcessFeatureExecutor` and
   `InProcessFeatureExecutorDeps` in `engine/feature-executor.ts`), the `executor_isolation`
   selection and its in-process log line in `daemon-cli.ts`, and the key from `types/config.ts`,
   the known top-level key set, and validation in `engine/config.ts`. Add no retired-key entry,
   warning, targeted error, or migration. A config that still sets the key fails with the generic
   `Unknown top-level key: "executor_isolation"`.
2. Replace the daemon-cli `opts.runFeature` composition-test bypass with an optional `fork` option
   that `daemon-cli.ts` passes through to `createChildProcessFeatureExecutor`'s existing `fork`
   dependency. Daemon-cli tests then run the production work order, child executor, broker, and
   terminal-effect path; only OS process creation is replaced.
3. `daemon-cli.ts` stops building the supervisor-side `makeRunFeature(deps)` fallback. `runDaemon`'s
   feature-execution dependency becomes exactly one of `{ runFeature }` (the core's unit-test
   injection, unchanged for `engine/daemon.ts` tests) or `{ featureExecution }`. The production
   composition supplies only the latter.
4. Delete the daemon-log feature-ownership context (`withDaemonLogFeatureOwnership` and its
   `AsyncLocalStorage` store in `engine/daemon-log.ts`). Its only writer was the in-process adapter.
   `formatDaemonConsoleTeeLine` and `createOwnershipAwareDaemonLogger` keep only their unowned
   behavior, which is already the only behavior in child mode.
5. Docs and the configuration reference describe only the child executor. The 10-15 ADR follow-up
   action closes.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. The child executor, broker, `executor-child` runtime, and the `fork` dependency already exist (`engine/child-feature-executor.ts` `ChildFeatureExecutorDeps.fork`; verified). |
| Prerequisites | None. Child is already the default (#3306) and the base-state seed is shared (#3331, merged 2026-10-21; verified). |
| Integration surface | Daemon composition only: `daemon-cli.ts`, `engine/daemon.ts` (dependency type), `engine/feature-executor.ts`, `engine/daemon-log.ts`, config type and validation. The IPC protocol, broker services, engine pinning, executor records, and GC are untouched. |
| Data implications | None persisted. The key never shipped in a release: it is absent from v1.6.0 and `CHANGELOG.md`, and no local branch or registered-project `.ai-conductor/config.yml` sets it (verified 2026-10-24). No migration or release-gate waiver; config is `.ai-conductor/config.yml`, not a `settings.json` schema surface. |
| Performance | Neutral. Tests that switch from the in-process pin to the in-memory fork add a broker and an in-memory IPC hop, not an OS process. |
| Worktree isolation | No new port, process, or shared resource. The in-memory fork runs in the test process. |

**Test feasibility (verified).** `test/engine/executor-parity.integration.test.ts` already drives
`runExecutorChild` through an in-memory `ForkedExecutor` against a real `createExecutorBroker`. That
is the precedent the six pinned test files (`daemon-otel-wiring`, `daemon-otel-parity` acceptance,
`export-failure-visible-without-changing-run` acceptance, `daemon-cli-skill-name-root`,
`daemon-mode-feature-log` integration, `daemon-state-refusal-event`) and the daemon-cli tests that
pass `runFeature` follow. A test whose target does not depend on the executor may keep a fake at the
`fork` seam only after showing that independence. Tests that pin `in-process` only to assert the
in-process branch (the rollback case in `daemon-cli-executor-wiring`, `feature-executor.test.ts`'s
adapter case, the `in-process` acceptance case in `config.test.ts`, and the ownership cases in
`daemon-log.test.ts`) are deleted with their subject. `config-consumer-registry.ts` drops the key.

**Focused local pattern basis: in-memory child fork.**
- *Role:* the test boundary for daemon feature execution.
- *Traits to preserve:* the fake replaces only process creation. It returns a `ForkedExecutor`
  whose IPC port runs the real `runExecutorChild` (hello, WorkOrder receipt, outcome), attached to
  the real broker.
- *Why it applies:* it is the existing proof that child and in-process outcomes match, so it is
  the only boundary that keeps the production broker path under test.
- *Allowed variation:* a shared test fixture may wrap it, and tests may stub the child's feature
  runner inside `runExecutorChild` input.
- *Rediscovery hints:* `test/engine/executor-parity.integration.test.ts`; `ForkedExecutor` and
  `createChildProcessFeatureExecutor` in `src/engine/child-feature-executor.ts`; `runExecutorChild`
  and `withExecutorBrokerProxies` in `src/engine/executor-child.ts`.

## Alignment

- **adr-2026-10-15-per-dispatch-engine-pinned-executor (APPROVED).** Option A and D1–D10 stand.
  Only D1's rollback-lever paragraph, the A2 mitigation clause, the "two executor adapters"
  negative consequence, and the follow-up action change. These are amended in place with additive
  notes. The structural decision (child process per dispatch) is unchanged, so no superseding ADR.
- **adr-2026-08-27-daemon-dispatcher-executor-seam (APPROVED).** D1 (as amended 2026-10-15) still
  names `executor_isolation: in-process` as the v1 rollback adapter; it gets an additive note.
  D8's central-stamping mechanism for the console tee and global subscriber is the ownership
  context deleted here. Under child execution, 10-15 D4 already attributes forwarded log lines
  through `featureLogFor(slug)`. D8's intent (central attribution, no slug threading) is kept; its
  in-supervisor mechanism has no remaining writer. D8 gets an additive note. Superseding is not
  warranted because no structural decision changes.
- **Dependency-type change (`runDaemon`).** A one-of shape removes the state "both runner and
  executor" and the silent fallback (`engine/daemon.ts` falls back to `deps.runFeature` when
  `featureExecution` is absent). It is consistent with the invalid-states-unrepresentable rule, and
  it is not a new pattern.
- **Production DI defaults.** The `fork` option defaults to Node's `child_process.fork` inside
  `createChildProcessFeatureExecutor`. Production never registers the in-memory fork.
- **Diagram accuracy.** The approved diagram reflects the single path and the fork seam. The 10-15
  diagram (`engine-updates-reach-dispatched-features-only-afte.md`) shows no in-process adapter and
  stays accurate.
- **Docs.** `docs/reference/configuration.md` (key table row and `## executor_isolation` section),
  `docs/runbooks/daemon-recovery.md` (the rollback instruction), `docs/guides/running-the-daemon.md`,
  `docs/guides/self-hosting.md`, and `docs/reference/artifacts.md`. The latter three link to
  `configuration.md#executor_isolation`, so their links must be retargeted when the section goes.
  The shipped `templates/project-config.yml.template` comment block for `executor_isolation` is
  removed too.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| Single `FeatureExecutor` (child) in daemon composition | Built unconditionally in `daemon-cli.ts`'s daemon startup and passed as `featureExecution` to its sole `runDaemon` call |
| `runDaemon` one-of feature-execution dependency | `engine/daemon.ts` dispatch reads `featureExecution` when present and `runFeature` otherwise. Production supplies `featureExecution`; `engine/daemon.ts` unit tests supply `runFeature` |
| daemon-cli `fork` option | Passed through to `createChildProcessFeatureExecutor`, which defaults to `child_process.fork` when absent. Production passes nothing; tests inject the in-memory fork |
| `createExecutorChildRuntime({ projectRoot })` in `engine/executor-child-runtime.ts` | Called by the `executor-child` branch of `src/index.ts` for its `createWorktree` and `run`. It moves that branch's existing inline composition, so the test fork reuses the exact production child composition |
| Collapsed `formatDaemonConsoleTeeLine` / `createOwnershipAwareDaemonLogger` | Existing callers in `daemon-cli.ts` (console tee and global bus subscriber), unchanged |

No new config key, event, CLI subcommand, hook, or job. Removed surfaces: the `executor_isolation`
key, `createInProcessFeatureExecutor`, `InProcessFeatureExecutorDeps`, `withDaemonLogFeatureOwnership`,
the daemon-cli `runFeature` option, and the in-process startup log line.

**Early overlap scan (advisory).** `ai-conductor overlap-scan` reported unmerged branches touching
`daemon-cli.ts` (`spec/daemon-log-flooded-with-raw-claude-stream-json-and`,
`origin/spec/self-host-phase6-wiring`) and `engine/config.ts` / `types/config.ts`
(`origin/spec/daemon-self-host-guardrails`). These are spec branches, not in-flight builds of the
same lines; none touches executor selection. Non-blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A retargeted test still tests nothing child-specific because it stubs below the broker | Technical | Medium | Medium | The fake replaces only process creation and runs the real `runExecutorChild` and broker (pattern basis above). Stories require each formerly pinned test to show it exercises that path or is executor-independent |
| The executor parity test compares child against the in-process adapter, which is removed | Technical | High | Medium | Its comparison baseline becomes the fixture's expected step sequence, ledger event types and outcome (amended #2392 Story 16) |
| #3377 (bot trailer) is building now and its accepted Story 2 required in-process dispatches to produce the trailer | Integration | High | Medium | Operator decision 2026-10-24: this spec is blocked by #3377. Its Story 2 in-process criteria are removed in place, and this build deletes #3377's in-process trailer tests along with the mode |
| An operator config or long-lived feature branch sets the removed key | Integration | Low | Low | None found (verified). The generic unknown-key error names the key; this is accepted under the operator's never-existed directive |
| A child-only feature-log attribution gap is exposed once ownership stamping is gone | Technical | Low | Low | Ownership was already never set in child mode, today's default, so behavior does not change. 10-15 D4 forwarding stays the attribution path |
| Docs anchor links to `#executor_isolation` break | Integration | High | Low | Retarget every link when the section is removed. No automated anchor check was found, so the plan's documentation task verifies that a repo-wide search for `executor_isolation` outside `.docs/` returns nothing |

## ADRs Created

None. No new structural decision: the child-process executor and its seam are governed by
adr-2026-10-15 and adr-2026-08-27. Both receive additive amendment notes (10-15 D1, A2,
Consequences, and the Follow-up Actions item; 08-27 D1 and D8).
