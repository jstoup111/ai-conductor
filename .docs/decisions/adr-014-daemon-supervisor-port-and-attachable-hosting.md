# ADR 014: Daemon supervisor port + attachable foreground hosting

**Date:** 2026-06-29
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Daemon supervised hosting (PR #143)
**Decision surfaces:** supervisor port seam (FR-1…FR-7), foreground-in-session host superseding
detached spawn (FR-5/FR-6/FR-14), operator-vs-automation authority split (FR-12, preserves
ADR-005/ADR-010), serial execution (FR-13), intake/execute work-source seam, session naming (FR-11)

## Context

The per-repo build daemon is spawned **detached** with `stdio:'ignore'`
(`launchDaemonDetached`, ADR-010 FR-22). Its colored output is discarded and a **running** daemon
can never be reconnected to — stdio is fixed at spawn time, so changing it to `inherit`/`pipe`
does not create a reconnectable endpoint. Operators have no way to watch a build live, take
control to investigate, or restart cleanly without hunting for a pid.

Forces:
- A **persistent PTY owner** is the only thing that makes an already-running process attachable
  after the fact. The daemon process itself cannot retroactively expose its stdio.
- **ADR-005 (non-autonomy) and ADR-010 (launch-only ensure-running)** forbid the *engineer
  automation* from managing daemon lifecycle — ensure-running must stay fire-and-forget (spawn iff
  none/stale, no-op if alive). New *operator* verbs (restart/stop/debug) must not erode that.
- ADR-010 already isolates the single-owner **lock** as a swappable primitive and flags the
  concurrency model as expected to change. The host/management layer should be **equally
  swappable** (local tmux now; a cluster supervisor later) without touching the build core.
- The daemon must remain a **bare-run** process (one clean foreground process, log to stdout, no
  double-fork) — that is also the container/k8s entrypoint contract.

## Options Considered

### Option A: Make the detached spawn use `stdio: 'inherit'` / `pipe`
- **Pros:** smallest change.
- **Cons:** does **not** solve the problem — stdio is bound at spawn; a *running* daemon still
  can't be reconnected to. No restart/debug. Rejected.

### Option B: A process manager with a Procfile (Overmind/Foreman)
- **Pros:** ready-made attach for some managers.
- **Cons:** Procfile/process-group model is built for a fixed set of named processes, not N
  per-repo daemons keyed by path; heavier dependency; weaker scriptable per-session control.
  Rejected.

### Option C: Host the foreground daemon inside a tmux session, behind a thin Supervisor port
- **Pros:** tmux owns a persistent PTY → attach/restart/inspect an already-running daemon, in
  color; scriptable verbs (`has-session`, `new-session`, `attach[-r]`, `capture-pane`,
  `kill-session`); composes with the ADR-010 pidfile lock unchanged; the **port** keeps the build
  core supervisor-agnostic so a future kubectl adapter is an adapter swap.
- **Cons:** tmux must be present on the host (incl. headless/cron) for the management plane;
  sessions are per-user global (needs path-namespaced names); reboot drops sessions.

## Decision

Adopt **Option C**. Introduce a thin **Supervisor port** —
`start / stop / restart / attach / logs / exec / isUp` — that all daemon management depends on; the
verbs and engineer nudge **never call `tmux` directly**. Implement a **tmux adapter** over the CLI
with an injectable runner (unit-testable by asserting exact tmux argv). The daemon is hosted as the
foreground process `conduct-ts daemon --continuous` inside a per-repo session
`cc-daemon-<slug>-<pathhash>`.

Key sub-decisions:

1. **Foreground-in-session supersedes detached spawn.** `launchDaemonDetached`’s
   `detached:true, stdio:'ignore'` model (ADR-010 FR-22) is replaced by `supervisor.start`. The
   inner foreground daemon still calls `holdLock`, so **ADR-010’s pidfile single-owner guarantee is
   unchanged** — the session layer is an *outer* idempotency check, not a replacement.

2. **Operator-vs-automation authority split (preserves ADR-005/ADR-010).** Lifecycle verbs
   (`start`, `stop`, `restart`, `debug`) are a **human-operator** capability. The **engineer
   automation path stays launch-only**: `ensureRunning` becomes `isUp? → start` (still
   fire-and-forget, no restart/stop/health-management), and engineer non-interactive state checks
   use `capturePane` (read) — **never `attach`** — so automation never steals an operator’s session
   nor supervises lifecycle. ADR-005’s non-autonomy invariant therefore holds.

3. **Swappable supervisor port (forward-looking).** The same port admits a kubectl adapter
   (`start`→reconcile, `restart`→rollout restart, `stop`→scale 0, `attach` read-only→`logs -f`,
   `attach` r/w→`exec -it`, `isUp`→`get pod`). tmux is never run *inside* k8s — there k8s *is* the
   supervisor. Three invariants lock this in: **bare-run** (daemon runs with no tmux), **one clean
   foreground process** (no double-fork; stdout logging), **host-local state behind interfaces**
   (pidfile via `daemon-lock.ts`; worktrees/`.daemon/` via existing helpers).

4. **Serial execution (interim).** Daemon pool concurrency is clamped to **1** so one attachable
   session shows exactly the one feature building. True concurrency needs a task-handoff worker and
   is out of scope; a `>1` request is clamped with an explanatory log.

5. **Intake/execute work-source seam.** The run loop consumes `BacklogItem`s from an **injected
   work-source**; the local adapter is today’s inline `discoverBacklog` (no behavior change). A
   future intake/execute process split + queue is an adapter swap — seam only, not built here.

6. **Session naming.** `cc-daemon-<slug>-<pathhash>` — never `:`/`.` (tmux target separators); the
   absolute-path hash prevents two same-named repos colliding in tmux’s per-user-global namespace
   (FR-11).

## Consequences

### Positive
- Operators can watch (read-only), debug (r/w), and restart a *running* daemon, in color.
- ADR-010 lock + ADR-005 non-autonomy are preserved, not weakened.
- The build core stays supervisor-agnostic → a cluster deployment later is an adapter, not a rewrite.

### Negative
- A new host dependency (`tmux`) for the **management plane** (not the build plane); needs a
  preflight + actionable error and docs that a reboot drops sessions (next `start`/nudge respawns).
- Two layers now express "is it up" (pidfile + session); status must reconcile them (stale =
  session present but inner pid dead).

### Follow-up Actions
- [ ] `daemon-tmux.ts`: Supervisor port + tmux adapter (injectable runner) + preflight.
- [ ] Management verbs + routing; `bin/conduct` forwards `daemon <verb>` to `conduct-ts`.
- [ ] Replace `launchDaemonDetached` with `supervisor.start`; `ensureRunning` → `isUp? → start`.
- [ ] Engineer nudge → `start`; non-interactive checks → `capturePane` (never attach).
- [ ] Clamp concurrency to 1; inject the work-source seam.
- [ ] Status augmented with session presence (stale detection).
- [ ] Verify the engineer intake poll never gains a detached/session spawn (9.3b guard).
