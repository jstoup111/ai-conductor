# Components: Intra-step Build Progress + Stall Events (issue #347)

**Last updated:** 2026-07-10
**Scope:** L3 component view of the new build-progress watcher, the two new
`ConductorEvent` kinds it emits, and every subscriber render path that consumes
them. Amends the Phase 9.1 emission-path view (`2026-06-25-phase-9.1-emission-path.md`)
and builds on the Wave C subscriber ruling (JSON-stdout `ui_renderer` plugin, no
`index.ts` edits).

## Diagram

```mermaid
graph TD
    subgraph BuildWorktree["Build worktree (agent side)"]
        TASKCLI["task-cli start/done<br/>flips task rows"]
        TSJ["task-status.json<br/>engine-owned, atomic writes"]
        GITLOG["worktree git HEAD<br/>commit movement"]
        TASKCLI --> TSJ
    end

    subgraph Engine["Conductor engine (daemon or TTY process)"]
        COND["conductor.ts build step<br/>awaits stepRunner.run"]
        WATCH["BuildProgressWatcher NEW<br/>unref interval poll ~30s<br/>snapshot diff + stall clock"]
        BREAKER["post-hoc stall breaker<br/>existing, unchanged semantics"]
        BUS["ConductorEventEmitter<br/>ui/events.ts"]
        COND -- "start on step entry<br/>stop on step settle" --> WATCH
        WATCH -- "reads on interval" --> TSJ
        WATCH -- "reads on interval" --> GITLOG
        WATCH -- "build_progress NEW<br/>on change only" --> BUS
        WATCH -- "build_no_progress NEW<br/>after quiet threshold" --> BUS
        COND --> BREAKER
        BREAKER -- "build_stall existing<br/>now actually rendered" --> BUS
    end

    subgraph Subscribers["Subscribers (render paths)"]
        DLOG["renderDaemonEvent<br/>daemon.log heartbeat + warnings"]
        TTY["createRenderer<br/>TTY lines"]
        OTEL["OtelVisualizer<br/>span events"]
        PERSIST["EventPersister<br/>events.jsonl"]
        UIPLUG["ui_renderer plugin NEW<br/>JSON-stdout, Wave C style"]
    end

    BUS --> DLOG
    BUS --> TTY
    BUS --> OTEL
    BUS --> PERSIST
    BUS --> UIPLUG

    DSTATUS["conduct daemon status<br/>tails daemon.log last line"]
    DLOG -- "build N-of-M line becomes<br/>lastActivity" --> DSTATUS
```

## Legend

- **NEW** — components or event kinds introduced by this feature.
- `BuildProgressWatcher` — new engine module; owns the interval timer, the last-seen
  snapshot (resolved count, current task id, worktree HEAD), and the quiet-period
  clock. Emits on *change*, never on a fixed cadence, except a low-frequency
  heartbeat re-emit so `daemon status` stays fresh.
- `build_stall` — existing event, emitted at `conductor.ts:1762`; today no renderer
  handles it (TTY and daemon renderers both drop it, OTel never subscribes). This
  feature adds render cases; emission semantics are unchanged.
- The bus (`ConductorEventEmitter`) swallows subscriber errors — a broken renderer
  cannot crash the engine (Wave B isolation, preserved).
- The `ui_renderer` plugin follows the Wave C ruling: discoverable via `plugin.yml`,
  zero edits to `src/index.ts`, one JSON line per event on stdout.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for issue #347 |
