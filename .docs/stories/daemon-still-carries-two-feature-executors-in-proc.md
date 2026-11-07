**Status:** Accepted

# Stories: The daemon runs every feature in one executor, with one lifecycle

Technical track (no PRD), change class modification. Source: jstoup111/ai-conductor#3333. Governing
decisions: adr-2026-10-15-per-dispatch-engine-pinned-executor D1, D4 and A2 as amended 2026-11-07,
and adr-2026-08-27-daemon-dispatcher-executor-seam D1 and D8 as amended 2026-10-24. Architecture
review: `.docs/decisions/architecture-review-2026-10-24-daemon-still-carries-two-feature-executors-in-proc.md`.
Scope boundary: `.docs/track/daemon-still-carries-two-feature-executors-in-proc.md`.

The architecture review's parity inventory numbers each behavior the in-process runner performs
and the child runtime does not. Stories 2–5 cite those rows by number.

Delivery is two stacked slices:

- Slice 1, parity: Stories 1–5. The child runs the one shared lifecycle, and the in-process
  executor still exists.
- Slice 2, removal: Stories 6–9. The in-process executor and the `executor_isolation` key are
  deleted.

## Story 1: Tests run the production child runtime in memory

**Requirement:** #3333 desired outcome 3; architecture review operator decisions 2 and 5 (Test boundary)

As a harness maintainer, I want a test to dispatch a feature through the real executor-child runtime without forking an OS process, so that every child behavior can be tested.

### Acceptance Criteria

#### Happy Path
- Given a child executor whose fork is the in-memory test fork, when it executes one WorkOrder, then the broker receives the child's hello, the production `createExecutorChildRuntime` runs that order, and the executor returns the child's outcome.
- Given two in-memory children running at once, when each writes a `console.warn`, then each line is captured only by its own child's console sink, and the bot co-author resolver installed before both children is the one still installed after both finish.
- Given `runDaemonMode` with an engine-root option pointing at a temp store whose `dist` resolves to a valid version id, when it dispatches a feature, then the WorkOrder carries that version id and the child reports the same id as its engine.

#### Negative Paths
- Given an in-memory child configured never to send its hello, when it is executed, then no hello reaches the broker and the executor returns `error` with reason `executor missing startup handshake`.
- Given the production `executor-child` entry, when it composes its runtime, then it installs the daemon process services itself, and a runtime composed with `processServices: inherited` installs none.

### Done When
- [ ] A fixture contract test shows the in-memory fork reaching the real `runExecutorChild`, broker and child runtime.
- [ ] A test shows two concurrent in-memory children keep separate console capture and leave the installed bot co-author resolver unchanged.

## Story 2: The child resumes and admits a feature as the in-process runner did

**Requirement:** #3333 architecture review operator decision 5; parity rows 1, 2, 3 and 17

As the operator, I want a resumed or stacked feature to take the same park, preflight, rebase and base-branch path in the child that it took in-process, so that a re-kicked feature is not silently re-run without its rebase.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with durable child state and no other lease holder, when the child dispatches it, then the dispatch acquires the feature dispatch lease once and runs the conductor, and its outcome is not `parked` with reason `feature-lease-held`.
- Given a feature worktree carrying `.pipeline/REKICK`, when the child dispatches it, then the stack preflight runs first, `resumeRebaseFirst` runs before the conductor's first step, and `.pipeline/REKICK` is consumed.
- Given a daemon configured with base branch `trunk`, when the child dispatches a REKICK feature, then the rebase-first resume and the finish publication both target `trunk`.
- Given a WorkOrder created with base `B1`, when the configured base advances to `B2` before setup, then the child's worktree setup and forced setup triage both use `B1`.

#### Negative Paths
- Given a REKICK feature that the operator parked after it was claimed, when the child dispatches it, then the dispatch returns `parked`, the conductor never runs, and `.pipeline/REKICK` is still present.
- Given a stacked feature whose stack preflight refuses, when the child dispatches it, then the dispatch halts with the preflight's detail, never `loop ended without DONE or HALT marker`, and `resumeRebaseFirst` is never called.
- Given a WorkOrder with no `baseBranch` field, when the child dispatches it, then the child uses the origin default branch, as before this change.

### Done When
- [ ] Child-path tests cover parity rows 1, 2, 3 and 17, a successful stacked dispatch, and the pinned setup base.

## Story 3: The child keeps the feature's records

**Requirement:** #3333 architecture review operator decision 5; parity rows 4, 5, 12, 13 and 16

As the operator, I want a feature run in the child to leave the same audit, memory, escalation and issue-link records it left in-process, so that nothing about a shipped or failed feature is lost.

