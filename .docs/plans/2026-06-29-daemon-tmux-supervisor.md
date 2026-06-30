# Handoff — tmux-supervised daemons (foreground process + attach/restart/debug)

> Own worktree + branch. This **inverts** how the per-repo daemon is hosted: from a self-daemonizing
> detached `stdio:'ignore'` spawn to a **foreground process running inside a tmux session** that an
> operator (and `/engineer`) can manage and attach to. Builds on ADR-010 (pidfile lock) and the
> daemon-log observability work — both stay; tmux is layered on top as the management/attach plane.

## Motivation

Today the daemon is spawned detached with `stdio:'ignore'` (`daemon-launch.ts`), so its colored
`console.log('[daemon] …')` output is discarded and the only window into it is the ANSI-stripped
`.daemon/daemon.log` tee. There is **no way to connect to a running daemon** — stdio is fixed at spawn
time; changing it to `inherit`/`pipe` does not create a reconnectable endpoint. A persistent PTY owner
(tmux) is the only thing that makes a running process attachable after the fact. Goal: `/engineer` (and
the operator) can **restart, connect to, and debug** a repo's daemon session on demand, in color.

## Decisions (locked)

- **Supervisor = tmux directly. No Procfile** (rules out Overmind/Foreman). tmux gives manage + attach
  + interactive debug with scriptable verbs (`has-session`, `new-session`, `kill-session`, `attach`,
  `send-keys`, `capture-pane`).
- **One tmux session per repo daemon** — `sessions` = per-repo daemons (exactly what engineer operates
  on), NOT per-feature. Session name: `cc-daemon-<repo-slug>` (hyphen, never `:` — `:` is tmux's
  session:window target separator).
- **Serial execution. Drop concurrency to 1.** Features run in-process today (`runConductorInWorktree`
  builds a `Conductor` + `DefaultStepRunner` in the daemon node process; the pool is just async
  promises sharing one stdout). True concurrency would require a task-handoff worker that runs each
  feature as its own process — **explicitly out of scope here.** Force the pool to serial so one
  attachable session = the one feature currently building.

## What already landed (don't repeat)

- `holdLock(repoPath)` (`daemon-lock.ts`) — pidfile at `.daemon/daemon.pid`, 1-per-repo, stale-reclaim.
- `.daemon/daemon.log` tee + `conduct daemon status`/`logs` observe sub-subcommands
  (`daemon-observe-cli.ts`, routed in `daemon-command.ts` via `argv[3] === 'status' | 'logs'`).

## Scope to build

1. **Supervisor port + tmux adapter.** Define a thin supervisor interface — `start / stop / restart /
   attach / logs / exec` — that the verbs call (never `tmux` directly), then implement the **tmux
   adapter** as a helper module (`src/conductor/src/engine/daemon-tmux.ts`) over the `tmux` CLI with an
   injectable runner (for tests): `hasSession(name)`, `newDetachedSession(name, cmd, cwd)`,
   `killSession(name)`, `attach(name, {readOnly})`, `capturePane(name)`, `sessionNameForRepo(repoPath)`.
   `attach` replaces the current process's stdio (spawn with `stdio:'inherit'`); `connect` uses
   `attach -r` (read-only — safe watch), `debug` uses full read/write (Ctrl-C the loop, poke around).
   The same interface admits a future **kubectl adapter** with no execution-core change (see
   k8s-readiness below).

2. **New management verbs** in `daemon-command.ts` routing (`argv[3]`), each delegating to the tmux
   helper (NOT a daemon run):
   - `daemon start` — idempotent: `hasSession?` no-op : `newDetachedSession(cc-daemon-<slug>,
     'conduct-ts daemon --continuous', repoPath)`. **Replaces `launchDaemonDetached`.**
   - `daemon restart` — `killSession` + `start`.
   - `daemon stop` — `killSession`.
   - `daemon connect` — `attach -r` (read-only live colored stream).
   - `daemon debug` — `attach` (read/write; interactive inspection).
   - keep `daemon status` / `daemon logs` — augment `status` to show tmux session presence
     (`hasSession`) alongside the existing pidfile liveness + log tail.

