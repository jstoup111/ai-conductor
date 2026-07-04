# Architecture: Daemon Lifecycle Controls

**Last updated:** 2026-07-04
**Scope:** Planned architecture for fleet **pause/resume**, idle-gated **restart-in-place**
(tmux session preserved), and **rebuild-safe engine versioning** (the #215 fix) in
`src/conductor`. Extends the supervised-hosting management plane (adr-2026-06-29) and the
pidfile-authority posture (adr-010). Proposed mechanisms shown here (versioned dist +
atomic current pointer, durable pause marker) are architecture-review's to confirm.
Current-state + additions. New elements marked **[NEW]**.

## Diagram 1 — Lifecycle control plane over the fleet

```mermaid
flowchart TD
  operator([Operator · human]) -->|"pause / resume / restart --all or repo list"| verbs

  subgraph mgmt["Management plane (extends adr-2026-06-29)"]
    verbs["daemon verb routing<br/>(index.ts → daemon-command.ts)"]
    fleet["[NEW] fleet iterator<br/>enumerate registry, act per repo,<br/>report per-repo outcome (FR-3/10/17)"]
    port{{"Supervisor port<br/>start·stop·restart·attach·logs·exec·isUp"}}
    tmux["tmux adapter (daemon-tmux.ts)<br/>[NEW] restart = respawn-in-place"]
    verbs --> fleet
    fleet --> port
    port --> tmux
  end

  subgraph repo["Per repo (authority stays local — adr-010)"]
    paused["[NEW] durable pause marker<br/>.daemon/PAUSED (repo-scoped)"]
    pid["pidfile .daemon/daemon.pid<br/>(single-owner, authoritative)"]
    session["tmux session cc-daemon-«slug»-«hash»<br/>[NEW] survives restart (FR-20)"]
    loopd["daemon loop (daemon.ts)<br/>[NEW] pause check at fill-pool /<br/>pickEligible boundary (FR-1)"]
    fleet -->|"pause = write marker<br/>resume = remove marker"| paused
    tmux -->|"respawn inside existing session"| session
    session --> loopd
    loopd -->|"reads each tick"| paused
    loopd --> pid
  end

  registry["registry.json<br/>(non-authoritative mirror — enumeration only)"]
  fleet -->|"read repo list"| registry

  classDef new fill:#e6ffe6,stroke:#2a2;
```

## Diagram 2 — Rebuild-safe engine versioning (proposed — closes #215)

```mermaid
flowchart TD
  build["harness build<br/>(npm run build / bin/setup)"] --> vdir["[NEW] emit to versioned dir<br/>dist-«sha»/ (never in-place)"]
  vdir --> flip["[NEW] atomic flip of current pointer<br/>(symlink rename — publish step)"]

  subgraph resolve["Engine resolution"]
    launcher["bin/conduct-ts<br/>[NEW] resolves engine via current pointer"]
    pin["[NEW] running daemon pins the real dir<br/>it started from — lazy imports keep<br/>resolving inside that dir (FR-13)"]
    launcher --> pin
  end

  flip --> launcher

  subgraph gc["[NEW] Version cleanup (FR-15)"]
    scan["enumerate dist-«sha» dirs"]
    refs["collect versions still referenced by<br/>live pidfiles + current pointer"]
    del["delete only unreferenced,<br/>non-current versions"]
    scan --> refs --> del
  end

  flip -.-> gc

  old["old daemon (started before rebuild)"] -->|"keeps executing its pinned dir<br/>until IT restarts (FR-13/14)"| pin

  classDef new fill:#e6ffe6,stroke:#2a2;
```

## Diagram 3 — Restart decision (idle-gated, session-preserving)

```mermaid
flowchart TD
  r([daemon restart]) --> up{"daemon running?"}
  up -- "no" --> notrun["[NEW] clear outcome — start it or<br/>report not-running (FR-12), never a hang"]
  up -- "yes" --> busy{"feature in flight?"}
  busy -- "yes" --> waitq["[NEW] wait for idle / require pause —<br/>report what restart is waiting on (FR-9).<br/>Never interrupts a build"]
  waitq --> idle
  busy -- "no" --> idle["idle or paused"]
  idle --> sess{"existing tmux session?"}
  sess -- "yes" --> respawn["[NEW] respawn inside SAME session —<br/>scrollback + windows survive (FR-20)"]
  sess -- "no" --> fresh["create session cleanly (FR-21)"]
  respawn --> handoff["[NEW] pidfile handoff: old owner releases,<br/>new process acquires (adr-010 preserved)"]
  fresh --> handoff
  handoff --> newver["new process resolves current engine<br/>version (FR-8/14); pause state preserved (FR-11)"]
```

## Legend

- **[NEW]** — added by this feature; unmarked elements exist today.
- Green class styling marks new subsystems where applied.
- `«slug»`, `«sha»`, `«hash»` — placeholders for repo slug, build content hash, path hash.
- Solid arrows: control/data flow. Dashed arrows: triggering/optional relationships.

## Notes

- **Pause gates pickup, not execution (FR-1):** the marker is read at the dispatch
  boundary (`pickEligible` / fill-pool guard and the idle tick). In-flight features drain
  normally; HALT parking is untouched. The marker follows the existing single-source
  signal-file pattern (`halt-marker.ts` precedent) but is **repo-scoped** (`.daemon/`),
  not feature-scoped (`.pipeline/`).
- **Durability (FR-4/7):** the pause marker is a file, so it survives crash, reboot, and
  restart, and a daemon launched by automation (`ensureRunning`) in a paused repo comes
  up paused. `ensureRunning` keeps its launch-not-manage contract (ADR-005) — it may
  start a daemon, but the started daemon immediately honors the marker.
- **Authority split preserved (adr-010):** fleet operations enumerate the registry but
  every control decision is per-repo against that repo's pidfile/marker; the registry
  mirror stays non-authoritative. Best-effort iteration: one repo's failure never aborts
  the rest (FR-17).
- **Restart-in-place vs today:** the current tmux adapter restart is kill-session +
  new-session (destroys scrollback). The new behavior respawns the daemon command
  inside the existing session; kill+recreate remains only the no-session fallback.
- **Versioned engine is the unconditional #215 fix:** running daemons are immune to
  rebuilds by construction (they pin their version directory), not by operator
  discipline. Pause-then-restart remains the orderly upgrade recipe, but forgetting it
  no longer crashes anything.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial planned-architecture diagrams | DECIDE phase for daemon-lifecycle-controls (ai-conductor#215) |
| 2026-07-04 | Confirmed against implementation plan (38 tasks, 3 phases); mechanisms now decided in the four 2026-07-04 ADRs | /plan update pass |