### Acceptance Criteria

#### Happy Path
- Given a child dispatch whose WorkOrder has `sourceRef` `jstoup111/ai-conductor#42` and whose run opens an implementation PR, when the run finishes, then the PR body carries `Closes jstoup111/ai-conductor#42`.
- Given a child dispatch whose run emits a passing and a failing `gate_verdict`, when the run ends, then the feature's audit trail holds a `gate_pass` record and a `gate_fail` record.
- Given a child dispatch, when its worktree is prepared, then the feature's `.memory` setup runs and a `memory_setup` event is recorded on the feature bus.
- Given a child dispatch whose run converges DONE but fails the ship-eligibility guard, when the runner handles it, then `escalateBuildFailure` opens the draft needs-remediation PR and the dispatch ends `halted`.
- Given a child dispatch whose setup triage returns `quarantined-pass`, when the runner continues to the conductor, then the quarantine evidence is surfaced to the worktree before the conductor runs.

#### Negative Paths
- Given a child dispatch whose WorkOrder has no `sourceRef`, when its implementation PR is opened, then no `Closes` line is added.
- Given a child dispatch whose operator-park marker cannot be read, when the conductor checks it, then the read error is written to the feature log and the dispatch continues.

### Done When
- [ ] Child-path tests cover parity rows 4, 5, 12, 13 and 16.

## Story 4: The child honours project config and provider policy

**Requirement:** #3333 architecture review operator decision 5; parity rows 6, 7, 8, 9, 10 and 11

As the operator, I want the child to read the same merged config, skill root, timeouts and provider policy the in-process runner used, so that a setting I configure applies to every dispatch.

### Acceptance Criteria

#### Happy Path
- Given a self-host child dispatch, when its StepRunner, setup prepare, forced setup prepare and setup triage run, then each uses the worktree's skill copy as `skillNameRoot`.
- Given a user config setting `dispatch_start_timeout_seconds` and no project value, when the child dispatches, then the child's prepare and teardown use the user's value.
- Given `daemon_verbose: true` and configured setup and teardown timeouts, when the child prepares, force-prepares and tears down a worktree, then each receives those timeouts and the verbose flag.
- Given a provider suppressed during a child dispatch, when the suppression happens, then one `provider_suppressed` event reaches the supervisor's root bus.
- Given a child dispatch, when its provider execution context is built, then it carries a prepared managed-session context and observation preparer.

#### Negative Paths
- Given `CONDUCT_SETUP_TRIAGE_KILLSWITCH` set, when a child dispatch's setup fails, then no setup-triage session is dispatched and triage returns `park` with output `setup-triage disabled by env killswitch`.
- Given a forced setup prepare in either executor, when it runs for a self-host feature, then it never uses the installed harness root as `skillNameRoot`.

### Done When
- [ ] Child-path tests cover parity rows 6, 7, 8, 9, 10 and 11, including the forced-prepare skill root.

## Story 5: Dispatch telemetry and shutdown match the in-process path

**Requirement:** #3333 architecture review operator decision 5; parity rows 14 and 15; adr-2026-10-15 D4 and D5

As the operator, I want each child dispatch's events, traces and shutdown to say what the in-process path said, so that dashboards and stop behavior do not depend on the executor.

### Acceptance Criteria

#### Happy Path
- Given a feature whose worktree carries `.pipeline/REKICK`, when the supervisor dispatches it to a child, then `feature_dispatch_started` carries `kind` `rekick` and the WorkOrder's `tier`.
- Given a child dispatch that halts at `build_review` with halt class `needs-human`, when the supervisor collects it, then `feature_dispatch_ended` carries outcome `halted`, `haltClass` `needs-human` and `step` `build_review`.
- Given a resumed feature whose worktree holds `conduct-session-id` `s1`, when its child dispatch is traced, then the visualizer run id is `s1`, `service.version` is the installed released harness version, `conductor.engine.version` stays the order's pinned `engineVersionId`, the trace carries the order's `sourceRef`, and the visualizer stop completes before `feature_dispatch_ended`.
- Given a child dispatch waiting on a rate limit, when the supervisor stops it, then the wait is aborted, open executions are closed, and the outcome is `parked` with the stop reason.

#### Negative Paths
- Given a child dispatch whose outcome is `parked`, when the supervisor ends it, then `feature_dispatch_ended` carries outcome `terminated`, never `halted`.
- Given an initial dispatch with no feature worktree, when the supervisor dispatches it, then `feature_dispatch_started` carries `kind` `initial` and the visualizer uses a fresh run id.

### Done When
- [ ] Tests cover parity rows 14 and 15 and the child's shutdown contract through the child path.

