# Sequence: Suppression lifecycle after the #369 repair

**Last updated:** 2026-07-10
**Scope:** Non-convergent restart followed by a converged boot — showing the corrected suppression key (marker target) and the newly wired clear-on-convergence. Boot runs through `initStaleEngineState` (single path).

## Diagram

```mermaid
sequenceDiagram
    participant CLI as runDaemonMode
    participant INIT as initStaleEngineState
    participant RI as restart-intent.ts
    participant TICK as runDaemon idle tick
    participant CHK as staleEngineChecker

    Note over CLI,RI: Boot 2 after a restart that failed to converge - fresh X, marker target T
    CLI->>INIT: init(repoPath, entryPath, flag)
    INIT->>RI: readRestartMarkerWithStatus
    RI-->>INIT: marker from F to T
    INIT->>INIT: log restarted for engine refresh - from F to T, fresh X
    INIT->>RI: recordSuppression(T) - marker target, was fresh X before this fix
    INIT->>RI: clearRestartMarker
    INIT-->>CLI: captured identity X

    Note over TICK,CHK: Later idle tick in the same boot - rebuild regenerates the same dist T
    TICK->>CHK: check()
    CHK-->>TICK: stale - captured X, on-disk T
    TICK->>TICK: log stale verdict with fromIdentity X and targetIdentity T
    TICK->>RI: isSuppressed(T)
    RI-->>TICK: true - restart toward T already failed, hold
    Note over TICK: no restart request - loop broken within the same boot

    Note over CLI,RI: Boot 3 - a restart that converged - fresh Y, marker target Y
    CLI->>INIT: init(repoPath, entryPath, flag)
    INIT->>RI: readRestartMarkerWithStatus
    RI-->>INIT: marker from X to Y
    INIT->>RI: clearSuppression - converged, record must not linger
    INIT->>RI: clearRestartMarker
    INIT-->>CLI: captured identity Y
```

## Legend

- **X / T / F / Y** are engine identities (sha256 of `dist/index.js`): F = pre-restart, X = fresh non-converged boot, T = the target that failed to converge, Y = a later converged identity.
- Before this fix, boot 2 recorded **X** — but a stale verdict in that boot means on-disk ≠ X, so `isSuppressed(on-disk)` could never match and the restart loop continued.
- Boot 3's `clearSuppression` is the newly wired call — previously the function had zero production callers and a stale record persisted until it happened to be overwritten.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#369 |
