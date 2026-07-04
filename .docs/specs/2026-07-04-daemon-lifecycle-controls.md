# PRD: Daemon Lifecycle Controls — Fleet Pause/Resume, Safe Restart, Rebuild Safety

**Date:** 2026-07-04
**Status:** Approved
**Source:** jstoup111/ai-conductor#215

## Problem / Background

Every registered repo runs its own background **build daemon**, and all of those daemons
execute the **same shared installed harness engine**. This creates two operational gaps:

1. **No way to quiesce the fleet.** An operator who needs the daemons to stop picking up
   new work — before maintenance, before an engine upgrade, while investigating a
   problem — has only two bad options today: kill each daemon (loses the running state
   and requires destructive-action approval) or let them keep dispatching builds.
   There is no "finish what you're doing, then stand by" instruction, per-daemon or
   fleet-wide.

2. **Upgrading the shared engine is hazardous while daemons run.** A confirmed live
   defect (issue #215): rebuilding the shared engine deletes the artifact files a
   long-running daemon in *another* repo will load next, crashing that unrelated daemon
   mid-operation. Today the only mitigation is documentation that says "never rebuild
   while daemons run" — an operator or automation that forgets is playing roulette with
   every running daemon.

Compounding both: the existing restart action **destroys the daemon's live session** —
an operator watching a daemon loses their connection, scrollback history, and window
arrangement every time the daemon is restarted. That makes restart feel destructive,
so operators avoid the very action that safe upgrades depend on.

These controls are also the foundation for a later capability (explicitly out of scope
now): the harness automatically restarting its own daemons when the engine changes.

## Goals & Non-Goals

**Goals**
- An operator can **pause** work pickup on one, several, or all daemons with a single
  action: in-flight work finishes or parks normally, no new work is dispatched, and the
  daemon stands by. **Resume** is the mirror action.
- An operator can **safely restart** one, several, or all daemons: restart never
  interrupts an in-progress build, and the restarted daemon comes back on the current
  engine version.
- Rebuilding or upgrading the shared engine **never crashes a running daemon** in any
  repo — each daemon keeps running the version it started with until it restarts.
- Restart **preserves the daemon's live session**: a connected operator stays connected,
  and scrollback and window arrangement survive.
- Pause state is **durable and honest**: it survives daemon crashes and restarts, is
  distinctly visible in status, and a paused repo loses nothing — its queued work and
  queue position are intact on resume.

**Non-Goals**
- Automatic restart when the engine changes (self-host auto-restart). These controls are
  its prerequisite, but no automatic lifecycle action is delivered here.
- Pausing or checkpointing an individual build **mid-feature**. In-flight work runs to
  its natural end (completion or parking); only *pickup of new work* is gated.
- Remote/cluster hosting or cross-machine fleets. Fleet operations here span the repos
  registered on this machine.
- Changing how work is prioritized or ordered. Pause must not *lose* queue position, but
  scheduling policy itself is untouched.

## Users / Personas

- **Operator (human):** supervises multiple repos' daemons on one machine. Wants to
  quiesce some or all of them before maintenance or an engine upgrade, restart them
  cleanly afterward, and never lose the live view they were watching.
- **Harness maintainer (same human, different hat):** develops the harness itself and
  needs to rebuild the shared engine without first hand-auditing which other repos have
  daemons running.
- **Automation (spec handoff / future lifecycle automation):** ensures daemons are
  running after routing work. Must never override an operator's pause, and later builds
  on the restart primitive.

## Functional Requirements

### Pause / Resume

- **FR-1:** An operator can **pause** a repo's daemon: from that moment it dispatches no
  new work. Work already in flight finishes or parks exactly as it would have; the
  daemon then stands by, still alive and observable.
- **FR-2:** An operator can **resume** a paused daemon: it picks up eligible work again,
  with its previously queued work and queue position intact — pausing costs the repo
  nothing but time.
- **FR-3:** Pause and resume accept **one repo, several repos, or all registered
  repos** in a single action, reporting the per-repo outcome individually.
- **FR-4:** Pause state is **durable**: it survives the daemon crashing, the host
  rebooting, or the daemon being restarted. A daemon starting up in a paused repo comes
  up paused — including a daemon started by automation, which must not override an
  operator's pause.
- **FR-5:** A paused daemon is **distinctly visible** in the status surface — clearly
  distinguishable from running, stopped, and stale/dead states.
- **FR-6 (negative):** Pausing an already-paused repo and resuming a non-paused repo are
  **safe, clearly-reported no-ops**, never errors and never state corruption.
- **FR-7 (negative):** Pausing a repo whose daemon is **not currently running** still
  takes effect: the pause is recorded, status reflects it, and a later daemon start in
  that repo honors it.

### Safe Restart

- **FR-8:** An operator can **restart** a repo's daemon; the replacement daemon runs the
  **current engine version** and remains the repo's single daemon.
- **FR-9:** Restart is **never mid-build destructive**: it takes effect only when the
  daemon has no feature in flight (immediately if idle or paused; otherwise after the
  in-flight work finishes or parks). The operator is told when a restart is waiting and
  on what.
- **FR-10:** Restart accepts **one repo, several repos, or all registered repos** in a
  single action, reporting the per-repo outcome individually.
- **FR-11:** Restart **preserves the repo's pause state**: restarting a paused daemon
  yields a paused daemon (fresh engine, still standing by).
- **FR-12 (negative):** Restarting a repo whose daemon is **not running** is a clearly
  reported, safe outcome (it either starts the daemon or reports "not running" — never a
  crash, hang, or silent nothing).

### Rebuild Safety (the #215 hazard)

- **FR-13:** Rebuilding or upgrading the shared engine while daemons are running **never
  crashes any running daemon**: each daemon continues to execute, fully and correctly,
  the engine version it started with — including engine functionality it has not yet
  had cause to load — until it is restarted.
- **FR-14:** After a restart, a daemon runs the **newest installed engine version**;
  which version each daemon is running is visible in the status surface.
- **FR-15:** Superseded engine versions are **cleaned up safely**: storage does not grow
  without bound, and cleanup never removes a version a running daemon still depends on.
- **FR-16 (negative):** If the current engine version is missing or broken (e.g. a
  failed build), starting or restarting a daemon fails with a **clear, actionable
  message** — and rebuild-safety for already-running daemons is unaffected.

### Fleet Operations

- **FR-17:** Fleet-wide actions are **best-effort per repo**: one repo's failure (dead
  daemon, missing path, unreadable state) is reported for that repo and does not abort
  the action for the rest.
