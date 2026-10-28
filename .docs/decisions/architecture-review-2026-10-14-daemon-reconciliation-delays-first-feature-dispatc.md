# Architecture Review: Daemon reconciliation delays first feature dispatch

**Date:** 2026-10-14
**Mode:** Lightweight (Medium tier): technical feasibility and architectural alignment
**Inputs reviewed:**
- `.docs/track/daemon-reconciliation-delays-first-feature-dispatc.md` (technical track, Balanced scope)
- `.docs/complexity/daemon-reconciliation-delays-first-feature-dispatc.md`
- `.docs/architecture/daemon-reconciliation-delays-first-feature-dispatc.md` (approved)
- jstoup111/ai-conductor#1174

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | TypeScript changes inside `src/conductor/src/engine` only. No new package, service, or infrastructure. |
| Prerequisites | None. `DaemonMaintenance`, `WorkClaims`, the `refreshJob` single-flight pattern, and the `isFeatureInFlight` predicate already exist (`engine/daemon.ts`, `engine/daemon-maintenance.ts`, `engine/work-claims.ts`). |
| Integration surface | One subsystem: the daemon dispatcher and the maintenance adapters wired in `daemon-cli.ts`. The only external calls are the existing `gh`/git calls; no new network call is added. |
| Data implications | No schema or durable state. The parked fingerprint is in-process. A new `ConductorEvent` variant appends to the existing `.daemon/events.jsonl`. |
| Performance risk | Removes work from the foreground path. Fingerprint inputs are 3 git calls already prefetched by the parked reconciler (`git worktree list`, `for-each-ref`, `ls-tree`), replacing the per-candidate `merge-base` checks (~0.45 s each, measured). |
| Worktree isolation | Repairs keep their isolated resolve worktrees (`withResolveWorktree`). Repairs already run beside feature builds at width above 1 via `afterBusyPoll` (verified, 85%), so the live boundary already tolerates the overlap. |

Measured baseline (live log, 2026-10-15 00:45 UTC, width 3): 11.3 s from scan start to first claim.
This was made up of:
- 3.4 s for the dashboard's fetch plus discovery;
- 0.5 s for the halt-PR `gh` list;
- 3.6 s for parked reconciliation;
- about 2.9 s for loop discovery.

Discovery by itself takes 2.2–3.3 s (`pollDurationMs`). The operator restated the latency target
accordingly (track file). Two further facts are verified:
- the startup fetch runs twice, once in the dashboard's `discoverTick({refresh:true})` and once in
  `maybeRekick(true)`;
- `sweepMergeableLabels` awaits a full CI-fix or autoresolve session inline.

## Alignment

Governing ADRs checked; only APPROVED ones count.

- **Conflict, resolved by amendment:** `adr-2026-08-27-daemon-dispatcher-executor-seam` D7 pins
  width 1 to byte-for-byte serial behavior. The operator chose dispatch-first at every width.
  The amendment narrows D7's guarantee to feature claim ordering, gates, and their log output.
  D5's periodic-sweep clause is amended to say the sweep is an off-loop single-flight job.
- **Changed by amendment:** `adr-2026-07-07-ship-ci-feedback-loop` decision 3 set at most one
  dispatch per tick with a shared serial guard. The operator chose uncapped repairs per sweep,
  with priority over new features. `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`'s
  one-per-tick consequence is noted the same way. Its two-call-site rule is preserved: a pooled
  autoresolve repair *is* the sweep call site.
- **Compatible, conditions carried into the new ADR's decisions:**
  - `adr-2026-07-27-ancestry-proven-park-reconciliation` D1/D3 and
    `adr-2026-08-01-multi-proof-park-deletion-authority` D3/D4: the fingerprint skip never
    replaces destructive-step ancestry re-verification, and skipped runs re-emit refusal counts.
  - `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main`: the fingerprint
    includes the `origin/main` SHA and the shipped listing.
  - `adr-2026-07-05-halt-pr-presentation-reliability` D4 and
    `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`: halt-PR reconciliation gains
    the in-flight guard.
  - `adr-015-daemon-pr-labeling-sweep`: triggers stay startup, after-feature, and per-tick, with
    no new timer thread.
  - Stale-engine and restart ADRs: they stay drain-then-act, and the drain waits for the
    maintenance job.
  - `adr-2026-07-13-park-all-dispatch-paths`: the `guardedDispatch` park re-check is unchanged.
  - `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification`: the preflight must pass
    before CI-fix repairs are accepted.
  - `adr-2026-07-04-durable-pause-marker` D2: a paused daemon still sweeps. The new rule is that
    pause blocks repair *claims*, which is operator-approved assumption A6.
  - `adr-2026-07-26-event-sink-registry-exhaustiveness`: the new variant declares its sinks.
