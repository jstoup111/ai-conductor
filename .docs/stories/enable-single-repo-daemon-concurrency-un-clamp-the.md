**Status:** Accepted

# Stories: Enable single-repo daemon concurrency (dispatcher/executor seam + un-clamp)

Technical track — acceptance criteria derive from issue jstoup111/ai-conductor#568's desired
outcomes and `adr-2026-08-27-daemon-dispatcher-executor-seam` (D1–D8), under the conditions of
`architecture-review-2026-08-27-enable-single-repo-daemon-concurrency-un-clamp-the` (C1–C6).

## Story 1: Operator-configured worker count replaces the unconditional clamp

As an operator, I want daemon concurrency gated by an explicit config key so that I can opt a
repo into N concurrent builds without patching code.

### Acceptance Criteria

#### Happy Path
- Given `daemon_concurrency: 2` in the repo's config and no `--concurrency` flag, when the daemon starts, then the pool's effective concurrency is 2 and the startup log line reports the resolved value and its source.
- Given `daemon_concurrency: 2` in config and `--concurrency 3` passed explicitly, when the daemon starts, then the effective concurrency is 3 (explicit flag wins over config).
- Given no config key and no flag, when the daemon starts, then the effective concurrency is 1.
- Given two independent eligible features and effective concurrency 2, when the daemon dispatches, then both features are claimed and progress concurrently within one daemon process.

#### Negative Paths
- Given `daemon_concurrency: 0` (or a negative or non-integer value), when config is validated, then validation rejects it with a message naming the key and the accepted range, and the daemon does not start with a silently clamped value.
- Given `daemon_concurrency` present but unregistered in the config-key consumer registry, when the registry exhaustiveness test runs, then the test fails naming the key (adr-2026-08-26 D4).
- Given a supervised daemon launched via tmux with no flag, when it reads config, then the config key alone raises concurrency (the tmux launch path passes no flag today, so config is the only operator lever there).

### Done When
- [ ] `daemon_concurrency` is a typed, validated, registry-declared config key with a `resolve*` helper defaulting to 1, and `clampDaemonConcurrency`'s unconditional clamp is gone from the daemon start path.
- [ ] A daemon integration test proves two features in flight simultaneously at effective concurrency 2.
- [ ] `docs/reference/configuration.md`, `docs/reference/cli.md`, and `docs/guides/running-the-daemon.md` document the key, the flag precedence, and the removed serial limitation in the same diff.

## Story 2: Concurrency 1 is byte-for-byte today's serial daemon

As an operator, I want the default to preserve current behavior exactly so that repos that never
opt in are untouched.

### Acceptance Criteria

#### Happy Path
- Given effective concurrency 1, when the daemon runs a backlog of features, then dispatch order, gate evaluation points (refresh, sweeps, stale-engine, restart), and log output shape match the pre-change daemon.
- Given the existing daemon test corpus, when it runs against the refactored daemon at concurrency 1, then it passes without semantic edits (mechanical renames allowed).

#### Negative Paths
- Given effective concurrency 1 and one feature in flight, when a stale engine is detected or a restart is queued, then it fires only after that feature finishes — exactly the pre-change idle-boundary timing.
- Given effective concurrency 1, when discovery would refresh mid-build, then no fetch or root fast-forward occurs while the single feature is in flight (pre-change quiescent behavior preserved at the default).

### Done When
- [ ] The full existing daemon test suite passes at the default without semantic changes.
- [ ] A serial-equivalence test pins the N=1 scheduling order of dispatch, refresh, sweep, and stale-engine checks.

## Story 3: Dispatch crosses the seam as a serializable work order with a document manifest

As a harness maintainer, I want the dispatcher→executor contract to be a plain serializable
struct so that a future cloud dispatcher can supply work without sharing process state.

### Acceptance Criteria

#### Happy Path
- Given an eligible feature, when the dispatcher builds its work order, then the order contains repo identity, feature slug, pinned base SHA, and a manifest of the spec's governing documents as refs plus content hashes, and the whole order survives JSON round-tripping without loss.
- Given a work order, when the executor materializes its workspace, then the worktree is cut from the order's pinned base SHA and the manifest's documents resolve to content matching their recorded hashes.

