# Architecture Review: Daemon Supervised Hosting

**Date:** 2026-06-29
**Mode:** Lightweight (Medium tier — Feasibility + Alignment)
**Stories reviewed:** `.docs/stories/daemon-supervised-hosting.md` (FR-1…FR-15)
**Inputs:** plan `2026-06-29-daemon-tmux-supervisor.md`, diagram
`2026-06-29-daemon-supervised-hosting.md`, ADRs 005/010, conflict report.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | OK. tmux CLI driven via `spawnSync` (no new npm dep); tmux 3.2a present on host. Adds a **management-plane** host dependency only. |
| Prerequisites | One-time: kill any currently-detached daemon so the first `daemon start` isn't lock-blocked (migration block required). |
| Integration surface | `daemon-tmux.ts` (new), `daemon-command.ts`, `index.ts`, `daemon-observe-cli.ts`, `daemon-launch.ts`, `daemon-lock.ts`, `handoff-step.ts`, `daemon-cli.ts`, `bin/conduct`. Bounded; reuses `daemonDir`/`holdLock`/`isLive`. |
| Data implications | None (no schema/migrations). State is the existing pidfile + new tmux session. |
| Performance risk | None material. tmux calls are sub-second control ops, not hot-path. |
| Worktree isolation | OK — and improved: session name carries an absolute-path hash, so two worktrees/repos never collide on a session (FR-11). Pidfile remains per-repo. |

## Alignment

- **ADR-005 (non-autonomy) — preserved.** The new lifecycle verbs (start/stop/restart/debug) are
  **operator-only**. The engineer automation path stays launch-only (`ensureRunning` = `isUp? →
  start`, fire-and-forget; state checks via `capturePane`, never `attach`). The invariant holds.
- **ADR-010 (pidfile single-owner) — preserved + superseded-in-part.** The pidfile lock stays the
  source of truth for inner 1-per-repo ownership. ADR-010’s **launch mechanism** (`launchDaemon`, the
  former detached `stdio:'ignore'` spawn, FR-22) is **superseded** by the daemon-supervisor ADR’s
  foreground-in-session host. Recorded in `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`;
  ADR-010’s lock/liveness decisions remain APPROVED and authoritative.
- **9.3b “no detached spawn in the poll” guard — must hold.** Condition C1 below: the new session
  start must live only in the sanctioned handoff nudge, never the engineer intake poll.
- **Pattern consistency.** Injectable-runner adapter matches the established `daemon-lock`/`daemon-launch`
  test seams (deps injection, argv assertion). The Supervisor port mirrors the hexagonal intake port
  (ADR-009) and the swappable lock primitive (ADR-010). No unjustified new pattern.
- **Diagram accuracy.** `.docs/architecture/2026-06-29-daemon-supervised-hosting.md` reflects the
  management/build plane split and the authority split; to be revalidated as-built at SHIP.

## Domain Integrity
Deferred to the TDD domain reviewer per-cycle (Medium-tier rule). Light note: model the supervisor
as a typed port (no stringly-typed verb dispatch leaking into the core); session name is a derived
value, not free input.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| tmux absent on a headless/cron host blocks management | Integration | Medium | Medium | Preflight + actionable error (FR-8); **bare-run** keeps builds working (FR-14) |
| Session start wired into engineer poll trips 9.3b guard | Integration | Low | Medium | Condition C1 — start only in handoff nudge; verify static guard |
| Stale reconciliation (session up, inner pid dead) misreported | Technical | Low | Medium | Status reconciles `hasSession` + `isLive` (FR-10) with explicit "stale" |

No High-impact risks.

## ADRs Created
- **`adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`** (DRAFT) — Daemon supervisor port
  + attachable foreground hosting. Supersedes the **launch mechanism** portion of ADR-010 (FR-22);
  preserves ADR-005 + ADR-010 lock/liveness. (Date+slug identifier per the post-#150 convention.)

## Conditions (APPROVED WITH CONDITIONS)
- **C1 — Engineer poll purity:** the new session `start` must appear **only** in the sanctioned
  handoff nudge, never the intake poll loop (upholds the 9.3b "no detached spawn in poll" guard).
  Evaluator + as-built review must confirm.
- **C2 — Bare-run invariant tested:** a test must prove the daemon runs correctly with **no tmux
  present** (management plane absent ⇒ build plane unaffected, FR-14).
- **C3 — Lock not re-encoded:** reuse `daemon-lock.ts` primitives (`daemonDir`, pidfile); the
  supervisor never re-encodes `.daemon/daemon.pid` (ADR-010 boundary).

## Gate
The daemon-supervisor ADR is **APPROVED** (operator-ratified 2026-06-29). BUILD gate cleared —
`/writing-system-tests` may begin.
