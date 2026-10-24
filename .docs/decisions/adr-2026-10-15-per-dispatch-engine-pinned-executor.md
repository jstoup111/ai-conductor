# ADR: Per-dispatch engine-pinned child executor

**Date:** 2026-10-15
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer DECIDE for jstoup111/ai-conductor#2392

## Context

A rebuilt engine reaches a running daemon's dispatches only after the whole pool drains (#2392).
The feature executor runs in-process (`createInProcessFeatureExecutor`,
`src/conductor/src/engine/feature-executor.ts`), so every feature runs the modules the daemon
loaded at boot. `bin/conduct-ts` resolves the `dist` symlink to one `dist-versions/«id»` when the
process starts (adr-2026-07-04-versioned-engine-store-atomic-flip). The only adoption path is a
supervisor restart. That restart is drain-then-act (adr-2026-08-27-daemon-dispatcher-executor-seam
D5), so it stops claiming until every in-flight feature finishes. On 2026-09-06 the repo produced
six engine builds. With `daemon_concurrency: 3` and a 150-feature backlog, fixes reach dispatches
hours after they merge.

adr-2026-08-27 D1 already places engine rebuild, relink and restarts on the dispatcher side and
declares the executor contract process-separable. But the WorkOrder carries no engine identity
(D2), and the v1 executor shares a lot of in-memory state with the dispatcher:

- the daemon-wide `RateLimitEpisode` and shared `providerAvailability`;
- the self-host `LiveBoundaryCoordinator` window and mutation queue;
- the `WorktreeLifecycleQueue` that serializes shared-`.git` add/remove;
- `ForwardingEventEmitter` re-emission of feature events onto the root bus, read by the per-feature
  daemon.log renderer, the OTel visualizer and the memory sampler;
- shutdown and park signalling through in-memory flags and abort controllers.

The operator required all six #2392 outcomes:

1. a dispatch after a rebuild runs the new engine without waiting for in-flight work;
2. in-flight work finishes on its own engine;
3. a pull-and-rebuild cadence needs no operator action;
4. each feature's engine version is recoverable from its own record;
5. exactly one supervisor generation is live;
6. status shows which features run an older engine.

## Options Considered

### Option A: Child executor pinned per dispatch
- **Pros:** Meets all six outcomes. In-flight isolation comes from process identity, and the
  supervisor keeps its single generation.
- **Cons:** Every shared in-memory service needs a cross-process protocol. The protocol must stay
  correct while the supervisor and its executors run different engine versions.

### Option B: In-process dynamic import of the pinned executor module
- **Pros:** No IPC. Smaller.
- **Cons:** Two engine versions share module singletons, `process.env`, signal handlers and the
  event emitter in one heap. Contract skew between dispatcher and executor fails silently, and memory
  grows with every version loaded.

### Option C: Restart without draining and resume in-flight work on the new engine
- **Cons:** Violates outcome 2. Rejected.

### Option D: Rolling two-generation daemon
- **Cons:** Violates outcome 5 and adr-2026-07-07-single-generation-stale-respawn D1. Rejected.

## Decision

Option A. The operator chose it, along with the supervisor restart policy and a single spec, on
2026-10-15.

### D1 — The executor runs as a child process of the supervisor
Each claimed feature runs in its own child, launched with Node's `child_process.fork` and an IPC
channel. The child runs the whole per-feature path: worktree creation and preparation, setup
triage, `runConductorInWorktree`, teardown and outcome. The supervisor stays a single process and
keeps the claim loop, backlog scan, sweeps, maintenance, terminal effects (already serializable
through `FeatureTerminalEffects`) and every dispatcher-owned shared service (adr-2026-08-27 D1).

The config key `executor_isolation: child | in-process` selects the adapter. It defaults to
`child`. `in-process` keeps today's behavior as an operator rollback lever and is the only mode in
which the per-dispatch pin of D2 does not apply.

