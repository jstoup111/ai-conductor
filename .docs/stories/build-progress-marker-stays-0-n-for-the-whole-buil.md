**Status:** Accepted

# Stories: Build progress marker increments per completed task (#757)

Track: technical (no PRD — acceptance criteria are defined directly here).
Complexity tier: S — at least one negative path per story, focused on the
highest-risk failure mode.

Approach B: the build-progress read path (`readSnapshot` / `BuildProgressWatcher.tick`)
computes the live `resolved` count from git-derived evidence (the same source the
build gate re-derives from) instead of from `.pipeline/task-status.json`'s stored
`completed`/`skipped` status. This is a display/observability change only — the
conductor's gate remains the sole owner/reconciler of `task-status.json` and its
boundary correctness contract is unchanged.

---

## Story 1: Live counter increments as task commits land during a build session

**Requirement:** #757 (live progress reflects git-derived completion mid-session)

As an operator watching the daemon log, I want the `▶ build X/N` counter to increment
as each task's work is committed during a live build session, so that `X/N` reflects
real progress and I can tell productive work apart from a stall without waiting for
the gate boundary.

### Acceptance Criteria

#### Happy Path
- Given a build session is in progress with a resolvable active plan of N tasks and
  0 tasks git-derived as complete, when the watcher polls, then the emitted
  `build_progress` event carries `resolved: 0` and `total: N`.
- Given that same session, when task commits subsequently land in the worktree such
  that git-derivation (the same source the gate uses) now shows K of N tasks complete
  (0 < K < N), when the watcher next polls, then it emits a `build_progress` event
  with `resolved: K` — without any gate-boundary reconciliation of
  `.pipeline/task-status.json` having run.
- Given git-derivation shows a task is `skipped`, when the watcher polls, then that
  task is counted toward `resolved` (skipped counts as resolved, matching the gate).
- Given the watcher already treats a task-status change / HEAD move / evidence bump as
  a change, when `resolved` advances via git-derivation, then the change-driven
  emission path fires (the counter is not gated behind only the heartbeat interval).

#### Negative Paths
- Given a build session with a resolvable plan, when git-derivation reports **more**
  completed tasks than `total` (or any count > total), then the emitted `resolved`
  is clamped to at most `total` (never overcounts; `X ≤ N` always holds).

### Done When
- [ ] `readSnapshot()` and `BuildProgressWatcher.tick()` compute `resolved` from
      git-derived completion (via `deriveCompletion` against the active plan, or the
      stamped-commit equivalent) rather than from `task-status.json`'s stored status.
- [ ] A test drives a session where commits land mid-session (no gate reconciliation)
      and asserts the emitted `build_progress.resolved` advances 0 → K.
- [ ] A test asserts a `skipped` task is included in `resolved`.
- [ ] A test asserts `resolved ≤ total` even when derivation yields a larger count.

---

## Story 2: Progress read degrades gracefully — the poll hot path never throws

**Requirement:** #757 (preserve the hot-path no-throw contract)

As the daemon, I want the build-progress read to never throw on the polling hot path
even when git-derivation fails or the plan path can't be resolved, so that adding the
live git-derivation cannot crash or silence the watcher.

### Acceptance Criteria

#### Happy Path
- Given the active plan path resolves and git-derivation succeeds, when the watcher
  polls, then `resolved` is the git-derived count and no fallback is used.

#### Negative Paths
- Given the active plan path cannot be resolved (no plan recorded / file missing),
  when the watcher polls, then `readSnapshot`/`tick` does not throw and `resolved`
  falls back to the `task-status.json` completed/skipped count (previous behavior),
  and the tick still completes.
- Given git-derivation throws (corrupt worktree, git failure), when the watcher polls,
  then the error is swallowed on the hot path, `resolved` falls back to the
  `task-status.json` count, and the watcher keeps polling (no crash, no unhandled
  rejection).
- Given `.pipeline/task-status.json` is itself missing/corrupt AND git-derivation is
  unavailable, when the watcher polls, then the tick is treated as "no data" and skips
  emission (existing behavior preserved) rather than emitting a bogus count or throwing.

### Done When
- [ ] A test stubs the plan path as unresolvable and asserts the tick completes,
      does not throw, and emits the `task-status.json`-based fallback count.
- [ ] A test makes git-derivation throw and asserts the tick swallows it, falls back,
      and the watcher continues polling.
- [ ] The `readSnapshot` docstring contract ("callers on the polling hot path must
      never see readSnapshot throw") is preserved and covered by a test.

---

## Story 3: Live git-derived count agrees with the gate at the boundary (no drift)

**Requirement:** #757 (live count must not diverge from authoritative reconciliation)

As an operator, I want the live git-derived `resolved` to match the gate's reconciled
count once the build-gate boundary is reached, so that the mid-session display is a
faithful preview of the authoritative state and never contradicts it.

### Acceptance Criteria

#### Happy Path
- Given a build session reaches a state where the gate boundary reconciles
  `task-status.json` to R completed/skipped tasks, when the watcher polls at or after
  that boundary, then the emitted `resolved` equals R (the live git-derived count and
  the gate-reconciled count agree; no drift).
- Given the whole plan is complete, when the watcher polls, then `resolved == total`
  (the counter reaches N/N and does not exceed it).

#### Negative Paths
- Given git-derivation transiently counts a task as complete that the gate later does
  not reconcile as complete (or vice versa) within one poll interval, when the next
  poll runs, then the emitted `resolved` re-reflects the current git-derived truth
  (the value is recomputed each tick, never latched to a stale higher-water mark that
  would keep the counter falsely high).

### Done When
- [ ] A test asserts the live git-derived `resolved` equals the gate-reconciled
      completed/skipped count for the same git state.
- [ ] A test asserts a fully-complete plan yields `resolved == total`.
- [ ] A test asserts `resolved` is recomputed per tick (not monotonically latched),
      so it can correct downward if git state changes.
