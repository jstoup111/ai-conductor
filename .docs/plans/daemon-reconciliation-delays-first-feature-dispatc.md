# Implementation Plan: Dispatch-first daemon maintenance

**Date:** 2026-10-14
**Design:** .docs/decisions/adr-2026-10-14-dispatch-first-daemon-maintenance.md
**Stories:** .docs/stories/daemon-reconciliation-delays-first-feature-dispatc.md
**Conflict check:** Clean as of 2026-10-14 (.docs/conflicts/2026-10-14-daemon-reconciliation-delays-first-feature-dispatc.md)

## Summary

This plan takes reconciliation and repair sessions off the path to the daemon's first claim
(jstoup111/ai-conductor#1174). Best-effort maintenance becomes a single-flight background job.
CI-fix and autoresolve become pooled repairs that take free slots ahead of new features. Parked
reconciliation skips unchanged inputs for up to 10 minutes. Every phase reports its duration on
the event spine. The plan has 19 tasks.

## Technical Approach

- **First-claim path (`engine/daemon.ts`).** The awaited `renderStartupDashboard` and
  `maintenance.startup(rekick, sweepBestEffort)` calls are removed from the pre-loop startup.
  Startup runs one `discoverBacklog({ refresh: true })`; its base SHA seeds `maybeRekick`, and
  `DaemonMaintenance.recordRefresh` starts the refresh throttle. The first fill pass skips its
  per-pass `consumeResumeAuthorizations`. Everything else on the claim path is unchanged: the
  gates, `pickEligible`, the throttled stale-engine check, and `guardedDispatchWith`.
- **Background job (`engine/daemon-maintenance.ts`).** `MaintenanceJob` follows the existing
  `refreshJob` / `startRefresh` / `foldRefresh` single-flight pattern in `engine/daemon.ts`. It
  is one dispatcher-held promise, started without being awaited and cleared in `finally`. A
  trigger that fires while it runs folds into one rerun.
  - **Steps.** The first run renders the dashboard, unless paused at boot. Every run then does
    rekick and resume consumption, followed by the halt-PR, parked, scratch and mergeable sweeps,
    each isolated in try/catch.
  - **Triggers.** Idle polls, busy polls at every width (the `busyMaintenanceEnabled()` gate is
    dropped for this trigger), and terminal collection.
  - **Drain and stop.** Both `close()` the job and await `settled()`.
  - **In-flight checks.** The sweep context's `isFeatureInFlight` reads live `WorkClaims` at call
    time.
- **Dashboard (`daemon-cli.ts`).** The dashboard discovers with `refresh: false` and keeps its
  informational parked classification, so its annotations survive.
- **Halt-PR guard (`engine/halt-pr-reconciliation.ts`).** The function takes an
  `isFeatureInFlight` context. A skip goes through `haltPrSweepCache` as a non-conformance
  `in-flight` entry, so it is logged once per transition.
- **Pooled repairs.**
  - `sweepMergeableLabels` enqueues into a new `RepairQueue` (`engine/repair-queue.ts`), deduped
    per `prUrl`, instead of awaiting `ciFix.dispatch` or `autoresolve.dispatch`.
  - The fill pass takes repairs before `pickEligible`, behind the same pause, episode,
    build-auth and gh-version guard. Order is priority band, then oldest. Each repair claims a
    `WorkClaims` key `repair:<prUrl>` and runs as a pooled worker collected by `collectOne`.
  - The `runRepair` binding in `daemon-cli.ts`:
    - re-reads PR state and drops a request that has gone stale;
    - refuses a repair whose feature slug is in flight;
    - bumps attempts at claim through a new mutex-guarded `updateWatch`;
    - calls the existing `createDaemonCiFixDispatch` or autoresolve adapters, with the sweep
      call-site semantics.

  Once repairs run outside the sweep, two writers can reach `.daemon/mergeable-watch.jsonl`, so
  `updateWatch` serializes every read-modify-write.
- **Parked fingerprint (`engine/park-reconciliation.ts`).** A hash over the existing prefetch
  outputs plus markers and the in-flight set. It is held in a per-process memo created by the
  `daemon-cli.ts` binding, with a 600 000 ms full-run bound. A skip returns the memo's summary.
- **Events.** A new `daemon_maintenance_phase` `ConductorEvent` variant is declared in
  `EVENT_SINKS` (persist only). `timeMaintenancePhase` wraps each phase. `daemon-cli.ts` binds the
  emitter to the daemon bus, so events persist to `.daemon/events.jsonl` through
  `startDaemonEventPersistence`. No sidecar file is added.
- **Sequencing.**
  - The event type and timer (1–2), the job primitive (3), the halt-PR guard (10) and the
    registry mutex (12) have no dependencies.
  - Startup ordering (4–6, 8) comes next, then job wiring (7, 9, 11).
  - Pooled repairs follow (13–16), then the fingerprint (17).
  - Phase-event integration (18) and the width-1 parity proof (19) close it out.

## Prerequisites

- None. All touched modules exist on main.


## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 17 ─┐
Task 3 ─▶ Task 4 ─▶ Task 5 ─▶ Task 6
                    Task 5 ─▶ Task 8
          Task 4 ─▶ Task 7 ─▶ Task 9 ──┐
                    Task 7 ─▶ Task 11  │
Task 10 (independent)                  │
Task 12 ─▶ Task 13 ─▶ Task 14 ─▶ Task 15 ─▶ Task 16
Tasks 2, 9, 14, 17 ─▶ Task 18
Tasks 7, 16 ─▶ Task 19
```

## Integration Points

- After Task 4: the first claim happens with no maintenance step on the path, observed through
  `runDaemon`.
- After Task 9: the background job runs beside workers, drains and stops cleanly.
- After Task 14: repairs claim pool slots ahead of features through the dispatcher fill pass.
- After Task 18: every phase duration is readable from `.daemon/events.jsonl` through the
  existing daemon persister.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon starting at any width with one eligible feature and retained halted, parked, and merged worktrees, when the first claim attempt happens, then rekick, resume-authorization consumption, the startup dashboard render, halt-PR reconciliation, parked reconciliation, the provider-scratch sweep, and the mergeable-label sweep have each been invoked zero times. | 4 | "zero calls to `renderStartupDashboard`, the rekick, `consumeResumeAuthorizations`" | diff-local |
| Story 1 happy: Given a daemon starting with one eligible feature, when the first claim attempt happens, then the pause gate, the build-auth gate, the gh-version gate, one startup origin refresh, discovery, the pickEligible checks, the existing throttled stale-engine check, and the guardedDispatch park re-check have each run before it. | 4 | "exactly one `discoverBacklog({ refresh: true })`" | diff-local |
| Story 1 negative: Given a feature whose shipped record is on the refreshed main, when the daemon starts, then discovery excludes it and it is never claimed even though no reconciler has run yet. | 4 | "the first `discoverBacklog` result excludes it, and dispatch is never called for it across three fill passes" | diff-local |
| Story 1 negative: Given a feature with a live HALT marker and an unconsumed resume authorization, when the daemon starts, then pickEligible skips it on the first claim attempt and it is claimed only on a later fill pass after the authorization is consumed. | 4 | "is skipped by `pickEligible` on the first pass, and is claimed on a later fill pass only after `consumeResumeAuthorizations` has cleared its marker" | diff-local |
| Story 1 negative: Given a feature that becomes operator-parked after pickEligible selected it on the first fill pass and before it is dispatched, when the first claim is attempted, then the guardedDispatch park re-check refuses it, the daemon log names the reason with the line `park: skipped dispatch of <slug> — operator-parked`, and no worktree is created for it. | 4 | "`guardedDispatchWith`'s `isParked` re-check returns false for it, the log fake records `park: skipped dispatch of <slug> — operator-parked` for it, dispatch is not called, and no worktree-creation fake is called for it" | diff-local |
| Story 1 negative: Given the daemon is paused at boot, when startup runs, then no feature is claimed, the startup dashboard is not rendered, and the background job still runs rekick and the sweeps. | 7 | "When paused at boot, the job makes zero `renderStartupDashboard` calls but still calls the rekick and all four sweep fakes, and no feature is claimed" | diff-local |
| Story 1 negative: Given the startup origin refresh fails, when startup continues, then discovery runs against the existing local main, the failure is logged once, and the first claim attempt is not blocked by any maintenance step. | 6 | "logs exactly one `startup origin refresh failed` line" | diff-local |
| Story 2 happy: Given a daemon starting with a remote reachable, when the first claim attempt happens, then exactly one fetch and fast-forward of the root checkout has run. | 5 | "reports exactly 1 call when the first dispatch fires" | diff-local |
| Story 2 happy: Given the startup refresh resolved base SHA S and the persisted last-seen SHA is older than S, when the background job runs the rekick, then the rekick treats S as the advance without running another fetch. | 5 | "the rekick sweep fake receives the advance A to S with no extra fetch" | diff-local |
| Story 2 happy: Given the startup refresh completed, when the background job renders the startup dashboard, then the dashboard uses that discovery result, runs no fetch and no fast-forward, and still shows the merged-ready and orphan parked annotations from its informational parked classification. | 8 | "renders its ELIGIBLE group from the cached startup discovery result object passed to it" | diff-local |
| Story 2 negative: Given the persisted last-seen SHA is missing, when the rekick runs with the startup SHA, then it seeds the SHA without a rekick sweep as on a first run. | 5 | "with a null persisted SHA, the SHA is seeded and the rekick sweep fake is not called" | diff-local |
| Story 2 negative: Given the startup refresh completed at time T, when the first fill pass checks whether an origin refresh is due, then no refresh starts before the configured minimum interval after T. | 5 | "`refreshStartable()` is false at any time before T plus the minimum interval" | diff-local |
| Story 3 happy: Given the first claim attempt has happened and the daemon was not paused at boot, when the background job first runs, then it renders the startup dashboard, then performs rekick and resume consumption, then runs the halt-PR, parked, provider-scratch, and mergeable-label sweeps in that order. | 7 | "The job's first run calls the step fakes in exactly this order" | diff-local |
| Story 3 happy: Given a background job is still running, when the loop reaches an idle poll, a busy poll, or a terminal collection, then the loop continues without awaiting the job and the trigger is merged into the running job instead of starting a second one. | 7 | "each of those triggers leaves exactly one job running" | diff-local |
| Story 3 happy: Given the pool is busy at width 1, when a busy poll fires, then the background job is started if none is running, and an origin refresh and fast-forward it triggers may run while the single feature is in flight. | 7 | "a busy poll calls `MaintenanceJob.trigger()` and the job starts" | diff-local |
| Story 3 negative: Given one maintenance step throws, when the background job runs, then the error is logged with the step name, the remaining steps still run, and the daemon loop keeps dispatching. | 9 | "the job's remaining step fakes are still called, and `runDaemon` keeps dispatching" | diff-local |
| Story 3 negative: Given a worker finishes while the background job is mid-sweep, when the loop wakes, then the worker is collected before the job settles. | 9 | "a worker that completes is collected by `collectOne`" | diff-local |
| Story 3 negative: Given a stale-engine restart is pending, when the pool drains, then the restart waits until the running background job settles and the job is never started again after the drain begins. | 9 | "the drained-boundary restart callback runs strictly after the pending job's `settled()` resolves" | diff-local |
| Story 3 negative: Given the daemon is stopping, when a background job is running, then shutdown waits for the job to settle and no new job starts. | 9 | "`runDaemon` returns only after `settled()` resolves" | diff-local |
| Story 4 happy: Given a halt-marked PR whose feature slug is in flight, when halt-PR reconciliation runs, then it makes no label, draft, or comment write for that PR, logs the in-flight skip only on the sweep where the skip first appears, and records no conformance outcome for it. | 10 | "`haltPrSweepCache` holds no conformance outcome (conforming or cleared) for that PR" | diff-local |
| Story 4 happy: Given a halt-marked PR whose feature slug is not in flight, when halt-PR reconciliation runs, then it applies today's presentation or clear behavior unchanged. | 10 | "the next sweep applies today's presentation or clear calls" | diff-local |
| Story 4 negative: Given a live worker clears a PR's halt marker and label while the background job is running, when halt-PR reconciliation reaches that PR, then the label is not re-applied. | 10 | "the second sweep makes no label-add call" | diff-local |
| Story 4 negative: Given a parked candidate's slug is in flight, when parked reconciliation runs, then it retains the candidate with reason in-flight and removes no worktree or branch. | 11 | "`reconcileParkedFeatures` removes no worktree or branch" | diff-local |
| Story 4 negative: Given a watched PR's feature slug is in flight, when the mergeable-label sweep runs, then it queues no repair and tears down no worktree for that slug. | 11 | "`sweepMergeableLabels` queues no repair request and calls no worktree teardown" | diff-local |
| Story 4 negative: Given a slug is claimed after the background job started, when a later step of the same job reaches that slug, then the step reads the current in-flight set and skips the slug. | 11 | "A slug claimed after the job started, before the parked step ran, is retained by `reconcileParkedFeatures` with reason in-flight" | diff-local |
| Story 5 happy: Given three watched PRs with failing checks and one with conflicts, when the mergeable-label sweep runs, then it queues four repair requests and awaits no repair session. | 13 | "leaves four entries in `RepairQueue`" | diff-local |
| Story 5 happy: Given two free slots, two queued repairs, and three eligible features, when the dispatcher fills the pool, then both slots go to the repairs and no feature is claimed on that pass. | 14 | "the fill pass starts both repairs through the `runRepair` fake and claims no feature on that pass" | diff-local |
| Story 5 happy: Given queued repairs whose features carry different priority bands, when the dispatcher fills slots, then repairs start in priority-band order and then oldest PR first. | 14 | "start in earliest `prCreatedAt` order (oldest PR first)" | diff-local |
| Story 5 happy: Given a repair is running, when the dispatcher counts occupied slots, then the repair's reserved claim counts toward daemon_concurrency and the claim is released when the repair returns any outcome. | 14 | "`inFlight.size` counts it against concurrency" | diff-local |
| Story 5 happy: Given a running repair completes and a feature is eligible, when the next fill pass runs, then the freed slot goes to the feature if no repair is queued. | 14 | "the next fill pass claims that feature" | diff-local |
| Story 5 negative: Given a repair is already running for a PR, when a later sweep finds that PR still eligible, then no second repair request for that PR is queued or started. | 13 | "A PR with a running or already-queued repair gets no second request" | diff-local |
| Story 5 negative: Given the PR's feature slug is in flight as a feature build, when the dispatcher considers that PR's repair, then the repair is not started. | 15 | "the repair is not started and the request stays queued" | diff-local |
| Story 5 negative: Given a repair request whose ciFixAttempts already equals MAX_CI_FIX_ATTEMPTS, when the sweep evaluates it, then no repair is queued and the exhaustion escalation behaves as today. | 13 | "A PR whose `ciFixAttempts` equals `MAX_CI_FIX_ATTEMPTS` is not queued" | diff-local |
| Story 5 negative: Given a repair session throws, when it returns, then its reserved claim is released, the error is logged, and the slot is available on the next fill pass. | 14 | "after a throw the next fill pass starts the next queued repair in that freed slot" | diff-local |
| Story 5 negative: Given a repair request is queued and the daemon is paused or restarts before it is claimed, when the request is later claimed or lost, then ciFixAttempts was not incremented for it. | 15 | "a process stop injected between the write and the adapter call leaves the incremented count on disk" | diff-local |
| Story 5 negative: Given a queued repair whose PR has since merged, closed, become draft, or turned green, when the dispatcher would claim it, then it re-reads the PR state, drops the request, and starts no repair. | 15 | "leaves `ciFixAttempts` and `resolveAttempts` unchanged on disk" | diff-local |
| Story 5 negative: Given the daemon crashes after a claimed repair bumped ciFixAttempts and before its git work, when the daemon restarts, then the attempt is still counted. | 15 | "the request is dropped, the adapter fake is called zero times, and no counter changes" | diff-local |
| Story 6 happy: Given a queued CI-fix repair, when it runs, then it uses an isolated resolve worktree from the PR tip, applies the acceptance guards and the suite gate, and pushes with the lease, exactly as the inline path did. | 16 | "created from the PR branch tip SHA, the acceptance-guard fake and the suite-gate fake are each called once, and on success the lease-protected push fake is called once" | diff-local |
| Story 6 happy: Given a queued autoresolve repair, when it runs, then it dispatches through the mergeable sweep's sanctioned resolver call site with its sweep-only test-only judgement. | 16 | "calls the resolver through the sweep call-site entry with the sweep-only test-only judgement enabled" | diff-local |
| Story 6 negative: Given the daemon is paused, when a repair is queued and a slot is free, then no repair is claimed until the pause is lifted, and a repair already running finishes. | 16 | "While paused, with a queued repair and a free slot, the repair claim count stays 0" | diff-local |
| Story 6 negative: Given a rate-limit episode is active, when a repair is queued and a slot is free, then no repair is claimed until the episode ends. | 16 | "While `rateLimitEpisode.active()` is true" | diff-local |
| Story 6 negative: Given the CI-fix startup preflight failed, when the sweep finds a failing-check PR, then no CI-fix repair request is accepted and the preflight failure is reported as today. | 13 | "With the CI-fix preflight failed, a failing-check PR produces zero ci-fix requests" | diff-local |
| Story 6 negative: Given the suite gate fails inside a repair, when the repair returns, then nothing is pushed and the outcome is recorded as today. | 16 | "the lease-push fake is called zero times" | diff-local |
| Story 7 happy: Given the daemon has just started, when parked reconciliation runs for the first time, then it performs the full per-candidate pass. | 17 | "The first `reconcileParkedFeatures` call in a fresh memo makes per-candidate merge-base calls" | diff-local |
| Story 7 happy: Given a full pass completed less than 10 minutes ago and none of the worktree list, branch refs including the origin/main SHA, park markers, HALT markers, shipped-record listing, or in-flight set has changed, when parked reconciliation runs, then it performs no per-candidate merge-base or GitHub call and reports skipped-unchanged. | 17 | "makes 0 merge-base calls and 0 calls of any kind to the gh-runner fake" | diff-local |
| Story 7 happy: Given a run is skipped, when it ends, then a daemon_maintenance_phase event carries the last full pass's counts, including refusal counts, and the daemon-log summary line is written only if those counts differ from the last logged summary. | 17 | "the `daemon_maintenance_phase` event the binding emits for it carries those same counts in summary" | diff-local |
| Story 7 negative: Given the inputs are unchanged but the last full pass was 10 or more minutes ago, when parked reconciliation runs, then it performs the full pass. | 17 | "or when 10 minutes have passed" | diff-local |
| Story 7 negative: Given only the origin/main SHA changed, when parked reconciliation runs, then it performs the full pass. | 17 | "separately, the origin/main SHA" | diff-local |
| Story 7 negative: Given only a park marker, a HALT marker, the shipped listing, the worktree list, or the in-flight set changed, when parked reconciliation runs, then it performs the full pass. | 17 | "a park marker, a HALT marker, the shipped listing, the worktree list, or the in-flight set changed" | diff-local |
| Story 7 negative: Given a full pass is about to remove a merged worktree, when the destructive step runs, then it re-verifies ancestry itself regardless of the fingerprint. | 17 | "the destructive helper's ancestry re-check fake is called for that slug" | diff-local |
| Story 7 negative: Given the daemon restarts, when parked reconciliation first runs, then no fingerprint from the previous process is used and no fingerprint file exists on disk. | 17 | "a filesystem write spy records zero writes made by the fingerprint memo" | diff-local |
| Story 8 happy: Given a daemon start, when the first claim attempt happens, then a daemon_maintenance_phase event with phase first-claim and the elapsed milliseconds since scan start is persisted to .daemon/events.jsonl. | 18 | "`.daemon/events.jsonl` holds one first-claim event" | diff-local |
| Story 8 happy: Given the startup refresh, rekick, dashboard render, halt-PR reconcile, parked reconcile, provider-scratch sweep, mergeable sweep, and each repair complete, when each finishes, then one daemon_maintenance_phase event per phase carries its phase, durationMs, and outcome. | 18 | "and one event each for startup-refresh, startup-dashboard, rekick, halt-pr-reconcile, parked-reconcile, provider-scratch and mergeable-sweep" | diff-local |
| Story 8 happy: Given a repair finishes, when its event is emitted, then it carries the PR reference and the feature slug when known. | 18 | "writes one repair event carrying phase repair, its `prUrl`" | diff-local |
| Story 8 negative: Given a maintenance step throws, when its event is emitted, then the outcome is failed and durationMs covers the time until the throw. | 18 | "A throwing job step writes outcome failed with `durationMs` covering the time until the throw" | diff-local |
| Story 8 negative: Given a parked run is skipped, when its event is emitted, then the outcome is skipped-unchanged. | 18 | "an unchanged parked run writes outcome skipped-unchanged" | diff-local |
| Story 8 negative: Given a repair is queued but blocked by pause, when the sweep ends, then the repair phase event outcome is deferred. | 18 | "a repair held back by pause writes outcome deferred" | diff-local |
| Story 8 negative: Given the new variant is added, when the event-sink registry is compiled, then its declaration is persist true, render false, audit false, and otel false and the pinned persisted-type test lists it. | 1 | "The `EVENT_SINKS` entry for `daemon_maintenance_phase` is `render: false, persist: true, audit: false, otel: false`" | diff-local |
| Story 9 happy: Given a width-1 daemon and a backlog with features in a known priority order, when it runs to drain with no repairs queued, then the sequence of claimed slugs and the gate log lines match today's daemon for the same backlog. | 19 | "the claimed-slug sequence and the gate log lines (pause, build-auth, gh-version) equal the recorded pre-change fixture" | diff-local |
| Story 9 negative: Given a width-1 daemon running a feature and a repair queued, when the feature finishes, then the repair takes the slot before the next feature. | 19 | "the repair starts on the fill pass after the feature finishes and before the next feature" | diff-local |
| Story 9 negative: Given a width-1 daemon with a feature running, when the background job runs, then no second feature or repair is claimed until the slot frees. | 19 | "`claims.list()` never holds more than one entry during the run, including while the background job runs" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D1 | task | task-4 | zero calls to `renderStartupDashboard`, the rekick, `consumeResumeAuthorizations` |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D2 | task | task-5, task-8 | reports exactly 1 call when the first dispatch fires |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D3 | task | task-7, task-9 | The job's first run calls the step fakes in exactly this order |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D4 | task | task-10, task-11 | makes zero label, draft and comment calls on the gh-runner fake |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D5 | task | task-14, task-13, task-15, task-16 | the fill pass starts both repairs through the `runRepair` fake and claims no feature on that pass |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D6 | task | task-17 | makes 0 merge-base calls and 0 calls of any kind to the gh-runner fake |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D7 | task | task-18, task-1 | `.daemon/events.jsonl` holds one first-claim event |
| adr-2026-10-14-dispatch-first-daemon-maintenance#D8 | task | task-19 | equal the recorded pre-change fixture |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D1 | no-change | none | The maintenance job and pooled repairs run dispatcher-side (Tasks 3, 14) through the existing adapters; executor code is untouched and still owns exactly one feature build. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D2 | no-change | none | Repairs are not executor work orders, so the WorkOrder struct and document manifest are unchanged. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D3 | task | task-14 | `claims.list()` contains `repair:<prUrl>` |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D4 | task | task-7 | keeps its original pinned base SHA |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D5 | task | task-7, task-9 | a busy poll calls `MaintenanceJob.trigger()` and the job starts |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D6 | no-change | none | No new root mutation path is added: the single startup refresh and later refreshes still go through the existing coordinatedRootMutation fastForwardRoot binding, and no fingerprint exclusion changes. |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D7 | task | task-19 | equal the recorded pre-change fixture |
| adr-2026-08-27-daemon-dispatcher-executor-seam#D8 | task | task-1 | The `EVENT_SINKS` entry for `daemon_maintenance_phase` is `render: false, persist: true, audit: false, otel: false` |
| adr-2026-07-07-ship-ci-feedback-loop#D1 | no-change | none | Check-state classification in PrMergeState is unchanged; the sweep still reads it to pick CI-fix candidates. |
| adr-2026-07-07-ship-ci-feedback-loop#D2 | no-change | none | The sweep label pass (ci-failed label and ci_failed event) is unchanged; only the post-label dispatch step changes. |
| adr-2026-07-07-ship-ci-feedback-loop#D3 | task | task-13, task-15 | leaves four entries in `RepairQueue` |
| adr-2026-07-07-ship-ci-feedback-loop#D4 | task | task-16 | A pooled CI-fix repair reaches the `runCiFix` fake inside `withResolveWorktree` |
| adr-2026-07-07-ship-ci-feedback-loop#D5 | task | task-13 | the existing exhaustion escalation fake is called as today |
| adr-2026-07-07-ship-ci-feedback-loop#D6 | no-change | none | The ci_watch.enabled kill switch is unchanged; when it is false the ciFix options stay absent, so the sweep queues no CI-fix request. |
| adr-2026-07-07-ship-ci-feedback-loop#D7 | no-change | none | The fixture-portability structural meta-test is unaffected by scheduling changes; new tests follow it. |
| adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep#D1 | task | task-16 | calls the resolver through the sweep call-site entry with the sweep-only test-only judgement enabled |

## Tasks

### Task 1: `daemon_maintenance_phase` event variant and sink declaration
**Story:** Story 8
**Type:** infrastructure

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/event-sinks.test.ts` so `PINNED_PERSISTED_EVENT_TYPES` lists `daemon_maintenance_phase`, and add a type-level fixture constructing each phase and outcome value.
2. Verify RED.
3. Implement: add the variant to the ConductorEvent union in `src/conductor/src/types/events.ts` with closed unions `MaintenancePhase` ('startup-refresh', 'first-claim', 'rekick', 'startup-dashboard', 'halt-pr-reconcile', 'parked-reconcile', 'provider-scratch', 'mergeable-sweep', 'repair') and `MaintenancePhaseOutcome` ('completed', 'skipped-unchanged', 'failed', 'deferred'), numeric `durationMs`, optional `prUrl`, optional slug, and optional summary counts. Add its `EVENT_SINKS` entry in `src/conductor/src/engine/event-sinks.ts` as `render: false, persist: true, audit: false, otel: false`.
4. Verify GREEN, commit.

**Done when:**
- [test] The `EVENT_SINKS` entry for `daemon_maintenance_phase` is `render: false, persist: true, audit: false, otel: false`, and `PINNED_PERSISTED_EVENT_TYPES` in `event-sinks.test.ts` lists `daemon_maintenance_phase`.
- [test] `persistedEventTypes()` includes `daemon_maintenance_phase`, and the `MaintenancePhase` union accepts exactly the nine phases and `MaintenancePhaseOutcome` exactly the four outcomes named in Steps.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new variant and its closed unions
- `src/conductor/src/engine/event-sinks.ts` — sink declaration
- `src/conductor/test/engine/event-sinks.test.ts` — pinned persisted list

**Dependencies:** none

### Task 2: Phase timer that reports duration and outcome
**Story:** Story 8
**Type:** infrastructure

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/maintenance-phase-timer.test.ts` with an injected clock and a recording emitter.
2. Verify RED.
3. Implement: `timeMaintenancePhase(phase, run, { now, emit })` in `src/conductor/src/engine/maintenance-phase-timer.ts`. It emits one `daemon_maintenance_phase` event when run resolves (outcome completed, or the outcome run returns, such as skipped-unchanged) or throws (outcome failed, after which it rethrows). `durationMs` is the clock delta to settlement.
4. Verify GREEN, commit.

**Done when:**
- [test] `timeMaintenancePhase` emits exactly one `daemon_maintenance_phase` event with outcome completed and `durationMs` equal to the injected clock delta when run resolves.
- [test] When run throws after the clock advanced 40 ms, `timeMaintenancePhase` emits outcome failed with `durationMs` 40 and rethrows the original error.
- [test] When run resolves to skipped-unchanged, the emitted event's outcome is skipped-unchanged.

**Files likely touched:**
- `src/conductor/src/engine/maintenance-phase-timer.ts` — new helper
- `src/conductor/test/engine/maintenance-phase-timer.test.ts` — tests

**Dependencies:** Task 1

### Task 3: Single-flight background maintenance job
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/daemon-maintenance-job.test.ts` with fake steps backed by deferred promises.
2. Verify RED.
3. Implement: a `MaintenanceJob` in `src/conductor/src/engine/daemon-maintenance.ts`, following the `refreshJob` / `startRefresh` / `foldRefresh` single-flight pattern in `engine/daemon.ts`. The traits to keep: one promise held by the dispatcher, started without awaiting it, and cleared in finally. It may differ in the steps it runs. The job has an ordered step list. Each step runs inside its own try/catch, and an error is logged as `[daemon] <step> error: <message>` before the next step runs. `trigger()` starts the job when none is running. A trigger that fires while a job is running sets a single `rerunPending` flag, so the job runs once more after it settles; triggers never stack. `settled()` returns the current promise, or a resolved one. `close()` stops any later start.
4. Verify GREEN, commit.

**Done when:**
- [test] Three `trigger()` calls while one job is pending produce exactly one concurrent run of each step fake, then exactly one rerun after the job settles.
- [test] When the second of three step fakes throws, `MaintenanceJob` logs a line naming that step, still runs the third step, and `settled()` resolves without rejecting.
- [test] After `close()`, `trigger()` starts no new run and `settled()` resolves once the in-progress run ends.

**Files likely touched:**
- `src/conductor/src/engine/daemon-maintenance.ts` — `MaintenanceJob`
- `src/conductor/test/engine/daemon-maintenance-job.test.ts` — tests

**Dependencies:** none

### Task 4: Startup claims first, then starts the background job
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/daemon-dispatch-first.test.ts`. Drive `runDaemon` with recording fakes for `renderStartupDashboard`, the rekick, `consumeResumeAuthorizations`, `reconcileHaltPrs`, `reconcileParkedFeatures`, `sweepProviderScratch` and `sweepMergeableLabels`. Also record the gates, `discoverBacklog`, `isHalted`, `isParked`, the stale-engine probe and dispatch. Snapshot the call log at the moment the first dispatch fires.
2. Verify RED.
3. Implement in `src/conductor/src/engine/daemon.ts`:
   - Remove the awaited `renderStartupDashboard` and `maintenance.startup(...)` calls from the pre-loop startup.
   - Run a startup `discoverBacklog({ refresh: true })` once before the loop (Task 5 owns the refresh details).
   - On the first fill pass only, skip the per-pass `consumeResumeAuthorizations` call; later passes keep it.
   - After the first claim attempt, trigger the `MaintenanceJob` from Task 3, whether the attempt dispatched or found nothing eligible.
4. Verify GREEN, commit.

**Done when:**
- [test] When `runDaemon` fires its first dispatch, the call log shows zero calls to `renderStartupDashboard`, the rekick, `consumeResumeAuthorizations`, `reconcileHaltPrs`, `reconcileParkedFeatures`, `sweepProviderScratch` and `sweepMergeableLabels`, at widths 1 and 3.
- [test] The same call log shows the pause, build-auth and gh-version checks, exactly one `discoverBacklog({ refresh: true })`, `pickEligible`'s `isHalted` and `isParked` reads, the stale-engine check, and `guardedDispatchWith`'s `isParked` re-check, all before dispatch.
- [test] For a slug whose shipped record is on the refreshed main, the first `discoverBacklog` result excludes it, and dispatch is never called for it across three fill passes.
- [test] For a slug that becomes operator-parked after `pickEligible` selected it, `guardedDispatchWith`'s `isParked` re-check returns false for it, the log fake records `park: skipped dispatch of <slug> — operator-parked` for it, dispatch is not called, and no worktree-creation fake is called for it.
- [test] A slug with a live HALT and an unconsumed resume authorization is skipped by `pickEligible` on the first pass, and is claimed on a later fill pass only after `consumeResumeAuthorizations` has cleared its marker.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — startup ordering, first-pass consume skip, job trigger
- `src/conductor/test/engine/daemon-dispatch-first.test.ts` — tests

**Dependencies:** Task 3

### Task 5: One startup fetch, reused by rekick and the refresh throttle
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/daemon-dispatch-first.test.ts` with a counting `fastForwardRoot` fake behind `discoverBacklog({ refresh: true })`, and a fake persisted last-seen SHA.
2. Verify RED.
3. Implement:
   - The startup refresh returns its resolved base SHA. `maybeRekick` in `engine/daemon.ts` takes that SHA as current when the background job runs it, instead of calling `resolveBaseSha({ refresh: true })`.
   - Add `DaemonMaintenance.recordRefresh(at)` in `engine/daemon-maintenance.ts` and call it after the startup refresh, so `refreshStartable()` respects the configured minimum interval from that moment.
   - A null persisted SHA seeds without a sweep, unchanged.
4. Verify GREEN, commit.

**Done when:**
- [test] The counting `fastForwardRoot` fake reports exactly 1 call when the first dispatch fires, and still 1 after the background job's rekick settles.
- [test] With persisted SHA A and startup SHA S, the rekick sweep fake receives the advance A to S with no extra fetch; with a null persisted SHA, the SHA is seeded and the rekick sweep fake is not called.
- [test] After `recordRefresh(T)`, `refreshStartable()` is false at any time before T plus the minimum interval, so the first fill pass starts no `startRefresh` job inside that window.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — startup SHA handoff to `maybeRekick`
- `src/conductor/src/engine/daemon-maintenance.ts` — `recordRefresh`
- `src/conductor/test/engine/daemon-dispatch-first.test.ts` — tests

**Dependencies:** Task 4

### Task 6: Startup refresh failure does not block the first claim
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test(s): make the startup `discoverBacklog({ refresh: true })` fake reject once.
2. Verify RED.
3. Implement: catch the startup refresh failure in `engine/daemon.ts` and log it once as `[daemon] startup origin refresh failed: <message>`. Then fall through to the first fill pass, whose `discoverBacklog({ refresh: false })` reads the existing local main.
4. Verify GREEN, commit.

**Done when:**
- [test] When the startup refresh fake rejects, `runDaemon` logs exactly one `startup origin refresh failed` line, and the first fill pass calls `discoverBacklog({ refresh: false })` and dispatches the eligible fixture slug.
- [test] In that run, the call log at the first dispatch contains zero maintenance-step calls.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — refresh failure handling
- `src/conductor/test/engine/daemon-dispatch-first.test.ts` — test

**Dependencies:** Task 5

### Task 7: Job step order, the paused-boot dashboard skip, and triggers at every width
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/daemon-maintenance-job-wiring.test.ts`. It records the step order of the job's first and second runs, and it runs a width-1 busy-pool fixture.
2. Verify RED.
3. Implement in `engine/daemon.ts`:
   - The job's first run is `renderStartupDashboard` (skipped when paused at boot), then `maybeRekick` plus `consumeResumeAuthorizations`, then `reconcileHaltPrs`, `reconcileParkedFeatures`, `sweepProviderScratch` and `sweepMergeableLabels`.
   - Later runs omit the dashboard.
   - Replace the awaited `afterIdlePoll(sweepBestEffort, …)`, `afterBusyPoll(sweepBestEffort)` and `afterTerminalCollection(sweepBestEffort)` calls with `MaintenanceJob.trigger()`.
   - Remove the `busyMaintenanceEnabled()` gate on the busy-poll trigger, so a busy poll at width 1 also triggers the job. The busy path's refresh policy now permits width 1, so an origin refresh may run while one feature is in flight.
4. Verify GREEN, commit.

**Done when:**
- [test] The job's first run calls the step fakes in exactly this order: `renderStartupDashboard`, rekick, `consumeResumeAuthorizations`, `reconcileHaltPrs`, `reconcileParkedFeatures`, `sweepProviderScratch`, `sweepMergeableLabels`; a second run makes no `renderStartupDashboard` call.
- [test] When paused at boot, the job makes zero `renderStartupDashboard` calls but still calls the rekick and all four sweep fakes, and no feature is claimed.
- [test] At width 1, with one feature in flight, a busy poll calls `MaintenanceJob.trigger()` and the job starts. A refresh it triggers calls the `fastForwardRoot` fake while that feature's work order keeps its original pinned base SHA.
- [test] While the job's step fake is pending, the loop does not await it on an idle poll, a busy poll or a terminal collection, and each of those triggers leaves exactly one job running.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — step list, trigger call sites
- `src/conductor/src/engine/daemon-maintenance.ts` — width-1 busy policy
- `src/conductor/test/engine/daemon-maintenance-job-wiring.test.ts` — tests

**Dependencies:** Task 4

### Task 8: Startup dashboard reuses startup discovery and keeps its parked annotations
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing test(s): add `src/conductor/test/engine/daemon-cli-startup-dashboard-wiring.test.ts`, modeled on `test/engine/daemon-cli-parked-reconciliation-wiring.test.ts`, asserting on the `renderStartupDashboard` binding in `daemon-cli.ts`.
2. Verify RED.
3. Implement in `src/conductor/src/daemon-cli.ts`: `scanInheritedState`'s discover callback returns the cached startup discovery result instead of calling `discoverTick`. The informational `reconcileParkedFeatures({ autoCleanup: false, reclaimMergedWorktrees: false })` call stays, so the "merged — ready to reconcile" and "orphan — needs manual review" annotations still render.
4. Verify GREEN, commit.

**Done when:**
- [test] The startup dashboard binding makes zero discovery-fake calls of its own (with `refresh: true` or false), zero `fastForwardRoot` calls, and zero `git fetch` calls on the git-runner fake, and renders its ELIGIBLE group from the cached startup discovery result object passed to it.
- [test] The binding calls the informational `reconcileParkedFeatures` fake exactly once with `autoCleanup: false`, and the rendered dashboard text contains `merged — ready to reconcile` and `orphan — needs manual review` for the matching fixture slugs.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — dashboard discover callback
- `src/conductor/test/engine/daemon-cli-startup-dashboard-wiring.test.ts` — tests

**Dependencies:** Task 5

### Task 9: Workers, drain and shutdown with a job in progress
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/daemon-maintenance-job-wiring.test.ts` with a never-resolving step fake, a worker that completes, a pending stale-engine restart, and a `shouldStop` teardown.
2. Verify RED.
3. Implement in `engine/daemon.ts`:
   - `beginDrain` calls `MaintenanceJob.close()` and awaits `settled()` before the drained-boundary restart action.
   - The stop path calls `close()` and awaits `settled()` before returning, next to the existing `if (refreshJob) await refreshJob`.
   - Worker collection never awaits the job.
4. Verify GREEN, commit.

**Done when:**
- [test] While a never-resolving job step is pending, a worker that completes is collected by `collectOne`, and a second eligible feature is dispatched before the job settles.
- [test] When a job step throws inside `runDaemon`, the daemon log holds a `[daemon] <step> error:` line naming that step, the job's remaining step fakes are still called, and `runDaemon` keeps dispatching: a feature that becomes eligible after the throw is dispatched on the next fill pass.
- [test] With a stale-engine restart pending, the drained-boundary restart callback runs strictly after the pending job's `settled()` resolves, and `trigger()` after `beginDrain` starts no new run.
- [test] With `shouldStop` set while a job is running, `runDaemon` returns only after `settled()` resolves, and no job step runs after that.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — drain and stop integration
- `src/conductor/test/engine/daemon-maintenance-job-wiring.test.ts` — tests

**Dependencies:** Task 7

### Task 10: Halt-PR reconciliation skips in-flight slugs through the delta cache
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/halt-pr-reconciliation.test.ts` with an `isFeatureInFlight` predicate and the existing injected gh runner.
2. Verify RED.
3. Implement:
   - `reconcileHaltPrs` in `src/conductor/src/engine/halt-pr-reconciliation.ts` accepts an `isFeatureInFlight(slug)` context. A marked PR whose slug is in flight is skipped before any `ensureHaltPresentation`, `cleanupHaltPresentation` or `upsertComment` call.
   - The skip is recorded in `haltPrSweepCache` under a distinct in-flight key that is never treated as a conformance outcome. It is logged only when the cached outcome changes.
   - The daemon passes its claims-backed predicate through the binding in `daemon-cli.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] For a marked PR whose slug is in flight, `reconcileHaltPrs` makes zero label, draft and comment calls on the gh-runner fake, logs the in-flight skip on the first sweep and on none of the next two identical sweeps, and `haltPrSweepCache` holds no conformance outcome (conforming or cleared) for that PR.