> **Amended 2026-10-24 by #3333:** The rollback lever is retired. The child executor is the daemon's only
> feature executor: the in-process adapter and the `executor_isolation` key are removed, and a config
> that still sets the key fails validation as an unknown top-level key. The per-dispatch pin of D2
> applies to every dispatch.

### D2 — The engine version is pinned per dispatch in the WorkOrder
At claim time the dispatcher resolves the floating `dist` symlink to a concrete immutable
`dist-versions/«id»`. It records `engineVersionId` in the WorkOrder beside `baseSha`, along with a
`schemaVersion`, and launches the child from that directory's entrypoint directly, never through
`dist`. A later flip therefore cannot change the engine under a live executor.

If resolution fails (a dangling symlink, or a `.publish-incomplete` sentinel), the dispatch is
pinned to the supervisor's own engine directory and an event records why.

The pin lasts for one dispatch only. A halted or parked feature that is re-dispatched later
resolves the current build again.

### D3 — The WorkOrder and executor protocol are versioned
The child sends a hello message carrying its `EXECUTOR_PROTOCOL_VERSION` and `engineVersionId`
before any work starts. The supervisor accepts the child only when its protocol version is equal to
the supervisor's own. Only then does it send the serialized WorkOrder over the channel.

The supervisor never writes into the feature worktree, which may not exist yet; a pre-created
`.pipeline/` directory would make `git worktree add` refuse. Once the child has created or reused
the worktree through the existing `createWorktree` seam (which still runs `verifyWorkOrder` before creation and cuts from the pinned base), it persists the order to `.pipeline/work-order.json`.

On a mismatch, the supervisor terminates the child before it does any work and relaunches the
dispatch pinned to its own engine directory, which is always compatible. It records the mismatch
as an event. Where the stale-engine gates are armed, it also requests a supervisor restart under
the drain fallback of D7. In a consumer daemon, later dispatches keep running on the supervisor's
build until an operator restart, and status shows it. There is no sticky fallback state: every
dispatch resolves `dist` and handshakes on its own, so a later compatible build is adopted
automatically. A protocol mismatch never blocks dispatch.

### D4 — Shared services are brokered over a typed channel; telemetry stays on the spine
The IPC channel carries two kinds of message.

**Occurrences** are `ConductorEvent`s in the existing union, unchanged:
- The child is the single writer of its feature `.pipeline/events.jsonl`, through its own
  `EventPersister`. Exceptions A and B of the event-spine rule apply: separate process,
  one writer per file.
- The child forwards every event over the channel, tagged with a scope of `feature` or `root`.
- The supervisor re-emits feature events on a per-executor proxy feature bus. The existing
  per-feature daemon.log renderer (slug attribution, adr-2026-08-27 D8), the OTel visualizer and
  the forwarding to the root bus all stay attached to that proxy bus.
- The supervisor emits `feature_dispatch_started` and `feature_dispatch_ended` itself, once per
  dispatch, at launch and at collection, so a crashed child cannot lose or duplicate them. It
  re-emits the child's other root events (`feature_shipped`, `provider_suppressed`) on the root
  bus.
- A variant the supervisor's union does not know is accepted without error. The supervisor
  neither renders nor persists it; the child's own ledger keeps it.
- The per-dispatch OTel visualizer reports the WorkOrder's pinned `engineVersionId` as the trace's
  engine version, not the supervisor's boot build.

**Coordination requests** are request/response calls against the dispatcher-owned services:
- rate-limit episode `enter`, `active` and `clear`;
- provider-availability `suppress` and lookups;
- live-boundary `runDispatch`, `openWindow` and `close`;
- `WorktreeLifecycleQueue` acquire and release;
- shutdown and stop requests;
- the terminal `FeatureExecutionOutcome`.

Methods that are synchronous today (`RateLimitEpisode.enter`, `active` and `nextWaitSeconds`, and `ProviderAvailability.suppress` and `isAvailable`) keep their synchronous signatures in the child. They are served from a local replica, which the supervisor keeps current by broadcasting the authoritative state after every change and after each accepted hello. A child's own `enter` or `suppress` updates its replica at once and is sent to the supervisor. Only methods that are already asynchronous become round-trip requests.

