# ADR: Stale-engine restart rides the respawn-in-place transport; relink precedes every handoff

**Date:** 2026-07-06
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#353
**Amends:** adr-2026-07-03-daemon-auto-restart-stale-engine (narrow: the RestartRequester "records intent and exits — respawn is someone else's job" contract)
**Reconciles with:** adr-2026-07-04-pending-restart-queue (non-autonomy clause), adr-2026-07-04-respawn-in-place-restart, ADR-005 (launch-never-manage), adr-010 (pidfile liveness)

## Context

Issue #353, reproduced twice on 2026-07-05: `conduct daemon restart` on a checkout with
`origin/main` ahead reliably ends with the daemon `stopped` (no pid, session down, fresh
engine built but nothing running it), and the recovering `daemon start` is then blocked by
the install-freshness gate until a manual `bin/install --update` relinks newly-merged skills.

Three verified defects compound (all confidence: **verified**, by direct code read + live
tmux experiment on 2026-07-06):

1. **`setRemainOnExit` has never worked.** `daemon-tmux.ts:230` issues
   `set-option -t '=<name>' remain-on-exit on`. `remain-on-exit` is a window option, so tmux
   parses `-t` as a *window* target; a bare session name matches no window and the command
   fails `no such window` (verified on tmux 3.2a). The non-zero exit is swallowed as
   "best-effort", so no pane anywhere has remain-on-exit armed and any daemon self-exit
   tears the whole session down. The corrected form
   `set-option -w -t '=<name>:' remain-on-exit on` was verified live: the session survives
   its process's exit with `pane_dead=1`. The existing smoke test asserts
   respawn-while-alive (`respawn-pane -k`), which never exercises remain-on-exit — which is
   why the defect passed.
2. **The stale-engine RestartRequester never respawns.** `createRestartRequester`
   (`daemon-cli.ts`) writes the `.daemon/RESTART_PENDING` identity-handshake marker
   (restart-intent.ts, underscore), releases the pidfile, and `process.exit(0)`s. The
   tested respawn machinery (`hasRestartPending → triggerSelfRestart → respawnPane`,
   `daemon.ts` idle boundary) watches the *different* `.daemon/RESTART-PENDING` marker
   (restart-marker.ts, hyphen, human-queued per adr-2026-07-04-pending-restart-queue). The
   2026-07-03 ADR explicitly deferred respawn to "#215's transport" — #215 has since
   shipped that transport, but nothing wired the stale path to it.
3. **Nothing relinks skills on the restart handoff.** After an origin advance introduces a
   new skill, the successor process's non-interactive `ensureInstallFresh` throws
   `InstallStaleError` and the relaunch dies. The #363-guarded relink primitive
   (`relinkSkillsForSelfBuild`, runs `bin/install --update` against the *installed* harness
   root only) exists but is invoked only on the self-build dispatch path.

## Options Considered

### Option A: Requester holds the respawn trigger; identity marker unchanged (chosen)
`createRestartRequester` gains the already-existing injected `triggerSelfRestart` (defined
only when a live tmux session hosts the daemon) and fires it instead of exiting when
present. The underscore marker keeps its exact schema and boot handshake (consume-once,
non-convergence suppression); the hyphen marker stays human-only.
- **Pros:** minimal delta on tested seams; the queue ADR's consume-once semantics and the
  boot handshake tests are untouched; the "two markers" split becomes harmless because the
  stale path no longer depends on the loop's marker polling.
- **Cons:** two marker files continue to exist (documented, distinct lifecycles).

### Option B: Unify both markers into one file/module
- **Pros:** one lifecycle to reason about.
- **Cons:** rewrites the consume-once semantics an APPROVED ADR specifies and two test
  suites assert, for no behavioral gain over Option A; higher regression risk in the exact
  area that just failed.

### Option C: Keep exit-to-respawn, add an external watcher that revives dead panes
- **Cons:** a standing watchdog was already rejected (Option C of the 2026-07-03 ADR);
  violates launch-never-manage.

## Decision

**Option A**, as four coordinated changes:

1. **Fix and arm `setRemainOnExit`.** Corrected invocation
   `set-option -w -t '=<name>:' remain-on-exit on`; failure is logged with tmux stderr
   (still non-fatal). It is armed at `Supervisor.start` session creation (not only on
   `restart` and dead-pane revival), so *every* supervised daemon pane survives its own
   exit as a revivable dead pane. The tmux smoke test additionally asserts the option is
   actually set (`show-options`) and that a session survives its process's natural exit —
   the assertion shape that would have caught defect 1.