- [test] After the slug leaves the in-flight set, the next sweep applies today's presentation or clear calls; the cache entry from the in-flight skip did not suppress them.
- [test] When a fixture worker removes the halt marker and label between two sweeps while the slug is in flight, the second sweep makes no label-add call.

**Files likely touched:**
- `src/conductor/src/engine/halt-pr-reconciliation.ts` — in-flight guard
- `src/conductor/src/daemon-cli.ts` — predicate wiring
- `src/conductor/test/engine/halt-pr-reconciliation.test.ts` — tests

**Dependencies:** none

### Task 11: Every mutating step reads the live in-flight set
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing test(s): in `src/conductor/test/engine/daemon-maintenance-job-wiring.test.ts`, claim a slug between the job's `reconcileHaltPrs` step and its `reconcileParkedFeatures` step. Also add a parked fixture and a mergeable-watch fixture for in-flight slugs.
2. Verify RED.
3. Implement: the job builds `DaemonSweepContext.isFeatureInFlight` as a closure over the live `WorkClaims` (`claims.list()` at call time), never a snapshot taken at job start. The parked sweep keeps its `retainedReason: 'in-flight'` path. `sweepMergeableLabels` queues no repair and removes no worktree for an in-flight slug.
4. Verify GREEN, commit.

**Done when:**
- [test] A slug claimed after the job started, before the parked step ran, is retained by `reconcileParkedFeatures` with reason in-flight, and the worktree-removal fake is not called for it.
- [test] For an in-flight slug, `reconcileParkedFeatures` removes no worktree or branch and `sweepMergeableLabels` queues no repair request and calls no worktree teardown.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — live sweep context
- `src/conductor/test/engine/daemon-maintenance-job-wiring.test.ts` — tests

