# Architecture: Connector Seam — Visualizer Selection Loop (finishes ADR-014)

**Last updated:** 2026-08-26
**Scope:** Wiring the registered-but-never-started `visualizer` plugin kind into the run loop —
registry selection mirroring `ui_renderer`, the built-in OTel exporter re-registered through the
same seam, an identity context on `start()`, error isolation so no connector can fail the run,
a config enablement key, and load-time shape validation. Consumed by `/architecture-review`.
**Source:** jstoup111/ai-conductor#1516; ADR-014 (otel-observability-exporter), ADR-002, ADR-003.

---

## Component view — selection loop and seam (changed vs existing)

```mermaid
graph TD
    subgraph discovery["plugin discovery (existing, ADR-002)"]
        loader["discoverPlugins()<br/>global then project dirs · plugin-loader.ts"]
        shape["visualizer shape validation (NEW)<br/>reject non-conforming entrypoint at load<br/>mirrors llm_provider check · plugin-loader.ts"]
        registry["PluginRegistry<br/>register / get / tryGet / list"]
        builtins["registerBuiltins (CHANGED)<br/>+ visualizer:otel factory<br/>· plugin-loader.ts"]
    end

    subgraph config["config (CHANGED)"]
        key["visualizers: [names] (NEW key)<br/>types/config.ts · docs/reference/configuration.md"]
        otelgate["otel.enabled gate (unchanged)<br/>resolveOtelConfig · otel-config.ts"]
    end

    subgraph runloop["run loop · index.ts (CHANGED)"]
        select["visualizer selection (NEW)<br/>named-but-missing → warn once, skip<br/>mirrors resolveMemoryProvider fallback"]
        build["buildVisualizers (CHANGED)<br/>per-plugin try/catch on start:<br/>throw → renderer_error-style event, run continues"]
        stop["stopVisualizers (existing)<br/>Promise.all, per-plugin catch"]
    end

    subgraph seam["connector seam (CHANGED contract)"]
        iface["VisualizerPlugin<br/>start(emitter, context) · stop()<br/>context: runId · project · branch ·<br/>feature · engineVersion · pipelineDir (NEW)"]
    end

    subgraph consumers["connectors on the seam"]
        otelvis["OtelVisualizer (CHANGED packaging)<br/>identity via start() context,<br/>constructor keeps exporter knobs<br/>· otel-visualizer.ts"]
        thirdparty["installed connector plugin<br/>«any kind: visualizer install»"]
    end

    subgraph spine["event spine (existing, unchanged)"]
        bus["ConductorEventEmitter · ui/events.ts"]
        persist["EventPersister → .pipeline/events.jsonl"]
        sinks["event-sinks.ts EVENT_SINKS<br/>(no connector column — visualizers<br/>self-select via emitter.on, documented)"]
    end

    loader --> shape --> registry
    builtins --> registry
    key --> select
    otelgate --> select
    registry --> select
    select --> build
    build -->|"start(emitter, context)"| iface
    iface --> otelvis
    iface --> thirdparty
    bus --> otelvis
    bus --> thirdparty
    bus --> persist
    stop -.->|flush on teardown| otelvis
```

## Sequence — startup selection and isolated failure

```mermaid
sequenceDiagram
    participant M as main() · index.ts
    participant R as PluginRegistry
    participant B as buildVisualizers
    participant V as connector «name»
    participant E as ConductorEventEmitter

    M->>R: registerBuiltins (incl. visualizer:otel)
    M->>R: discoverPlugins (shape-validates visualizer entries)
    M->>M: resolve enabled connectors<br/>(config visualizers key + otel gate)
    M->>R: tryGet('visualizer', «name») per enabled name
    alt named but not registered
        M->>M: warn once, skip «name» (run continues)
    end
    M->>B: buildVisualizers(list, emitter, context)
    B->>V: start(emitter, context)
    alt start throws
        B->>E: emit error event (renderer_error-style)
        Note over B: connector dropped — other connectors and the run continue
    end
    V->>E: on(type, handler) — self-selected types
    Note over E: emit() already isolates handler errors (swallow)
    M->>V: stopVisualizers → stop() (per-plugin catch, OTel flush)
```

## Legend

- **NEW / CHANGED** markers name the delta; everything else is existing behavior left intact.
- `«name»` — placeholder for a configured connector name.
- Error-isolation rule mirrors ADR-003 (ui_renderer): a failing plugin never poisons the others
  or the run. Named-but-missing resolution mirrors `resolveMemoryProvider` (warn once, skip).
- The sink registry deliberately gains no connector column: connectors self-select event types
  via `emitter.on`, and that divergence is documented rather than reconciled (Approach B rejected
  in `.memory/decisions/connector-seam-approach.md`).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1516 — finish ADR-014's selection loop |
