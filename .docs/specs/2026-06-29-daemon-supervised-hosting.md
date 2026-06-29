# PRD: On-Demand Management of the Per-Repo Build Daemon

**Date:** 2026-06-29
**Status:** Draft

## Problem / Background

Each registered repo runs a background **build daemon** that drains the backlog of
ready features. Today an operator has almost no way to interact with a daemon once it
is running: its live activity is not viewable in real time, it cannot be paused or
inspected, and the only way to "restart" it is to find and kill its process by hand.
When something looks wrong — a daemon stuck on a feature, an unexpected halt, output
that needs watching — the operator is effectively locked out of a process that is
actively changing their repository.

This matters now because the `/engineer` flow and day-to-day operation both depend on
trusting the daemon. Trust requires a window in: the ability to watch what a daemon is
doing in real time, take control to investigate, and restart it cleanly — without
guesswork or hunting for process IDs.

## Goals & Non-Goals

**Goals**
- An operator can **start, stop, restart, watch, debug, and check the status** of a
  repo's build daemon on demand, through the normal command surface.
- Watching a running daemon shows its **live, full-color activity** exactly as it
  happens, without disturbing the work in progress.
- Debugging lets the operator **take interactive control** of a running daemon — pause
  its work, inspect, then resume or restart.
- Management actions are **safe to repeat** (idempotent) and never spawn a duplicate
  daemon for a repo.
- The build automation (`/engineer` handoff) can **ensure a repo's daemon is running**
  without disrupting an operator who is already connected to it.

**Non-Goals**
- Watching several simultaneous in-progress builds inside a single daemon. A daemon
  presents **one feature in progress at a time** (see FR-11); concurrent multi-build
  viewing is out of scope.
- Hosting daemons on a remote cluster or shared fleet. The design must not *preclude*
  that later, but no remote/cluster hosting is delivered here.
- Splitting backlog discovery and feature execution into independently operated
  services. The capability to do so later must be preserved, but it is not built here.

## Users / Personas

- **Operator (human):** runs and supervises daemons across one or more repos. Wants to
  watch a build live, jump in when something looks off, and restart cleanly — in color,
  on demand.
- **Engineer automation (`/engineer` handoff):** after routing a new spec to a repo,
  needs to guarantee that repo's daemon is running so the work gets picked up — without
  stealing a session a human operator may currently be watching.

## Functional Requirements

- **FR-1:** An operator can **start** a repo's build daemon on demand.
- **FR-2:** Starting is **idempotent** — if the daemon is already running, start is a
  no-op and never creates a second daemon for that repo.
- **FR-3:** An operator can **stop** a repo's running daemon on demand. Stopping a
  daemon that is not running is a safe no-op, not an error.
- **FR-4:** An operator can **restart** a repo's daemon on demand; the managed daemon is
  replaced with a fresh run while remaining the repo's single daemon.
- **FR-5:** An operator can **connect** to a running daemon to watch its live, full-color
  activity in real time, **read-only** — connecting does not alter or interrupt the work.
- **FR-6:** An operator can **debug** a running daemon by taking interactive control —
  pausing the work in progress, inspecting, and then resuming or restarting it.
- **FR-7:** An operator can **check the status** of a repo's daemon (running vs. not
  running) on demand.
- **FR-8 (negative):** If the daemon-management capability is **unavailable on the host**,
  any management action fails with a clear, actionable message explaining what is missing
  and how to enable it — never a silent or cryptic failure.
- **FR-9 (negative):** **Connecting to or debugging a daemon that is not running** yields
  a clear "not running — start it first" message, not an error dump or a hang.
- **FR-10 (negative):** A daemon that is reported as present but is actually **dead/stale**
  is distinguishable in status from a healthy running daemon.
- **FR-11 (negative):** Managing **one repo's daemon never affects another repo's daemon**,
  even when two repos share the same name.
- **FR-12:** The build automation can **ensure** a repo's daemon is running as part of
  spec handoff; if a daemon is already running, this is a no-op that does **not** disturb
  an operator currently connected to it.
- **FR-13:** A daemon **builds one feature at a time**, so connecting to it shows exactly
  the single feature currently in progress.
- **FR-14:** The daemon **continues to build correctly on hosts where the management
  capability is absent** — management is additive and never required for the daemon to do
  its job.
- **FR-15:** Daemon-management actions are reachable **consistently through the standard
  command surface**; a management action must never silently mis-route to an unrelated
  operation (e.g. a status check accidentally launching a build).

## Non-Functional Requirements

- **Observability:** The live view of a running daemon is full-color and faithful to the
  daemon's actual real-time output.
- **Reliability:** Management actions are idempotent and safe to repeat. A host restart
  may drop in-memory management state; the next start/ensure transparently restores it.
- **Single-owner guarantee:** Exactly one daemon per repo is preserved regardless of how
  it is started (operator action or automation).
- **Portability (forward-looking):** The management capability is designed so the daemon
  could later be hosted on a different substrate (e.g. a cluster) **without changing how
  operators start/stop/restart/watch/debug it**.

## Acceptance Criteria / Success Metrics

- Every FR is covered by passing automated tests, including all five negative paths
  (FR-8, FR-9, FR-10, FR-11, and the mis-route guard in FR-15).
- An end-to-end walkthrough on a real repo succeeds: start a daemon, watch it live in
  color, take control and pause/inspect, restart it, confirm a repeated start is a no-op,
  stop it cleanly, and confirm an automation "ensure" does not duplicate or disturb it.
- The daemon still builds correctly on a host where the management capability is absent.

## Scope

### In Scope
- The six management capabilities (start, stop, restart, connect, debug, status) for a
  per-repo daemon, plus the automation "ensure-running" path.
- Clear, actionable failures for the unavailable-capability and not-running cases.
- One-feature-at-a-time daemon behavior so the live view is unambiguous.
- Consistent routing of management actions through the standard command surface.

### Out of Scope
- Concurrent multi-feature builds within one daemon and any viewer for them.
- Remote/cluster hosting of daemons.
- Operating backlog discovery and feature execution as separate services.

## Key Decisions & Rationale

- **Management is additive, never required (FR-14).** The daemon must remain a simple,
  self-sufficient builder; the management layer wraps it. This keeps the daemon portable
  and avoids coupling its core function to any one hosting mechanism.
- **One feature at a time (FR-13).** A single in-progress feature makes the live view
  unambiguous and the "connect/debug" experience meaningful. Concurrency is deferred.
- **Portability is a first-class constraint (NFR).** The operator-facing verbs are fixed;
  the substrate that hosts the daemon is intentionally swappable so a future cluster
  deployment doesn't change the operator experience.

## Dependencies

- The existing single-daemon-per-repo ownership guarantee (the daemon lock).
- The existing daemon activity log / status surface (extended, not replaced).

## Open Questions

- None blocking. The hosting substrate and exact command names are settled in the
  companion implementation plan; this PRD intentionally stays at the capability level.
