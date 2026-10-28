**Status:** Accepted

# Engine updates reach dispatched features without a full daemon drain (#2392)

Track: technical (no PRD; acceptance criteria live here)
Tier: L

## Context

The daemon runs each feature in its own process today, on the engine version it loaded at boot. A
rebuilt engine reaches dispatches only after a drained supervisor restart. The approved design
(`adr-2026-10-15-per-dispatch-engine-pinned-executor`, D1–D10) changes three things:

- Each claimed feature runs in a child executor process.
- That process is pinned to the immutable `dist-versions` build that `dist` points to at claim time.
- The supervisor brokers the shared services, keeps a single generation, and restarts at a
  natural idle, falling back to an age-capped drain.

The scope boundary is comprehensive: all six #2392 outcomes.

## Story 1: A dispatch after a rebuild runs the new engine without waiting for in-flight work

**Requirement:** #2392 outcome 1; ADR D2

As the operator, I want every newly claimed feature to run on the build `dist` points to at claim time, whenever that build's executor protocol matches the supervisor's, so that engine fixes reach work without draining the pool.

### Acceptance Criteria

#### Happy Path
- Given a daemon in `executor_isolation: child` mode whose supervisor booted on build v1 and `dist` now points to v2, when a feature is claimed, then its executor process runs from `dist-versions/v2` and its WorkOrder records `engineVersionId` v2.
- Given feature A is in flight on v1 and `dist` flips to v2, when feature B is claimed while A is still running, then B is dispatched immediately on v2 with no claim-stop and without waiting for A to finish.
- Given a feature halted on v1 and `dist` now points to v2, when the halt is cleared and the feature is re-dispatched, then the new dispatch runs on v2, not v1.

#### Negative Paths
- Given `dist` is a dangling symlink at claim time, when a feature is claimed, then it is dispatched on the supervisor's own engine build, and an event records the resolution failure with its reason.
- Given a `.publish-incomplete` sentinel is present in the engine store at claim time, when a feature is claimed, then it is dispatched on the supervisor's own engine build rather than the partially published target, and the reason is recorded.
- Given `dist` resolves to a directory whose name does not parse as a version id, when a feature is claimed, then the dispatch falls back to the supervisor's own build, and no WorkOrder is ever written with an unparseable `engineVersionId`.
- Given a first dispatch whose worktree does not exist yet, when the executor is launched, then the supervisor has written nothing under `.worktrees/«slug»`, worktree creation succeeds, and the child persists the WorkOrder to `.pipeline/work-order.json` only after the worktree exists.

### Done When
- [ ] A test proves that claims made before and after a `dist` flip launch executors from the two different `dist-versions` directories while the first executor is still running.
- [ ] The WorkOrder sent to the child after an accepted hello carries `engineVersionId` and `schemaVersion`, and the child persists it to `.pipeline/work-order.json` after worktree creation and verifies it.
- [ ] Each fallback reason (dangling symlink, publish sentinel, unparseable id) has a test asserting the supervisor-build pin and the recorded reason.

## Story 2: An in-flight feature finishes on the engine it started with

**Requirement:** #2392 outcome 2; ADR D2, D6

As the operator, I want a running feature to keep its engine until it finishes, so that its verdicts and evidence come from one engine.

### Acceptance Criteria

#### Happy Path
- Given feature A's executor is running from `dist-versions/v1`, when a rebuild flips `dist` to v2, then A's process keeps executing v1 code to completion, and every step and gate verdict it records is produced by v1.
- Given A is running on v1 and GC runs after `dist` moves to v3, when GC evaluates v1, then v1 is retained because a live executor record references it.

#### Negative Paths
- Given A is running on v1, when the executor record for A cannot be parsed during a GC pass, then the GC pass aborts with zero deletions.
- Given A's executor process has exited and its record was removed, when GC next runs and v1 is outside the keep window, then v1 becomes eligible for deletion.
- Given the supervisor restarts and finds an executor record whose pid is dead, when boot completes, then that stale record is removed and no longer protects its version.

### Done When
- [ ] A test proves that a running executor's module path does not change across a `dist` flip.
- [ ] `readLiveReferencedVersionIds` returns the version ids named in `.daemon/executors/«slug».json` records, and unreadable records abort GC with zero deletions.
- [ ] The boot sweep removes dead-pid executor records, and a test covers it.

