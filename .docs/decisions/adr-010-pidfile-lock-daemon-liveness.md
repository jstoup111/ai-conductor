# ADR 010: Pidfile-lock daemon liveness, 1-per-repo mutex & ensure-running

**Date:** 2026-06-26
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.3 (redesign) — engineer loop, intake port & daemon liveness
**Decision surfaces:** liveness primitive + 1-per-repo mutex (FR-17/18/20), stale reclaim (FR-19),
ensure-running semantics (FR-21/22), `launchDaemonDetached` cwd fix (FR-22), registry mirror
authority (FR-23)

## Context

The engineer must, after opening a spec PR, make sure a daemon is running for the target repo —
without ever **managing** the daemon's lifecycle (ADR-005: launch-only, never supervise). Two
hazards:

1. **Duplicate daemons.** Two ideas routed to repo A in quick succession (or a manual start racing
   the engineer) could spawn two daemons that both build from `main` → duplicate PRs, racing
   worktrees, wasted compute. We need a **1-per-repo mutex**.
2. **Stale state.** A daemon killed with `kill -9` (or crash) leaves no clean signal. Whatever
   liveness mechanism we choose must distinguish *alive* from *dead-but-left-a-mark*, and a dead
   daemon must never permanently refuse the repo.

There is **no** liveness mechanism today; the shipped `launchDaemonDetached(project)` even passes a
**non-existent `--project` flag** (`['conduct','daemon','--project',project]`) instead of setting the
child's working directory — so the launched daemon does not reliably bind to the intended repo.

Forces:
- The mechanism must be a true mutex (atomic), survive `kill -9`, and need no always-on coordinator
  (the engineer is interactive/intermittent; the daemon is per-repo).
- ADR-005 forbids lifecycle ownership — ensure-running must be **fire-and-forget** (spawn iff
  none/stale, no-op if alive), never restart/health-manage.
- The 9.2 registry already mirrors `daemonState`, but a mirror updated by a separate writer can lag
  reality; the **source of truth must be local to the repo**.
- **The PRD (FR-20 / Open Questions) flags the single-winner concurrency model as expected to change
  in a future iteration.** So the *lock primitive* must be isolated/swappable without touching
  routing, authoring, or the daemon loop.

## Options Considered

### A (chosen): `.daemon/daemon.pid` with atomic `O_EXCL` create as the mutex; `kill(pid,0)` liveness
Acquire by creating `.daemon/daemon.pid` with `O_EXCL` (atomic "create-only-if-absent" = the kernel
arbitrates a single winner). The file holds `{ pid, uuid, startedAt }`. Liveness is
`process.kill(pid, 0)`: `ESRCH` → dead/stale → reclaimable; success or `EPERM` → treat **alive**.
`ensure-running` probes the lock and spawns a detached daemon **only** when there is no lock or the
lock is stale; the daemon itself acquires the lock on boot (so the engineer never holds it). The
registry `daemonState` is a **non-authoritative mirror** for reporting; the pidfile decides.
- **Pros:** atomic single-winner with no coordinator; survives `kill -9` (stale pidfile is
  detectable + reclaimable); source of truth lives **with the repo**; tiny, swappable surface.
- **Cons:** pid reuse is theoretically possible (mitigated by the stored `uuid`); `EPERM` is treated
  conservatively as alive (correct — never reclaim a lock we cannot prove dead).

### B: Registry-heartbeat liveness (daemon writes `lastHeartbeat` to 9.2 registry; staleness = timeout)
- **Pros:** single inspectable store; no per-repo file.
- **Cons:** **not a mutex** (two daemons can both heartbeat — needs a *separate* lock anyway);
  introduces a tunable timeout (false-positive reclaim of a slow-but-alive daemon, or slow reclaim of
  a dead one); makes the **shared registry authoritative for liveness**, the exact coupling we want to
  avoid (ADR-002/003 keep the registry a routing/index store, not a control bus). *Rejected as the
  primary mechanism.* The registry remains a **mirror** only (Option A keeps it for reporting).

