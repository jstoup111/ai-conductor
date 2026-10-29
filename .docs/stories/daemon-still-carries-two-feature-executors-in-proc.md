**Status:** Accepted

# Stories: The daemon runs every feature in one executor

Technical track (no PRD), change class deletion. Source: jstoup111/ai-conductor#3333. Governing
decisions: adr-2026-10-15-per-dispatch-engine-pinned-executor D1 and adr-2026-08-27-daemon-dispatcher-executor-seam
D1 and D8, as amended 2026-10-24. Architecture review:
`.docs/decisions/architecture-review-2026-10-24-daemon-still-carries-two-feature-executors-in-proc.md`.
Scope boundary: `.docs/track/daemon-still-carries-two-feature-executors-in-proc.md`.

Child-executor behavior itself (engine pinning, protocol handshake, brokered services, executor
records, shutdown) is specified by `.docs/stories/engine-updates-reach-dispatched-features-only-afte.md`
and is unchanged. These stories cover only that it is the daemon's one execution path, how the
config treats the retired key, how daemon tests reach that path, and log attribution once the
in-supervisor path is gone.

## Story 1: Every daemon dispatch runs in a per-dispatch child executor

**Requirement:** #3333 desired outcome 1; architecture review decisions 1 and 3

As the operator, I want the daemon to run every dispatched feature one way, in its own engine-pinned child executor, so that per-feature setup has one implementation and a child-only regression cannot hide behind another path.

### Acceptance Criteria

#### Happy Path
- Given a valid project config and a built engine version `v1` current in the engine store, when the daemon starts and claims a feature, then it builds a WorkOrder pinned to `v1`, forks exactly one child executor for that feature, and the feature's `.pipeline/events.jsonl` records `executor_started` with `engineVersionId` `v1`.
- Given the daemon has started, when its startup log is read, then it contains no line naming an executor isolation mode or saying that per-dispatch engine pinning is disabled.
- Given two features in flight under `daemon_concurrency: 2`, when the daemon receives SIGTERM, then each child executor receives a stop request and the broker aborts pending coordination calls before the supervisor exits.

#### Negative Paths
- Given a dispatch whose child never sends its hello within the dispatch-start timeout, when the timeout expires, then the dispatch ends with an `error` outcome whose reason is `executor missing startup handshake`, the claim is released, no relaunch is attempted, and no step of that feature runs inside the supervisor process.
- Given a child that reports a protocol version different from the supervisor's, when the supervisor reads its hello, then it terminates that child and relaunches the dispatch as a child pinned to the supervisor's own engine directory, never inside the supervisor process.
- Given the daemon scheduler is composed with a feature executor, when a feature is dispatched, then the executor runs it and no supervisor-side feature runner is invoked for it.

### Done When
- [ ] A daemon composition test shows a claimed feature reaches the child executor with a WorkOrder pinned to the current engine version and no config input selecting the executor.
- [ ] A test shows a dispatch whose child never sends its hello ends `error` with reason `executor missing startup handshake`, forks once, and runs no feature step in the supervisor.
- [ ] A typecheck-backed test shows the scheduler's dependencies accept a feature executor or a feature runner, and reject being given both.

## Story 2: A config that names the retired executor key fails to load

**Requirement:** #3333 desired outcome 2; architecture review decision 1

As the operator, I want a config that still names `executor_isolation` rejected like any other unknown key, so that no config value can appear to select an execution path.

### Acceptance Criteria

#### Happy Path
- Given a project `.ai-conductor/config.yml` with no `executor_isolation` key, when the config loads, then it loads with no warning about executor isolation, no `config_deprecated_key` event, and no executor-isolation field in the loaded config.

