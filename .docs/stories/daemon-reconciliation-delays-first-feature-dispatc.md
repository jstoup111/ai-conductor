**Status:** Accepted

# Stories: Dispatch-first daemon maintenance (#1174)

Track: technical

Tier: M

Governing ADR: adr-2026-10-14-dispatch-first-daemon-maintenance (D1–D8). Scope boundary is binding
per `.docs/track/daemon-reconciliation-delays-first-feature-dispatc.md`: the latency target is no
maintenance before the first claim, so first dispatch lands within one startup refresh plus one
discovery plus 1 s. Speeding up discovery itself is out of scope.

## Story 1: Claim the first eligible feature before any best-effort maintenance runs

**Requirement:** ADR D1

As an operator, I want the daemon to start eligible work as soon as it knows the work is safe, so that a growing set of retained worktrees and open PRs never delays the first build.

### Acceptance Criteria

#### Happy Path

- Given a daemon starting at any width with one eligible feature and retained halted, parked, and merged worktrees, when the first claim attempt happens, then rekick, resume-authorization consumption, the startup dashboard render, halt-PR reconciliation, parked reconciliation, the provider-scratch sweep, and the mergeable-label sweep have each been invoked zero times.
- Given a daemon starting with one eligible feature, when the first claim attempt happens, then the pause gate, the build-auth gate, the gh-version gate, one startup origin refresh, discovery, the pickEligible checks, the existing throttled stale-engine check, and the guardedDispatch park re-check have each run before it.

#### Negative Paths

- Given a feature whose shipped record is on the refreshed main, when the daemon starts, then discovery excludes it and it is never claimed even though no reconciler has run yet.
- Given a feature with a live HALT marker and an unconsumed resume authorization, when the daemon starts, then pickEligible skips it on the first claim attempt and it is claimed only on a later fill pass after the authorization is consumed.
- Given a feature that becomes operator-parked after pickEligible selected it on the first fill pass and before it is dispatched, when the first claim is attempted, then the guardedDispatch park re-check refuses it, the daemon log names the reason with the line `park: skipped dispatch of <slug> — operator-parked`, and no worktree is created for it.
- Given the daemon is paused at boot, when startup runs, then no feature is claimed, the startup dashboard is not rendered, and the background job still runs rekick and the sweeps.
- Given the startup origin refresh fails, when startup continues, then discovery runs against the existing local main, the failure is logged once, and the first claim attempt is not blocked by any maintenance step.

### Done When

- [ ] A runDaemon unit test with recording fakes for every maintenance dependency asserts zero calls to each of them at the moment the first dispatch callback fires.
- [ ] Unit tests for the shipped, halted-with-authorization, operator-parked, paused-at-boot, and failed-refresh fixtures assert the claimed-slug list and the maintenance call order.

## Story 2: Fetch origin once at startup and reuse the result

**Requirement:** ADR D2

As an operator, I want startup to fetch the remote only once, so that the network round trip is not paid two or three times before work starts.

### Acceptance Criteria

#### Happy Path

- Given a daemon starting with a remote reachable, when the first claim attempt happens, then exactly one fetch and fast-forward of the root checkout has run.
- Given the startup refresh resolved base SHA S and the persisted last-seen SHA is older than S, when the background job runs the rekick, then the rekick treats S as the advance without running another fetch.
- Given the startup refresh completed, when the background job renders the startup dashboard, then the dashboard uses that discovery result, runs no fetch and no fast-forward, and still shows the merged-ready and orphan parked annotations from its informational parked classification.

#### Negative Paths

- Given the persisted last-seen SHA is missing, when the rekick runs with the startup SHA, then it seeds the SHA without a rekick sweep as on a first run.
- Given the startup refresh completed at time T, when the first fill pass checks whether an origin refresh is due, then no refresh starts before the configured minimum interval after T.

### Done When

