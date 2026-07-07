**Status:** Accepted

# Stories: Daemon auto-restart on stale engine code

**Track:** technical (no PRD — criteria derive from the technical intent + APPROVED ADR
adr-2026-07-03-daemon-auto-restart-stale-engine)
**Source:** jstoup111/ai-conductor#256 (blocked_by #215)
**Tier:** M

---

## Story: Capture engine identity at daemon startup

As the daemon, I want to record the identity of the engine build I actually loaded, so that
staleness is decidable later without guessing.

### Acceptance Criteria

#### Happy Path
- Given a daemon starting from a built `dist/`, when `runDaemonMode` initializes, then an
  engine identity (content hash of the resolved `dist/index.js` entry) is captured in memory
  and logged once at startup (`engine identity: <hash-prefix>`).
- Given two starts on a byte-identical `dist/`, when identity is captured in each, then both
  captures are equal (identity is content-derived, not time-derived).

#### Negative Paths
- Given `dist/index.js` is unreadable at startup (removed or permission-denied after launch),
  when capture is attempted, then the daemon starts normally, logs one warning
  (`engine identity unavailable — stale-engine auto-restart disabled`), and every later
  staleness check in this process short-circuits to not-stale (fail-closed, no crash).
- Given a capture failure occurred at startup, when the on-disk dist later changes, then no
  restart is ever requested by this process (disabled-for-lifetime is sticky).

### Done When
- [ ] Startup log contains exactly one engine-identity line (hash prefix) on a healthy start.
- [ ] Unit test proves capture failure yields a disabled checker (subsequent `isStale()` calls
      return not-stale without touching the filesystem) and exactly one warning log line.
- [ ] Identity of a byte-identical rebuild compares equal in a real-fixture test (two tsup
      builds of identical input compared).

---

