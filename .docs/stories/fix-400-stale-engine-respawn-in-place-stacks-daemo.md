**Status:** Accepted

# Stories: Fix #400 — single-generation stale-engine respawn

Technical track (no PRD). Requirements are the decision points of the APPROVED
`adr-2026-07-07-single-generation-stale-respawn` (TS-1..TS-5 map to ADR Decisions 1–5).
Issue: jstoup111/ai-conductor#400.

> Test-infrastructure constraint (applies to every story): any test that spawns a real
> daemon/tmux process MUST honor the env kill-switch guard for production spawns (global
> vitest setup) and per-worktree isolation conventions; unit tests use injected fakes.

---

## Story: Fired trigger terminates the predecessor

**Requirement:** TS-1 (ADR Decision 1)

As an operator, I want the old daemon process to be provably gone after it hands off to a
successor, so that stale-engine transitions never accumulate concurrent daemons.

### Acceptance Criteria

#### Happy Path
- Given a session-hosted daemon whose stale-engine gates all pass, when `triggerSelfRestart()`
  returns successfully, then the requester releases the pidfile lock and terminates the
  process with an explicit exit code 0 — without relying on `respawn-pane -k` or event-loop
  drain.
- Given the same firing, when the predecessor terminates, then the `RESTART_PENDING` marker it
  wrote beforehand remains on disk for the successor's boot handshake (write-marker-then-exit
  ordering preserved).