- [ ] A startup test counting fastForwardRoot invocations reports exactly 1 at the first claim and still 1 after the background job settles.
- [ ] A dashboard wiring test asserts the dashboard's discovery fake is never called with refresh true and its informational reconcileParkedFeatures fake is called once with auto-cleanup off.

## Story 3: Run best-effort maintenance as one background job the loop never waits on

**Requirement:** ADR D3

As an operator, I want maintenance to keep running without holding up dispatch or worker collection, so that a slow sweep cannot stall the daemon.

### Acceptance Criteria

#### Happy Path

- Given the first claim attempt has happened and the daemon was not paused at boot, when the background job first runs, then it renders the startup dashboard, then performs rekick and resume consumption, then runs the halt-PR, parked, provider-scratch, and mergeable-label sweeps in that order.
- Given a background job is still running, when the loop reaches an idle poll, a busy poll, or a terminal collection, then the loop continues without awaiting the job and the trigger is merged into the running job instead of starting a second one.
- Given the pool is busy at width 1, when a busy poll fires, then the background job is started if none is running, and an origin refresh and fast-forward it triggers may run while the single feature is in flight.

#### Negative Paths

- Given one maintenance step throws, when the background job runs, then the error is logged with the step name, the remaining steps still run, and the daemon loop keeps dispatching.
- Given a worker finishes while the background job is mid-sweep, when the loop wakes, then the worker is collected before the job settles.
- Given a stale-engine restart is pending, when the pool drains, then the restart waits until the running background job settles and the job is never started again after the drain begins.
- Given the daemon is stopping, when a background job is running, then shutdown waits for the job to settle and no new job starts.

### Done When

- [ ] A test with a never-resolving fake sweep proves the loop dispatches a second feature and collects a finished worker while the sweep is still pending.
- [ ] A test firing three triggers during one running job observes exactly one concurrent job invocation.
- [ ] A drain test asserts the restart callback runs strictly after the pending job resolves.

## Story 4: Leave in-flight features alone during maintenance

**Requirement:** ADR D4

As an operator, I want maintenance that runs beside builds to never touch a feature that is building, so that a live worker's own state changes always win.

### Acceptance Criteria

#### Happy Path

- Given a halt-marked PR whose feature slug is in flight, when halt-PR reconciliation runs, then it makes no label, draft, or comment write for that PR, logs the in-flight skip only on the sweep where the skip first appears, and records no conformance outcome for it.
- Given a halt-marked PR whose feature slug is not in flight, when halt-PR reconciliation runs, then it applies today's presentation or clear behavior unchanged.

#### Negative Paths

- Given a live worker clears a PR's halt marker and label while the background job is running, when halt-PR reconciliation reaches that PR, then the label is not re-applied.
- Given a parked candidate's slug is in flight, when parked reconciliation runs, then it retains the candidate with reason in-flight and removes no worktree or branch.
- Given a watched PR's feature slug is in flight, when the mergeable-label sweep runs, then it queues no repair and tears down no worktree for that slug.
- Given a slug is claimed after the background job started, when a later step of the same job reaches that slug, then the step reads the current in-flight set and skips the slug.

### Done When

- [ ] For each of halt-PR reconciliation, parked reconciliation, and the mergeable-label sweep, a test with the slug in the in-flight set asserts zero mutating calls to the GitHub and git fakes for that slug.
- [ ] A test that adds a slug to the claims between two job steps asserts the later step skips it.

## Story 5: Queue CI-fix and autoresolve as pooled repairs that ship before new features

**Requirement:** ADR D5

As an operator, I want open PRs that need a repair to get worker slots before new features start, so that shippable work ships first and repairs share the concurrency budget.

### Acceptance Criteria

#### Happy Path