## Story 3: The executor protocol is versioned and a mismatch never blocks dispatch

**Requirement:** ADR D3, D7

As the operator, I want a newer executor that the supervisor cannot talk to to be caught before it does any work, so that a protocol change cannot strand or corrupt a feature.

### Acceptance Criteria

#### Happy Path
- Given the supervisor and the pinned executor report the same `EXECUTOR_PROTOCOL_VERSION`, when the child sends its hello, then the supervisor accepts it and the child starts the feature.
- Given a self-host daemon with the stale-engine gates armed and a pinned executor that reports a different protocol version, when the hello arrives, then the supervisor terminates that child before any worktree or step work, relaunches the same dispatch from the supervisor's own build, records the mismatch as an event, and requests a supervisor restart under the drain fallback.

#### Negative Paths
- Given a child that never sends a hello within the dispatch start timeout, when the timeout elapses, then the supervisor kills the child, the dispatch ends with an `error` outcome naming the missing handshake, and the claim is released.
- Given a child whose hello is malformed (missing fields or non-numeric protocol version), when it arrives, then it is treated as a mismatch and the dispatch is relaunched on the supervisor's own build.
- Given a consumer daemon (stale-engine gates not armed) and a protocol mismatch, when the hello arrives, then the dispatch is relaunched on the supervisor's own build, no supervisor restart is requested, and `daemon status` shows the feature on the supervisor's build.
- Given a relaunch on the supervisor's own build also fails its handshake, when that happens, then the dispatch ends `error` with both failures recorded, and no further relaunch loop occurs.

### Done When
- [ ] Hello-handshake acceptance, mismatch relaunch, timeout and malformed-hello cases each have a test that mocks the process boundary.
- [ ] A mismatch emits an event and sets the supervisor's restart reason to protocol mismatch.
- [ ] No feature step runs in a child whose handshake was rejected.

## Story 4: The rate-limit episode and provider suppression stay daemon-wide across processes

**Requirement:** ADR D4

As the operator, I want a rate limit hit in one executor to pause all claims and waits exactly as it does today, so that child processes don't hammer an exhausted provider.

### Acceptance Criteria

#### Happy Path
- Given two executors in flight, when executor A reports a rate-limit with a deadline, then the supervisor's episode becomes active, no new feature is claimed, and executor B's next rate-limit wait blocks until the same episode clears.
- Given an executor suppresses a provider on usage exhaustion, when another executor selects a provider, then it sees that provider as unavailable until the deadline, and a `provider_suppressed` event is persisted to `.daemon/events.jsonl`.

#### Negative Paths
- Given an executor is blocked waiting on an episode, when the supervisor shuts down, then the wait is aborted and the executor takes the shutdown path instead of hanging.
- Given the IPC channel drops while an executor is waiting on an episode, when the disconnect is observed, then the executor stops waiting and exits through the shutdown path.
- Given an executor halts during an active episode, when the dispatcher collects it, then the halt is still recorded as episode-caused and recovered by the existing episode-halt sweep.

### Done When
- [ ] A broker test shows `enter`, `active` and `clear` from a child proxy mutating the supervisor's single `RateLimitEpisode`.
- [ ] A broker test shows suppression from one child is visible to another child's availability lookup.
- [ ] Episode-caused halt accounting works for child-mode outcomes.

## Story 5: Self-host live-boundary windows and root mutations stay serialized across processes

**Requirement:** ADR D4, D8; adr-2026-08-27 D6

As the operator of a self-host daemon, I want executor fingerprint windows and supervisor root mutations never to overlap, so that a busy-pool rebuild cannot halt features as live-checkout drift.

### Acceptance Criteria

#### Happy Path
- Given a child executor holds an open live-boundary window, when the supervisor starts a root mutation (fast-forward, rebuild or relink), then the mutation waits until that window closes.
- Given a root mutation is in progress, when a child requests a new window, then the window opens only after the mutation completes.

#### Negative Paths
- Given a child dies while holding a window, when its IPC channel disconnects, then the supervisor closes that window so later mutations are not blocked forever.
- Given a `dist` flip completes between two of a feature's provider dispatches, when that feature verifies its next window, then no live-boundary drift is reported for the flip.
- Given a non-self-host daemon, when executors run, then no live-boundary messages are exchanged and no window is opened.