#### Negative Paths
- Given a session-hosted daemon, when `triggerSelfRestart()` throws, then the requester logs
  the failure, does NOT release the lock, does NOT exit, and the daemon remains the running
  owner (stay-alive retry contract retained verbatim from #353).
- Given tmux kills the predecessor via `respawn-pane -k` before it reaches its own lock
  release, when the successor boots and reads the pidfile, then the pid is dead (`ESRCH`) and
  the successor acquires via the existing stale-reclaim path — no manual cleanup needed.
- Given a headless (non-session-hosted) daemon with a stale verdict, when the requester runs,
  then behavior is byte-identical to today: write marker → release lock → exit 0.
- Given the marker write itself fails in session-hosted mode, when the requester handles the
  error, then it does not exit and does not release the lock (existing backstop unchanged).

### Done When
- [ ] `daemon-cli-restart-requester.test.ts`'s session-hosted assertions are flipped: fired
      trigger asserts `lock.releaseSync()` called AND `process.exit(0)` invoked (via injected
      process fake), replacing the "no lock release, no exit" pins.
- [ ] Trigger-failure assertions (stay alive, lock retained, no exit) still pass unmodified.
- [ ] Headless-path assertions pass unmodified.

---

## Story: A fired trigger is one-shot — the idle loop can never re-fire it

**Requirement:** TS-2 (ADR Decision 2)

As an operator, I want a single stale-engine event to produce at most one respawn, so that a
burst of respawns (four in ~60s in #400) is structurally impossible.

### Acceptance Criteria

#### Happy Path
- Given the idle-boundary stale branch, when `requestRestart` resolves indicating the trigger
  fired, then the daemon loop breaks with `stopReason: 'engine_restart'` (mirroring the
  dispatch-boundary precedent) and performs no further idle polls.
- Given `requestRestart`'s new return contract, when a caller inspects the result, then fired
  vs failed is an explicit discriminated value, not an implicit flag left set across
  iterations.

#### Negative Paths
- Given a stale verdict on every idle poll and a `requestRestart` fake that reports "fired"
  without exiting the process (simulating a future requester regression), when the loop
  continues for N further idle polls, then `requestRestart` was invoked exactly once (the
  backstop break prevents the #400 burst).
- Given `requestRestart` reports "failed" (e.g. relink aborted or trigger threw), when the
  next idle boundary is reached, then the daemon MAY legitimately attempt again — retry after
  failure is preserved and is asserted as distinct from multi-fire after success.
- Given a task lands in `inFlight` between the stale verdict and the request, when the
  re-verify check runs, then no restart is requested (existing guard unchanged).

### Done When
- [ ] A unit test drives ≥3 consecutive idle polls with a permanently-stale checker and a
      non-exiting "fired" fake: exactly 1 `requestRestart` call, loop exits with
      `stopReason: 'engine_restart'`.
- [ ] A unit test with a "failed" result asserts the loop continues and a later boundary
      retries (≥2 calls across polls) — proving retry-on-failure was not regressed.
- [ ] `requestRestart`'s return type change compiles at every call site (dispatch-boundary
      path included) with no `any` escape.

---

## Story: Successor tolerates a mid-exit predecessor (bounded lock takeover)

**Requirement:** TS-3 (ADR Decision 3)

As an operator, I want a freshly-respawned daemon to wait briefly for its exiting predecessor
to release the pidfile, so that the normal handoff ordering (trigger → release → exit) never
produces a spurious lock-loss.

### Acceptance Criteria

#### Happy Path
- Given a pidfile held by a live pid, when the holder releases it within the bounded window,
  then `holdLock` acquires and returns a valid lock (successor becomes owner without any
  operator action).
- Given a pidfile holding a dead pid, when `holdLock` runs, then it reclaims immediately via
  the existing stale-reclaim path — the bounded wait applies only to live holders.

#### Negative Paths
- Given a pidfile held by a live pid that never releases, when the bounded window elapses,
  then `holdLock` returns `null` (loser verdict) rather than waiting indefinitely or throwing.
- Given two processes concurrently attempting takeover of the same released pidfile, when both
  race the `O_EXCL` create, then exactly one wins and the other gets `null` — single-winner
  semantics unchanged by the wait loop.
- Given the bounded window is configured, when the constant is inspected, then it lives inside
  the lock module (ADR-010's swappable boundary) — no caller passes or duplicates it.

### Done When
- [ ] `daemon-lock.test.ts` gains: live-holder-releases-mid-wait → acquired; live-holder-
      persists → `null` after the bound (test uses a shortened injectable wait/poll interval,
      not real multi-second sleeps); dead-pid → immediate reclaim (existing test unmodified).
- [ ] Concurrent-takeover race test passes (one winner, one `null`).
- [ ] No public API outside the lock module exposes the wait constant.

---

## Story: A lock-loser terminates instead of lingering

**Requirement:** TS-4 (ADR Decision 4)

As an operator, I want a daemon that loses the 1-per-repo mutex to actually end its process,
so that `pgrep` never shows resident non-owner daemons (five were resident in #400).

### Acceptance Criteria

#### Happy Path
- Given `holdLock` returned `null`, when `runDaemonMode` handles the loss, then it logs the
  existing "another daemon is already running" line and ends the process with an explicit
  exit code 0 — never a bare `return` into a live event loop.

#### Negative Paths
- Given a loser exiting, when the winner's pidfile is inspected afterwards, then it is
  byte-identical — the loser mutated nothing (ADR-010 pin retained).
- Given the loser path, when it exits, then the exit code is 0 (a loser is a normal outcome,
  not an error — supervisors and `ensureRunning` must not treat it as a crash).

### Done When
- [ ] A test drives `runDaemonMode` with an occupied live lock and an injected process fake:
      asserts explicit exit(0) invoked and winner pidfile untouched.
- [ ] Real-process smoke (kill-switch-guarded): second daemon started against a live owner is
      observably gone (pid dead) within the bound, not resident.

---

## Story: Re-enable auto_restart_on_stale_engine

**Requirement:** TS-5 (ADR Decision 5)

As an operator, I want the stale-engine auto-restart turned back on in this repo once the fix
lands, so that merged engine changes converge without manual restarts (reverting the #402
operational disable).

### Acceptance Criteria

#### Happy Path
- Given the fix's code changes are in the same change set, when `.ai-conductor/config.yml` is
  read at daemon startup, then `auto_restart_on_stale_engine: true` and the checker arms
  (startup log reflects ARMED state).

#### Negative Paths
- Given any other consumer project without the key, when config is validated, then the
  default remains `false` — the C1/C2/C3 total-function contract in `config.ts` is untouched
  (absent → false; non-boolean → false + one warning).
- Given the flag is enabled but the repo is not self-host, when the idle boundary evaluates
  the gate chain, then no restart is requested (gates unchanged).

### Done When
- [ ] `.ai-conductor/config.yml` line for `auto_restart_on_stale_engine` reads `true` in this
      repo, committed in the implementation PR (not the spec PR).
- [ ] `config.test.ts` default/validation contract tests pass unmodified.

---

## Story: End-to-end single-generation invariant (real tmux)

**Requirement:** TS-1..TS-4 capstone (ADR Consequences — the assertion shape #393 lacked)

As an operator, I want an end-to-end proof that a stale-engine transition leaves exactly one
daemon process, so that the #400 failure class cannot silently return.

### Acceptance Criteria

#### Happy Path
- Given a real-tmux supervised daemon (kill-switch-guarded test env) whose engine identity is
  then invalidated on disk, when the idle boundary fires the respawn and the successor boots,
  then: the count of `daemon --continuous` processes for the repo equals exactly 1 at steady
  state, the predecessor pid is dead, the tmux session survives, and the successor consumed
  the `RESTART_PENDING` marker.

#### Negative Paths
- Given the same transition, when process counts are sampled repeatedly across the handoff
  window (not just at the end), then the count never exceeds 2 (predecessor + successor
  mid-handoff) and settles at 1 — a stacked third generation fails the test.
- Given the successor is forced to lose the lock past the bound (predecessor artificially held
  alive), when the loser exits, then total process count returns to 1 (the held predecessor)
  and no resident loser remains.

### Done When
- [ ] `daemon-stale-respawn-e2e.test.ts` extended (or a sibling e2e added) asserting: steady-
      state count == 1, predecessor pid `ESRCH`, session alive, marker consumed, hyphen
      `RESTART-PENDING` untouched.
- [ ] The e2e runs green in the repo's standard vitest invocation (`rtk proxy npx vitest run`
      equivalent) without leaking processes (kill-switch verified in teardown).
