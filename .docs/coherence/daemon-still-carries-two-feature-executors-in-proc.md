# Coherence: The daemon runs every feature in one executor, with one lifecycle (#3333)

**Plan:** .docs/plans/daemon-still-carries-two-feature-executors-in-proc.md
**Stories:** .docs/stories/daemon-still-carries-two-feature-executors-in-proc.md
**Track:** technical, so there are no FR rows. **Tier:** L.
**Source-Ref:** jstoup111/ai-conductor#3333

Outcomes 4 and 5 are delivered outside plan tasks: documentation travels in the BUILD diff under
HARNESS "Docs track features", and the ADR follow-up was closed by this spec's DECIDE amendment.
Both are waived with that evidence. Stories 2–5 deliver the parity that operator decision 5 of the
architecture review requires before the removal outcomes; they serve no separate intake outcome.

## Table

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-6, story-7 | covered | The daemon runs dispatched features one way only, the per-dispatch engine-pinned child process. There is no config value that selects another execution path. |
| outcome | outcome-2 | story-7 | covered | A config that still sets `executor_isolation` gets a clear, actionable result (rejection or a deprecation warning naming the key), not silent acceptance. |
| outcome | outcome-3 | story-1, story-8 | covered | Daemon tests that previously forced `in-process` exercise the production child path, or their target is shown to be executor-independent. |
| outcome | outcome-4 |  | gap | Docs and the configuration reference no longer describe an in-process mode or a rollback lever. — outcome-4: delivered by the BUILD diff under HARNESS "Docs track features" and verified at `finish`; documentation is not a story or plan task. Waived in `.docs/coherence-waivers/daemon-still-carries-two-feature-executors-in-proc.md`. |
| outcome | outcome-5 |  | gap | The ADR's follow-up action is marked done. — outcome-5: delivered in DECIDE by this spec's amendment to `adr-2026-10-15-per-dispatch-engine-pinned-executor` (Follow-up Actions item ticked with an amendment note); no build work remains. Waived in `.docs/coherence-waivers/daemon-still-carries-two-feature-executors-in-proc.md`. |
| story | story-1 | task-3, task-4, task-5 | covered | Tests run the production child runtime in memory |
| story | story-2 | task-1, task-6, task-7, task-8, task-9, task-10, task-11, task-12 | covered | The child resumes and admits a feature as the in-process runner did |
| story | story-3 | task-13, task-14, task-15, task-16, task-17 | covered | The child keeps the feature's records |
| story | story-4 | task-18, task-19, task-20, task-21, task-22, task-23 | covered | The child honours project config and provider policy |
| story | story-5 | task-2, task-24, task-25, task-26 | covered | Dispatch telemetry and shutdown match the in-process path |
| story | story-6 | task-27, task-28, task-29, task-32 | covered | Every daemon dispatch runs in a per-dispatch child executor |
| story | story-7 | task-33 | covered | A config that names the retired executor key fails to load |
| story | story-8 | task-30, task-31, task-34 | covered | Daemon tests run the production child-executor path |
| story | story-9 | task-35, task-36 | covered | Daemon log attribution is unchanged with one executor |
| task | task-1 | story-2 | covered | Serves story 2: The daemon feature lifecycle moves into one engine module. |
| task | task-2 | story-5 | covered | Serves story 5: Supervisor-local state becomes adapter-owned lifecycle context. |
| task | task-3 | story-1 | covered | Serves story 1: The executor-child runtime is one factory with a process-services mode. |
| task | task-4 | story-1 | covered | Serves story 1: runDaemonMode takes an engine-root option, and tests get a valid temp engine store. |
| task | task-5 | story-1 | covered | Serves story 1: The in-memory fork runs the production child runtime. |
| task | task-6 | story-2 | covered | Serves story 2: makeRunFeature takes an explicit dispatch admission mode. |
| task | task-7 | story-2 | covered | Serves story 2: The WorkOrder carries the supervisor's base branch. |
| task | task-8 | story-2 | covered | Serves story 2: The child builds its lifecycle from makeFeatureRunnerDeps and the shared module. |
| task | task-9 | story-2 | covered | Serves story 2: A parked REKICK feature stays parked in the child (row 1). |
| task | task-10 | story-2 | covered | Serves story 2: The child runs the stacked-state preflight (row 2). |
| task | task-11 | story-2 | covered | Serves story 2: The child resumes a REKICK feature rebase-first (row 3). |
| task | task-12 | story-2 | covered | Serves story 2: The child targets the configured base branch (row 17). |
| task | task-13 | story-3 | covered | Serves story 3: The child links the source issue on the implementation PR (row 4). |
| task | task-14 | story-3 | covered | Serves story 3: The child writes the gate audit trail (row 5). |
| task | task-15 | story-3 | covered | Serves story 3: The child prepares the feature's memory (row 12). |
| task | task-16 | story-3 | covered | Serves story 3: The child escalates a false ship and surfaces quarantine (row 13). |
| task | task-17 | story-3 | covered | Serves story 3: The child logs park-marker read errors and passes diagnosticLog (row 16). |
| task | task-18 | story-4 | covered | Serves story 4: The child uses the worktree skill root, and forced prepare does too (row 6). |
| task | task-19 | story-4 | covered | Serves story 4: The child prepares a managed-session context (row 7). |
| task | task-20 | story-4 | covered | Serves story 4: The child loads merged user and project config (row 8). |
| task | task-21 | story-4 | covered | Serves story 4: A provider suppressed in the child reaches the root bus (row 9). |
| task | task-22 | story-4 | covered | Serves story 4: The child passes setup and teardown timeouts and verbosity (row 10). |
| task | task-23 | story-4 | covered | Serves story 4: The setup-triage kill switch applies in the child (row 11). |
| task | task-24 | story-5 | covered | Serves story 5: Supervisor dispatch events carry kind, tier, halt class and step (row 14). |
| task | task-25 | story-5 | covered | Serves story 5: The child dispatch's trace context matches in-process (row 15). |
| task | task-26 | story-5 | covered | Serves story 5: The child keeps its shutdown contract on the shared lifecycle. |
| task | task-27 | story-6 | covered | Serves story 6: The scheduler accepts exactly one feature-execution dependency. |
| task | task-28 | story-6 | covered | Serves story 6: Daemon composition builds only the child executor. |
| task | task-29 | story-6 | covered | Serves story 6: Handshake failures stay inside child executors. |
| task | task-30 | story-8 | covered | Serves story 8: Daemon tests that passed a feature runner use the in-memory fork. |
| task | task-31 | story-8 | covered | Serves story 8: Daemon tests that pinned in-process execution run the child path. |
| task | task-32 | story-6 | covered | Serves story 6: Delete the in-process executor and the supervisor's lifecycle adapter. |
| task | task-33 | story-7 | covered | Serves story 7: A config naming executor_isolation fails as an unknown key. |
| task | task-34 | story-8 | covered | Serves story 8: A daemon test fixture that still sets the retired key fails at load. |
| task | task-35 | story-9 | covered | Serves story 9: Supervisor log lines stay unattributed without the ownership context. |
| task | task-36 | story-9 | covered | Serves story 9: Concurrent child output keeps per-feature attribution in daemon.log. |
| adr | adr-2026-10-15-per-dispatch-engine-pinned-executor | story-2, story-5, story-6 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage, judged below under §4f. |
| adr | adr-2026-08-27-daemon-dispatcher-executor-seam | story-2, story-6, story-9 | covered | Decision-by-decision plan mapping in the plan's Architecture Obligation Coverage, judged below under §4f. |
| criterion | Story 1 happy: Given a child executor whose fork is the in-memory test fork, when it executes one WorkOrder, then the broker receives the child's hello, the production `createExecutorChildRuntime` runs that order, and the executor returns the child's outcome. | 5 | covered | "the broker receiving the child's hello, the production `createExecutorChildRuntime` running the order, and `execute` returning the child's outcome" | diff-local |
| criterion | Story 1 happy: Given two in-memory children running at once, when each writes a `console.warn`, then each line is captured only by its own child's console sink, and the bot co-author resolver installed before both children is the one still installed after both finish. | 5 | covered | "Two concurrent in-memory children each capture only their own `console.warn`, and the bot co-author resolver installed before both is the one installed after both finish." | diff-local |
| criterion | Story 1 happy: Given `runDaemonMode` with an engine-root option pointing at a temp store whose `dist` resolves to a valid version id, when it dispatches a feature, then the WorkOrder carries that version id and the child reports the same id as its engine. | 4, 5 | covered | "carries `engineVersionId` `20261107T000000Z-0123456789ab` from the temp store" | diff-local |
| criterion | Story 1 negative: Given an in-memory child configured never to send its hello, when it is executed, then no hello reaches the broker and the executor returns `error` with reason `executor missing startup handshake`. | 5 | covered | "A `handshake: 'silent'` child delivers no hello, and `execute` returns `error` with reason `executor missing startup handshake`." | diff-local |
| criterion | Story 1 negative: Given the production `executor-child` entry, when it composes its runtime, then it installs the daemon process services itself, and a runtime composed with `processServices: inherited` installs none. | 3 | covered | "`processServices: 'install'` installs the daemon process services once and `processServices: 'inherited'` installs none" | diff-local |
| criterion | Story 2 happy: Given a stacked feature with durable child state and no other lease holder, when the child dispatches it, then the dispatch acquires the feature dispatch lease once and runs the conductor, and its outcome is not `parked` with reason `feature-lease-held`. | 8 | covered | "acquires the feature dispatch lease once, runs the conductor, and does not return `parked` with reason `feature-lease-held`" | diff-local |
| criterion | Story 2 happy: Given a feature worktree carrying `.pipeline/REKICK`, when the child dispatches it, then the stack preflight runs first, `resumeRebaseFirst` runs before the conductor's first step, and `.pipeline/REKICK` is consumed. | 10, 11 | covered | "calls `resumeRebaseFirst` before the conductor's first step, and `.pipeline/REKICK` no longer exists afterwards" | diff-local |
| criterion | Story 2 happy: Given a daemon configured with base branch `trunk`, when the child dispatches a REKICK feature, then the rebase-first resume and the finish publication both target `trunk`. | 12 | covered | "rebases onto `trunk`, and its finish publication targets `trunk`" | diff-local |
| criterion | Story 2 happy: Given a WorkOrder created with base `B1`, when the configured base advances to `B2` before setup, then the child's worktree setup and forced setup triage both use `B1`. | 8 | covered | "the child's worktree setup and forced setup triage both use `B1`" | diff-local |
| criterion | Story 2 negative: Given a REKICK feature that the operator parked after it was claimed, when the child dispatches it, then the dispatch returns `parked`, the conductor never runs, and `.pipeline/REKICK` is still present. | 9 | covered | "returns `parked`, the conductor never runs, and `.pipeline/REKICK` is still present" | diff-local |
| criterion | Story 2 negative: Given a stacked feature whose stack preflight refuses, when the child dispatches it, then the dispatch halts with the preflight's recovery and `resumeRebaseFirst` is never called. | 10 | covered | "halts the child dispatch with the preflight's recovery, and `resumeRebaseFirst` is never called" | diff-local |
| criterion | Story 2 negative: Given a WorkOrder with no `baseBranch` field, when the child dispatches it, then the child uses the origin default branch, as before this change. | 12 | covered | "A child dispatch whose order has no `baseBranch` uses the origin default branch." | diff-local |
| criterion | Story 3 happy: Given a child dispatch whose WorkOrder has `sourceRef` `jstoup111/ai-conductor#42` and whose run opens an implementation PR, when the run finishes, then the PR body carries `Closes jstoup111/ai-conductor#42`. | 13 | covered | "edits the implementation PR body to carry `Closes jstoup111/ai-conductor#42`" | diff-local |
| criterion | Story 3 happy: Given a child dispatch whose run emits a passing and a failing `gate_verdict`, when the run ends, then the feature's audit trail holds a `gate_pass` record and a `gate_fail` record. | 14 | covered | "leaves a `gate_pass` and a `gate_fail` record in the feature's audit trail" | diff-local |
| criterion | Story 3 happy: Given a child dispatch, when its worktree is prepared, then the feature's `.memory` setup runs and a `memory_setup` event is recorded on the feature bus. | 15 | covered | "runs the `.memory` setup during worktree preparation and records a `memory_setup` event on the feature bus" | diff-local |
| criterion | Story 3 happy: Given a child dispatch whose run converges DONE but fails the ship-eligibility guard, when the runner handles it, then `escalateBuildFailure` opens the draft needs-remediation PR and the dispatch ends `halted`. | 16 | covered | "calls `escalateBuildFailure` and ends `halted`" | diff-local |
| criterion | Story 3 happy: Given a child dispatch whose setup triage returns `quarantined-pass`, when the runner continues to the conductor, then the quarantine evidence is surfaced to the worktree before the conductor runs. | 16 | covered | "surfaces the quarantine evidence before the conductor runs" | diff-local |
| criterion | Story 3 negative: Given a child dispatch whose WorkOrder has no `sourceRef`, when its implementation PR is opened, then no `Closes` line is added. | 13 | covered | "A child dispatch with no `sourceRef` makes no `Closes` edit." | diff-local |
| criterion | Story 3 negative: Given a child dispatch whose operator-park marker cannot be read, when the conductor checks it, then the read error is written to the feature log and the dispatch continues. | 17 | covered | "writes the read error to the feature log and continues to the conductor" | diff-local |
| criterion | Story 4 happy: Given a self-host child dispatch, when its StepRunner, setup prepare, forced setup prepare and setup triage run, then each uses the worktree's skill copy as `skillNameRoot`. | 18 | covered | "passes the worktree skill copy as `skillNameRoot` to its StepRunner, setup prepare, forced setup prepare and setup triage" | diff-local |
| criterion | Story 4 happy: Given a user config setting `dispatch_start_timeout_seconds` and no project value, when the child dispatches, then the child's prepare and teardown use the user's value. | 20 | covered | "With `dispatch_start_timeout_seconds` set only in user config, a child dispatch's prepare and teardown use the user's value." | diff-local |
| criterion | Story 4 happy: Given `daemon_verbose: true` and configured setup and teardown timeouts, when the child prepares, force-prepares and tears down a worktree, then each receives those timeouts and the verbose flag. | 22 | covered | "each receive the timeouts and the verbose flag" | diff-local |
| criterion | Story 4 happy: Given a provider suppressed during a child dispatch, when the suppression happens, then one `provider_suppressed` event reaches the supervisor's root bus. | 21 | covered | "produces exactly one `provider_suppressed` event on the supervisor's root bus" | diff-local |
| criterion | Story 4 happy: Given a child dispatch, when its provider execution context is built, then it carries a prepared managed-session context and observation preparer. | 19 | covered | "carries a prepared managed-session context and observation preparer" | diff-local |
| criterion | Story 4 negative: Given `CONDUCT_SETUP_TRIAGE_KILLSWITCH` set, when a child dispatch's setup fails, then no setup-triage session is dispatched and triage returns `park` with output `setup-triage disabled by env killswitch`. | 23 | covered | "dispatches no triage session and triage returns `park` with output `setup-triage disabled by env killswitch`" | diff-local |
| criterion | Story 4 negative: Given a forced setup prepare in either executor, when it runs for a self-host feature, then it never uses the installed harness root as `skillNameRoot`. | 18 | covered | "passes the worktree skill root for a self-host feature and never the installed harness root" | diff-local |
| criterion | Story 5 happy: Given a feature whose worktree carries `.pipeline/REKICK`, when the supervisor dispatches it to a child, then `feature_dispatch_started` carries `kind` `rekick` and the WorkOrder's `tier`. | 24 | covered | "emits `feature_dispatch_started` with `kind` `rekick` and the WorkOrder's `tier`" | diff-local |
| criterion | Story 5 happy: Given a child dispatch that halts at `build_review` with halt class `needs-human`, when the supervisor collects it, then `feature_dispatch_ended` carries outcome `halted`, `haltClass` `needs-human` and `step` `build_review`. | 24 | covered | "emits `feature_dispatch_ended` with outcome `halted`, `haltClass` `needs-human` and `step` `build_review`" | diff-local |
| criterion | Story 5 happy: Given a resumed feature whose worktree holds `conduct-session-id` `s1`, when its child dispatch is traced, then the visualizer run id is `s1`, the harness version is the installed one, the trace carries the order's `sourceRef`, and the visualizer stop completes before `feature_dispatch_ended`. | 25 | covered | "is traced with run id `s1`, the installed harness version and the order's `sourceRef`" | diff-local |
| criterion | Story 5 happy: Given a child dispatch waiting on a rate limit, when the supervisor stops it, then the wait is aborted, open executions are closed, and the outcome is `parked` with the stop reason. | 26 | covered | "the wait is aborted, `closeOpenExecutionsForShutdown` is called, and the outcome is `parked` with the stop reason" | diff-local |
| criterion | Story 5 negative: Given a child dispatch whose outcome is `parked`, when the supervisor ends it, then `feature_dispatch_ended` carries outcome `terminated`, never `halted`. | 24 | covered | "A `parked` child outcome emits `feature_dispatch_ended` with outcome `terminated`." | diff-local |
| criterion | Story 5 negative: Given an initial dispatch with no feature worktree, when the supervisor dispatches it, then `feature_dispatch_started` carries `kind` `initial` and the visualizer uses a fresh run id. | 24, 25 | covered | "emits `feature_dispatch_started` with `kind` `initial`" | diff-local |
| criterion | Story 6 happy: Given a valid project config and an engine store whose current version is `20261107T000000Z-0123456789ab`, when the daemon claims a feature, then it forks exactly one child executor whose WorkOrder carries that `engineVersionId`, and the feature's `.pipeline/events.jsonl` records `executor_started` with it. | 28 | covered | "dispatching a claimed feature through exactly one fork call, whose WorkOrder carries `engineVersionId` `20261107T000000Z-0123456789ab`" | diff-local |
| criterion | Story 6 happy: Given the daemon has started, when its startup log is read, then it contains no line naming an executor isolation mode or saying that per-dispatch engine pinning is disabled. | 28 | covered | "the startup log contains no line naming an executor isolation mode or disabled per-dispatch pinning" | diff-local |
| criterion | Story 6 happy: Given two features in flight under `daemon_concurrency: 2`, when the daemon receives SIGTERM, then each child executor receives a stop request and the broker aborts pending coordination calls before the supervisor exits. | 28 | covered | "makes each in-memory child receive a `stop` message and calls the broker's `abortAll` before `runDaemonMode` resolves" | diff-local |
| criterion | Story 6 negative: Given a dispatch whose child never sends its hello within the dispatch-start timeout, when the timeout expires, then the dispatch ends `error` with reason `executor missing startup handshake`, the claim is released, no relaunch is attempted, and no feature step runs inside the supervisor process. | 29 | covered | "ends the dispatch `error` with reason `executor missing startup handshake`, releases the claim, forks exactly once, and runs no feature step in the supervisor" | diff-local |
| criterion | Story 6 negative: Given a child that reports a protocol version different from the supervisor's, when the supervisor reads its hello, then it terminates that child and relaunches the dispatch as a child pinned to the supervisor's own engine directory. | 29 | covered | "terminates the first child and relaunches the dispatch through the fork pinned to the supervisor's engine directory" | diff-local |
| criterion | Story 6 negative: Given the daemon scheduler's dependencies, when they supply both a feature runner and a feature executor, or neither, then they fail to typecheck. | 27 | covered | "rejects both-supplied and neither-supplied literals" | diff-local |
| criterion | Story 7 happy: Given a project config with no `executor_isolation` key, when the config loads, then it loads with no executor-isolation warning, no `config_deprecated_key` event, and no executor-isolation field. | 33 | covered | "a config without the key loads with no executor-isolation warning, no `executor_isolation` field, and no `config_deprecated_key` event" | diff-local |
| criterion | Story 7 negative: Given a project config containing `executor_isolation: in-process`, when the daemon starts, then config loading fails with exactly `Unknown top-level key: "executor_isolation"` and the daemon claims no feature. | 33 | covered | "fails at load and never invokes the executor fork, so no feature is claimed" | diff-local |
| criterion | Story 7 negative: Given a project config containing `executor_isolation` with any value, when the config loads, then loading fails with the same error and no `config_deprecated_key` event or retired-key warning is emitted. | 33 | covered | "with exactly `Unknown top-level key: "executor_isolation"`, and `emitDeprecatedConfigKeyEvents` emits no event for any of them" | diff-local |
| criterion | Story 8 happy: Given any daemon test that formerly passed a feature runner to the daemon composition or pinned in-process execution, when it runs, then it dispatches through the injected in-memory fork, or the test file states why its assertion does not depend on the executor. | 30, 31 | covered | "or carries a comment naming why its assertion is executor-independent" | diff-local |
| criterion | Story 8 happy: Given the daemon is composed with no injected fork, when a feature is dispatched, then the child executor launches the child with Node's process fork from the pinned engine directory. | 28 | covered | "launches the child through the mocked Node `fork` with a module path inside the pinned version directory" | diff-local |
| criterion | Story 8 negative: Given a daemon composition caller that supplies a feature runner function in place of a fork, when the code is typechecked, then it fails because the daemon accepts no such option. | 28 | covered | "a `@ts-expect-error` case shows `DaemonModeOptions` rejects a `runFeature` member" | diff-local |
| criterion | Story 8 negative: Given a daemon test whose fixture config still sets `executor_isolation`, when it runs, then it fails at config load with the unknown-key error and the injected fork is never called. | 34 | covered | "fails at config load with `Unknown top-level key: "executor_isolation"` and never calls the injected executor fork" | diff-local |
| criterion | Story 9 happy: Given supervisor code writes a `console.warn` while features are in flight, when the line reaches `.daemon/daemon.log`, then it is rendered with no feature slug tag. | 35 | covered | "renders a supervisor `console.warn` with no feature slug tag while features are in flight" | diff-local |
| criterion | Story 9 happy: Given a daemon-wide bus event outside any feature, when the global subscriber renders it, then the line is rendered by the plain daemon logger with no feature slug tag. | 35 | covered | "renders a daemon-wide event through the plain daemon logger with no feature slug tag" | diff-local |
| criterion | Story 9 negative: Given features `feature-a` and `feature-b` in flight at once, each writing console output from its child, when `.daemon/daemon.log` is read, then every line from each child carries only its own feature's tag and none of them is unprefixed. | 36 | covered | "every line from `feature-b`'s child carries only `feature-b`'s, and none of them is unprefixed" | diff-local |