### Done When
- [ ] A test with a child proxy proves that mutation-after-window and window-after-mutation ordering hold through the broker.
- [ ] A test proves that child death releases its windows.
- [ ] A test proves that a busy-pool `dist` flip produces no live-boundary halt.

## Story 6: Worktree add and remove stay serialized across executor processes

**Requirement:** ADR D4

As the operator, I want shared-`.git` worktree operations from every executor and from supervisor sweeps to stay serialized, so that concurrent children do not corrupt `.git/worktrees`.

### Acceptance Criteria

#### Happy Path
- Given two children creating worktrees at the same moment, when both request the lifecycle lock, then their `git worktree add` operations run one after the other.
- Given a supervisor sweep is removing a worktree, when a child requests the lifecycle lock, then the child waits until the sweep releases it.

#### Negative Paths
- Given a child dies while holding the lifecycle lock, when its channel disconnects, then the supervisor releases the lock and the next waiter proceeds.
- Given a child's lock request is pending when the supervisor shuts down, when shutdown starts, then the request is rejected and the child takes the shutdown path.

### Done When
- [ ] A broker test proves mutual exclusion between two child proxies and a supervisor-side holder.
- [ ] A test proves that a lock held by a dead child is released.

## Story 7: Feature telemetry reaches the same consumers, with the child as the single ledger writer

**Requirement:** ADR D4; adr-2026-08-27 D8

As the operator, I want daemon.log, OTel and the feature ledger to show a child-mode feature exactly as they show an in-process one, so that observability does not regress.

### Acceptance Criteria

#### Happy Path
- Given a child executor emits feature events, when they are forwarded, then the child alone appends them to `.worktrees/«slug»/.pipeline/events.jsonl`, and the supervisor re-emits them so the per-feature daemon.log renderer prints them with the feature's slug attribution.
- Given a child emits a root-scoped event such as `feature_shipped`, when it is forwarded, then the supervisor emits it on the root bus and it is persisted to `.daemon/events.jsonl`; `feature_dispatch_started` and `feature_dispatch_ended` are emitted by the supervisor itself, once per dispatch, at launch and at collection.
- Given a child writes a feature log line or a `console.warn`, when it is forwarded, then it appears in daemon.log tagged with the feature's slug.

#### Negative Paths
- Given a newer child emits an event variant the supervisor's union does not define, when it is forwarded, then the supervisor accepts it without throwing, neither renders nor persists it, and the child's own ledger still records it.
- Given a child crashes mid-run, when the supervisor inspects that feature's ledger, then every complete line is parseable and no line was written by the supervisor.
- Given an event message whose payload is not valid JSON, when the supervisor receives it, then it logs and drops that one message, and keeps the executor and the rest of the stream running.

### Done When
- [ ] A test proves that the supervisor never writes to a child-mode feature ledger.
- [ ] A test proves that forwarded feature events reach the per-feature renderer with slug attribution.
- [ ] A test proves that an unknown variant is accepted without error and is neither rendered nor persisted by the supervisor.

## Story 8: The executor outcome and terminal effects return to the dispatcher

**Requirement:** ADR D1, D4

As the operator, I want child-mode outcomes to drive claims, parking, watches and processed-marking exactly as in-process outcomes do, so that backlog bookkeeping is unchanged.

### Acceptance Criteria

#### Happy Path
- Given a child finishes with status `done` and terminal effects including `markProcessed` and `enrollWatch`, when the dispatcher collects it, then the claim completes and both effects run supervisor-side.
- Given a child ends `halted` or `parked`, when it is collected, then the claim is parked and a HALT-cleared watcher is registered, exactly as for in-process outcomes.

#### Negative Paths
- Given a child process exits non-zero without sending an outcome, when the supervisor observes the exit, then the dispatch is collected as `error` with the exit code and signal in its reason, and the claim is released into the halted path.
- Given a child sends an outcome and then hangs instead of exiting, when the teardown budget elapses, then the supervisor kills it, and the already-received outcome is the one recorded.
- Given a child sends two outcome messages, when the second arrives, then it is ignored and logged, and the terminal effects run only once.
- Given a child crashes before sending an outcome, when the supervisor collects the dispatch, then exactly one `feature_dispatch_ended` is emitted for it, by the supervisor.