## Decision

**Adopt the pidfile `O_EXCL` lock (A).** The atomic create is the 1-per-repo mutex; `kill(pid,0)` is
liveness; the registry `daemonState` is a reporting mirror only.

**Mechanism (locked):**
- **Lock = mutex (FR-17/20):** `.daemon/daemon.pid` created with `O_EXCL`. The daemon acquires it on
  boot; the **atomic create is the single-winner gate** — two concurrent boots, exactly one wins, the
  loser no-ops/exits 0 (never errors, never a second builder).
- **Liveness (FR-18):** `process.kill(pid, 0)` → `ESRCH` = dead (reclaim); success/`EPERM` = **alive,
  never reclaimed**. A `uuid` in the pidfile guards against pid reuse.
- **Stale reclaim (FR-19):** a dead lock (`ESRCH`) is reclaimed by re-creating via `O_EXCL` (the
  reclaim itself races safely — only one reclaimer wins). A repo is **never permanently refused**
  because of a stale pidfile + half-built worktree.
- **ensure-running (FR-21) — non-autonomous (ADR-005):** probe the lock; **alive → no-op**;
  **none/stale → spawn one detached daemon**. Fire-and-forget: no restart, no health management, no
  lifecycle ownership. (ADR-005 explicitly covers this as "launch, never manage" — confirmed still
  holding; see review.)
- **`launchDaemonDetached` fix (FR-22):** spawn with **`cwd: repoPath`** (canonical path from the 9.2
  registry), **not** the bogus `--project` flag. The daemon binds to the repo via its working
  directory; detached + stdio-detached so the engineer session can exit.
- **Registry mirror (FR-23):** `daemonState` in the 9.2 registry is updated best-effort for
  reporting/governor visibility and is **explicitly non-authoritative** — on any disagreement the
  **pidfile wins**. No control decision reads the mirror.
- **Isolation for the flagged future change (FR-20 caveat):** the entire lock/liveness primitive is
  confined behind a single module boundary (acquire / isLive / reclaim / ensureRunning). Routing,
  authoring, and the daemon loop call **only** that boundary, so swapping the single-winner model
  later (the PRD's flagged iteration) is a localized change with no ripple.

## Consequences

### Positive
- True atomic 1-per-repo mutex with no always-on coordinator; correct under `kill -9`.
- Liveness source of truth lives with the repo; the shared registry stays a routing/index store.
- The launch bug is fixed at the boundary; the primitive is swappable for the flagged FR-20 rework.

### Negative / Risks
- **FR-20 single-winner model is explicitly expected to change** — accepted; mitigated by confining
  the primitive behind one module boundary (swap without ripple).
- Theoretical pid reuse → mitigated by the stored `uuid`.
- `EPERM` treated as alive could, in principle, delay reclaim of a same-pid foreign process — chosen
  deliberately (never reclaim a lock we cannot prove dead); acceptable at solo scale.

### Follow-up Actions
- [ ] `.daemon/daemon.pid` `{pid,uuid,startedAt}`; `O_EXCL` acquire = single-winner (test: 2 concurrent
      boots → exactly one owns).
- [ ] `kill(pid,0)` liveness: `ESRCH`→stale, success/`EPERM`→alive; `uuid` guards pid reuse.
- [ ] Stale reclaim after `kill -9` (test: stale pidfile + half-built worktree → ensure-running
      reclaims + respawns, never permanent refusal).
- [ ] ensure-running fire-and-forget: alive→no-op, none/stale→spawn one detached (no lifecycle mgmt).
- [ ] Fix `launchDaemonDetached` → `cwd: repoPath` (registry canonical path); drop `--project`.
- [ ] Registry `daemonState` mirror non-authoritative; pidfile wins on disagreement; no control read.
- [ ] Confine the primitive behind one module boundary (acquire/isLive/reclaim/ensureRunning) so the
      flagged FR-20 change is localized.