- Given three watched PRs with failing checks and one with conflicts, when the mergeable-label sweep runs, then it queues four repair requests and awaits no repair session.
- Given two free slots, two queued repairs, and three eligible features, when the dispatcher fills the pool, then both slots go to the repairs and no feature is claimed on that pass.
- Given queued repairs whose features carry different priority bands, when the dispatcher fills slots, then repairs start in priority-band order and then oldest PR first.
- Given a repair is running, when the dispatcher counts occupied slots, then the repair's reserved claim counts toward daemon_concurrency and the claim is released when the repair returns any outcome.
- Given a running repair completes and a feature is eligible, when the next fill pass runs, then the freed slot goes to the feature if no repair is queued.

#### Negative Paths

- Given a repair is already running for a PR, when a later sweep finds that PR still eligible, then no second repair request for that PR is queued or started.
- Given the PR's feature slug is in flight as a feature build, when the dispatcher considers that PR's repair, then the repair is not started.
- Given a repair request whose ciFixAttempts already equals MAX_CI_FIX_ATTEMPTS, when the sweep evaluates it, then no repair is queued and the exhaustion escalation behaves as today.
- Given a repair session throws, when it returns, then its reserved claim is released, the error is logged, and the slot is available on the next fill pass.
- Given a repair request is queued and the daemon is paused or restarts before it is claimed, when the request is later claimed or lost, then ciFixAttempts was not incremented for it.
- Given a queued repair whose PR has since merged, closed, become draft, or turned green, when the dispatcher would claim it, then it re-reads the PR state, drops the request, and starts no repair.
- Given the daemon crashes after a claimed repair bumped ciFixAttempts and before its git work, when the daemon restarts, then the attempt is still counted.

### Done When

- [ ] A sweep test asserts the CI-fix and autoresolve dispatch fakes are never awaited inside sweepMergeableLabels and that the queue holds one request per eligible PR.
- [ ] A fill-pass test asserts the repair-before-feature order, the priority-band-then-age order, and the claims list contents during and after a repair.
- [ ] A test asserts a thrown repair releases its claim.

## Story 6: Keep repairs inside today's safety rails

**Requirement:** ADR D5

As an operator, I want pooled repairs to keep every guard they have today, so that moving them does not weaken what gets pushed to a PR.

### Acceptance Criteria

#### Happy Path

- Given a queued CI-fix repair, when it runs, then it uses an isolated resolve worktree from the PR tip, applies the acceptance guards and the suite gate, and pushes with the lease, exactly as the inline path did.
- Given a queued autoresolve repair, when it runs, then it dispatches through the mergeable sweep's sanctioned resolver call site with its sweep-only test-only judgement.

#### Negative Paths

- Given the daemon is paused, when a repair is queued and a slot is free, then no repair is claimed until the pause is lifted, and a repair already running finishes.
- Given a rate-limit episode is active, when a repair is queued and a slot is free, then no repair is claimed until the episode ends.
- Given the CI-fix startup preflight failed, when the sweep finds a failing-check PR, then no CI-fix repair request is accepted and the preflight failure is reported as today.
- Given the suite gate fails inside a repair, when the repair returns, then nothing is pushed and the outcome is recorded as today.

### Done When

- [ ] Tests for pause and an active rate-limit episode assert the repair claim count stays 0 while a repair is queued and a slot is free.
- [ ] A preflight-failed test asserts the repair queue stays empty.
- [ ] The existing runCiFix guard, suite-gate, and lease-push tests pass unchanged through the pooled path.

## Story 7: Skip unchanged parked reconciliation for up to 10 minutes

**Requirement:** ADR D6

As an operator, I want repeat parked sweeps over unchanged inputs to cost almost nothing, so that retained worktrees do not slow every tick.

### Acceptance Criteria

#### Happy Path

- Given the daemon has just started, when parked reconciliation runs for the first time, then it performs the full per-candidate pass.
- Given a full pass completed less than 10 minutes ago and none of the worktree list, branch refs including the origin/main SHA, park markers, HALT markers, shipped-record listing, or in-flight set has changed, when parked reconciliation runs, then it performs no per-candidate merge-base or GitHub call and reports skipped-unchanged.
- Given a run is skipped, when it ends, then a daemon_maintenance_phase event carries the last full pass's counts, including refusal counts, and the daemon-log summary line is written only if those counts differ from the last logged summary.