- **Event spine:** durations extend the `ConductorEvent` union. No sidecar file or ad-hoc log is
  added, which satisfies `.agents/skills/event-spine` steps 1–3.
- **Pattern basis:** the background job follows the existing `refreshJob` / `startRefresh` /
  `foldRefresh` single-flight pattern in `engine/daemon.ts`. That pattern is a promise held by
  the dispatcher, started without being awaited, folded on the next pass, and woken through
  `wakeBusyPoll`. It may vary in what it runs, but must keep its single-flight and never-awaited
  traits. Repair slot reservation reuses `WorkClaims` (`engine/work-claims.ts`, `claim` /
  `release` / `list`) as width accounting; it must not become a second dispatch authority.
- **Diagram accuracy:** the architecture file has been revised to show repair priority and
  uncapped queuing.

## Wiring Surface

| New production surface | Production caller (design-time) |
|---|---|
| Background maintenance job (single-flight) | Started by `runDaemon` in `engine/daemon.ts` after the first claim attempt, and from the existing idle, busy, and terminal-collection triggers in place of the awaited `sweepBestEffort`. |
| Startup refresh reuse (seeded base SHA) | `maybeRekick` and `renderStartupDashboard` wiring in `daemon-cli.ts` consume the startup refresh result instead of refreshing again. |
| Halt-PR in-flight guard | `reconcileHaltPrs` binding in `daemon-cli.ts`, which receives `isFeatureInFlight` from the job's sweep context. |
| Repair request queue and pooled repair claim | Filled by `sweepMergeableLabels` (`engine/mergeable-sweep.ts`). Drained by the dispatcher's fill-pool step in `engine/daemon.ts` ahead of `pickEligible`, which runs the existing `CiFixRunner` and autoresolve adapters wired in `daemon-cli.ts`. |
| Parked input fingerprint | Inside `reconcileParkedFeatures` (`engine/park-reconciliation.ts`), called by the job. |
| `daemon_maintenance_phase` event | Emitted on the daemon-wide `ConductorEventEmitter` in `daemon-cli.ts`. Persisted by `startDaemonEventPersistence` through its `EVENT_SINKS` declaration (`engine/event-sinks.ts`). |

Early overlap scan: `ai-conductor overlap-scan` over these paths is advisory and is reported
alongside this review.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A mutating reconciler races a live worker on the same slug now that maintenance overlaps builds at width 1 | Data | Medium | High | ADR D4: every mutating sweep consults `isFeatureInFlight`. Stories require a test per reconciler that an in-flight slug is untouched. |
| A feature shipped on origin while the daemon was down is dispatched once | Data | Low | High | ADR D2: the startup refresh stays before discovery (A2). |
| The fingerprint misses an input and skips a needed reconcile | Data | Low | Medium | The input list is enumerated in ADR D6, with a 10-minute full-run bound and a full first run per process. |
| A repair at width 1 delays the next feature by a whole provider session | Performance | Medium | Medium | Operator-chosen priority. The `repair` phase duration makes the delay visible. |
| The drain boundary (stale-engine restart) waits on a long maintenance job | Performance | Low | Medium | The job runs no provider sessions (repairs are pooled), so it lasts seconds. |

## ADRs Created

- `adr-2026-10-14-dispatch-first-daemon-maintenance` (APPROVED by operator 2026-10-14), which
  amends:
  - `adr-2026-08-27-daemon-dispatcher-executor-seam` D5 and D7;
  - `adr-2026-07-07-ship-ci-feedback-loop` decision 3;
  - the consequence in `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`.

## Conditions

1. Each mutating maintenance step, including halt-PR reconciliation, must have a test proving it
   leaves an in-flight slug untouched.
2. A test must prove the first claim happens with no maintenance step having run.
3. A test must prove the fetch runs exactly once before the first claim.
4. Repairs must keep bump-before-git-work, attempt caps, the resolve worktree, the guards, the
   suite gate, and the lease push. Tests must prove no more than one repair per pull request and
   no repair for an in-flight slug.
5. The plan must carry Architecture Obligation Coverage rows for every decision of the three
   amended ADRs plus the new ADR.
