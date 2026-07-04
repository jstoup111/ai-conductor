**Status:** Accepted

# Stories: Daemon Event-Driven Wake for Parked (HALTED) Features

**Track:** technical (no PRD). Requirements trace to the approved
ADR `adr-2026-07-04-event-driven-halt-clear-wake.md` (decisions D1–D7) and intake issue
jstoup111/ai-conductor#111. Tier M — per-criterion negative paths.

---

## Story: Event-driven re-dispatch on HALT clear

**Requirement:** ADR D2, D3 (watch seam; watch never authority)

As a daemon operator, I want a parked feature to re-dispatch within ~1 second of me clearing
its `.pipeline/HALT`, so that unparking does not wait for a polling tick.

### Acceptance Criteria

#### Happy Path
- Given a daemon with feature «slug» parked (HALT present) and a registered HALT watcher, when
  `.pipeline/HALT` is removed, then the idle wait resolves via the wake arm (not the sleep
  tick) and «slug» is re-dispatched on the next loop iteration.
- Given the rekick path renames `HALT` → `HALT.cleared`, when the rename completes, then the
  watcher fires the same as a plain removal and «slug» re-dispatches through the existing
  un-park path.

#### Negative Paths
- Given a spurious/duplicate watcher event while `.pipeline/HALT` still exists, when the wake
  fires, then `onCleared` re-verification (or the `isHalted` dispatch gate) prevents dispatch
  and the loop iteration is a no-op — «slug» stays parked, no error is thrown.
- Given «slug» is already `inFlight` when a wake arrives, when the loop re-evaluates
  eligibility, then «slug» is NOT dispatched a second time (no duplicate concurrent run).
- Given the watcher emits an internal error, when the error occurs, then it is swallowed
  (daemon keeps running) and a later backstop poll still re-dispatches «slug» after HALT is
  cleared.

### Done When
- [ ] daemon.test.ts has a test where clearing HALT re-dispatches the parked feature without
      advancing the fake sleep (wake path), and it passes.
- [ ] daemon.test.ts has a wake-while-still-halted test asserting zero dispatches, and a
      wake-while-inFlight test asserting exactly one run for «slug».
- [ ] All pre-existing daemon.test.ts tests pass unmodified (sleep is still called once per
      idle cycle — race, not replacement).

---

## Story: Latched single-shot Waker

**Requirement:** ADR D4

As a daemon maintainer, I want the waker to latch a wake that fires between idle waits, so
that a HALT cleared during dispatch work is never missed.

### Acceptance Criteria

#### Happy Path
- Given no idle wait is in progress, when `wake()` fires and the loop later awaits
  `waker.armed()`, then the wait resolves immediately (latch consumed).
- Given multiple `wake()` calls before one wait, when the loop awaits, then exactly one
  immediate resolution occurs (coalesced) and the next wait blocks normally.

#### Negative Paths
- Given no wake has fired, when the loop awaits the race, then only the sleep arm can resolve
  it — the waker never resolves spuriously.
- Given the daemon is exiting with a pending 60s sleep, when the loop's final iteration ends,
  then the `.unref()`ed default sleep timer does not hold the process open.

### Done When
- [ ] Unit tests cover: latched wake resolves immediately; coalescing; no spurious resolution;
      and they pass.