#### Negative Paths

- Given the inputs are unchanged but the last full pass was 10 or more minutes ago, when parked reconciliation runs, then it performs the full pass.
- Given only the origin/main SHA changed, when parked reconciliation runs, then it performs the full pass.
- Given only a park marker, a HALT marker, the shipped listing, the worktree list, or the in-flight set changed, when parked reconciliation runs, then it performs the full pass.
- Given a full pass is about to remove a merged worktree, when the destructive step runs, then it re-verifies ancestry itself regardless of the fingerprint.
- Given the daemon restarts, when parked reconciliation first runs, then no fingerprint from the previous process is used and no fingerprint file exists on disk.

### Done When

- [ ] A test with a counting merge-base fake asserts 0 calls on an unchanged second run within 10 minutes and a full count after each single-input change and after 10 minutes on an injected clock.
- [ ] A test asserts the skipped run's event counts equal the prior full run's counts and that no repeat summary log line is written.

## Story 8: Emit maintenance phase durations on the event spine

**Requirement:** ADR D7

As an operator, I want each startup and maintenance phase to report its duration, so that dispatch-latency regressions are visible without reading logs.

### Acceptance Criteria

#### Happy Path

- Given a daemon start, when the first claim attempt happens, then a daemon_maintenance_phase event with phase first-claim and the elapsed milliseconds since scan start is persisted to .daemon/events.jsonl.
- Given the startup refresh, rekick, dashboard render, halt-PR reconcile, parked reconcile, provider-scratch sweep, mergeable sweep, and each repair complete, when each finishes, then one daemon_maintenance_phase event per phase carries its phase, durationMs, and outcome.
- Given a repair finishes, when its event is emitted, then it carries the PR reference and the feature slug when known.

#### Negative Paths

- Given a maintenance step throws, when its event is emitted, then the outcome is failed and durationMs covers the time until the throw.
- Given a parked run is skipped, when its event is emitted, then the outcome is skipped-unchanged.
- Given a repair is queued but blocked by pause, when the sweep ends, then the repair phase event outcome is deferred.
- Given a maintenance event whose outcome its phase never produces, such as startup-refresh with deferred, repair with skipped-unchanged, or a summary on any phase but parked-reconcile, when the daemon is compiled, then the type check rejects it, because only repair may be deferred and only parked-reconcile may be skipped-unchanged or carry a summary.
- Given the new variant is added, when the event-sink registry is compiled, then its declaration is persist true, render false, audit false, and otel false and the pinned persisted-type test lists it.

### Done When

- [ ] A daemon test reads .daemon/events.jsonl through the existing persister and finds one first-claim event plus one event per phase with numeric durationMs.
- [ ] The EVENT_SINKS entry and the pinned persisted-event-type list include daemon_maintenance_phase.

## Story 9: Keep width-1 feature ordering unchanged

**Requirement:** ADR D8

As an operator running a default width-1 daemon, I want feature ordering and gate behavior to stay exactly as today, so that only maintenance placement and repair slots differ.

### Acceptance Criteria

#### Happy Path

- Given a width-1 daemon and a backlog with features in a known priority order, when it runs to drain with no repairs queued, then the sequence of claimed slugs and the gate log lines match today's daemon for the same backlog.

#### Negative Paths

- Given a width-1 daemon running a feature and a repair queued, when the feature finishes, then the repair takes the slot before the next feature.
- Given a width-1 daemon with a feature running, when the background job runs, then no second feature or repair is claimed until the slot frees.

### Done When

- [ ] A width-1 ordering test compares the claimed-slug sequence and gate log lines against a recorded fixture of today's behavior.
- [ ] A width-1 test asserts the claims list never exceeds one entry while a repair and features compete.