None of this is telemetry. These are ownership calls and state replication the spine cannot carry, and their
only consumer is the supervisor's broker. They duplicate no information on the spine: the
occurrences they cause (for example `provider_suppressed`) are still emitted as events.

Plain feature log lines and tee'd `console.warn`/`console.error` are forwarded as log messages and
rendered through the existing `featureLogFor(slug)` sink.

### D5 — The child's lifecycle is bound to the supervisor
On SIGTERM the supervisor sends a stop request to each child. The child takes today's shutdown
path: it aborts rate-limit waits and sets `conductor.shutdownRequested`. Once the existing scaled
teardown budget expires, the supervisor force-kills the child.

When the IPC channel disconnects (the supervisor died), the child takes the same shutdown path and
exits. The feature resumes on a later dispatch from its persisted `.pipeline/` state, as it does
today after a crash.

When a successor supervisor boots and finds an executor record whose pid is still alive, it
confirms the pid is that recorded executor and terminates it before the slug can be dispatched
again.

Each child inherits the supervisor's V8 heap cap. A child that exhausts it fails alone, as an
`error` outcome, and the supervisor survives. The total ceiling is the configured concurrency
plus one, times the cap. The daemon memory sampler and heap guard keep measuring only the
supervisor process.

Operator park and pause stay file-based and are unchanged.

### D6 — Live executor pins protect their engine version from GC
At launch the supervisor writes `.daemon/executors/«slug».json` with `{pid, engineDir,
engineVersionId, startedAt}`. It removes the record when the child exits. On boot it removes
records whose pid is dead.

`readLiveReferencedVersionIds` reads these records in addition to the pidfile, and keeps the same
fail-closed rule: an unreadable record aborts the GC pass with zero deletions. These records are
durable state (event-spine exception C). They are not an occurrence channel.

### D7 — Supervisor restart: natural idle plus an age-capped drain
This decision applies only where the existing stale-engine gates are armed: continuous mode, a
self-host repository, and `auto_restart_on_stale_engine: true`. Elsewhere no stale-engine restart
happens, as today.

A stale supervisor (its boot engine differs from `dist`) no longer stops claiming on every
rebuild. It restarts through the existing single-generation trigger
(adr-2026-07-07-single-generation-stale-respawn D1) at a natural idle, when no executor is running.

It falls back to today's claim-stop drain only in two cases:
- it has been stale longer than `supervisor_max_stale_hours` (default 24), measured from when the
  supervisor first became stale, not from the latest build;
- a protocol mismatch occurred (D3).

Either restart:
- is deferred while a rate-limit episode is active
  (adr-2026-07-05-daemon-rate-limit-episode-coordinator);
- stops new maintenance-job runs once it is pending, and waits for a running instance to settle
  (adr-2026-10-14-dispatch-first-daemon-maintenance D3).

Operator-queued RESTART-PENDING restarts keep drain-then-act.

### D8 — Cadence rebuild runs while executors are busy (self-host)
In a self-host daemon with the stale-engine gates of D7 armed, the existing fetch, fast-forward and
`rebuildEngine` sequence becomes a
background maintenance job that runs on the `engine_refresh_min_interval_seconds` interval whatever
the pool occupancy, under the single-flight maintenance job of
adr-2026-10-14-dispatch-first-daemon-maintenance. It no longer waits for a quiescent boundary.

Each root mutation, including the `dist` flip that the live boundary fingerprints, runs through the
existing `coordinatedRootMutation` / `LiveBoundaryCoordinator.runMutation`, so it never overlaps an
open fingerprint window (adr-2026-08-27 D6).

Consumer daemons gain no rebuild job. They adopt any rebuild of the shared install at their next
dispatch through D2.