3. **Replace the detached launch** (`engineer/daemon-launch.ts`) — `launchDaemonDetached` becomes a
   call to the tmux helper's `start` (or is deleted in favor of `daemon start`). Keep the
   fire-and-forget signature (returns void). The foreground `conduct-ts daemon --continuous` inside the
   session still calls `holdLock`, so the pidfile lock, duplicate-protection, and liveness observability
   are unchanged — tmux sits on top.

4. **`ensureRunning` → ensure-session** (`daemon-lock.ts`) — probe `hasSession` (source of truth for
   "up") in addition to / instead of the bare pidfile probe, then `start` if absent. Still fire-and-
   forget; a live session → no-op (no duplicate).

5. **Engineer wiring** (`engineer/handoff-step.ts`) — swap the `ensureRunning(...)` nudge for `daemon
   start` (tmux-idempotent). For non-interactive state checks, engineer reads `capturePane(name)`
   instead of attaching, so it inspects without stealing the operator's session.

6. **Force serial** — set the daemon pool concurrency to 1 (`daemon.ts` / `daemon-command.ts`
   `--concurrency` parsing); reject or ignore `>1` with a clear log line pointing at this plan's
   out-of-scope note.

7. **Fix the `bin/conduct` bash wrapper routing** — `conduct daemon <verb>` currently falls through to
   the feature-build path (e.g. `conduct daemon status` launches a conductor for a feature named
   "status"). Forward `daemon <verb>` to `conduct-ts` so the bash and TS entrypoints agree.

## Out of scope (do NOT build here)

- Per-feature attachable sessions/windows and any real (>1) concurrency / task-handoff worker.
- systemd units, Procfiles, or any non-tmux supervisor.
- Splitting intake and execute into **separate processes**, and the work queue that would connect them.
  Preserve the *seam* only (see below) — do not build the second process or the queue here.

## Supervisor portability / k8s-readiness

tmux is NOT run inside k8s — there, **k8s itself is the supervisor**. The two are alternative adapters
of the same supervisor port, so the goal is to keep that port thin and the execution core
supervisor-agnostic. The verbs map 1:1: `start`→Deployment/StatefulSet reconcile, `restart`→`kubectl
rollout restart`, `stop`→scale to 0, `connect`→`kubectl logs -f`, `debug`→`kubectl exec -it`,
`status`→`kubectl get pod` + probes.

### Three invariants to enforce now (cheap, lock in portability)

1. **Bare-run** — the daemon MUST run correctly when launched with **no tmux present**
   (`conduct-ts daemon --continuous` works standalone). tmux is purely additive; never put logic the
   daemon needs to *function* inside a supervisor verb. (Test the no-tmux path.)
2. **One clean foreground process** — no double-fork / self-daemonize; log to stdout. This is exactly
   the container/k8s entrypoint contract, and is the part of today's detached `stdio:'ignore'` model
   that this plan removes. State it as an invariant.
3. **Host-local state behind interfaces** — the pidfile lock stays behind `daemon-lock.ts` (in k8s it's
   belt-and-suspenders to StatefulSet at-most-one and helps arbitrate the brief rollout overlap);
   worktrees + `.daemon/` stay behind existing helpers (a PVC in k8s).

### Intake / execute seam (pull them apart behind an interface)

Today intake (`daemon-backlog.ts` `discoverBacklog`) and execute (`runFeature` →
`runConductorInWorktree`) run **inline in one process** on the host. **Keep that as the local adapter —
no behavior change.** But wire them through a **work-source seam**: the execution loop consumes
`BacklogItem`s from an *injected source* rather than calling `discoverBacklog` directly. 

- **Local adapter (now):** source = in-process backlog scan, executed inline on the host. Fine.
- **k8s (later, not now):** source = a queue fed by a **separate intake process** (poll/webhook →
  enqueue); a separate **execution process/pod** consumes → builds → opens PR. Two deployments sharing
  the queue + durable intake ledger (adr-012), supervisor port unchanged.

