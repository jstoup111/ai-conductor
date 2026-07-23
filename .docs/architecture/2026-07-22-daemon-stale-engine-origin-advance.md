# Architecture: Daemon engine freshness on origin/main advance

**Last updated:** 2026-07-22
**Scope:** The quiescent-boundary engine-refresh gate — how a fix merged to
`origin/main` reaches the running daemon's loaded engine (fast-forward →
rebuild/publish → stale check → restart transport), and the loud-staleness
degraded paths when the self-heal chain cannot run. Feature:
`daemon-stale-engine-origin-advance` (intake #598, Tier M, technical track).

## Context (as-is gap)

The stale-engine checker hashes `dist/index.js` (engine-identity.ts). `dist` is
untracked (#309), so a merge to `origin/main` moves source only. The
pre-dispatch gate `rebuildAndMaybeRestartForStaleEngine` (daemon.ts:917-945)
rebuilds the daemon's own checkout **without fast-forwarding it first** —
`fastForwardRoot()` (daemon-backlog.ts:149) runs only on `refresh:true` paths
(startup / fully-drained idle). A behind checkout rebuilds byte-identical
content, `publish-engine.mjs:340` logs "content unchanged — publish skipped",
the checker returns `current`, and the daemon runs the pre-fix engine forever.

## Diagram: quiescent-boundary refresh gate (to-be)

```mermaid
graph TD
    QB["Quiescent boundary<br/>(pre-dispatch, inFlight = 0;<br/>and drained idle)"] --> ARMED{"staleGatesArmed?<br/>continuous AND selfHost AND<br/>auto_restart_on_stale_engine"}
    ARMED -- no --> ADV["Advisory-only staleness probe<br/>(non-self-host / flag off):<br/>loud warn if engine behind origin,<br/>with exact reload path"] --> DISPATCH["proceed to dispatch"]
    ARMED -- yes --> FF["NEW: fastForwardRoot()<br/>fetch origin «default»<br/>merge --ff-only"]
    FF -- "ff ok / already current" --> REBUILD["rebuildEngine()<br/>npm run build → publish-engine.mjs"]
    FF -- "skip: dirty tree /<br/>diverged / fetch failure" --> WARN["NEW: loud staleness warning<br/>cause + exact reload path<br/>(pull, build, daemon restart)"] --> REBUILD
    REBUILD -- "content changed:<br/>flip dist symlink,<br/>stamp source SHA sidecar" --> CHECK{"staleEngineChecker.check()<br/>hash(dist/index.js) ≠ captured?"}
    REBUILD -- "content unchanged:<br/>publish skipped" --> CHECK
    CHECK -- stale --> SUPP{"non-convergence<br/>suppressed?"}
    CHECK -- current --> DISPATCH
    SUPP -- no --> RESTART["requestRestart():<br/>write RESTART_PENDING,<br/>release lock, exit(0)"]
    SUPP -- yes --> DISPATCH
    RESTART --> RESPawn["supervisor respawns daemon;<br/>re-resolves dist symlink<br/>(#400 single-generation handoff)"]

    style FF fill:#c8e6c9,stroke:#2e7d32
    style WARN fill:#ffe0b2,stroke:#e65100
    style ADV fill:#ffe0b2,stroke:#e65100
    style RESPawn fill:#e1f5fe,stroke:#0277bd
```

## Diagram: merged-fix propagation sequence (to-be)

```mermaid
sequenceDiagram
    participant GH as origin/main
    participant D as daemon (pinned dist-versions/«old»)
    participant Git as repo checkout
    participant Pub as publish-engine.mjs
    participant Chk as staleEngineChecker
    participant Sup as supervisor

    Note over GH: engine fix merges (commit F)
    D->>D: quiescent boundary reached (inFlight = 0)
    D->>Git: NEW fastForwardRoot() — fetch + merge --ff-only
    alt fast-forward succeeds
        Git-->>D: HEAD now includes F
        D->>Pub: rebuildEngine() (npm run build)
        Pub->>Pub: build → content hash differs
        Pub-->>D: flip dist → dist-versions/«new», stamp source SHA
        D->>Chk: check()
        Chk-->>D: stale (hash drifted)
        D->>Sup: requestRestart() — marker, lock release, exit(0)
        Sup->>D: respawn — new daemon binds dist-versions/«new»
        Note over D: subsequent builds run post-fix engine (versionId ≥ F)
    else ff impossible (dirty / diverged / fetch fail) or non-self-host
        D->>D: LOUD staleness warning — cause + exact reload path
        Note over D: engine stays pinned, but staleness is never silent
    end
```

## Legend

- **Green** — new fast-forward step (reuses existing `fastForwardRoot`, same
  clean-tree + on-default-branch guards).
- **Orange** — new loud-staleness surfacing (degraded paths that previously
  stayed silent).
- **Blue** — existing #400 single-generation restart transport (unchanged).
- `«default»` / `«old»` / `«new»` — placeholder for the derived default branch
  and engine version ids.
- Invariants preserved: never swap code mid-build (quiescent-only), fail-closed
  on indeterminate hash, non-convergence suppression, single daemon generation.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | Spec authoring for daemon-stale-engine-origin-advance (#598) |
