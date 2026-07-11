# Sequence: Single-generation stale-engine respawn (#400 fix)

**Last updated:** 2026-07-07
**Scope:** The hardened respawn-in-place flow — exactly one daemon generation survives a
stale-engine transition. Fixes the three #400 defects: multi-fire trigger, surviving
predecessor, resident lock-losers. Issue jstoup111/ai-conductor#400.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon predecessor (old engine)
    participant FS as Filesystem
    participant T as tmux pane
    participant D2 as Daemon successor (new engine)

    Note over D: idle boundary - inFlight is 0
    D->>D: stale verdict - all gates pass
    rect rgb(235, 245, 235)
        Note over D: FIX 1 - one-shot guard set BEFORE any side effect.<br/>Later idle polls can never re-fire the trigger
        D->>D: staleRestartFired = true
    end
    D->>FS: relinkSkillsForSelfBuild
    D->>FS: write RESTART_PENDING marker<br/>(from «old-id» to «target-id»)
    alt tmux session exists
        D->>T: triggerSelfRestart - respawnPane -k
        rect rgb(235, 245, 235)
            Note over D: FIX 2 - predecessor terminates unconditionally.<br/>release pidfile lock, break loop, exit 0.<br/>Survives even if respawn-pane -k fails to kill it
        end
        D->>FS: release pidfile lock
        D->>D: exit 0
        T->>D2: relaunch in SAME pane
    else headless
        D->>FS: release pidfile lock
        D->>D: exit 0 (unchanged fallback)
        Note over T: dead pane held by remain-on-exit,<br/>revived by next start or ensureRunning
    end
    rect rgb(235, 245, 235)
        Note over D2: FIX 3 - bounded lock takeover.<br/>holdLock waits bounded for the exiting predecessor<br/>to release (or reclaims a dead-pid pidfile)
    end
    D2->>FS: holdLock - bounded wait, then acquire
    alt lock acquired
        D2->>FS: handshake - read and clear marker,<br/>loop-guard on «target-id»
        Note over D2: exactly ONE daemon process remains<br/>(pgrep count is 1 across the transition)
    else lock still held by a LIVE daemon after the bound
        rect rgb(250, 235, 235)
            Note over D2: FIX 3b - loser terminates.<br/>log and exit 0 explicitly - never stays resident
        end
        D2->>D2: exit 0
    end
```

## Legend

- `«old-id»` / `«target-id»` are placeholder engine-identity hashes.
- Green boxes are the #400 hardening points; the red box is the hardened loser path.
- **FIX 1** closes the four-respawns-in-60s burst: the pre-fix idle branch
  (`daemon.ts:818-851`) re-fired `requestRestart` on every idle poll with no guard and no
  `break` — unlike the `RESTART-PENDING` verb path, which already guards with
  `restartTriggeredSuccessfully`.
- **FIX 2** closes predecessor survival: the pre-fix session-hosted requester
  (`daemon-cli.ts:320-331`) trusted `respawn-pane -k` to kill the process and deliberately
  skipped lock-release/exit; observed evidence (#400) shows predecessors survive. Exit is
  now unconditional after firing; ordering is trigger → release → exit so the successor's
  bounded wait (FIX 3) plus dead-pid stale reclaim covers both kill orderings.
- **FIX 3** closes resident losers: pre-fix, a successor losing `holdLock` merely
  `return`ed (`daemon-cli.ts:430-433`) and the process stayed alive in the pane. The loser
  path now ends in an explicit exit, and acquisition first waits bounded for the
  predecessor's in-flight release rather than declaring defeat instantly.
- Re-enables `auto_restart_on_stale_engine` (reverts the #402 operational disable).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#400 |