The seam makes that split an *adapter swap, not a rewrite*. Only the seam is in scope here.

### k8s deploy shape (non-distributed, for reference)

`conduct-ts daemon --continuous` as the container foreground entrypoint (under `tini`); **StatefulSet
`replicas: 1`** (or Deployment `strategy: Recreate`) for at-most-one; **PVC** for checkout + worktrees +
`.daemon/`; stdout → `kubectl logs`; debug via `kubectl exec`. No tmux in the pod.

## Constraints

- Branch + PR; never commit to main; never `gh pr merge` without approval. Current VERSION `0.99.18`;
  present the bump before opening the PR (new CLI subcommands = MINOR per convention). CHANGELOG
  `[Unreleased]` + docs in the same PR: README, `src/conductor/README.md`, and the **`HARNESS.md`
  "Daemon CLI" table** (replace the "Planned (PR #143)" note with the shipped `start`/`restart`/`stop`/
  `connect`/`debug` verbs) — HARNESS.md loads every session, so that's where operators find the CLI.
- `test/test_harness_integrity.sh` must pass. Mandatory negative-path tests: tmux not installed, stale
  session (dead inner pid but session present), `start` when already running (idempotent no-op),
  `connect`/`debug` when no session, slug collision across two repos.
- tmux must be present on the host **including headless/cron contexts** where engineer nudges daemons —
  add a preflight check + actionable error when `tmux` is missing. Document that tmux sessions are
  per-user-global (hence the `cc-daemon-<slug>` namespace) and that a reboot drops sessions (next
  engineer nudge / `daemon start` respawns).
- Reuse `daemon-lock.ts` primitives for inner liveness; do not re-encode the `.daemon/daemon.pid` path.

## Migration

One-time: kill any currently-detached daemons (`kill $(jq -r .pid .daemon/daemon.pid)` per repo) so the
first tmux-hosted `daemon start` isn't blocked by the 1-per-repo lock.

## Pointers

- `src/conductor/src/engine/engineer/daemon-launch.ts` — the detached `stdio:'ignore'` spawn to replace.
- `src/conductor/src/engine/daemon-command.ts` — verb routing (`argv[3]`); add management verbs.
- `src/conductor/src/daemon-cli.ts` — `runDaemonMode`, the `log()` sink, `runConductorInWorktree`
  (in-process feature execution → why serial), `holdLock` wiring.
- `src/conductor/src/engine/daemon-lock.ts` — `ensureRunning`, pidfile primitives, add `daemonDir`.
- `src/conductor/src/engine/daemon-observe-cli.ts` — `status`/`logs`; augment `status` with `hasSession`.
- `src/conductor/src/engine/engineer/handoff-step.ts` — the engineer nudge to repoint at `daemon start`.
- `bin/conduct` — bash wrapper routing fix.

## Verification

- **Unit:** supervisor-port tmux adapter with an injected runner (assert exact `tmux` argv for each
  verb, read-only flag on `connect`); `daemon-command` routing for `start/stop/restart/connect/debug`;
  engineer handoff calls `start` (not `ensureRunning`); concurrency forced to 1; **bare-run invariant**
  (daemon runs with no tmux present); **intake/execute seam** (execution consumes from an injected
  work-source — local in-process adapter exercised; seam swappable).
- **Manual end-to-end** in a real repo with the new binary:
  1. `conduct-ts daemon start` → `tmux ls` shows `cc-daemon-<slug>`; `.daemon/daemon.pid` written.
  2. `conduct-ts daemon connect` → live **colored** stream; detach with `Ctrl-b d`.
  3. `conduct-ts daemon debug` → attach read/write; `Ctrl-c` pauses the loop; inspect; restart.
  4. `conduct-ts daemon restart` → inner pid changes, session persists.
  5. Second `conduct-ts daemon start` → idempotent no-op (session already live).
  6. `conduct-ts daemon stop` → session gone, lock released.
  7. Engineer nudge while session alive → no-op (no duplicate session/daemon).
- `test/test_harness_integrity.sh` green.
