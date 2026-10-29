# Coherence: The daemon runs every feature in one executor (#3333)

**Plan:** .docs/plans/daemon-still-carries-two-feature-executors-in-proc.md
**Stories:** .docs/stories/daemon-still-carries-two-feature-executors-in-proc.md
**Track:** technical, so there are no FR rows. **Tier:** M.
**Source-Ref:** jstoup111/ai-conductor#3333

Outcomes 4 and 5 are delivered outside plan tasks: documentation travels in the BUILD diff under
HARNESS "Docs track features", and the ADR follow-up was closed by this spec's DECIDE amendment.
Both are waived with that evidence.

## Table

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, story-2 | covered | The daemon runs dispatched features one way only, the per-dispatch engine-pinned child process. There is no config value that selects another execution path. |
| outcome | outcome-2 | story-2 | covered | A config that still sets `executor_isolation` gets a clear, actionable result (rejection or a deprecation warning naming the key), not silent acceptance. |
| outcome | outcome-3 | story-3 | covered | Daemon tests that previously forced `in-process` exercise the production child path, or their target is shown to be executor-independent. |
| outcome | outcome-4 |  | gap | Docs and the configuration reference no longer describe an in-process mode or a rollback lever. — outcome-4: delivered by the BUILD diff under HARNESS "Docs track features" and verified at `finish`; documentation is not a story or plan task. Waived in `.docs/coherence-waivers/daemon-still-carries-two-feature-executors-in-proc.md`. |
| outcome | outcome-5 |  | gap | The ADR's follow-up action is marked done. — outcome-5: delivered in DECIDE by this spec's amendment to `adr-2026-10-15-per-dispatch-engine-pinned-executor` (Follow-up Actions item ticked with an amendment note); no build work remains. Waived in `.docs/coherence-waivers/daemon-still-carries-two-feature-executors-in-proc.md`. |
| story | story-1 | task-3, task-4, task-5, task-8, task-14 | covered | Every daemon dispatch runs in a per-dispatch child executor |
| story | story-2 | task-9 | covered | A config that names the retired executor key fails to load |
| story | story-3 | task-1, task-2, task-6, task-7, task-12, task-13 | covered | Daemon tests run the production child-executor path |
| story | story-4 | task-10, task-11 | covered | Daemon log attribution is unchanged with one executor |
| task | task-1 | story-3 | covered | Serves story 3: Executor-child runtime factory and in-memory fork fixture. |
| task | task-2 | story-3 | covered | Serves story 3: Executor parity test checks the child against fixture expectations. |
| task | task-3 | story-1 | covered | Serves story 1: The scheduler accepts exactly one feature-execution dependency. |
| task | task-4 | story-1 | covered | Serves story 1: Daemon composition builds only the child executor. |
| task | task-5 | story-1 | covered | Serves story 1: Handshake failures stay inside child executors. |
| task | task-6 | story-3 | covered | Serves story 3: Daemon tests that passed a feature runner use the in-memory fork. |
| task | task-7 | story-3 | covered | Serves story 3: Daemon tests that pinned in-process execution run the child path. |
| task | task-8 | story-1 | covered | Serves story 1: Delete the in-process executor adapter. |
| task | task-9 | story-2 | covered | Serves story 2: A config naming executor_isolation fails as an unknown key. |
| task | task-10 | story-4 | covered | Serves story 4: Supervisor log lines stay unattributed without the ownership context. |
| task | task-11 | story-4 | covered | Serves story 4: Concurrent child output keeps per-feature attribution in daemon.log. |
| task | task-12 | story-3 | covered | Serves story 3: A test that still sets the retired key fails at load. |
| task | task-13 | story-3 | covered | Serves story 3: A test fork that never sends hello hits the production timeout. |
| task | task-14 | story-1 | covered | Serves story 1: Daemon composition options select nothing and name no executor mode. |
| adr | adr-2026-10-15-per-dispatch-engine-pinned-executor | story-1, story-3, story-4 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage, judged below under §4f. |
| adr | adr-2026-08-27-daemon-dispatcher-executor-seam | story-1, story-4 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage, judged below under §4f. |
| criterion | Story 1 happy: Given a valid project config and a built engine version `v1` current in the engine store, when the daemon starts and claims a feature, then it builds a WorkOrder pinned to `v1`, forks exactly one child executor for that feature, and the feature's `.pipeline/events.jsonl` records `executor_started` with `engineVersionId` `v1`. | 4 | covered | "dispatching a claimed feature through exactly one fork call, whose WorkOrder carries `engineVersionId` `v1`, whose feature worktree `.pipeline/events.jsonl` records `executor_started` with `engineVersionId` `v1`" | diff-local |
| criterion | Story 1 happy: Given the daemon has started, when its startup log is read, then it contains no line naming an executor isolation mode or saying that per-dispatch engine pinning is disabled. | 14 | covered | "The same suite asserts the startup log contains no line naming an executor isolation mode or disabled per-dispatch pinning." | diff-local |
| criterion | Story 1 happy: Given two features in flight under `daemon_concurrency: 2`, when the daemon receives SIGTERM, then each child executor receives a stop request and the broker aborts pending coordination calls before the supervisor exits. | 4 | covered | "SIGTERM with two features in flight makes each of the two in-memory child ports receive a `stop` message and calls the broker's `abortAll` before `runDaemonMode` resolves." | diff-local |
| criterion | Story 1 negative: Given a dispatch whose child never sends its hello within the dispatch-start timeout, when the timeout expires, then the dispatch ends with an `error` outcome whose reason is `executor missing startup handshake`, the claim is released, no relaunch is attempted, and no step of that feature runs inside the supervisor process. | 5 | covered | "A child that never sends its hello ends the dispatch `error` with reason `executor missing startup handshake`, releases the claim, forks exactly once with no relaunch, and never invokes the feature runner." | diff-local |
| criterion | Story 1 negative: Given a child that reports a protocol version different from the supervisor's, when the supervisor reads its hello, then it terminates that child and relaunches the dispatch as a child pinned to the supervisor's own engine directory, never inside the supervisor process. | 5 | covered | "that child completes the feature, and the feature runner is never invoked outside a forked child." | diff-local |
| criterion | Story 1 negative: Given the daemon scheduler is composed with a feature executor, when a feature is dispatched, then the executor runs it and no supervisor-side feature runner is invoked for it. | 3 | covered | "With `featureExecution` composed, `runDaemon` calls `executor.execute` with the claimed item's WorkOrder, and no supervisor-side feature runner is invoked for that feature." | diff-local |
| criterion | Story 2 happy: Given a project `.ai-conductor/config.yml` with no `executor_isolation` key, when the config loads, then it loads with no warning about executor isolation, no `config_deprecated_key` event, and no executor-isolation field in the loaded config. | 9 | covered | "`config.test.ts` asserts a config without the key loads with no executor-isolation warning, no `executor_isolation` field, and no `config_deprecated_key` event from `emitDeprecatedConfigKeyEvents`." | diff-local |
| criterion | Story 2 negative: Given a project config containing `executor_isolation: in-process`, when the config loads, then loading fails with exactly `Unknown top-level key: "executor_isolation"` and the daemon claims no feature. | 9 | covered | "`daemon-child-dispatch.integration.test.ts` shows `runDaemonMode` with that key in project config fails at load and never invokes the executor fork, so no feature is claimed." | diff-local |
| criterion | Story 2 negative: Given a project config containing `executor_isolation: child`, when the config loads, then loading fails with the same `Unknown top-level key: "executor_isolation"` error; no value of the key is accepted. | 9 | covered | "the rejection comes from the unknown-top-level-key check by key name before any value is read, so no value is accepted." | diff-local |
| criterion | Story 2 negative: Given a project config containing `executor_isolation` with any value, when the config loads, then no `config_deprecated_key` event and no retired-key warning is emitted for it. | 9 | covered | "the result carries no warnings and `emitDeprecatedConfigKeyEvents` emits no `config_deprecated_key` event, so no retired-key warning or deprecation event is produced for the key." | diff-local |
| criterion | Story 3 happy: Given a daemon composition test that injects an in-memory fork, when it dispatches a fixture feature, then the dispatch passes through WorkOrder creation, the child executor, a real broker attachment and the real executor-child runtime, and the feature's terminal effects apply only after its claim is released. | 4 | covered | "so the dispatch passes through a real broker attachment and the real executor-child runtime." | diff-local |
| criterion | Story 3 happy: Given any daemon test that formerly pinned in-process execution in its config fixture, when it runs, then it dispatches through the injected fork, or the test file states why its assertion does not depend on the executor and the test passes with the child executor composed. | 7 | covered | "and passes with the child executor composed by `runDaemonMode`." | diff-local |
| criterion | Story 3 happy: Given the daemon is composed with no injected fork, when a feature is dispatched, then the child executor launches the child with Node's process fork from the pinned engine directory. | 4 | covered | "launching the child through the mocked Node `fork` with a module path inside the temp store's `dist-versions/v1` directory." | diff-local |
| criterion | Story 3 negative: Given a daemon test that injects an in-memory fork whose child never sends its hello, when it dispatches a feature, then the test observes the production handshake-timeout handling and an `error` outcome, not a bypass that skips the handshake. | 13, 5 | covered | "With a silent in-memory child, `createChildProcessFeatureExecutor.execute` returns an `error` outcome through its own dispatch-start timeout handling, and the child's `run` is never invoked." | diff-local |
| criterion | Story 3 negative: Given a daemon composition caller that supplies a feature runner function in place of a fork, when the code is typechecked, then it fails because the daemon accepts no such option. | 14 | covered | "A `@ts-expect-error` case shows `DaemonModeOptions` rejects a `runFeature` member." | diff-local |
| criterion | Story 3 negative: Given a daemon test whose fixture config still sets `executor_isolation`, when it runs, then it fails at config load with the unknown-key error rather than silently selecting an execution path. | 12 | covered | "never calls the injected executor fork, so no execution path is silently selected." | diff-local |
| criterion | Story 4 happy: Given a feature running in its child executor, when the child writes a feature log line or a `console.warn`, then `.daemon/daemon.log` shows that line carrying the feature's slug tag. | 11 | covered | "Every daemon.log line from `feature-a`'s child (feature log and forwarded `console.warn`) carries only `feature-a`'s slug tag, every line from `feature-b`'s child carries only `feature-b`'s, and none of them is unprefixed." | diff-local |
| criterion | Story 4 happy: Given supervisor code writes a `console.warn` while features are in flight, when the line reaches `.daemon/daemon.log`, then it is rendered as a supervisor line with no feature slug tag. | 10, 11 | covered | "`daemon-log.test.ts` asserts `formatDaemonConsoleTeeLine` renders a supervisor `console.warn` with no feature slug tag while features are in flight." | diff-local |
| criterion | Story 4 happy: Given a daemon-wide bus event outside any feature, when the global subscriber renders it, then the line is rendered by the plain daemon logger with no feature slug tag. | 10 | covered | "`daemon-log.test.ts` asserts `createOwnershipAwareDaemonLogger` renders a daemon-wide event through the plain daemon logger with no feature slug tag." | diff-local |
| criterion | Story 4 negative: Given two features `feature-a` and `feature-b` in flight at once, each writing console output from its child, when `.daemon/daemon.log` is read, then every line from `feature-a` carries only `feature-a`'s tag, every line from `feature-b` carries only `feature-b`'s tag, and none of them is unprefixed. | 11 | covered | "Every daemon.log line from `feature-a`'s child (feature log and forwarded `console.warn`) carries only `feature-a`'s slug tag, every line from `feature-b`'s child carries only `feature-b`'s, and none of them is unprefixed." | diff-local |
| criterion | Story 4 negative: Given supervisor console output written while `feature-a` is in flight, when it is rendered, then it never carries `feature-a`'s slug tag. | 11 | covered | "The supervisor `console.warn` written during the overlap appears in daemon.log with no feature slug tag, so it is never attributed to `feature-a` or `feature-b`." | diff-local |