- [ ] Daemon process exits promptly after `runDaemon` returns with a pending default sleep
      (asserted via unref'd timer or an integration check).

---

## Story: Watcher lifecycle bound to park/unpark

**Requirement:** ADR "Watcher lifecycle"

As a daemon maintainer, I want each per-slug watcher registered on park and disposed on
re-dispatch and on daemon exit, so that no watcher outlives its purpose or leaks handles.

### Acceptance Criteria

#### Happy Path
- Given «slug» is parked, when `parked.add(slug)` completes, then a watcher for
  `<worktreeBase>/<slug>/.pipeline/HALT` is registered exactly once.
- Given «slug» re-dispatches, when `parked.delete(slug)` runs, then its watcher is disposed
  BEFORE `runFeature` can tear down the worktree on `done`.
- Given the daemon loop reaches its single return, when it exits, then all remaining watchers
  are disposed.

#### Negative Paths
- Given a disposed watcher, when its former HALT path is subsequently created and removed,
  then no callback fires.
- Given a watch target directory that does not exist, when `watchHaltCleared` is invoked,
  then it returns a no-op dispose and does not throw.
- Given «slug» parks again after a prior park/unpark cycle, when the second park registers a
  new watcher, then exactly one live watcher exists for «slug» (no accumulation).

### Done When
- [ ] daemon-deps.test.ts (real fs via `mkdtemp`): create/rm HALT fires `onCleared`;
      `dispose()` stops callbacks; missing dir → no-op dispose; all pass.
- [ ] daemon.test.ts asserts disposal on re-dispatch and on stop (spy on the injected
      `watchHaltCleared` dispose), and passes.

---

## Story: Poll backstop and shared discovery timer

**Requirement:** ADR D3, D5

As a daemon operator, I want a 60s poll to remain the correctness backstop and the only
network-touching discovery path, so that missed events never strand a feature and unparking
never requires network.

### Acceptance Criteria

#### Happy Path
- Given the sleep (timeout) arm resolves, when the loop iterates, then it runs the full sweep
  `discoverBacklog({refresh:true})` (git fetch — finds newly merged specs).
- Given the wake arm resolves, when the loop iterates, then it runs a local-only
  `discoverBacklog({refresh:false})` scan and the cleared «slug» is found in the backlog
  (halted ≠ processed) — no `git fetch` occurs on unpark.

#### Negative Paths
- Given an event-hostile filesystem where no watcher event ever fires, when HALT is cleared,
  then the backstop re-dispatches «slug» within one `idle-poll` interval (≤60s default).
- Given the remote is unreachable, when the timeout-arm sweep's `git fetch` fails, then the
  daemon keeps looping (no crash, no HALT) and local unparking still works via wake arm.

### Done When
- [ ] daemon.test.ts asserts refresh:true on timeout-arm iterations and refresh:false on
      wake-arm iterations (via injected discovery spy), and passes.
- [ ] A no-watcher (deps absent) test recovers a cleared HALT within one poll tick, and passes.

---

## Story: `--no-watch` flag and `idle-poll` default change

**Requirement:** ADR D5, D6

As a daemon operator on an event-hostile filesystem, I want `--no-watch` to disable the
watcher and `--idle-poll` to tune the backstop, so that I can restore the previous pure-polling
behavior exactly.

### Acceptance Criteria

#### Happy Path
- Given no flags, when the daemon command parses, then watch is enabled and `idlePollSeconds`
  defaults to 60.
- Given `--no-watch`, when the command parses, then the parsed options carry `watch: false`
  and `daemon-cli` wires NO `watchHaltCleared` dep into `runDaemon`.
- Given `--no-watch --idle-poll 5`, when the daemon runs, then behavior matches the legacy
  5s pure-polling loop.

#### Negative Paths
- Given `--idle-poll 0` or a non-numeric value, when the command parses, then the existing
  int-flag error/fallback behavior applies (no NaN interval reaches the loop).
- Given `--no-watch`, when a HALT is cleared, then re-dispatch still occurs (via polling) —
  disabling watch never disables unparking.

### Done When
- [ ] daemon-command.test.ts: `--no-watch` → `watch:false`; default `watch:true`; `idle-poll`
      default 60; invalid values handled; all pass.
- [ ] `README.md` and `src/conductor/README.md` document `--no-watch` and the new `idle-poll`
      semantics; CHANGELOG `[Unreleased]` carries the Added/Changed entries.

---

## Story: Transition-only, status-preserving logging

**Requirement:** ADR D7

As a daemon operator reading `.daemon/daemon.log`, I want idle cycles to log only real
transitions and re-dispatch to carry prior progress, so that the log stays quiet when nothing
changes and never loses a feature's last-known status.

### Acceptance Criteria

#### Happy Path
- Given a feature's status is unchanged across N idle backstop ticks, when those ticks run,
  then zero per-feature lines are emitted for it.
- Given «slug» re-dispatches after a park, when the resume is logged, then the line carries
  its prior progress (e.g. `↻ resume «slug» (was: «last step»)`), not a bare start.
- Given `git fetch` starts failing, when consecutive sweeps fail, then exactly one
  failure-onset line is logged; when a later fetch succeeds, exactly one recovery line.

#### Negative Paths
- Given the remote stays offline for many consecutive sweeps, when each sweep fails with the
  same error, then no additional failure lines are emitted after the onset line.
- Given an idle tick where discovery returns the same backlog, when the tick completes, then
  the per-slug last-known status map is NOT cleared or reset (a later resume still shows the
  correct `was:` status).
- Given a genuine status change between ticks, when the tick runs, then that change IS logged
  (dedup suppresses repeats, never real transitions).

### Done When
- [ ] Logging tests assert: offline fetch logs onset once + recovery once; unchanged idle
      ticks emit nothing; resume line carries prior status; a real transition is not
      suppressed; all pass.
- [ ] `discoverBacklog` / `resolveDiscoveryRef` accept the transition-only logger without
      changing existing callers' behavior (existing tests green).