### D9 — The engine version is recorded per feature and shown in status
- The child emits a new `ConductorEvent` variant, `executor_started { slug, engineVersionId,
  protocolVersion, supervisorEngineVersionId }`, into its feature ledger.
- The supervisor adds an optional `engineVersionId` field to the root `feature_dispatch_started`
  event, so the record survives in `.daemon/events.jsonl` after the worktree is removed.
- The shipped-record `engine_version` comes from the executor that ran finish, so it is the
  pinned version.
- `daemon status` lists each live executor from `.daemon/executors/` with its version, and marks
  any whose `engineVersionId` differs from the current `dist` target as older than current.

### D10 — Delivered as one spec with a scope exception
The operator declined the proposed three-spec split on 2026-10-15. The plan carries a
`**Scope-exception:**` that cites this decision.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Node's built-in `child_process.fork` can launch an arbitrary module path (the pinned `dist-versions/«id»` entrypoint) with an IPC channel carrying JSON-serializable messages; no new dependency | inferred | 95% | yes | Mechanism changes (e.g. spawn plus stdio framing); D1/D3/D4 transport only | APPROVED by operator 2026-10-15 |
| A2 | The shared-state inventory (rate-limit episode, providerAvailability, LiveBoundaryCoordinator, WorktreeLifecycleQueue, feature event forwarding, feature logs, shutdown flags, process.env swaps, terminal outcome) is complete for the per-feature path in daemon-cli.ts runConductorInWorktree / beginFeatureRun and daemon-deps.ts makeFeatureRunnerDeps | inferred | 85% | yes | Child mode silently loses a coordination path; mitigated by a full-feature child-mode parity test and the in-process rollback lever | APPROVED by operator 2026-10-15 |
| A3 | The live boundary fingerprints the `dist` symlink target (live-boundary.ts walks with readlink and deliberately ignores .gitignore; only dist-versions is excluded), and rebuildEngine already runs through coordinatedRootMutation (daemon-cli.ts) | verified | 95% | yes | A busy-pool rebuild could halt self-host features as live-checkout drift | n/a |
| A4 | Only the self-host daemon should run the cadence rebuild job; consumer daemons adopt shared-install rebuilds through per-dispatch resolution | inferred | 90% | yes | Consumers would need their own rebuild cadence to satisfy outcome 3 | APPROVED by operator 2026-10-15 |
| A5 | Most engine fixes land in executor-side code (conductor, steps, gates), so supervisor staleness bounded by D7 is acceptable | inferred | 75% | no | Supervisor-side fixes lag up to the age cap | n/a |

> **Amended 2026-10-24 by #3333:** A2's mitigation no longer includes the in-process rollback lever, which
> is removed. Child-mode coverage now rests on the parity test and on daemon tests that run the
> production child path through an injected in-memory fork.

## Consequences

### Positive
- A rebuild reaches the next dispatch within one cadence interval, with no drain and no operator
  action.
- In-flight features finish on the engine they started with; their verdicts and evidence are
  produced by one engine.
- A heap exhaustion in one feature no longer takes down the daemon or the other features.
- The engine version per feature is durable in `.daemon/events.jsonl` and in the shipped-record.

### Negative
- A versioned cross-process protocol must be maintained. Executor-side changes to the protocol
  force a supervisor drain (D3/D7).
- Supervisor-side fixes can lag up to `supervisor_max_stale_hours`.
- Each feature pays a child-process start (module load) per dispatch.
- Two executor adapters (child and in-process) exist until the rollback lever is retired.

  > **Amended 2026-10-24 by #3333:** The rollback lever is retired; only the child adapter remains.

- More engine versions are retained while long-running executors pin older builds.
- Total memory ceiling grows to (concurrency + 1) times the per-process heap cap.

### Follow-up Actions
- [x] Retire `executor_isolation: in-process` once child mode has run a full release cycle without
  a rollback (separate intake).

> **Amended 2026-10-24 by #3333:** Done, ahead of the release-cycle precondition, by operator decision after
> the two paths drifted and halted every child dispatch (fixed by #3331).