#### Negative Paths
- Given a project config containing `executor_isolation: in-process`, when the config loads, then loading fails with exactly `Unknown top-level key: "executor_isolation"` and the daemon claims no feature.
- Given a project config containing `executor_isolation: child`, when the config loads, then loading fails with the same `Unknown top-level key: "executor_isolation"` error; no value of the key is accepted.
- Given a project config containing `executor_isolation` with any value, when the config loads, then no `config_deprecated_key` event and no retired-key warning is emitted for it.

### Done When
- [ ] Config validation tests cover the absent key and the `in-process`, `child`, and invalid-value cases, asserting the exact unknown-key error and the absence of a deprecation event.
- [ ] The config consumer registry used by the config tests has no entry for the key.

## Story 3: Daemon tests run the production child-executor path

**Requirement:** #3333 desired outcome 3; architecture review decision 2

As a harness maintainer, I want daemon composition, integration and acceptance tests to dispatch through the same work order, child executor, broker and terminal-effect path production uses, so that a child-only regression fails a test.

### Acceptance Criteria

#### Happy Path
- Given a daemon composition test that injects an in-memory fork, when it dispatches a fixture feature, then the dispatch passes through WorkOrder creation, the child executor, a real broker attachment and the real executor-child runtime, and the feature's terminal effects apply only after its claim is released.
- Given any daemon test that formerly pinned in-process execution in its config fixture, when it runs, then it dispatches through the injected fork, or the test file states why its assertion does not depend on the executor and the test passes with the child executor composed.
- Given the daemon is composed with no injected fork, when a feature is dispatched, then the child executor launches the child with Node's process fork from the pinned engine directory.

#### Negative Paths
- Given a daemon test that injects an in-memory fork whose child never sends its hello, when it dispatches a feature, then the test observes the production handshake-timeout handling and an `error` outcome, not a bypass that skips the handshake.
- Given a daemon composition caller that supplies a feature runner function in place of a fork, when the code is typechecked, then it fails because the daemon accepts no such option.
- Given a daemon test whose fixture config still sets `executor_isolation`, when it runs, then it fails at config load with the unknown-key error rather than silently selecting an execution path.

### Done When
- [ ] Every daemon test that formerly set `executor_isolation: in-process` or passed a feature runner to the daemon composition runs through the injected fork or carries a stated executor-independence reason.
- [ ] The executor parity test checks the child executor against the fixture's expected step sequence, ledger event types and outcome, for a clean, a rate-limited and a halted run.
- [ ] A test shows the in-memory fork reaches the real executor-child runtime and broker (hello, WorkOrder receipt and outcome are observed).

## Story 4: Daemon log attribution is unchanged with one executor

**Requirement:** #3333 desired outcome 1; architecture review decision 4 (adr-2026-08-27 D8 as amended)

As the operator, I want `.daemon/daemon.log` to attribute every feature's lines to that feature and leave the supervisor's own lines unprefixed, so that removing the in-supervisor path costs no attribution.

### Acceptance Criteria

#### Happy Path
- Given a feature running in its child executor, when the child writes a feature log line or a `console.warn`, then `.daemon/daemon.log` shows that line carrying the feature's slug tag.
- Given supervisor code writes a `console.warn` while features are in flight, when the line reaches `.daemon/daemon.log`, then it is rendered as a supervisor line with no feature slug tag.
- Given a daemon-wide bus event outside any feature, when the global subscriber renders it, then the line is rendered by the plain daemon logger with no feature slug tag.

#### Negative Paths
- Given two features `feature-a` and `feature-b` in flight at once, each writing console output from its child, when `.daemon/daemon.log` is read, then every line from `feature-a` carries only `feature-a`'s tag, every line from `feature-b` carries only `feature-b`'s tag, and none of them is unprefixed.
- Given supervisor console output written while `feature-a` is in flight, when it is rendered, then it never carries `feature-a`'s slug tag.

### Done When
- [ ] A daemon-log test shows supervisor console-tee and global-subscriber lines render unprefixed with features in flight.
- [ ] A test shows forwarded console output from two concurrent child executors renders with each feature's own slug tag.