- **FR-18 (negative):** Naming an **unknown/unregistered repo** in a lifecycle action
  yields a clear error identifying the bad name; valid repos named in the same action
  are still acted on.
- **FR-19:** Lifecycle actions on one repo's daemon **never affect another repo's
  daemon** beyond what was asked — pausing repo A must not slow, pause, or restart
  repo B.

### Session Preservation

- **FR-20:** Restart **reuses the daemon's existing live session**: an operator
  connected to the daemon stays connected across the restart, and the session's
  scrollback history and window arrangement survive.
- **FR-21 (negative):** If the daemon has **no existing session** (first start, or the
  session was externally destroyed), restart/start creates one cleanly — session
  preservation never blocks a restart.

## Non-Functional Requirements

- **Reliability:** All lifecycle actions are idempotent and safe to repeat. Interrupted
  actions (host crash mid-restart) leave the repo in a recoverable, honestly-reported
  state, never a wedged one.
- **Authority:** Each repo's daemon remains the authority on its own liveness; the
  machine-wide registry remains a best-effort mirror for fleet iteration and reporting.
  No fleet action depends on the mirror being perfectly current.
- **Single-owner guarantee:** Exactly one daemon per repo is preserved through pause,
  resume, and restart — including restarts that race with automation's ensure-running.