### Done When
- [ ] Child-mode collection reuses the existing `collectOne` handling for every `FeatureExecutionOutcome` status.
- [ ] Exit-without-outcome, hang-after-outcome and duplicate-outcome cases each have a test.

## Story 9: Child executors stop with the supervisor and never orphan

**Requirement:** ADR D5

As the operator, I want stopping or losing the supervisor to stop every child cleanly, so that no orphaned build keeps running or pins an old engine.

### Acceptance Criteria

#### Happy Path
- Given children are running, when the supervisor receives SIGTERM, then every child receives a stop request, aborts its rate-limit waits, and stops at its next shutdown boundary.
- Given the supervisor process dies abruptly, when each child observes its IPC channel disconnect, then the child takes the shutdown path and exits, and the feature resumes from its `.pipeline/` state on a later dispatch.

#### Negative Paths
- Given a child ignores the stop request, when the scaled teardown budget expires, then the supervisor force-kills it before releasing the daemon lock.
- Given a supervisor died and a successor boots while a previous generation's child for slug X is still alive, when boot completes, then the successor terminates that pid (after confirming it is the recorded executor process) and removes its record before slug X can be dispatched again.
- Given an operator parks a feature whose child is running, when the child reaches its next park boundary, then it terminates as `parked` through the existing file-based park check.

### Done When
- [ ] A test proves stop-request fan-out on SIGTERM and force-kill after the budget, with the process boundary mocked.
- [ ] A test proves that a child exits on IPC disconnect.
- [ ] A test proves that operator park terminates a child-mode run as `parked`.

## Story 10: Executor processes keep daemon observability and guards truthful

**Requirement:** ADR D1, D5; continuous-daemon-grows-to-4-2-gb-in-three-hours-a Stories 1 to 5; enable-single-repo-daemon-concurrency-un-clamp-the Story 10

As the operator, I want the supervisor's memory evidence, heap guard, process count and legacy-branch guard to keep their meaning in child mode, so that adding executor processes does not hide daemon growth or weaken an existing safety check.

### Acceptance Criteria

#### Happy Path
- Given a child-mode feature reaches a step boundary, when the daemon memory sample is recorded, then it is still the supervisor's own memory with the supervisor's pid, daemon-origin, carrying the feature slug, exactly as before this change.
- Given three child executors and one supervisor are running, when the single-generation process check counts `daemon --continuous` processes, then it counts exactly one.
- Given a child executor exhausts its inherited V8 heap cap, when it dies, then the dispatch is collected as `error` naming heap exhaustion, the supervisor keeps running, and no supervisor heap snapshot is written for the child's memory.

#### Negative Paths
- Given a child's rss crosses the daemon memory threshold, when the supervisor evaluates its threshold, then no supervisor heap snapshot is written, because only the supervisor's own memory is compared.
- Given a child is launched, when its command line is inspected, then it does not contain `daemon --continuous`, so it can never satisfy the supervisor process pattern.
- Given a child-mode dispatch would take the legacy no-`providerExecution` branch while the supervisor's effective concurrency is greater than 1, when the child evaluates the guard, then it refuses fail-closed exactly as in-process mode does, using the effective concurrency passed by the supervisor.

### Done When
- [ ] A test proves that child-mode memory samples are supervisor-origin with the supervisor pid and unchanged fields.
- [ ] A test proves that a child heap-exhaustion exit becomes an `error` outcome without a supervisor heap snapshot.
- [ ] A test proves that the executor command line does not match the single-generation daemon process pattern.
- [ ] A test proves the legacy-branch refusal at effective concurrency greater than 1 in child mode.

## Story 11: The supervisor restarts at a natural idle, with an age-capped drain fallback

**Requirement:** #2392 outcome 5; ADR D7

As the operator of a self-host daemon with the stale-engine gates armed (continuous mode, self-host, `auto_restart_on_stale_engine: true`), I want the supervisor to adopt a new build without stopping claims on every rebuild, while never staying stale indefinitely, so that one generation stays live and supervisor fixes still land.