**Dependencies:** Task 7

### Task 12: Serialized writes to the mergeable watch registry
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/mergeable-watch-lock.test.ts`, with two interleaved read-modify-write callers on a temp project root.
2. Verify RED.
3. Implement: `updateWatch(projectRoot, mutate)` in `src/conductor/src/engine/mergeable-sweep.ts`. It runs `readWatch`, applies mutate, then runs `rewriteWatch` under a per-project in-process promise mutex. The sweep's survivor rewrite and the repair claim and completion updates (Tasks 14 and 15) all write through it, because once repairs run outside the sweep, two writers can race.
4. Verify GREEN, commit.

**Done when:**
- [test] Two concurrent `updateWatch` calls that each increment a different entry's counter both persist, and the final `.daemon/mergeable-watch.jsonl` holds both increments.
- [test] `updateWatch` applies mutations in call order, and a mutate that throws leaves the file byte-identical and releases the mutex for the next caller.

**Files likely touched:**
- `src/conductor/src/engine/mergeable-sweep.ts` — `updateWatch` mutex
- `src/conductor/test/engine/mergeable-watch-lock.test.ts` — tests

**Dependencies:** none

### Task 13: The mergeable sweep queues repair requests and awaits no repair session
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/mergeable-sweep.test.ts` with three failed-check PRs, one conflicting PR, a PR that already has a running repair, a PR at `MAX_CI_FIX_ATTEMPTS`, and a failed CI-fix preflight.
2. Verify RED.
3. Implement:
   - Add a `RepairRequest { kind: 'ci-fix' | 'autoresolve'; prUrl; slug?; prCreatedAt; queuedAt }` type (`prCreatedAt` from the merge-state read the sweep already makes) and a `RepairQueue` (enqueue, dedup per `prUrl`, list, take) in `src/conductor/src/engine/repair-queue.ts`.
   - `sweepMergeableLabels` replaces both one-per-tick dispatch blocks with an enqueue of every eligible candidate. The existing `isEligible` checks stay, including the attempt cap and CONFLICTING precedence. It does not bump `ciFixAttempts` or `resolveAttempts`, and it never calls `ciFix.dispatch` or `autoresolve.dispatch`.
   - A PR whose `prUrl` is already queued or running is skipped with one log line and no counter change.
   - When the CI-fix startup preflight failed, the `ciFix` options are absent, as they are today, so no CI-fix request is queued.