#### Negative Paths
- Given a manifest entry whose resolved content no longer matches its recorded hash, when the executor validates the order, then the dispatch fails closed for that feature with an error naming the mismatched document, and no build starts.
- Given a work order referencing a base SHA absent from the local repository, when the executor materializes the workspace, then the dispatch fails closed with an error naming the missing SHA rather than silently falling back to the branch tip.
- Given the executor runs a build, when any code on the executor path resolves feature run-state or artifacts, then it does so from the workspace and the work order, never from a persisted manifest file acting as artifact-resolution authority (adr-2026-07-28 D3 preserved).

### Done When
- [ ] A WorkOrder type with manifest entries (ref + content hash) exists, is JSON-serializable, and is the only argument the executor dispatch receives for feature identity and base.
- [ ] A test proves worktree materialization from a pinned SHA that is behind the current `origin/<base>` tip.
- [ ] A test proves hash-mismatch and missing-SHA orders are refused before any build side effect.

## Story 4: Work claims formalize the single dispatch authority

As a harness maintainer, I want claim/release to be the one dedup authority so that no feature
is ever double-dispatched and no second authority appears beside the existing gates.

### Acceptance Criteria

#### Happy Path
- Given two open slots and one eligible feature, when the fill loop runs twice, then the feature is claimed once, the second pass observes the claim, and exactly one executor runs it.
- Given a finished executor, when its result is collected, then the claim is released and the feature's terminal handling (processed marker, park, halt) proceeds exactly as today.

#### Negative Paths
- Given a feature with an operator park marker, when the dispatcher's claim path evaluates it, then the same `isOperatorParked` predicate consulted by every existing dispatch path refuses the claim before any build-start side effect (adr-2026-07-13 D2), and the entry-point enumeration test covers the claim path.
- Given a feature already claimed by a running executor, when a halt-clear wake or re-kick sweep makes it look eligible, then `pickEligible`'s existing gates plus the claim registry refuse a second dispatch (adr-2026-07-04-event-driven-halt-clear-wake D3 — no second authority).
- Given the daemon restarts mid-build, when it comes back up, then in-memory claims are gone by design and the backlog re-derives work from durable state without duplicate or lost features (in-flight worktrees resume via the existing re-dispatch path).

### Done When
- [ ] `started`/`inFlight` set semantics live behind a WorkClaims interface with an in-memory implementation and no durable lease (adr-2026-07-22-heartbeat-lease-deferred respected).
- [ ] The park entry-point enumeration test enumerates and passes the dispatcher claim path.
- [ ] A concurrency test proves no double dispatch under repeated fill/collect cycles at N=3 with a churning backlog.

## Story 5: Concurrent workers never corrupt each other's state or the main checkout

As an operator, I want N builds isolated so that one feature's run-state, park markers, and git
state are untouched by its neighbors.

### Acceptance Criteria

#### Happy Path
- Given two features building concurrently, when both complete, then each worktree's `.pipeline/` (task-status, evidence sidecar, events.jsonl) contains only its own feature's records and the root checkout's tracked and untracked state is unchanged by either build.
- Given two features building concurrently, when one auto-parks, then its park marker lands in the main checkout's `.daemon/parked/<its-slug>` and the other feature's dispatch state is unaffected.

#### Negative Paths
- Given two executors running, when one halts with a HALT marker, then the marker is written only under its own worktree's `.pipeline/` and the sibling build continues to completion.
- Given worktree lifecycle operations for two slugs racing (add/remove), when they execute, then the dispatcher serializes them against the shared `.git` so neither fails with a lock error nor prunes the other's half-registered worktree.
- Given a provider scratch sweep at a dispatch boundary, when other executors are live, then their leased scratch directories are not reclaimed (owner lease respected at N>1).
- Given any worktree-removal predicate (shipped-record reap, resolution-worktree lifecycle), when it evaluates a slug with an active work claim, then the claim registry answers "genuinely active" and the removal is refused with a logged reason.

