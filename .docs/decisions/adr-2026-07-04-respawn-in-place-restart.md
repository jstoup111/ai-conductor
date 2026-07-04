# ADR: Restart-in-place via pane respawn inside the existing tmux session

**Date:** 2026-07-04
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session
**Feature:** daemon-lifecycle-controls (FR-8–12, FR-20–21)

## Context

Today the supervisor's `restart` is `killSession` + `newDetachedSession`
(`daemon-tmux.ts:274-279`): the tmux session — with the operator's attachment,
scrollback, and window arrangement — is destroyed on every restart. PRD FR-20 requires
the session to survive; FR-8 requires the replacement to be the repo's single daemon on
the newest engine; adr-010's pidfile stays the ownership authority; the supervisor port
surface (adr-2026-06-29) should not change shape (`restart` keeps its verb and
signature — only its implementation changes). The respawn-in-place pattern
(remain-on-exit + respawn-pane) was validated operationally on 2026-07-03.

## Options Considered

### Option A: Respawn the daemon command in the existing pane (chosen)
- `restart` = ensure session exists → set the pane's `remain-on-exit` so process death
  never reaps the pane → `respawn-pane -k` with the daemon foreground command → new
  process acquires the pidfile.
- **Pros:** session, scrollback, geometry, and any attached clients survive; tmux (an
  external supervisor process) performs the swap, so it works regardless of who
  requests it; matches the operationally validated pattern.
- **Cons:** pane targeting must be deterministic; `respawn-pane -k`'s kill semantics
  must be understood (below).

### Option B: Keep kill-session + new-session (status quo)
- **Pros:** already implemented.
- **Cons:** fails FR-20 outright — attached operators are disconnected, scrollback lost.
  This ADR exists to replace it.

### Option C: In-process self-exec (daemon replaces its own image)
- **Pros:** no tmux dependency for the swap itself.
- **Cons:** Node has no `execve` replacement primitive; emulations (spawn child + exit)
  break the pane's process ownership and the pidfile handoff ordering; unportable
  cleverness where tmux already provides the primitive. Rejected.

## Decision

**Option A.**

- **Supervisor change:** the tmux adapter's `restart` becomes respawn-in-place; the
  port's verb surface is unchanged. Targeting uses the daemon session's canonical name
  (`cc-daemon-<slug>-<pathhash>`) and its window 0 / pane 0 — the pane the adapter
  itself created. Operator-created extra windows in the session are untouched.
- **Gating:** restart proceeds only when the daemon is idle or paused (busy semantics
  are ADR `pending-restart-queue`'s subject). Not-running + session absent → this is a
  `start` (FR-12/21); not-running + dead pane present (remain-on-exit corpse) →
  respawn revives it.
- **Pidfile handoff (adr-010 preserved):** `respawn-pane -k` terminates the old pane
  process (tmux kills the pane's process group); the old process's exit backstop
  releases the pidfile, or — if it died hard — the new process's `acquire` reclaims the
  stale record via the existing pid-liveness + uuid path. No new lock semantics; the
  handoff is exactly ADR-010's reclaim, exercised deliberately.
- **Engine adoption (FR-8/14):** the respawned command re-enters through
  `bin/conduct-ts`, which resolves the `current` engine realpath (per
  adr-2026-07-04-versioned-engine-store-atomic-flip) — restart adopts the newest
  version with no daemon-side logic.
- **Fallback:** if respawn fails (tmux too old for the needed flags, pane vanished
  mid-operation), fall back to kill-session + new-session and **report the session
  loss explicitly** — restart must succeed; degraded continuity is reported, never
  silent.

## Negative paths / adversarial review

- **Old process ignores termination:** tmux's pane kill is not polite-SIGTERM-first by
  default; the daemon already tolerates hard death (pidfile reclaim + crash backstop).
  Restart is only invoked idle/paused, so no build is in flight to corrupt (FR-9).
- **Respawn races `ensureRunning`:** the session stays up throughout, so
  `ensureRunning`'s `isUp → no-op` path holds; even in the sliver where the pane is
  swapping, pidfile acquisition arbitrates single ownership (adr-010).
- **Attached read-only observer during respawn:** attachment is to the session, not the
  process — the observer sees the old process end and the new one boot in the same
  scrollback. That is the desired FR-20 experience.
- **Pane index drift:** the adapter targets the pane it created; if an operator has
  manually split/moved panes, targeting falls back to the session's active pane of
  window 0, and on ambiguity the explicit-fallback path (report + recreate) engages
  rather than respawning a random pane.
- **remain-on-exit side effect:** a crashed daemon now leaves a visible dead pane
  instead of a vanished session — an observability improvement (status distinguishes
  session-up/process-dead), but `daemon start` must revive dead panes, not just create
  sessions (FR-21 covers the no-session case; the dead-pane case is the respawn path).
- **Real-binary smoke required:** injected-runner tests assert argv; a real tmux smoke
  must prove respawn preserves scrollback and that `=name` exact-target semantics hold
  (standing convention after the `=name` bug).

## Consequences

### Positive
- Restart stops being destructive → operators will actually use it, which is what safe
  engine upgrades depend on.
- Crash forensics improve (dead pane with scrollback instead of a vanished session).

### Negative
- Two-layer liveness (session up vs. process up) becomes visible and must be rendered
  honestly in status.
- Slightly deeper tmux feature dependency (remain-on-exit, respawn-pane) — gated with
  the explicit degraded fallback.

### Follow-up Actions
- [ ] Rewrite tmux adapter `restart` (remain-on-exit + respawn-pane -k + fallback).
- [ ] `start` learns to revive a dead remain-on-exit pane.
- [ ] Status renders session-up/process-dead distinctly.
- [ ] Injected-runner argv tests + real tmux smoke (scrollback survival, exact-name
      targeting, pidfile handoff).