4. Verify GREEN, commit.

**Done when:**
- [test] With three failed-check PRs and one conflicting PR, `sweepMergeableLabels` leaves four entries in `RepairQueue` (three ci-fix, one autoresolve), and the `ciFix.dispatch` and `autoresolve.dispatch` fakes are called zero times.
- [test] A PR with a running or already-queued repair gets no second request, and its `ciFixAttempts` and `resolveAttempts` are unchanged in the rewritten registry.
- [test] A PR whose `ciFixAttempts` equals `MAX_CI_FIX_ATTEMPTS` is not queued, and the existing exhaustion escalation fake is called as today.
- [test] With the CI-fix preflight failed, a failing-check PR produces zero ci-fix requests in `RepairQueue`, and the preflight failure log line is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/repair-queue.ts` — queue type
- `src/conductor/src/engine/mergeable-sweep.ts` — enqueue instead of dispatch
- `src/conductor/test/engine/mergeable-sweep.test.ts` — tests

**Dependencies:** Task 12

### Task 14: The dispatcher gives free slots to repairs before features
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/daemon-pooled-repairs.test.ts`, with a fake `RepairQueue`, a fake repair runner, the priority resolver and `runDaemon` at widths 1 and 2.
2. Verify RED.
3. Implement in `engine/daemon.ts`:
   - At each fill pass, after the gates and before `pickEligible`, take repair requests from `RepairQueue` while slots are free.
   - Order requests by the existing `priorityResolver` band of the request's feature slug (an unresolvable slug ranks lowest), then by earliest `prCreatedAt` (oldest PR first).
   - Each started repair claims a reserved `WorkClaims` key `repair:<prUrl>`, which counts toward concurrency through `claims.list()`.
   - It runs as a pooled worker promise collected by `collectOne`. The claim is released in finally, whatever the outcome or error.
   - The run goes through an injected `runRepair(request)` dep that `daemon-cli.ts` binds to the existing `createDaemonCiFixDispatch` and autoresolve dispatch adapters.