### Done When
- [ ] An N=2 integration test asserts per-worktree `.pipeline/` disjointness, root-checkout invariance, and correct park-marker placement.
- [ ] Worktree add/remove for different slugs is serialized through one dispatcher-owned queue with a test provoking the former race.

## Story 6: Shared maintenance runs instead of starving at N>1

As an operator, I want discovery, fast-forward, and sweeps to keep running while workers are
busy so that a busy pool still picks up newly merged specs.

### Acceptance Criteria

#### Happy Path
- Given one executor busy and one slot free, when a spec merges to origin, then a refresh (fetch + root fast-forward) occurs within the poll interval, discovery finds the new spec, and the free slot dispatches it while the first build continues undisturbed.
- Given all slots busy, when the sweep timer elapses, then `sweepBestEffort` runs, skipping in-flight slugs via its existing `isFeatureInFlight` predicate.
- Given a root fast-forward while executors are busy, when in-flight builds continue, then their worktrees and pinned bases are untouched, and the setup-once marker's base check for those features still compares against their orders' pinned SHAs (no spurious full setup re-runs).
- Given a self-host executor whose containment is unproven has an open fingerprint window, when a root mutation (fetch/fast-forward, rebuild, relink) becomes due, then the mutation is deferred until no unproven-containment window is open (windows close between provider dispatches, so deferral does not require a full drain), and the deferral is logged with its reason.

#### Negative Paths
- Given the root checkout is not on the default branch, when fast-forward is attempted, then it refuses exactly as today and logs the reason.
- Given the main checkout is dirty with edits attributable to multiple in-flight feature branches, when the leak triage's all-or-nothing heal cannot pick a single candidate, then fast-forward refuses and logs the full dirty-entry list loudly (no silent stall).
- Given a rate-limit episode is active, when slots are free, then the dispatcher claims no new work while in-flight executors continue (adr-2026-07-05 D2), and resume is jittered.
- Given the base advanced while a halted (not in-flight) feature waits, when `rekickSweep` runs, then the halted feature re-kicks per the existing per-SHA bound, and no in-flight feature is rebased or re-kicked by the advance.

### Done When
- [ ] A test proves a newly merged spec dispatches into a free slot while another build is in flight.
- [ ] A test proves a mid-run fetch/fast-forward does not re-trigger setup or alter state for pinned in-flight features.
- [ ] The multi-branch leak refusal path emits a distinct, greppable log line listing dirty entries.

## Story 7: Engine staleness and queued restarts drain, then act

As an operator, I want stale-engine recovery and queued restarts to still happen at N>1 without
ever interrupting a running build.

### Acceptance Criteria

#### Happy Path
- Given a stale engine detected with two executors running, when the dispatcher enters drain (claims stop), then both builds finish normally, and the rebuild + restart fires exactly once at the drained boundary.
- Given a durable RESTART-PENDING marker and a busy pool, when executors finish, then the queued restart fires at the drained boundary with the existing marker-consume → lock-release → exit ordering.
- Given a restart is queued while draining, when the operator checks daemon status, then the pending restart and the full set of features it is waiting on (the drain set) are visible.

#### Negative Paths
- Given work in flight, when staleness is probed, then no rebuild, relink, or restart touches the root checkout before the pool is drained (work-in-flight suppression).
- Given a stale-engine trigger that fails to fire, when the drained boundary is reached again later, then the retry follows the existing log-and-stay-alive path with the one-shot-per-firing bound intact (no restart loop).
- Given a drain in progress, when a new high-priority feature merges, then it is not claimed until after the restart completes, and the post-restart daemon picks it up (drain is strict, not best-effort).
- Given a rate-limit episode is active at the drained boundary, when a queued or stale-engine restart would fire, then it is deferred until the episode ends (the episode gate composes with drain — a restart mid-episode would respawn a daemon with no episode memory).
- Given SIGTERM arrives while N executors are draining, when the bounded force-release timeout is evaluated, then the bound scales with the number of in-flight executors (per-executor allowance), so a routine N-worker drain does not force-release the lock while builds still run.
- Given the daemon is paused, when slots are free, then the pause predicate gates the claim loop (no new claims) while in-flight executors run to completion.