### Acceptance Criteria

#### Happy Path
- Given the supervisor's boot build differs from `dist` and executors are running, when the next claim boundary arrives, then claiming continues and no drain begins.
- Given the supervisor is stale, when the pool becomes naturally empty (no executor running, whether or not eligible backlog remains), then the existing single-generation restart trigger fires before the next claim and the predecessor exits after handing off.
- Given the supervisor first became stale more than `supervisor_max_stale_hours` ago, including when further rebuilds have landed since, when that threshold is crossed, then claiming stops, in-flight executors drain, and the restart trigger fires at the drained boundary.

#### Negative Paths
- Given a protocol mismatch was recorded, when the next claim boundary arrives, then a claim-stop drain begins regardless of stale age.
- Given `supervisor_max_stale_hours` is set to zero, negative or non-numeric, when the config loads, then it is rejected with a message naming the key and the default of 24 applies.
- Given the restart trigger fails, when that happens, then the supervisor stays alive, keeps dispatching, and retries at a later idle or drained boundary, never leaving two live generations.
- Given an operator-queued RESTART-PENDING exists, when it is observed, then it keeps today's drain-then-act behavior.
- Given a rate-limit episode is active when the pool becomes naturally idle, when the restart would fire, then it is deferred until the episode ends.
- Given a supervisor restart becomes pending (pool naturally empty, or a drain has begun) while the background maintenance job is running a rebuild, when the restart boundary is reached, then no new job run starts and the restart fires only after the running job settles.
- Given the supervisor is stale but no restart boundary has been reached, when the maintenance interval elapses, then the job still runs, because staleness alone never marks a restart pending.
- Given the stale-engine gates are not armed, when the supervisor's boot build differs from `dist`, then no restart and no drain occur, and new dispatches still run on the current build.

### Done When
- [ ] `daemon.ts` gate tests cover the natural-idle restart, the age-cap drain measured from first staleness, the mismatch drain, the absence of a drain when busy and below the cap, rate-limit deferral, job-settle ordering, and unarmed gates.
- [ ] Config validation for `supervisor_max_stale_hours` is tested.
- [ ] Single-generation termination after a fired trigger is unchanged and still covered by its tests.

## Story 12: A self-host cadence rebuild runs while executors are busy

**Requirement:** #2392 outcome 3; ADR D8

As the operator of a self-host daemon with the stale-engine gates armed, I want pulling and rebuilding to happen on its interval even under load, so that a merged fix reaches the next dispatch with no operator action.

### Acceptance Criteria

#### Happy Path
- Given a self-host daemon with the stale-engine gates armed, executors in flight and `engine_refresh_min_interval_seconds` elapsed, when the background maintenance job runs, then it fetches, fast-forwards, rebuilds and flips `dist` without waiting for the pool to drain.
- Given a daemon in `executor_isolation: child` mode and that rebuild produced a new build, when the next feature is claimed, then that feature runs on the new build.
- Given a consumer (non-self-host) daemon in child mode, when the shared install is rebuilt by any means into a protocol-compatible build, then its next claim runs on the new build, and no rebuild job runs in the consumer daemon.

#### Negative Paths
- Given the fetch or the rebuild fails, when the job ends, then `dist` is unchanged, executors are unaffected, the failure is logged, and the job retries after the next interval.
- Given the minimum interval has not elapsed, when the maintenance job is evaluated, then no fetch or rebuild runs.
- Given a rebuild is already running, when the interval elapses again, then no second concurrent rebuild starts.
- Given a self-host daemon with `auto_restart_on_stale_engine: false`, when the interval elapses, then no engine rebuild runs from the maintenance job, while its existing origin refresh and fast-forward behave as before.

### Done When
- [ ] A test proves that the rebuild runs with in-flight executors and goes through the coordinated root mutation.
- [ ] Failed-rebuild, throttle and single-flight cases each have a test.
- [ ] A test proves that consumer daemons register no rebuild job.

## Story 13: The engine version each feature ran on is recoverable from its own record

**Requirement:** #2392 outcome 4; ADR D9

As the operator, I want each dispatch's engine version recorded with the feature, so that I can tell after the fact which build produced a result.

### Acceptance Criteria