## Architecture decision judgement (§4f)

- `adr-2026-10-15-per-dispatch-engine-pinned-executor`:
  - **D1** (amended 2026-11-07: the child runs the one lifecycle module) is asserted by Task 8, which makes the child obtain its lifecycle only from `makeFeatureRunnerDeps` and the module, and by Tasks 9–23, which assert each inventory row through the child. Tasks 28 and 32 make the child the only executor.
  - **D2** (per-dispatch pin) is asserted by Task 28's WorkOrder and `executor_started` carrying `20261107T000000Z-0123456789ab`.
  - **D3** (mismatch relaunch on the supervisor build) is asserted by Task 29.
  - **D4** (supervisor-owned dispatch events and forwarding; amended 2026-11-07 for event fields, the visualizer and the WorkOrder `baseBranch`) is asserted by Tasks 24 and 25, by Task 21's root-scoped `provider_suppressed`, by Task 7's additive field and by Task 36's per-slug forwarding.
  - **D5** (stop on SIGTERM) is asserted by Task 26's child shutdown contract and Task 28's stop messages and `abortAll`.
  - **D6, D7, D8, D10** are untouched, so `no-change`. **D9** is `existing`.
- `adr-2026-08-27-daemon-dispatcher-executor-seam`:
  - **D1** (amended: v1 adapter removed) is asserted by Task 28's executor-fork passthrough and Task 32's deletion.
  - **D2** (serializable WorkOrder) is asserted by Task 7: the new field is optional, serializable, and leaves the schema version at 1.
  - **D4** is `existing`; Task 8 keeps the child bound to the claim-time base SHA.
  - **D3, D5, D6, D7** are unaffected, so `no-change`.
  - **D8** (amended: attribution through child forwarding) is asserted by Tasks 35 and 36.

## Achievability (§4g)

Every criterion row was checked against its cited `Done when` checks; each quote is verbatim from a
cited task. No cited check could deliver its criterion only by violating an amended ADR decision.
Parity rows (Stories 2–5) are delivered by the shared lifecycle module that Task 8 wires into the
child, and each criterion's check dispatches through the production child runtime, so a passing
check observes the behavior in the child rather than in a stub. Story 7's closed rejection message
is the existing unknown-top-level-key path in `validateConfig`, so the required `ok: false` outcome
is representable.