4. Verify GREEN, commit.

**Done when:**
- [test] With two free slots, two queued repairs and three eligible features, the fill pass starts both repairs through the `runRepair` fake and claims no feature on that pass.
- [test] Queued repairs whose slugs resolve to priority bands P2 and P0, plus an unresolved slug, start in the order P0, P2, unresolved; repairs in the same band start in earliest `prCreatedAt` order (oldest PR first), regardless of `queuedAt`.
- [test] While a repair runs, `claims.list()` contains `repair:<prUrl>`, and `inFlight.size` counts it against concurrency; after it resolves, rejects or throws, the key is gone and the error is logged, and after a throw the next fill pass starts the next queued repair in that freed slot.
- [test] When the only running repair finishes, nothing is queued, and a feature is eligible, the next fill pass claims that feature.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — repair fill step and pooled worker
- `src/conductor/src/daemon-cli.ts` — `runRepair` binding to the existing adapters
- `src/conductor/test/engine/daemon-pooled-repairs.test.ts` — tests

**Dependencies:** Task 13

### Task 15: Claim-time attempt bump, eligibility re-read and in-flight exclusion
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/daemon-pooled-repairs.test.ts` and `test/daemon-cli-ci-fix-wiring.test.ts`.
2. Verify RED.
3. Implement the `runRepair` binding in `daemon-cli.ts`, in this order, before any git work:
   - Re-read the PR through the existing `readPullRequestMergeState`. Drop the request with a log line when the PR is MERGED, CLOSED, draft, or has a green rollup (CI-fix), or is no longer CONFLICTING (autoresolve).
   - Refuse when the request's feature slug is in flight as a feature build.
   - Increment `ciFixAttempts` and stamp `lastCiFixAt` (or `resolveAttempts`) through `updateWatch` from Task 12, then call the adapter. Completion outcomes rewrite the entry through `updateWatch` exactly as the old inline path did.
4. Verify GREEN, commit.

**Done when:**
- [test] A claimed CI-fix repair persists `ciFixAttempts + 1` and `lastCiFixAt` to `.daemon/mergeable-watch.jsonl` through `updateWatch` before the adapter fake is first called; a process stop injected between the write and the adapter call leaves the incremented count on disk.
- [test] A request that is queued and then lost to a daemon restart, or held by pause, leaves `ciFixAttempts` and `resolveAttempts` unchanged on disk.
- [test] When the re-read state is MERGED, CLOSED, draft, or green, the request is dropped, the adapter fake is called zero times, and no counter changes.
- [test] When the request's feature slug is in `WorkClaims` as a feature build, the repair is not started and the request stays queued.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — `runRepair` binding
- `src/conductor/test/engine/daemon-pooled-repairs.test.ts` — tests
- `src/conductor/test/daemon-cli-ci-fix-wiring.test.ts` — tests

**Dependencies:** Task 14

### Task 16: Pause and rate-limit gates block repair claims; repairs keep today's pipeline
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/daemon-pooled-repairs.test.ts` with pause and an active rate-limit episode. Add a wiring test showing that `runRepair` reaches `runCiFix` through `withResolveWorktree` and the existing acceptance guards, suite gate and lease push, and that an autoresolve request reaches the mergeable sweep's sanctioned resolver call site with the sweep-only test-only judgement flag.
2. Verify RED.
3. Implement: the repair fill step sits behind the same `!paused && !episodeActive && !buildAuthMissing && !ghVersionBlocked` guard as feature selection in `engine/daemon.ts`. An already-running repair is never cancelled. The `runRepair` binding passes autoresolve requests through the sweep call-site entry of the resolver, unchanged.
4. Verify GREEN, commit.

