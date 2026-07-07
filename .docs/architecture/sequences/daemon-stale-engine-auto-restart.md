# Sequence: Daemon stale-engine auto-restart

**Last updated:** 2026-07-03
**Scope:** The exit-to-respawn flow — from a self-build merge rebuilding `dist/` to the daemon converging on the new engine. Issue jstoup111/ai-conductor#256.

## Diagram

```mermaid
sequenceDiagram
    participant B as Self-build finish<br/>(rebuild of dist)
    participant D as Daemon (old engine)
    participant FS as Filesystem
    participant S as Respawn transport (#215)
    participant D2 as Daemon (new engine)

    Note over D: startup - EngineIdentity.capture()<br/>hash of loaded dist entry saved in memory
    B->>FS: writes new dist («new-hash»)
    D->>D: idle branch - inFlight is 0, nothing eligible
    D->>FS: re-stat and hash dist entry
    FS-->>D: «new-hash» differs from captured «old-hash»
    D->>D: gates - selfHost true, flag on,<br/>determinate, loop-guard clear
    D->>FS: write .daemon/RESTART_PENDING<br/>(reason, old and target identity)
    D->>FS: release pidfile lock
    D->>S: clean exit (code 0)
    S->>D2: respawn daemon on current dist
    D2->>FS: read and clear RESTART_PENDING
    Note over D2: log restarted-for-engine-refresh<br/>capture new identity, resume loop
```

## Legend

- `«old-hash»` / `«new-hash»` are placeholder engine-identity values.
- The transport between exit and respawn is deliberately opaque here — it is #215's restart primitive. Until #215 lands, a manual `daemon start` / `ensureRunning` nudge plays that role.
- **Superseded 2026-07-06 (#353):** this flow's exit step stranded the daemon `stopped` (transport keyed to a different marker file; `remain-on-exit` never armed). The current flow is `sequences/daemon-restart-leaves-the-daemon-stopped-when-orig.md` — respawn-in-place when a session exists, marker+exit only headless.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#256 |
| 2026-07-06 | Legend note: flow superseded by respawn-in-place wiring | Issue #353 (respawn gap) |