## Story 6: Every daemon dispatch runs in a per-dispatch child executor

**Requirement:** #3333 desired outcome 1; architecture review operator decisions 1 and 3

As the operator, I want the daemon to run every dispatched feature one way, in its own engine-pinned child executor, so that per-feature behavior has one implementation.

### Acceptance Criteria

#### Happy Path
- Given a valid project config and an engine store whose current version is `20261107T000000Z-0123456789ab`, when the daemon claims a feature, then it forks exactly one child executor whose WorkOrder carries that `engineVersionId`, and the feature's `.pipeline/events.jsonl` records `executor_started` with it.
- Given the daemon has started, when its startup log is read, then it contains no line naming an executor isolation mode or saying that per-dispatch engine pinning is disabled.
- Given two features in flight under `daemon_concurrency: 2`, when the daemon receives SIGTERM, then each child executor receives a stop request and the broker aborts pending coordination calls before the supervisor exits.

#### Negative Paths
- Given a dispatch whose child never sends its hello within the dispatch-start timeout, when the timeout expires, then the dispatch ends `error` with reason `executor missing startup handshake`, the claim is released, no relaunch is attempted, and no feature step runs inside the supervisor process.
- Given a child that reports a protocol version different from the supervisor's, when the supervisor reads its hello, then it terminates that child and relaunches the dispatch as a child pinned to the supervisor's own engine directory.
- Given the daemon scheduler's dependencies, when they supply both a feature runner and a feature executor, or neither, then they fail to typecheck.

### Done When
- [ ] A daemon composition test shows a claimed feature reaches the child executor with no config input selecting it.
- [ ] The in-process executor adapter no longer exists.

## Story 7: A config that names the retired executor key fails to load

**Requirement:** #3333 desired outcome 2; architecture review operator decision 1

As the operator, I want a config that still names `executor_isolation` rejected like any other unknown key, so that no config value can appear to select an execution path.

### Acceptance Criteria

#### Happy Path
- Given a project config with no `executor_isolation` key, when the config loads, then it loads with no executor-isolation warning, no `config_deprecated_key` event, and no executor-isolation field.

#### Negative Paths
- Given a project config containing `executor_isolation: in-process`, when the daemon starts, then config loading fails with exactly `Unknown top-level key: "executor_isolation"` and the daemon claims no feature.
- Given a project config containing `executor_isolation` with any value, when the config loads, then loading fails with the same error and no `config_deprecated_key` event or retired-key warning is emitted.

### Done When
- [ ] Config validation tests cover the absent key and the rejected values.

## Story 8: Daemon tests run the production child-executor path

**Requirement:** #3333 desired outcome 3; architecture review operator decision 2

As a harness maintainer, I want daemon composition, integration and acceptance tests to dispatch through the production work order, child executor, broker and terminal-effect path, so that a child-only regression fails a test.

### Acceptance Criteria

#### Happy Path
- Given any daemon test that formerly passed a feature runner to the daemon composition or pinned in-process execution, when it runs, then it dispatches through the injected in-memory fork, or the test file states why its assertion does not depend on the executor.
- Given the daemon is composed with no injected fork, when a feature is dispatched, then the child executor launches the child with Node's process fork from the pinned engine directory.

#### Negative Paths
- Given a daemon composition caller that supplies a feature runner function in place of a fork, when the code is typechecked, then it fails because the daemon accepts no such option.
- Given a daemon test whose fixture config still sets `executor_isolation`, when it runs, then it fails at config load with the unknown-key error and the injected fork is never called.

### Done When
- [ ] No daemon test passes a feature runner to the daemon composition or sets `executor_isolation`.

## Story 9: Daemon log attribution is unchanged with one executor

**Requirement:** #3333 desired outcome 1; architecture review operator decision 4 (adr-2026-08-27 D8 as amended)

As the operator, I want `.daemon/daemon.log` to attribute every feature's lines to that feature and leave the supervisor's own lines unprefixed, so that removing the in-supervisor path costs no attribution.

### Acceptance Criteria

#### Happy Path
- Given supervisor code writes a `console.warn` while features are in flight, when the line reaches `.daemon/daemon.log`, then it is rendered with no feature slug tag.
- Given a daemon-wide bus event outside any feature, when the global subscriber renders it, then the line is rendered by the plain daemon logger with no feature slug tag.

#### Negative Paths
- Given features `feature-a` and `feature-b` in flight at once, each writing console output from its child, when `.daemon/daemon.log` is read, then every line from each child carries only its own feature's tag and none of them is unprefixed.

### Done When
- [ ] Daemon-log tests cover supervisor, daemon-wide and concurrent child lines.