**Done when:**
- [test] While paused, with a queued repair and a free slot, the repair claim count stays 0. A repair started before the pause runs to completion, and the queued one starts on the first fill pass after the pause lifts.
- [test] While `rateLimitEpisode.active()` is true, with a queued repair and a free slot, the repair claim count stays 0 until the episode ends.
- [test] A pooled CI-fix repair reaches the `runCiFix` fake inside `withResolveWorktree` created from the PR branch tip SHA, the acceptance-guard fake and the suite-gate fake are each called once, and on success the lease-protected push fake is called once.
- [test] When the suite-gate fake fails, the lease-push fake is called zero times and the recorded outcome matches the inline path's outcome for the same fixture.
- [test] A pooled autoresolve repair calls the resolver through the sweep call-site entry with the sweep-only test-only judgement enabled.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — gate placement
- `src/conductor/src/daemon-cli.ts` — adapter call-site entry
- `src/conductor/test/engine/daemon-pooled-repairs.test.ts` — tests

**Dependencies:** Task 15

### Task 17: Parked reconciliation input fingerprint with a 10-minute bound
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing test(s): extend `src/conductor/test/engine/park-reconciliation.test.ts` with a counting merge-base fake, a counting gh issue-state fake, an injected clock, and fixtures that change one input at a time.
2. Verify RED.
3. Implement in `src/conductor/src/engine/park-reconciliation.ts`:
   - After its existing prefetch, `reconcileParkedFeatures` computes `fingerprintParkedInputs()`: a hash of the `git worktree list` output, the for-each-ref output (which includes the origin/main SHA), the `.daemon/parked` marker names and contents, each candidate worktree's HALT marker presence, the shipped-record listing, and the sorted in-flight slug set.
   - The fingerprint and the last full-pass time and summary are held in a module-closure memo created per daemon process by the `daemon-cli.ts` binding. Nothing is written to disk.
   - When the fingerprint equals the memo and less than 600 000 ms has passed on the injected clock, the per-candidate loop is skipped. The function returns skipped-unchanged with the memo's summary counts.
   - The first call in a process always runs the full pass.
   - The daemon-log summary line goes through the existing `sweepSummarySignatures` suppression.
   - Destructive steps keep their own ancestry re-verification.
4. Verify GREEN, commit.

**Done when:**
- [test] The first `reconcileParkedFeatures` call in a fresh memo makes per-candidate merge-base calls. An unchanged second call 9 minutes later makes 0 merge-base calls and 0 calls of any kind to the gh-runner fake, and returns skipped-unchanged.
- [test] A second call makes the full per-candidate merge-base count when, separately, the origin/main SHA, a park marker, a HALT marker, the shipped listing, the worktree list, or the in-flight set changed, or when 10 minutes have passed.
- [test] A skipped call returns the prior full pass's summary counts, including refusal counts, the `daemon_maintenance_phase` event the binding emits for it carries those same counts in summary, and no repeat summary line is written to the daemon log.
- [test] In a full pass that removes a merged worktree, the destructive helper's ancestry re-check fake is called for that slug. A new memo, as after a restart, runs the full pass, and a filesystem write spy records zero writes made by the fingerprint memo.

**Files likely touched:**
- `src/conductor/src/engine/park-reconciliation.ts` — fingerprint and skip
- `src/conductor/src/daemon-cli.ts` — per-process memo binding
- `src/conductor/test/engine/park-reconciliation.test.ts` — tests

**Dependencies:** Task 2

### Task 18: Emit phase events for every startup and maintenance phase
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing test(s): `src/conductor/test/daemon-maintenance-phase-events.test.ts`. It runs the daemon with the real daemon ConductorEventEmitter, `startDaemonEventPersistence` on a temp project root, and fake steps, then reads back `.daemon/events.jsonl`.
2. Verify RED.
3. Implement:
   - In `engine/daemon.ts`, wrap the startup refresh, each job step and each pooled repair in `timeMaintenancePhase` from Task 2, with phases startup-refresh, startup-dashboard, rekick, halt-pr-reconcile, parked-reconcile, provider-scratch, mergeable-sweep and repair.
   - Emit first-claim with `durationMs` measured from the `scanning backlog` start to the first claim attempt.
   - A repair event carries `prUrl` and, when known, slug.
   - When a fill pass holds a queued repair back because of pause or a rate-limit episode, emit a repair event with outcome deferred, once per request per blocking episode.
   - The parked step forwards skipped-unchanged from Task 17.
   - Inject the emitter through a new optional `emitMaintenancePhase` dep that `daemon-cli.ts` binds to events.emit.
4. Verify GREEN, commit.

**Done when:**
- [test] After one daemon start and a single job run, `.daemon/events.jsonl` holds one first-claim event, whose `durationMs` equals the injected clock delta from scan start to the first claim attempt, and one event each for startup-refresh, startup-dashboard, rekick, halt-pr-reconcile, parked-reconcile, provider-scratch and mergeable-sweep, each with a numeric `durationMs` and an outcome.
- [test] A pooled repair writes one repair event carrying phase repair, its `prUrl`, the feature slug when the fixture resolves one, a numeric `durationMs` equal to the injected clock delta of the run, and outcome completed.
- [test] A throwing job step writes outcome failed with `durationMs` covering the time until the throw, an unchanged parked run writes outcome skipped-unchanged, and a repair held back by pause writes outcome deferred.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — phase wrapping and the first-claim timer
- `src/conductor/src/daemon-cli.ts` — emitter binding
- `src/conductor/test/daemon-maintenance-phase-events.test.ts` — integration test

**Dependencies:** Tasks 2, 9, 14, 17

