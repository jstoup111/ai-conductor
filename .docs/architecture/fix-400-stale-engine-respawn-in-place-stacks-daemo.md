# Components: Single-generation stale-engine respawn (#400 fix)

**Last updated:** 2026-07-07
**Scope:** The components touched by the #400 hardening (Approach A — harden the existing
`RESTART_PENDING` stale-engine path in place; pipeline unification is follow-up #408).

## Diagram

```mermaid
graph TD
    subgraph Predecessor["Daemon predecessor process"]
        IDLE["Idle branch<br/>engine/daemon.ts idle boundary"]
        GUARD["One-shot trigger guard<br/>CHANGED - staleRestartFired flag plus break,<br/>mirrors restartTriggeredSuccessfully on the verb path"]
        REQ["createRestartRequester<br/>CHANGED - daemon-cli.ts<br/>session-hosted now releases lock and exits 0<br/>unconditionally after firing"]
    end

    subgraph Successor["Daemon successor process"]
        HOLD["holdLock<br/>CHANGED - engine/daemon-lock.ts<br/>bounded wait for predecessor release,<br/>dead-pid stale reclaim unchanged"]
        LOSER["Lock-loser path<br/>CHANGED - daemon-cli.ts<br/>explicit exit 0, never resident"]
        HAND["Boot handshake<br/>UNCHANGED - read and clear marker,<br/>loop-guard on target identity"]
    end

    MARKER[".daemon/RESTART_PENDING<br/>restart-intent marker - UNCHANGED"]
    TMUX["respawnPane -k<br/>engine/daemon-tmux.ts - UNCHANGED transport"]
    CFG[".ai-conductor/config.yml<br/>auto_restart_on_stale_engine<br/>CHANGED - re-enabled, reverts #402"]

    CFG -- "gates" --> IDLE
    IDLE --> GUARD
    GUARD -- "first firing only" --> REQ
    REQ --> MARKER
    REQ --> TMUX
    REQ -- "release lock, exit 0" --> HOLD
    TMUX -- "relaunch in same pane" --> HOLD
    HOLD -- "acquired" --> HAND
    HOLD -- "live owner after bound" --> LOSER
    HAND -. "consume" .-> MARKER
```

## Legend

- **CHANGED** nodes are modified by this fix; **UNCHANGED** nodes are load-bearing context.
- Solid arrows: control flow. Dotted arrows: reads/writes.
- The two-pipeline structure (`RESTART_PENDING` underscore for stale-engine vs
  `RESTART-PENDING` hyphen for the restart verb) is retained by this fix; unifying them is
  follow-up jstoup111/ai-conductor#408.
- Invariant delivered: across a stale-engine transition, `pgrep -af "daemon --continuous"`
  for the repo counts exactly 1 at steady state.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#400 |
