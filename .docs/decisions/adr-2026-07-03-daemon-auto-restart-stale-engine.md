# ADR: Daemon auto-restart on stale engine code — exit-to-respawn at the idle boundary

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#256
**Amends:** adr-2026-07-03-harness-daemon-profile (narrow: the "new code goes live only on `bin/install`" clause)
**Depends on:** issue #215 (safe restart primitives — versioned dist, respawn-in-place, pause/idle gating)

## Context

A merged self-build rebuilds `src/conductor/dist`, but the running daemon is a single
long-lived `node dist/index.js` process that keeps executing the engine it loaded at start
(adr-2026-07-03-harness-daemon-profile). Today convergence onto new engine code requires an
operator to notice and perform manual restart surgery. No build-identity notion exists in the
engine (no BUILD_ID, no dist hash/mtime check anywhere).

The daemon must never swap code mid-build, must never manage other processes
(ADR-005 launch-never-manage), owns liveness solely through its pidfile (ADR-010), and does
no prompt dispatch at the sweep boundary (ADR-001). Restart machinery that kills/recreates
tmux sessions or versions the dist is issue #215 and out of scope here.

## Options Considered

### Option A: Exit-to-respawn (record intent, exit cleanly, let the transport respawn)
- **Pros:** Daemon-side logic is tiny and self-contained; never touches its own tmux pane;
  composes with whatever restart transport #215 ships; preserves ADR-005 (the daemon manages
  only itself — self-termination already exists for ceilings); pidfile released cleanly per
  ADR-010.
- **Cons:** The respawn is not guaranteed by this feature — until #215's transport exists, a
  stale daemon exits and stays down until nudged (`ensureRunning`/`daemon start`).

### Option B: In-process restart verb (respawn-pane -k of own session)
- **Pros:** Restart is immediate and self-contained.
- **Cons:** The daemon kills the pane it is executing in — failure modes mid-syscall are
  ugly; duplicates/reaches into #215's supervisor internals; violates the spirit of
  launch-never-manage.

### Option C: External watchdog process
- **Pros:** No daemon-loop changes.
- **Cons:** A new standing component with its own lifecycle/identity problems; overlaps
  #215's fleet controls; contradicts pidfile-as-single-truth simplicity.

## Decision

**Option A — exit-to-respawn**, gated fail-closed:

1. **EngineIdentity (new, `engine/engine-identity.ts`).** At daemon startup capture the
   identity of the loaded engine: a content hash of the resolved `dist/index.js` entry
   (tsup chunk hashes are content-derived, so the entry's import map changes whenever any
   chunk changes; an input-identical rebuild yields the same identity and is correctly NOT
   stale). Capture failure ⇒ staleness checking is disabled for the process lifetime,
   logged once.
2. **StaleEngineCheck at the idle boundary only.** In `runDaemon`'s idle branch
   (`inFlight.size === 0` and nothing eligible), re-hash the on-disk entry and compare.
   All gates must pass before acting: continuous mode, `selfHost` true
   (existing `classifySelfHost`), config flag `auto_restart_on_stale_engine: true`
   (new key, **default false**, read once at startup like all project config), verdict
   determinate, loop-guard clear. Indeterminate (read/hash error) ⇒ never stale
   (fail-closed, mirroring blocker-resolver semantics).
3. **RestartRequester (new seam).** On a stale verdict: log the decision, write
   `.daemon/RESTART_PENDING` (reason, from-identity, target-identity, timestamp), release
   the pidfile lock, exit 0. It never spawns, signals, or respawns anything — the respawn
   transport is #215's restart primitive (interim: `ensureRunning` nudge or operator
   `daemon start`).
4. **Startup handshake + loop-guard.** On boot the daemon reads and clears
   `RESTART_PENDING`, logs "restarted for engine refresh," and compares its freshly
   captured identity to the marker's target-identity. If a restart did not change the
   captured identity (we came back on the same engine we tried to leave), auto-restart is
   **suppressed** until the on-disk identity changes again — a non-converging restart must
   not loop. Suppression state rides in the marker lineage (`.daemon/`), not the registry.

## Consequences

- adr-2026-07-03-harness-daemon-profile is **narrowly amended**: new engine code goes live
  on `bin/install` **or** on a stale-engine auto-restart at an idle boundary under this
  ADR's gates. The mid-build invariant is unchanged — the check exists only in the idle
  branch, so a daemon with work in flight still runs its startup engine to completion.
- ADR-005/ADR-010 are preserved: the daemon only ever terminates itself and releases its
  own lock; nothing here manages, signals, or health-checks another process; `ensureRunning`
  stays fire-and-forget.
- ADR-001 is untouched: no prompt dispatch is added at any boundary; the check is
  deterministic filesystem work in the idle branch.
- Non-harness repos are byte-for-byte unaffected (`selfHost` gate); with the config flag
  defaulted off, even the harness repo opts in explicitly.
- Until #215 lands, enabling the flag can leave the repo daemon-less between exit and the
  next nudge — acceptable for the self-host repo, and the reason this feature is
  blocked_by #215 (dependency-ordered dispatch holds the build).
- The build gate for this spec is expected to hold in WAITING until #215 closes.

## Evidence

- Idle boundary: `src/conductor/src/engine/daemon.ts:376-389` (`inFlight.size === 0` branch).
- Single long-lived process, lazy dist imports: `bin/conduct-ts:9,29`,
  `src/conductor/src/index.ts:295-300`, `daemon-lock.ts:482`.
- No existing build identity: repo-wide grep for BUILD_ID/dist-hash/mtime is empty.
- Self-host gate: `src/conductor/src/engine/self-host/detector.ts:80`,
  `daemon-cli.ts:195`, `conductor.ts:585`.
- Clean-exit path with release backstop: `daemon-cli.ts:180-184,503-507`.
- Config read once at startup: `daemon-cli.ts:186`, `engine/config.ts:66`.