### Task 19: Width-1 feature ordering parity and slot bound
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing test(s): `src/conductor/test/engine/daemon-width-one-parity.test.ts`. It runs a width-1 backlog of four features in a known priority order, with no repairs, and compares the claimed-slug sequence and the gate log lines against a fixture recorded from the pre-change daemon. A second case adds a queued repair while a feature runs.
2. Verify RED, for the repair-ordering case.
3. Implement: no new production code is expected beyond Tasks 4–16. Fix any ordering or log drift the parity test exposes in `engine/daemon.ts`.
4. Verify GREEN, commit.

**Done when:**
- [test] At width 1 with no repairs, the claimed-slug sequence and the gate log lines (pause, build-auth, gh-version) equal the recorded pre-change fixture for the same backlog.
- [test] At width 1, with a feature running and a repair queued, the repair starts on the fill pass after the feature finishes and before the next feature, and `claims.list()` never holds more than one entry during the run, including while the background job runs.

**Files likely touched:**
- `src/conductor/test/engine/daemon-width-one-parity.test.ts` — parity test and fixture
- `src/conductor/src/engine/daemon.ts` — drift fixes only if needed

**Dependencies:** Tasks 7, 16

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-R1: daemon.ts: make the busy-poll maintenance path start the single-flight origin refresh (startRefresh, subject to refreshStartable) at width 1; add a daemon-maintenance-job-wiring test where, with one feature in flight, the busy poll triggers the job, the fastForwardRoot fake is called, and the in-flight work order keeps its pinned base SHA
**Gate:** prd-audit
**Rationale:** Task 7 Step 3 already requires that a width-1 busy-poll trigger may run an origin refresh while a feature is in flight. The code fires the trigger, but no job step starts a refresh: rekick uses refresh:false, and startRefresh is reachable only from the free-slot branch. This is implementation drift within an approved task plus a missing done-when test. No architectural decision is needed.
**Criterion:** S3.3
**Parent task:** 7
**Done when:**
- [test] S3.3 is satisfied by this task.
- The repair for task rem-prd-audit-R1 is committed and its targeted tests pass.

### Task rem-prd-audit-R1-2: daemon.ts: make the busy-poll maintenance path start the single-flight origin refresh at width 1, with a test asserting fastForwardRoot is called while the in-flight work order keeps its pinned base SHA
**Gate:** prd-audit
**Rationale:** This is the same defect as S3.3: the width-1 busy refresh is not connected. Task 7 admits the fix and R1 covers it. No new decision is needed.
**Parent task:** 7
**Governing clause:** Task 7
**Done when:**
- Task 7 is satisfied by this task.
- The repair for task rem-prd-audit-R1-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R2: mergeable-sweep.ts / daemon-cli.ts: skip enqueue for any request whose slug the live isFeatureInFlight / isWorkClaimActive predicate reports in flight, covering both ci-fix and autoresolve; add a test that an in-flight slug with a failing-check PR leaves RepairQueue empty and calls no worktree teardown
**Gate:** prd-audit
**Rationale:** Task 11 Step 3 requires that sweepMergeableLabels queue no repair for an in-flight slug. The CI-fix eligibility binding in daemon-cli.ts takes no in-flight predicate, so a CI-fix request is queued for an in-flight slug. Only autoresolve receives isWorkClaimActive. This is a conforming implementation fix plus the missing done-when test.
**Criterion:** S4.5
**Parent task:** 11
**Done when:**
- [test] S4.5 is satisfied by this task.
- The repair for task rem-prd-audit-R2 is committed and its targeted tests pass.

### Task rem-prd-audit-R3: daemon-cli.ts: supply repairPriority to runDaemon, bound to the existing priorityResolver band lookup for the request slug; add a daemon-cli wiring test proving production deps pass a resolver that ranks a P0 slug's repair before a P2 slug's repair
**Gate:** prd-audit
**Rationale:** Task 14 Step 3 requires repairs to be ordered by the existing priorityResolver band. The engine consumes the optional repairPriority dep, but runDaemonMode never supplies it. Wiring the existing resolver in daemon-cli.ts is conforming production wiring that a test must pin.
**Criterion:** S5.3
**Parent task:** 14
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-R3 is committed and its targeted tests pass.

### Task rem-prd-audit-R3-2: daemon-cli.ts: wire repairPriority to the existing priorityResolver, with a production-wiring test
**Gate:** prd-audit
**Rationale:** This is the same unwired repairPriority defect as S5.3, and ADR decision 5 already mandates band ordering. Task 14 admits the fix and R3 covers it.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 5
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 5 is satisfied by this task.
- The repair for task rem-prd-audit-R3-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R4: daemon.ts startNextRepair: skip, and leave queued, any request whose slug is claimed as a feature build before takeByUrl/startRepair, so no repair:<url> claim, worker, merge-state read or phase event occurs; add a multi-pass test at width 2 asserting the runner is called zero times across three fill passes while the feature runs, and that the repair starts after the feature finishes
**Gate:** prd-audit
**Rationale:** Task 15 requires that a repair whose feature slug is in flight is not started and stays queued. Today the check runs inside the worker after the pool claim. A claim/requeue loop then repeats every fill pass with a GitHub read and a completed phase event each time. Moving the exclusion before takeByUrl/startRepair is within Task 15's contract.
**Criterion:** S5.7
**Parent task:** 15
**Done when:**
- [test] S5.7 is satisfied by this task.
- The repair for task rem-prd-audit-R4 is committed and its targeted tests pass.

### Task rem-as-built-R5: mergeable-sweep.ts / daemon-cli.ts: make the claim-time attempt persistence for both ci-fix and autoresolve fail closed (propagate the updateWatch/rewriteWatch failure and do not call the adapter); add tests where an injected persistence failure results in zero adapter calls for each repair kind
**Gate:** as-built
**Rationale:** Task 15 Step 3 orders the attempt bump through updateWatch before the adapter call. The autoresolve claim path uses rewriteWatch, which swallows persistence failures, so an adapter can run with no durable attempt count. This is a conforming fix within Task 15.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 5
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 5 is satisfied by this task.
- The repair for task rem-as-built-R5 is committed and its targeted tests pass.

### Task rem-prd-audit-R6: daemon-width-one-parity.test.ts / daemon-serial-equivalence.test.ts: restore exact toEqual comparison of the width-1 run against the recorded pre-change fixture (RECORDED_N1_TRACE), including the claimed-slug sequence and the pause, build-auth and gh-version gate log lines; fix any ordering or log drift in daemon.ts the comparison exposes
**Gate:** prd-audit
**Rationale:** Task 19's done-when requires comparison with a recorded pre-change fixture covering the claimed-slug sequence and the pause, build-auth and gh-version gate log lines. The tests were weakened to ordering checks. Restoring the fixture comparison is test work within Task 19 and preserves its coverage.
**Criterion:** S9.1
**Parent task:** 19
**Done when:**
- [test] S9.1 is satisfied by this task.
- The repair for task rem-prd-audit-R6 is committed and its targeted tests pass.

### Task rem-as-built-R7: daemon.ts / daemon-cli.ts: make the startup refresh (recordRefresh) also seed the refreshEngineSource fresh throttle so the first stale-engine check does not fetch again; extend the Task 5 counting-fastForwardRoot test to the armed self-host path, asserting exactly 1 call at first dispatch
**Gate:** as-built
**Rationale:** ADR decision 2 and Task 5 require one startup fetch, with recordRefresh seeding the refresh throttle. refreshEngineSource keeps its own independent throttle, so armed self-host startup calls fastForwardRoot twice. Making the startup refresh seed that throttle conforms to the approved design.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 2
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 2 is satisfied by this task.
- The repair for task rem-as-built-R7 is committed and its targeted tests pass.

### Task rem-as-built-R8: daemon.ts: decouple the per-fill-pass consumeResumeAuthorizations from the job's in-flight promise (no awaiting the job's shared promise; errors caught and logged); add a test where a never-resolving job consume step does not block a later fill pass from dispatching, and a rejecting step does not reject runDaemon
**Gate:** as-built
**Rationale:** ADR decision 3 and Tasks 7 and 9 require that the loop never await the background job. The per-pass consumeResumeAuthorizations returns the job's shared pending promise. A slow step therefore blocks dispatch and collection, and a rejection can escape runDaemon. This is a conforming implementation fix.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 3
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 3 is satisfied by this task.
- The repair for task rem-as-built-R8 is committed and its targeted tests pass.

### Task rem-as-built-R9: daemon.ts: route every restart/rebuild/relink/engine-refresh boundary (predispatch stale-engine refresh/rebuild/restart, queued refresh, relink, restart, bare restart consumption, stale restart) through MaintenanceJob.close() + await settled() before acting; add tests asserting each restart callback runs strictly after a pending job's settled() resolves
**Gate:** as-built
**Rationale:** ADR decision 3 and Task 9 require that restart actions run only after the job is closed and settled. Several restart and refresh boundaries skip that settlement: the predispatch stale-engine path, the queued refresh/relink/restart paths, bare restart consumption and stale restart. Applying the existing close+settled step at those boundaries conforms to the design.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 3
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 3 is satisfied by this task.
- The repair for task rem-as-built-R9 is committed and its targeted tests pass.