#### Happy Path
- Given a child-mode dispatch starts, when its executor initializes, then an `executor_started` event carrying `slug`, `engineVersionId`, `protocolVersion` and `supervisorEngineVersionId` is appended to the feature's `.pipeline/events.jsonl`.
- Given a dispatch starts, when the supervisor emits `feature_dispatch_started`, then the event carries `engineVersionId` and is persisted to `.daemon/events.jsonl`, where it remains after the worktree is removed.
- Given a feature ships, when its shipped-record is written, then its `engine_version` is the executor's pinned version, not the supervisor's.
- Given a child-mode dispatch exports OTel traces, when the trace resource is built, then its engine version attribute is the WorkOrder's pinned `engineVersionId`, not the supervisor's boot build.

#### Negative Paths
- Given a feature was dispatched twice on different builds, when its records are read, then each dispatch carries its own `engineVersionId` and neither overwrites the other.
- Given a `.daemon/events.jsonl` written before this change, when it is read, then `feature_dispatch_started` events without `engineVersionId` parse successfully and report the version as unknown.

### Done When
- [ ] The `executor_started` variant exists in the `ConductorEvent` union and is emitted once per child dispatch.
- [ ] `feature_dispatch_started` has the optional `engineVersionId`, and a backward-compatible parse is tested.
- [ ] Tests assert that the shipped-record `engine_version` and the OTel trace engine version both match the executor's pin.

## Story 14: Daemon status shows features running an older engine than the current build

**Requirement:** #2392 outcome 6; ADR D9

As the operator, I want `daemon status` to show each in-flight feature's engine version against the current build, so that I can see at a glance what is running stale code.

### Acceptance Criteria

#### Happy Path
- Given two live executors, one on v1 and one on v2, with `dist` on v2, when I run `ai-conductor daemon status`, then both features are listed with their version, and the v1 feature is marked as older than current v2.
- Given the supervisor itself is stale, when status renders, then the supervisor row shows its own version and that it is older than current.

#### Negative Paths
- Given an executor record that cannot be parsed, when status renders, then that feature is shown with an unknown version and a warning, and the other rows still render.
- Given `dist` cannot be resolved, when status renders, then the current build is shown as unknown, and no feature is falsely marked as older.

### Done When
- [ ] The observe CLI renders a per-feature engine version column from `.daemon/executors/` records.
- [ ] Older-than-current marking, unreadable-record and unresolvable-`dist` cases are tested against rendered output.

## Story 15: `executor_isolation` selects child or in-process execution

**Requirement:** ADR D1

As the operator, I want a config lever to fall back to in-process execution, so that a child-mode defect can be reverted without a code change.

### Acceptance Criteria

#### Happy Path
- Given no `executor_isolation` key in config, when the daemon starts, then it uses child mode.
- Given `executor_isolation: in-process`, when the daemon starts, then features run in the supervisor process on its boot build, exactly as before this change, and its startup log says that per-dispatch engine pinning is disabled.

#### Negative Paths
- Given `executor_isolation` set to an unrecognized value, when the config loads, then startup fails with a message naming the key and its allowed values `child` and `in-process`.

### Done When
- [ ] Config parsing for `executor_isolation` is tested for the default, both values and an invalid value.
- [ ] A test shows that in-process mode wires the existing in-process executor.

## Story 16: A full feature runs end to end in child mode with in-process parity

**Requirement:** architecture review condition 1; ADR assumption A2

As the operator, I want a full feature dispatch through the child executor to produce the same steps, ledger and outcome as in-process, so that no coordination path is silently lost.

### Acceptance Criteria

#### Happy Path
- Given a fixture feature with a stubbed provider, when it is dispatched once in child mode and once in in-process mode, then both runs record the same ordered step sequence, the same terminal status and the same terminal effects.

#### Negative Paths
- Given the fixture provider returns a rate-limit on its first call, when the feature runs in child mode, then the run waits on the daemon-wide episode and completes after it clears, matching in-process behavior.
- Given the fixture feature halts at a gate, when it runs in child mode, then the halt marker, the ledger and the collected outcome match the in-process run.

### Done When
- [ ] A parity test drives one fixture feature through both executor adapters and compares step sequence, ledger event types and the outcome.
- [ ] The parity test covers a rate-limited path and a halted path.
