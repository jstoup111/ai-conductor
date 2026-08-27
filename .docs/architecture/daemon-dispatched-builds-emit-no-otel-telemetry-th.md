# Components: Daemon OTel wiring via shared visualizer seam

**Last updated:** 2026-08-26
**Scope:** How the OTel visualizer reaches BOTH entry points — interactive `main()` and the
daemon's per-feature dispatch — through one shared wiring seam, closing the gap where
`daemon-cli.ts` built its own buses with no visualizer (#1934).

## Diagram

```mermaid
graph TD
    subgraph seam["Shared wiring seam (NEW)"]
        wire["wireOtelVisualizer(config, ctx, events)<br/>resolveOtelConfig → createOtelVisualizer → start()"]
    end

    subgraph interactive["Interactive entry (index.ts main tail)"]
        ibus["run event bus"]
        ipipe[".pipeline/ of primary checkout"]
    end

    subgraph daemon["Daemon entry (daemon-cli.ts)"]
        root["daemon-wide forwarding bus"]
        bfr["beginFeatureRun(worktree, item)"]
        fbus["per-feature bus (persistence.events)"]
        fpipe["worktree .pipeline/<br/>conduct-session-id = durable run id"]
        stop["beginFeatureRun stop()<br/>detach renderers + persistence"]
    end

    subgraph otel["OtelVisualizer (existing, engine/otel/)"]
        vis["OtelVisualizer<br/>start(bus) / stop() = forceFlush + handler cleanup"]
        res["buildResource<br/>service.name, conductor.run.id,<br/>conductor.feature, conductor.project"]
        otlp["OTLP endpoint<br/>(per-project config; N daemons export independently)"]
    end

    ibus --> wire
    ipipe --> wire
    bfr --> wire
    fbus --> wire
    fpipe --> res
    wire --> vis
    vis --> res
    vis --> otlp
    stop -->|"await vis.stop() — flush on dispatch end,<br/>HALT and error included"| vis
    root -.->|"no visualizer on the root bus<br/>(per-feature attribution)"| fbus
```

## Legend

- **NEW** — the shared seam extracted from the interactive tail's inline block; both entry
  points call it, so a third entry point cannot silently omit the visualizer again.
- Per-feature attach: one visualizer per daemon dispatch, on the feature-scoped bus, with the
  worktree's `.pipeline/` as `pipelineDir` — `conductor.run.id` resolves to the durable
  `conduct-session-id`, so re-dispatches of the same feature in later daemon processes stitch
  by run id (per-dispatch traces, shared identity).
- Disabled/absent OTel config → `wireOtelVisualizer` returns null; daemon behavior unchanged.
  Unreachable endpoint → `onWarning` bridges to a `renderer_error` event (bounded warning).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1934 (daemon emits no OTel) |