### Task rem-as-built-R10: daemon.ts: call MaintenanceJob.close() as soon as the loop exits on shouldStop, before draining workers via collectOne, then await settled(); add a test where a worker completing during shutdown triggers no new job run
**Gate:** as-built
**Rationale:** Task 9 requires that the stop path close the job, and that no job step runs after shouldStop. The job is closed only after draining workers, and collectOne completion paths can trigger new maintenance runs before that. Moving close() before shutdown collection is within Task 9.
**Parent task:** 9
**Governing clause:** Task 9
**Done when:**
- Task 9 is satisfied by this task.
- The repair for task rem-as-built-R10 is committed and its targeted tests pass.

### Task rem-as-built-R11: repair-queue.ts: remove the unused RepairQueue.has and RepairQueue.take methods, and migrate the tests that use them to list()/takeByUrl() so the dedup and queue-content assertions are kept
**Gate:** as-built
**Rationale:** Task 13 defines RepairQueue with enqueue, dedup, list and take. Production uses takeByUrl and list, so has() and the unordered take() are dead public surface. Removing them, and moving tests onto the production methods, keeps Task 13's coverage of dedup and queue contents.
**Parent task:** 13
**Governing clause:** Task 13
**Done when:**
- Task 13 is satisfied by this task.
- The repair for task rem-as-built-R11 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-r9b-predispatch-settle: daemon.ts rebuildAndMaybeRestartForStaleEngine: replace the unconditional close() at :1508-1510 with a non-terminal await maintenanceJob.settled() before refresh/rebuild. Call close()+settled() only immediately before deps.requestRestart, so the fresh, suppressed, unavailable and unfired returns at :1539/:1550/:1554/:1557 leave the job open. Add tests: after a fresh/no-restart predispatch check, a later collectOne/idle trigger still runs the maintenance steps. A restart still runs strictly after a pending pass settles.
**Gate:** prd-audit
**Rationale:** Verified (100%): daemon.ts:1508-1510 permanently closes the MaintenanceJob on every armed predispatch boundary. daemon-maintenance.ts close() sets closed=true and trigger() then returns early, so a fresh-engine result leaves maintenance dead for the rest of the process. This is an implementation defect in rem-as-built-R9 under approved ADR decision 3, and no architectural decision is needed. The fix keeps settlement non-terminal until a restart is actually requested. Test coverage gains the fresh/no-restart path.
**Criterion:** S3.2
**Parent task:** rem-as-built-R9
**Done when:**
- [test] S3.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-r9b-predispatch-settle is committed and its targeted tests pass.

### Task rem-as-built-rem-r9b-idle-stale-restart: daemon.ts natural-idle stale restart (~:1933): call maintenanceJob.close() and await maintenanceJob.settled() immediately before deps.requestRestart, matching :1792/:1845. Add a test asserting requestRestart runs strictly after a pending job's settled() resolves on the natural-idle stale path.
**Gate:** as-built
**Rationale:** Verified (99%): daemon.ts:1933 calls deps.requestRestart on the natural-idle stale path with no close/settle. The other boundaries at :1792 and :1845 already do this. The finding is a missed sibling site of rem-as-built-R9, and the change is mechanical BUILD work.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 3
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 3 is satisfied by this task.
- The repair for task rem-as-built-rem-r9b-idle-stale-restart is committed and its targeted tests pass.

### Task rem-as-built-rem-r9b-drain-no-await: daemon.ts beginDrain (~:1430): keep maintenanceJob.close() but remove await maintenanceJob.settled(), leaving settlement to the drained action boundary (:1768 and the restart/relink sites). Add a test: with a never-resolving maintenance step and an active worker, a drain request still lets the busy observer collect the finished worker, and the drained action awaits settlement.
**Gate:** as-built
**Rationale:** Verified (99%): beginDrain awaits maintenanceJob.settled() at daemon.ts:1430-1431, and the busy observer awaits beginDrain before collecting workers. Pending maintenance therefore blocks collection, which violates ADR decision 3's dispatch-first intent. The fix is narrow code placement: close at drain start, settle at the drained action boundary, which :1768 already handles.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 3
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 3 is satisfied by this task.
- The repair for task rem-as-built-rem-r9b-drain-no-await is committed and its targeted tests pass.

### Task rem-as-built-rem-r9b-fold-no-await-tail: daemon.ts reconciliation tail (~:1215/:1239) and foldRefresh (~:1289): keep reconciliations serialized with each other, but foldRefresh must not await a pending background reconciliation. Either chain the fold's reconciliation onto the tail without awaiting it from the fill pass, or skip/coalesce when one is in flight, and catch rejections. Add a test: with a never-resolving background rekick pending, a fill pass that folds a refreshed backlog still dispatches and collects.
**Gate:** as-built
**Rationale:** Inferred (95%) from the cited lines: commit 1a750770c8 serialized rekick reconciliation on a shared tail that foldRefresh awaits, so foreground fill passes wait on background maintenance again. ADR decision 3 already says background maintenance must not block dispatch or collection, so this is conforming implementation work and needs no ADR change.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 3
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 3 is satisfied by this task.
- The repair for task rem-as-built-rem-r9b-fold-no-await-tail is committed and its targeted tests pass.

### Task rem-as-built-rem-d5-durable-claim-write: mergeable-sweep.ts: make updateWatch persist through a throwing write, either a strict rewriteWatch variant or a flag, so a claim-write failure propagates instead of returning a successful result. Keep the C3 swallow only for existing best-effort callers. In daemon-cli.ts repair claim (~:1230-1254), treat a thrown or failed claim write as not claimed and never invoke either adapter. Add tests: with writeFile failing, updateWatch rejects, and neither repair adapter is called.
**Gate:** as-built
**Rationale:** Verified (100%): rewriteWatch (mergeable-sweep.ts:288-297) swallows write errors, and updateWatch then returns mutation.result as a successful claim. Repair adapters (daemon-cli.ts ~:1251/:1254) can therefore run without durable attempt accounting, which violates ADR decision 5. The prior remediation was marked done but did not land. The fix is code-level.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 5
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 5 is satisfied by this task.
- The repair for task rem-as-built-rem-d5-durable-claim-write is committed and its targeted tests pass.

### Task rem-prd-audit-rem-r4b-skip-inflight-repair: daemon.ts startNextRepair (~:1084): iterate the sorted repair queue and skip, leaving queued, any request whose slug is in flight as a feature build. Start the first eligible repair before falling through to feature claims, with no takeByUrl, repair claim, merge-state read or phase event for skipped entries. Add tests in daemon-pooled-repairs.test.ts: (a) width 2, feature A in flight, repairs A(P0) and B(P2) queued: B's repair takes the free slot ahead of a new feature; (b) width 2, only A's repair queued: the runner is called zero times across three fill passes while A runs, then the repair starts after A finishes.
**Gate:** prd-audit
**Rationale:** Verified (100%): daemon.ts:1084 returns undefined when the head repair's slug is in flight, so every other queued repair is skipped and the slot falls through to feature claims. This is a defect in rem-prd-audit-R4's implementation, and the required width-2 multi-pass test is missing. Both are BUILD work.
**Criterion:** S5.7
**Parent task:** rem-prd-audit-R4
**Done when:**
- [test] S5.7 is satisfied by this task.
- The repair for task rem-prd-audit-rem-r4b-skip-inflight-repair is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-rem-r9c-unfired-restart-reopen: daemon-maintenance.ts / daemon.ts: add MaintenanceJob.reopen(), which clears the closed flag without starting a run. At the predispatch stale restart (rebuildAndMaybeRestartForStaleEngine, ~:1559) and the natural-idle stale restart (~:1938), keep close()+await settled() immediately before deps.requestRestart. When result.fired is false, call reopen() unless shouldStop or a drain is active, leaving the drain and stop closes terminal. Add tests to daemon-maintenance-job-wiring.test.ts: (a) predispatch path with requestRestart resolving {fired:false}, then a later collectOne/idle trigger still runs the maintenance step fakes and dispatch continues; (b) same for the natural-idle stale path; (c) with {fired:true}, requestRestart still runs strictly after a pending pass's settled() resolves; (d) a unit test that reopen() after close() lets trigger() start a run, and that trigger() after a drain-initiated close still starts nothing
**Gate:** as-built
**Rationale:** Verified (99%, read daemon.ts:1556-1561, :1937-1949 and daemon-maintenance.ts close()/trigger()). Both restart sites call maintenanceJob.close() then await settled() before deps.requestRestart. When the result is fired:false, the loop keeps dispatching or idle-polling, but MaintenanceJob.closed stays true forever, so every later trigger() no-ops. ADR decision 3 and the existing settle-before-restart tasks (Task 9, rem-prd-audit-rem-r9b-predispatch-settle, rem-as-built-rem-r9b-idle-stale-restart) already require recurring maintenance whenever no restart occurs. This is conforming implementation drift with no architectural decision needed, so it routes to BUILD. Fix: keep close()+settled() immediately before requestRestart so settlement still precedes the restart. When result.fired is false (relink failure at daemon-cli.ts:803, no restart marker), reopen the job through a new MaintenanceJob.reopen() that clears `closed` only when no stop or drain is in force, so normal triggers resume. Leave beginDrain and shouldStop closes terminal. Coverage from Task 9 and the r9b tests stays in place.
**Governing clause:** adr-2026-10-14-dispatch-first-daemon-maintenance decision 3
**Done when:**
- adr-2026-10-14-dispatch-first-daemon-maintenance decision 3 is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-rem-r9c-unfired-restart-reopen is committed and its targeted tests pass.