2. **RestartRequester rides the transport.** On a stale verdict the requester, in order:
   (a) **relink** via `relinkSkillsForSelfBuild`; on throw, log loudly and **abort this
   restart attempt** — the daemon keeps running the old engine and retries at a later
   boundary (stale-but-alive beats down-and-blocked; fail-safe direction preserved);
   (b) **write** the underscore identity marker exactly as today (boot handshake and
   loop-guard unchanged);
   (c) **respawn**: if `triggerSelfRestart` is injected (session-hosted), fire it — tmux
   swaps the process in place, pidfile succession identical to the already-tested CLI
   respawn path (successor reconciles the stale pidfile); if absent (bare-run/headless),
   release the pidfile and exit 0 as today — with remain-on-exit fixed this now leaves a
   revivable dead pane when a session exists, and the bare-terminal case is unchanged.
   A respawn-call failure logs and leaves the daemon running (marker present; the boot
   handshake of whatever process comes next still converges) — the daemon never exits
   without either a successor arranged or a durable marker + revivable pane behind it.
3. **CLI `restart` relinks before respawning.** `daemon restart` runs the same
   #363-guarded relink before `Supervisor.restart` respawns the pane, so "the documented
   way to bring a stale daemon current" cannot hand off into an `InstallStaleError`. A
   relink failure aborts the restart with the existing loud message (daemon left running).
4. **Non-autonomy reconciliation.** adr-2026-07-04-pending-restart-queue's "nothing
   daemon-side ever writes the [hyphen] marker" clause is preserved verbatim — the stale
   path touches only its own underscore marker. The autonomous *trigger* of the respawn
   primitive is exactly the "separate, explicitly gated decision" that ADR anticipated,
   and its gates are unchanged from the 2026-07-03 ADR: `auto_restart_on_stale_engine`
   config flag (default **false**), self-host repos only, determinate identity verdict,
   non-convergence loop-guard clear.

## Negative paths / adversarial review

- **Respawn loop on a non-converging engine:** unchanged protection — the boot handshake
  suppresses auto-restart when the successor's identity equals the marker's from-identity;
  suppression state rides `.daemon/RESTART_PENDING.suppression` as today.
- **Relink fails (worktree-rooted install, #363 guard):** restart attempt aborts loudly;
  daemon stays up on the old engine. Never respawn into a known-blocked freshness gate.
- **`respawn-pane` fails (pane vanished):** logged; daemon continues; with remain-on-exit
  fixed the failure mode is a live daemon or a revivable dead pane — never a torn-down
  session with no marker.
- **Crash between marker write and respawn:** marker survives; consumed once at next boot
  (existing tested semantics).
- **Headless bare-run daemon:** behavior byte-identical to the approved 2026-07-03 ADR
  (marker + clean exit); `ensureRunning`/`daemon start` revives, now unblocked because the
  successor's freshness gate was satisfied by the relink in step (a) of the *attempt* that
  wrote the marker — and `start`'s own interactive gate remains as backstop.
- **tmux portability of the `-w` form:** verified on tmux 3.2a (the deployment target);
  the smoke test pins the behavior so a tmux upgrade that changes option-target parsing
  fails CI, not production.

## Consequences

- The single observed failure class of #353 (restart-with-origin-ahead → stopped daemon →
  blocked start) is closed end-to-end; an unattended daemon converges onto new engine code
  without operator surgery.
- adr-2026-07-03-daemon-auto-restart-stale-engine's Option A "Cons" line ("a stale daemon
  exits and stays down until nudged") is retired for session-hosted daemons; the ADR is
  amended, not superseded — every gate and the marker schema survive.
- One new invariant becomes testable and tested: **a supervised daemon process's exit,
  for any reason, must leave either a running successor or a revivable dead pane** — the
  end-to-end real-tmux test asserting "stale engine detected → daemon still up (new pid,
  same session)" is part of this feature's acceptance surface.
- Two marker files remain by design; their split responsibilities are now documented here
  and in the architecture diagram (`daemon-restart-leaves-the-daemon-stopped-when-orig.md`).

## Evidence

- Broken invocation + swallow: `src/conductor/src/engine/daemon-tmux.ts:230-233`; live
  repro: `set-option -t '=<name>'` → `no such window` / exit 1; corrected `-w -t '=<name>:'`
  → exit 0, session survives process exit with `pane_dead=1` (tmux 3.2a, 2026-07-06).
- Exit-without-respawn: `createRestartRequester` in `src/conductor/src/daemon-cli.ts`
  (write marker → `lock.releaseSync()` → `process.exit(0)`).
- Transport exists and is injected conditionally: `buildDaemonModeOptions` in
  `src/conductor/src/index.ts` (triggerSelfRestart = respawnPane iff hasSession).
- Idle-boundary hyphen path (tested, human-queued): `src/conductor/src/engine/daemon.ts`
  (`hasRestartPending → triggerSelfRestart`, T28/T30 suites).
- Relink primitive + #363 guard: `relinkSkillsForSelfBuild` in
  `src/conductor/src/engine/install-freshness.ts` (throws `InstallStaleError`; resolves
  installed root, rejects worktree roots).
- Freshness gate on every daemon launch: `ensureInstallFresh` non-interactive throw path
  (`install-freshness.ts`), wired at daemon-process startup and `daemon start`.