### Done When
- [ ] Drain mode exists as an explicit dispatcher state observable in the daemon log with a slug-free `[daemon]` line naming the reason.
- [ ] Tests cover: restart deferred while busy, fired exactly once when drained, suppression on trigger failure, and pause-gates-claims.

## Story 8: Self-host live boundary stays sound under interleaved dispatches

As an operator of the self-hosting repo, I want N>1 self-host builds to keep the fail-closed
boundary without cross-feature false halts.

### Acceptance Criteria

#### Happy Path
- Given two self-host executors with overlapping provider-dispatch windows, when each verifies its boundary, then neither halts on the other's excluded-path writes and both runs complete.
- Given a dispatcher-attributed root mutation (fast-forward, rebuild, relink) while a proven-contained fingerprint window is open, when the window verifies, then the mutation is recognized as dispatcher-attributed (serialized or re-baselined) and does not halt the executor's run.
- Given an executor whose containment is unproven, when the dispatcher schedules root mutations, then it never mutates the root while that executor's fingerprint window is open — the fail-closed semantics of unproven containment are preserved by deferral, not by attribution.

#### Negative Paths
- Given an unattributed write to the live root checkout (e.g. an operator edit outside excluded paths with containment unproven), when any open window verifies, then that run still halts fail-closed naming the drifted path — attribution machinery never converts real drift into a pass.
- Given provider-state drift (live provider home changed), when a window verifies, then the halt remains unconditional for the affected run exactly as today (no containment escape for provider state).
- Given the fingerprint surface, when this feature's diff is inspected, then no path is added to the exclusion list (adr-2026-08-17 D4).

### Done When
- [ ] An N=2 self-host integration test (faked provider) proves no cross-executor false halt and preserved fail-closed behavior for injected unattributed drift.
- [ ] Dispatcher root mutations and open windows are coordinated through one owner (coordinator), with tests for mutation-during-window and window-during-mutation orderings.

## Story 9: Interleaved output stays attributable to its feature

As an operator triaging a busy daemon, I want every log line and persisted event attributable so
that halt/ship triage stays readable at N>1.

### Acceptance Criteria

#### Happy Path
- Given two executors running, when they emit build progress, then every feature-owned line in `.daemon/daemon.log` carries its `[slug]` tag and every persisted event lands in its own worktree's `events.jsonl`.
- Given an engine warning surfaces via the process-level `console.warn`/`console.error` tee during a build, when it is written to the daemon log, then it carries the owning feature's slug tag stamped centrally (not threaded through call sites).

#### Negative Paths
- Given a genuinely daemon-global message (sweep error, drain announcement), when it is logged, then it carries the bare `[daemon]` prefix and no feature tag (no false attribution).
- Given interleaved lifecycle transitions from two features, when the transition-suppression logic runs, then suppression stays per-slug (one feature's repeated status does not suppress the other's).

### Done When
- [ ] The warn/error tee and the global bus subscriber attribute feature-owned output at N=2 in a test with two interleaved fake builds.
- [ ] Any new dispatcher/executor event types declare render/persist/audit sinks in the exhaustive registry.

## Story 10: The legacy env-mutating dispatch path refuses concurrency

As a harness maintainer, I want the one remaining process-global env mutation fenced so that
N>1 can never race on `process.env`.

### Acceptance Criteria

#### Happy Path
- Given the modern `providerExecution` path, when N=2 builds run, then no code mutates process-global provider env vars (per-invocation env only).

#### Negative Paths
- Given a dispatch that would take the legacy no-`providerExecution` branch (which mutates `CLAUDE_CONFIG_DIR` process-globally), when effective concurrency is greater than 1, then that dispatch is refused fail-closed with a logged reason naming the branch and the concurrency conflict, and the feature is not silently built serially.
- Given effective concurrency 1, when the legacy branch is taken, then behavior is unchanged (restore-in-finally preserved).

### Done When
- [ ] A guard at the legacy branch refuses N>1 with a distinct, greppable error, covered by a test.
- [ ] A test asserts the modern path performs no `process.env` provider mutations during dispatch.
