**Status:** Accepted

# Stories: Stale-engine restart respawns in place; relink precedes every handoff (#353)

**Track:** technical (no PRD — requirements TR-1…TR-6 derive from
adr-2026-07-06-stale-engine-respawn-in-place, APPROVED)
**Tier:** M

> **Amended 2026-07-07 (#400, adr-2026-07-07-single-generation-stale-respawn):** TR-2's
> session-hosted happy path is narrowed — after `triggerSelfRestart()` returns
> **successfully**, the requester now releases the pidfile lock and exits 0 explicitly
> (it no longer stays resident trusting `respawn-pane -k`; #400 proved predecessors
> survive it and stack generations). Session survival is still guaranteed (respawn-pane
> relaunch + remain-on-exit). The trigger-**failure** and marker-write-failure stay-alive
> contracts below are unchanged and remain binding. See
> `.docs/stories/fix-400-stale-engine-respawn-in-place-stacks-daemo.md`.

---

## Story: remain-on-exit is actually armed and keeps the pane through its own exit

**Requirement:** TR-1

As an operator, I want every supervised daemon pane to survive its process's exit so that a
daemon self-exit can never tear down the tmux session it is hosted in.

### Acceptance Criteria

#### Happy Path
- Given a daemon session created by `daemon start`, when the session's window options are
  queried (`tmux show-options -w`), then `remain-on-exit on` is reported for the daemon pane's
  window.
- Given a supervised session with the option armed, when the pane's foreground process exits
  naturally (clean exit, not `respawn-pane -k`), then the tmux session still exists and
  `list-panes` reports `pane_dead=1` for the daemon pane.
- Given a `daemon restart`, when the pane is respawned in place, then the replacement pane's
  window still reports `remain-on-exit on` (the option survives respawn).

#### Negative Paths
- Given tmux rejects the `set-option` call (simulated non-zero exit from the tmux runner),
  when `setRemainOnExit` runs during `start`/`restart`, then the failure is logged including
  tmux's stderr text (never silently swallowed) and the start/restart itself still proceeds.
- Given the legacy broken invocation form (`set-option` without `-w` against a bare `=name`
  session target), when executed against a real tmux server, then it exits non-zero — the
  real-tmux test asserts the *corrected* form exits 0 and the option is verifiably set, so a
  regression to the old form fails the suite rather than passing vacuously.
- Given a session created by the *dead-pane revival* branch of `start`, when the revived
  daemon process later exits on its own, then the session again survives with a dead pane
  (the option is armed on every creation path, not only `restart`).

### Done When
- [ ] `setRemainOnExit` issues `set-option -w -t '=<name>:' remain-on-exit on` and surfaces
      non-zero exits in the daemon/supervisor log with the tmux error text.
- [ ] `Supervisor.start`'s fresh-session path arms remain-on-exit immediately after
      `newDetachedSession`.
- [ ] Real-tmux smoke test proves: option reported by `show-options`; session survives a
      natural process exit with `pane_dead=1`; both assertions run against a real tmux server
      (no injected-runner-only coverage).

---

## Story: stale-engine detection respawns the daemon in place when session-hosted

**Requirement:** TR-2

As an operator, I want a session-hosted daemon that detects a stale engine to replace itself
in place so that bringing a daemon current never ends with `status: stopped`.

### Acceptance Criteria

#### Happy Path
- Given a session-hosted daemon armed for auto-restart (flag on, self-host) whose on-disk
  engine hash differs from the loaded one, when the stale verdict fires (dispatch or idle
  boundary), then the daemon is replaced in the SAME tmux session with a new pid, and
  `daemon status` reports `running` (never `stopped`/`session:down`) throughout.
- Given the respawned successor boots, when it reads `.daemon/RESTART_PENDING`, then the
  existing handshake behavior is observed unchanged: marker consumed once,
  "restarted for engine refresh" logged, identity compared against the marker's target.

#### Negative Paths
- Given `triggerSelfRestart`/`respawn-pane` throws (pane vanished), when the requester
  attempts the respawn, then the failure is logged, the daemon process does NOT exit, and a
  later boundary retries — the daemon is never left down by a failed respawn.
- Given the identity-marker write fails (unwritable `.daemon/`), when the requester runs
  session-hosted, then it aborts the attempt and stays alive on the old engine (logged); it
  does not exit leaving neither marker nor successor.
- Given a non-converging engine (successor's identity equals the identity it restarted away
  from), when the successor boots, then the existing suppression loop-guard engages and no
  further auto-respawn fires until the on-disk identity changes — the respawn wiring must not
  defeat the loop-guard.
- Given the daemon is NOT session-hosted (bare terminal run, `triggerSelfRestart` absent),
  when the stale verdict fires, then today's contract holds byte-for-byte: underscore marker
  written, pidfile released, exit 0.
- Given a stale-engine restart occurs by any path, then `.daemon/RESTART-PENDING` (hyphen,
  human-queued) is never created or modified by daemon-side code
  (adr-2026-07-04-pending-restart-queue non-autonomy clause).
- Given the arming gates are not all satisfied (flag default false, or non-self-host, or
  indeterminate identity), when an engine rebuild lands, then no restart of any kind is
  attempted (existing gate tests keep passing).

### Done When
- [ ] `createRestartRequester` accepts the injected `triggerSelfRestart` and fires it after
      the marker write when present; headless fallback path unchanged.
- [ ] End-to-end real-tmux test: seed a session-hosted daemon, mutate the engine dist to
      force a stale verdict, assert the session survives, a new pid runs the daemon, the
      marker was consumed, and `daemon status` never reports `stopped`.
- [ ] Requester unit tests cover: respawn-throw → alive + logged; marker-write-failure
      (session-hosted) → alive + no exit; headless → marker + release + exit 0 ordering
      preserved (existing T-suite green).
- [ ] A test asserts the hyphen marker file is absent/untouched across a stale-engine restart.

---

## Story: skills are relinked before any restart handoff so the successor's freshness gate passes

**Requirement:** TR-3

As an operator, I want the restart/self-restart handoff to relink harness skills first so that
a daemon brought current across an origin advance is never blocked by `InstallStaleError`.

### Acceptance Criteria

#### Happy Path
- Given the fast-forwarded source introduced a new skill not yet symlinked in
  `~/.claude/skills/`, when a stale-engine self-restart fires, then the #363-guarded relink
  (`bin/install --update` at the *installed* harness root) runs before the respawn and the
  successor boots without tripping `ensureInstallFresh`.
- Given skills are already fresh, when the relink preflight runs, then it completes as a
  no-op and the restart proceeds (no behavior change for the common case).

#### Negative Paths
- Given the relink throws (e.g. the #363 guard rejects a worktree-resolved root, or
  `bin/install --update` exits non-zero), when the self-restart attempt runs, then the attempt
  is aborted loudly: no respawn, no exit, daemon continues on the old engine, and the log
  names the relink failure.
- Given the installed harness root is unresolved (primitive's documented "nothing to link
  against" case), when the relink preflight runs, then it logs and skips (existing primitive
  semantics) and the restart proceeds — an unresolvable root must not wedge restarts on
  non-harness setups.
- Given the relink succeeds but the successor still fails `ensureInstallFresh` for an
  unrelated reason, when the successor exits at boot, then the fixed remain-on-exit leaves a
  revivable dead pane and the failure text is visible in the pane scrollback / daemon log —
  never a silently vanished session.

### Done When
- [ ] The stale-engine requester invokes `relinkSkillsForSelfBuild` (or an equivalently
      #363-guarded seam) BEFORE writing the marker/respawning; ordering asserted by test.
- [ ] Relink-failure test: requester aborts, process still alive, old engine still running,
      failure logged.
- [ ] Integration test (real `bin/install` binary or realistic runner): a newly-linked skill
      appears in `~/.claude/skills/` (isolated fake HOME) after the relink step runs.

---

## Story: CLI `daemon restart` brings the daemon current without stranding it

**Requirement:** TR-4

As an operator, I want `conduct daemon restart` on a checkout whose origin is ahead to end
with a running daemon on the new engine so that the documented recovery verb actually
recovers.

### Acceptance Criteria

#### Happy Path
- Given a supervised daemon and unlinked newly-merged skills, when the operator runs
  `daemon restart`, then the CLI relinks skills, respawns the pane in place, and the
  replacement daemon reaches `running` (session preserved) without any manual
  `bin/install --update`.

#### Negative Paths
- Given the relink fails, when `daemon restart` runs, then the restart aborts with the
  existing loud `InstallStaleError` message, the running daemon is left untouched
  (still `running` on the old engine), and no respawn occurs.
- Given the daemon is busy mid-build, when `daemon restart` runs, then the existing
  queue-behind-work behavior (hyphen marker, adr-2026-07-04-pending-restart-queue) is
  unchanged — the relink-then-respawn applies only when the restart actually fires.

### Done When
- [ ] `daemon-supervisor-cli.ts` restart path runs the #363-guarded relink before
      `supervisor.restart`; failure aborts before any tmux mutation.
- [ ] Test: relink failure → supervisor.restart never called, error surfaced, exit non-zero.
- [ ] Test: busy path unchanged (marker queued; no relink/respawn at request time).

---

## Story: docs and changelog track the new lifecycle behavior

**Requirement:** TR-5

As a harness consumer, I want the daemon lifecycle documentation to describe the
respawn-in-place stale-engine behavior so that operational expectations match reality.

### Acceptance Criteria

#### Happy Path
- Given the PR lands, when reading `src/conductor/README.md`'s daemon lifecycle section, then
  it documents: remain-on-exit semantics, the stale-engine respawn-in-place flow, the
  relink-before-handoff step, and the headless fallback.
- Given the PR lands, when reading `CHANGELOG.md`, then an `[Unreleased]` **Fixed** entry
  describes #353's operator-visible change.

#### Negative Paths
- Given the docs describe the old behavior ("stale daemon exits and stays down until
  nudged"), when the PR is reviewed, then that text is updated or removed — stale operational
  guidance is a defect (repo "docs track features" rule).

### Done When
- [ ] `src/conductor/README.md` lifecycle section updated in the same PR.
- [ ] `CHANGELOG.md` `[Unreleased]` → Fixed entry present.
- [ ] Harness integrity suite (`test/test_harness_integrity.sh`) passes.