> **Amended 2026-07-06 (#353, adr-2026-07-06-stale-engine-respawn-in-place):** the
> "write marker → release lock → exit 0" contract below now applies **only to headless
> (non-session-hosted) daemons**. A session-hosted daemon relinks skills, writes the same
> marker, then respawns in place via `triggerSelfRestart`; a marker-write failure while
> session-hosted aborts the attempt (stays alive) instead of exit(1). See
> `.docs/stories/daemon-restart-leaves-the-daemon-stopped-when-orig.md` (TR-2/TR-3).

## Story: Detect stale engine at the idle boundary and request restart

As the self-host daemon, I want to detect at the idle boundary that the on-disk engine is
newer than the one I loaded, and get out of the way cleanly, so a respawn brings up current
code without operator surgery.

### Acceptance Criteria

#### Happy Path
- Given a continuous-mode self-host daemon with `auto_restart_on_stale_engine: true`, a
  captured identity, an empty `inFlight` set and nothing eligible, when the on-disk
  `dist/index.js` hash differs from the captured identity, then the daemon logs the stale
  verdict (both identities), writes `.daemon/RESTART_PENDING` containing reason,
  from-identity, target-identity and timestamp, releases the pidfile lock, and exits with
  code 0.
- Given the same gates, when the on-disk hash equals the captured identity (including after
  a byte-identical rebuild), then no marker is written and the loop sleeps/polls as today.

#### Negative Paths
- Given a stale on-disk engine, when any feature is in flight (`inFlight.size > 0`) or an
  eligible spec is about to dispatch, then no restart is requested this pass — the check is
  reached only from the idle branch, and `inFlight.size === 0` is re-verified immediately
  before the exit path runs.
- Given a stale on-disk engine but the daemon is running in non-continuous (`once`) mode,
  when the idle boundary is reached, then no restart is requested (the process exits at
  backlog-drained per existing behavior, with no `RESTART_PENDING` marker).
- Given a stale on-disk engine but `classifySelfHost` resolved false (any non-harness repo,
  or detection uncertainty), when the idle branch runs, then the staleness check does not
  execute at all — a non-self-host daemon's idle behavior is byte-for-byte unchanged.
- Given a stale on-disk engine but `auto_restart_on_stale_engine` is `false`, absent, or an
  unparseable value, when the idle branch runs, then no restart is requested; an unparseable
  value logs one warning and is treated as `false` (fail-closed).
- Given re-hashing `dist/index.js` fails at check time (transient read error, mid-rebuild
  ENOENT), when the idle branch runs, then the verdict is indeterminate → treated as
  not-stale, one warning logged (no warning spam on repeated identical failures), and no
  restart is requested.
- Given the `RESTART_PENDING` write succeeds but the process crashes before the clean exit,
  when the daemon dies, then the existing exit backstop still releases the pidfile lock
  (no stranded lock), and the next daemon start treats the leftover marker per the startup
  handshake story.

### Done When
- [ ] Acceptance spec proves the full happy path against a REAL rebuilt dist fixture: build,
      start daemon (injected-runner plus one real-binary smoke), rebuild with a source
      change, observe marker content + exit 0 + released lock (real-binary smoke rule).
- [ ] Acceptance spec proves a byte-identical rebuild does NOT trigger restart.
- [ ] Unit tests cover every negative path above with concrete assertions (no marker file,
      no exit, log content).
- [ ] `RESTART_PENDING` schema (reason, fromIdentity, targetIdentity, at) round-trips
      parse/serialize in a unit test.

---

## Story: Startup restart handshake

As the freshly respawned daemon, I want to acknowledge the restart intent I woke up from, so
operators can see why the process cycled and loop protection has the data it needs.

### Acceptance Criteria

#### Happy Path
- Given `.daemon/RESTART_PENDING` exists from a prior stale-exit, when the daemon starts,
  then it reads the marker, logs `restarted for engine refresh` with the marker's from/target
  identities and its own freshly captured identity, and removes the marker before entering
  the loop.
- Given the freshly captured identity equals the marker's target identity, when startup
  completes, then auto-restart remains armed (the restart converged).

#### Negative Paths
- Given the marker file is corrupt or unparseable, when the daemon starts, then it logs one
  warning, removes the file, and proceeds with auto-restart armed and no suppression state
  (fail-closed to default gates — a bad marker can only lose suppression context, never
  crash the boot or block the loop).
- Given no marker exists (normal start), when the daemon starts, then no
  restart-handshake log line is emitted (no noise on ordinary boots).
- Given processed markers, HALT-parked features, and in-progress worktrees exist, when the
  daemon boots after an engine-refresh exit, then its dispatch decisions are identical to a
  manual restart today — processed markers and HALT markers are honored; the restart reason
  introduces no new dispatch, re-dispatch, or state mutation (parity guard against the
  PR #109 / backfill class of restart-time bugs).

### Done When
- [ ] Unit tests cover present/absent/corrupt marker with exact log + file-state assertions.
- [ ] The marker is provably gone after startup in all three cases.

---

## Story: Restart-loop suppression on non-convergence

As the operator, I want a restart that fails to change the engine to stop retrying, so a
wedged dist (or a broken respawn transport) degrades to a warning instead of a crash-loop.

### Acceptance Criteria

#### Happy Path
- Given the post-restart captured identity does NOT equal the marker's target identity (we
  came back on the same engine we tried to leave), when startup completes, then the daemon
  logs a suppression warning naming both identities and disables auto-restart until the
  on-disk identity changes from the suppressed value.
- Given suppression is active and the on-disk engine later changes to a NEW identity
  (different from the suppressed target), when the idle check runs, then suppression clears
  and the normal stale flow applies to the new identity.

#### Negative Paths
- Given suppression is active, when idle checks keep seeing the same suppressed-stale
  identity, then no `RESTART_PENDING` is written and no exit occurs — and the suppression
  warning is not re-logged every poll tick (log once per suppression episode).
- Given suppression state on disk is missing or corrupt, when the daemon evaluates it, then
  it treats suppression as absent and relies on the per-boot handshake to re-derive it (a
  lost suppression record can cause at most ONE extra restart attempt, never a tight loop —
  bounded by the handshake re-detecting non-convergence on the next boot).

### Done When
- [ ] Simulated non-convergence (marker target ≠ fresh identity) yields suppression: unit
      test asserts no marker write on subsequent stale verdicts of the same identity.
- [ ] Identity moving past the suppressed value re-arms the flow in the same test.
- [ ] Log-once behavior asserted (two idle passes under suppression → one warning line).

---

## Story: Config flag `auto_restart_on_stale_engine`

As the operator, I want auto-restart to be an explicit per-repo opt-in, so no repo — including
the harness — restarts itself without a committed decision.

### Acceptance Criteria

#### Happy Path
- Given `.ai-conductor/config.yml` contains `auto_restart_on_stale_engine: true`, when the
  daemon starts, then the resolved config carries the flag and the startup log states
  stale-engine auto-restart is ARMED (alongside the existing self-host classification line).
- Given the flag is absent, when the daemon starts, then it resolves to `false` and the
  feature is inert (no new log noise beyond one DISARMED status line at startup).

#### Negative Paths
- Given `auto_restart_on_stale_engine: "banana"` (unparseable), when config loads, then the
  value resolves to `false` with one warning naming the key — config loading never throws
  for this key and the daemon still boots.
- Given the flag is edited to `true` while a daemon is already running, when subsequent idle
  checks run, then behavior does NOT change mid-process (config is read once at startup);
  the new value applies from the next daemon start. The DISARMED startup line makes the
  active state observable so this is not mistaken for a bug.

### Done When
- [ ] Config schema/type test covers true/false/absent/invalid.
- [ ] Startup log shows ARMED/DISARMED state in a spec.
- [ ] `src/conductor/README.md` documents the key, its default, and the once-at-startup read
      (docs-track-features rule).
