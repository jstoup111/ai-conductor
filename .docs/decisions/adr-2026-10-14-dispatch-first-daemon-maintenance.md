# ADR: Dispatch-first daemon maintenance with pooled repairs

**Date:** 2026-10-14
**Status:** APPROVED
**Deciders:** Operator (composer session for jstoup111/ai-conductor#1174)

## Context

On 2026-10-15 at 00:45 UTC, the daemon (`daemon_concurrency: 3`) took 11.3 s from `scanning
backlog` to the first `▶ start`. The startup sequence in `engine/daemon.ts` awaits every step in
order before the loop can claim anything:

1. `renderStartupDashboard`: a fetch, a fast-forward, a full discovery, and a second
   informational-only `reconcileParkedFeatures`.
2. `maintenance.startup`: `maybeRekick(true)` fetches and fast-forwards again, then
   `consumeResumeAuthorizations` runs.
3. `sweepBestEffort`: `reconcileHaltPrs`, `reconcileParkedFeatures`, `sweepProviderScratch`, and
   `sweepMergeableLabels`.

The mergeable-label sweep awaits a whole CI-fix or autoresolve provider session inline, so startup
latency has no upper bound. Discovery by itself measures 2.2–3.3 s (`pollDurationMs` in
`.daemon/events.jsonl`). None of the reconcilers emits a duration.

Dispatch correctness depends on four things, all on the claim path:

- discovery's processed, shipped-record, and parked dedup;
- `pickEligible`'s halted and parked checks;
- the park re-check inside `guardedDispatch`;
- the pause, build-auth, and gh-version gates.

Every other startup step is documented as best-effort, never-throw, or informational.

`adr-2026-08-27-daemon-dispatcher-executor-seam` D5 already lets periodic sweeps run whatever the
pool occupancy. D7 pins width 1 to byte-for-byte serial behavior. The operator chose to apply this
change at every width. They also chose that open-PR repairs ship before new features start.

## Options Considered

### Option A: Dispatch first, maintenance in a background job, repairs as pooled work (chosen)
- **Pros:** Takes all best-effort work and every provider repair session off the first-claim
  path. Latency stops growing with the number of retained worktrees. Repairs share the
  `daemon_concurrency` budget instead of running hidden inside a sweep.
- **Cons:** Maintenance now overlaps live workers at width 1 as well. Every mutating reconciler
  needs an in-flight guard, and seam ADR D5/D7 and the CI-feedback bounded-dispatch clause must be
  amended.

### Option B: Keep it serial, make each step faster
- **Pros:** No new overlap between maintenance and workers.
- **Cons:** Inline repair sessions still block dispatch, cost stays linear in the number of
  worktrees, and the measured figures leave the target out of reach.

### Option C: Time-budgeted foreground sweep with resumable cursors
- **Pros:** A hard latency bound.
- **Cons:** Needs a cursor in every reconciler, which is the comprehensive scope the operator
  declined. Partial sweeps are hard to reason about for safety.

## Decision

Option A, at every daemon width.

1. **The first claim comes before best-effort maintenance.** From scan start to the first claim,
   the daemon runs only: the pause, build-auth, and gh-version gates; one startup origin refresh;
   discovery; `pickEligible`; the existing throttled stale-engine check; and `guardedDispatch`.
   The dispatch-safety checks inside those steps are unchanged. Rekick, resume-authorization consumption, the startup dashboard, halt-PR
   reconciliation, parked reconciliation, the provider-scratch sweep, and the mergeable-label
   sweep do not run on this path.
2. **Startup fetches once.** The startup origin refresh is the only fetch and fast-forward before
   the first claim. Its resolved base SHA seeds the rekick's base-advance detection. The startup
   dashboard reuses that discovery result and does no fetch or fast-forward of its own. It keeps
   its informational parked classification (auto-cleanup off), which produces the "merged — ready
   to reconcile" and "orphan — needs manual review" annotations. The rate-limit interval for later
   refreshes starts at that refresh.
3. **Best-effort maintenance runs as one single-flight background job.** On its first run the
   job renders the startup dashboard. The dashboard is skipped when the daemon is paused at boot,
   as today. The job then runs rekick and resume consumption, so the dashboard still shows the
   HALTs inherited on restart. After that it runs the halt-PR, parked, provider-scratch, and
   mergeable-label sweeps in today's order. At every width, including 1, the origin refresh and
   fast-forward may run while features are in flight; the pinned work-order base of seam ADR D4
   makes this safe. Each step keeps its never-throw
   contract. The job starts after the first claim attempt at startup. After that it runs on the
   existing triggers: idle poll, busy poll (at every width), and terminal collection. At most one
   instance runs at a time, and a trigger that fires while it is running is merged into it. The
   dispatch loop never awaits it. The job never runs a stale-engine rebuild, a restart, or a
   queued restart; those stay drain-then-act, and the drained boundary also waits for the job to
   settle. Like the origin refresh, the job is excluded from the drain.

   > **Amended 2026-10-15 by #2392:** In a self-host daemon with the stale-engine gates armed,
   > the job now also runs the fetch, fast-forward and engine rebuild on the
   > `engine_refresh_min_interval_seconds` interval while features are in flight. Child
   > executors are pinned per dispatch, so a rebuild never changes a running build's engine.
   > Restarts and queued restarts still never run in the job. Once a supervisor restart is pending
   > at a natural idle or a drained boundary, the job is not started again, and the restart waits
   > for any running instance to settle. See adr-2026-10-15-per-dispatch-engine-pinned-executor
   > D7 and D8.
4. **Mutating maintenance skips in-flight slugs.** `reconcileHaltPrs` gains the
   `isFeatureInFlight` guard that the parked and mergeable sweeps already have, so a live worker's
   own halt-state clear always wins. The skip goes through the existing delta-only log cache: it
   is logged once per transition and never recorded as a conformance outcome. Rekick and resume consumption keep their current
   operator-park and processed skips, and `pickEligible` stays the only dispatch authority.
5. **CI-fix and autoresolve are pooled repairs, and repairs come before new features.** The
   mergeable-label sweep no longer awaits a repair session. It hands each eligible repair to the
   dispatcher as a repair request. The dispatcher fills free slots with pending repairs before any
   new feature claim. Repairs are ordered by their feature's existing priority band, then by
   oldest pull request. Each running repair holds a reserved `WorkClaims` entry keyed by its pull
   request, which counts toward `daemon_concurrency`. The per-sweep limit of one dispatch is
   removed: a sweep may queue as many repairs as are eligible. Per-pull-request rules still hold:
   - at most one repair runs per pull request at a time;
   - no repair runs for a feature slug that is in flight;
   - `ciFixAttempts` is bumped when the repair is claimed, before git work, never when it is
     queued, so a request deferred by pause, a rate-limit episode, or a restart consumes no
     attempt;
   - eligibility is re-read at claim, and a request whose pull request has merged, closed, become
     draft, or turned green is dropped without running;
   - `MAX_CI_FIX_ATTEMPTS` and the autoresolve cap still bound attempts;
   - the isolated resolve worktree, acceptance guards, suite gate, and lease-protected push are
     unchanged.

   The CI-fix startup preflight must pass before any CI-fix repair request is accepted. Pause and
   the rate-limit episode block repair claims in the same way they block feature claims. Repairs
   run dispatcher-side through the existing `CiFixRunner` and autoresolve adapters. They are not
   executor work orders, so seam ADR D1 and D2 are unchanged. A pooled autoresolve repair counts
   as the mergeable sweep's sanctioned call site in
   `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`, not as a third one. It keeps that
   site's sweep-only test-only judgement (D1 and D1.1 there).
6. **Parked reconciliation skips unchanged inputs for up to 10 minutes.** The first parked
   reconcile in each daemon process is always complete. Later ones compute an in-process
   fingerprint and skip per-candidate work when it is unchanged and the last complete run was
   less than 10 minutes ago. The fingerprint covers the registered worktree list, the branch refs
   including the `origin/main` SHA, the `.daemon/parked` markers, the worktree HALT markers, the
   shipped-record listing, and the in-flight slug set. The fingerprint is never written to disk.
   A skipped run emits a `daemon_maintenance_phase` event carrying the last complete run's
   summary counts, refusals included, so a refusal is never mistaken for a healthy idle sweep. The
   daemon-log summary line stays under the existing outcome-cache suppression. Destructive steps still re-verify ancestry for
   themselves.
7. **Phase durations ride the existing event spine.** A new `ConductorEvent` variant,
   `daemon_maintenance_phase`, carries:
   - `phase`: one of `startup-refresh`, `first-claim`, `rekick`, `startup-dashboard`,
     `halt-pr-reconcile`, `parked-reconcile`, `provider-scratch`, `mergeable-sweep`, or `repair`;
   - `durationMs`;
   - `outcome`: one of `completed`, `skipped-unchanged`, `failed`, or `deferred`;
   - an optional `slug` or pull-request reference for a `repair`.

   `first-claim` measures the time from scan start to the first claim attempt. Its `EVENT_SINKS`
   entry is persist true, render false, audit false, and otel false. It is written to
   `.daemon/events.jsonl` by the existing daemon persister. No OpenTelemetry instrument is added.
8. **What width 1 still guarantees.** At width 1, feature claim ordering, gate evaluation, and
   their log output are unchanged from today. The differences at width 1 are where maintenance
   runs (decisions 1 and 3) and repairs occupying the single slot ahead of a new feature
   (decision 5).

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Deferring resume-authorization consumption only delays a resume and never dispatches a halted feature, because pickEligible skips live HALT markers (engine/daemon.ts pickEligible isHalted) and the loop already re-consumes on every fill pass | verified | 90% | yes | A halted feature could be dispatched early | n/a |
| A2 | One startup origin refresh before discovery is enough for shipped-record dedup to see merges that landed while the daemon was down | inferred | 85% | yes | A feature already shipped on origin could be dispatched once | APPROVED by operator 2026-10-14 |
| A3 | Halt-PR presentation is idempotent and additive (adr-2026-07-05-halt-pr-presentation-reliability D4), so running it beside workers is safe once in-flight slugs are skipped | verified | 90% | yes | A sweep could re-apply a halt label that a live worker just cleared | n/a |
| A4 | Repairs already run beside feature builds at width above 1 through afterBusyPoll, so resolve worktrees and the live boundary tolerate the overlap | verified | 85% | yes | Repairs could trip live-boundary halts in feature builds | n/a |
| A5 | GitHub issue state is the only parked-reconcile input outside the fingerprint, and a 10-minute full-run bound is acceptable staleness for it | inferred | 80% | yes | A closed intake issue's park would be unparked up to 10 minutes late | APPROVED by operator 2026-10-14 |
| A6 | Pause should stop new repair claims as well as new feature claims, a change from today, where a paused daemon still runs CI-fix sessions inside its sweeps | unverified | 70% | yes | A paused daemon would keep spending provider time on repairs, or repairs would stop when the operator expected them to continue | APPROVED by operator 2026-10-14 |

## Consequences

### Positive
- The first claim no longer waits on reconciliation or repair sessions. Its latency is bounded by
  one refresh plus one discovery.
- Repairs ship ahead of new features and are bounded by `daemon_concurrency`. The bound is now
  visible instead of hidden inside a sweep.
- Every maintenance phase reports a duration, so regressions show up on the event spine.

### Negative
- At width 1, a repair can delay the next feature by a whole provider session.
- Maintenance now overlaps workers at every width. A future mutating reconciler that leaves out
  the in-flight guard can race a live build.
- A parked reconcile can act up to 10 minutes late on GitHub issue-state changes.

### Follow-up Actions
- [ ] Discovery speed (2.2–3.3 s) goes to a follow-up intake; it is outside this feature's scope.
- [ ] Amendment notes beside `adr-2026-08-27-daemon-dispatcher-executor-seam` D5 and D7,
      `adr-2026-07-07-ship-ci-feedback-loop` decision 3, and the one-resolution-per-tick
      consequence of `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`.