## Architecture decision judgement (§4f)

- `adr-2026-10-15-per-dispatch-engine-pinned-executor`:
  - **D1** (amended: child is the only executor) is asserted by Task 14's check that `runDaemonMode` constructs the child executor with no config input selecting it. Task 8 removes the adapter.
  - **D2** (per-dispatch pin) is asserted by Task 4's WorkOrder and `executor_started` carrying `engineVersionId` `v1`.
  - **D3** (mismatch relaunch on the supervisor build) is asserted by Task 5.
  - **D4** (feature log lines forwarded and rendered through `featureLogFor(slug)`) is asserted by Task 11's per-slug attribution of forwarded child output. The brokered coordination services are not changed by this feature.
  - **D5** (stop on SIGTERM) is asserted by Task 4's stop messages to each child and `abortAll`.
  - **D6, D7, D8** concern GC pins, the restart policy, and the cadence rebuild. Nothing in this feature touches them, so `no-change` is correct.
  - **D9** is `existing`: `executor_started` is emitted in `src/conductor/src/engine/executor-child.ts` (verified).
  - **D10** is #2392's delivery decision, so `no-change`.
- `adr-2026-08-27-daemon-dispatcher-executor-seam`:
  - **D1** (amended: v1 adapter removed) is asserted by Task 14's executor-fork passthrough with child-only composition. Task 8 removes the adapter.
  - **D2** is `existing`: `buildWorkOrder` is imported into `daemon-cli.ts`.
  - **D4** is `existing`: `resolveDaemonBaseSha` is imported and used at dispatch in `daemon-cli.ts` (verified).
  - **D3, D5, D6, D7** are unaffected, so `no-change`.
  - **D8** (amended: attribution through child forwarding, supervisor lines unprefixed) is asserted by Task 10's unprefixed supervisor tee and global-subscriber lines, and by Task 11.

## Achievability (§4g)

Every criterion row was checked against its cited `Done when` checks. An independent coverage
judge, run in two rounds during `/plan`, found that every check explicitly asserts its criterion's
Then-clause. No cited check could deliver its criterion only by violating an amended ADR decision.
Story 2's closed rejection message is the existing unknown-top-level-key path in `validateConfig`
(verified in `src/conductor/src/engine/config.ts`), so the required `ok: false` outcome is
representable.