- **Observability:** Status answers, per repo: running/paused/stopped/stale, which
  engine version, and (while a restart is pending) what it is waiting on.
- **Compatibility:** Existing daemons and repos keep working through the upgrade that
  introduces these controls; a repo that has never been paused behaves exactly as today.

## Acceptance Criteria / Success Metrics

- Every FR is covered by passing automated tests, including all seven negative paths
  (FR-6, FR-7, FR-12, FR-16, FR-18, FR-19, FR-21).
- A test proves the #215 hazard is closed: with a daemon running, rebuild the shared
  engine, and the running daemon continues operating (including late loading of engine
  functionality) without error; after restart it runs the new version.
- An end-to-end walkthrough succeeds on a real multi-repo setup: pause all daemons →
  verify no new dispatch and PAUSED status → rebuild the engine → restart all → verify
  each daemon is back on the new version, in its original session with scrollback
  intact, still paused → resume all → verify work pickup resumes with queue intact.
- An operator connected to a daemon's live view stays connected through a restart.

## Scope

### In Scope
- Pause and resume, per-repo through fleet-wide, with durable state and status surfacing.
- Idle-gated safe restart, per-repo through fleet-wide, preserving pause state and the
  live session.
- Rebuild-safe engine versioning: running daemons immune to rebuilds, restart adopts the
  newest version, safe cleanup of superseded versions.
- Per-repo outcome reporting for all fleet actions.

### Out of Scope
- Automatic restart on engine change (future; enabled by this work).
- Mid-feature pause/checkpoint of an in-flight build.
- Remote/cluster hosting; cross-machine fleet control.
- Changes to scheduling/priority policy.

## Key Decisions & Rationale

- **Pause gates pickup, not execution.** In-flight work always runs to its natural end
  (finish or park). This keeps pause non-destructive and composable: "pause, wait for
  idle, then restart" is the safe upgrade recipe.
- **Rebuild safety is unconditional, not procedural.** The system guarantees a rebuild
  cannot crash running daemons, rather than relying on operators remembering to pause
  first. Pause remains valuable for orderly upgrades, but forgetting it must not cost a
  crash.
- **Restart waits rather than kills.** A daemon mid-build is doing paid-for work in a
  real repo; interrupting it risks corrupted worktrees and half-built features. The
  operator gets visibility into what a pending restart is waiting on instead.
- **Session continuity is a requirement, not a nicety.** Losing scrollback on every
  restart trains operators to avoid restarting — the opposite of what safe upgrades
  need.
- **Per-repo authority, fleet-wide convenience.** Fleet actions are iteration plus
  per-repo reporting; no central controller owns daemon state. This preserves the
  established authority posture and keeps single-repo behavior primary.

## Dependencies

- The existing per-repo daemon and its single-daemon-per-repo ownership guarantee.
- The existing daemon status/observability surface (extended, not replaced).
- The existing live-session hosting of daemons (the capability an operator uses to
  watch/attach today) — session preservation extends it.
- The machine-wide project registry as the enumeration source for fleet actions
  (remaining non-authoritative for liveness).
- The shared installed harness engine used by all repos' daemons (the pre-existing
  reality that creates the #215 hazard).

## Open Questions

- **Engine version isolation mechanism** — how builds are laid out and atomically
  published so running daemons keep their version while new starts get the newest
  (e.g. versioned artifact directories with an atomic switch vs. copy-on-start), and
  the matching cleanup policy: for `/architecture-review` to decide and record as ADRs.
- **Pause signal placement** — where durable, repo-scoped pause state lives and at
  which loop boundary it is honored, consistent with existing signal-file precedent:
  architecture's call.
- **Restart-in-place technique** — how a replacement process is started inside the
  existing session without destroying it, and how the single-owner lock hands off
  between old and new process: architecture's call.
- **Pending-restart semantics** — whether a restart requested on a busy daemon queues
  durably (fires when idle) or requires the operator to pause first and retry: weigh
  during architecture review; the PRD requires only that it never interrupts a build
  and reports what it's waiting on.
