# Components: OTel two-layer identity (#1938)

**Last updated:** 2026-08-26
**Scope:** Identity propagation through `src/conductor/src/engine/otel/` — how project, feature,
and run id reach metric data points and the OTel Resource so metric backends can distinguish
projects and concurrent runs without collector rewriting.

## Diagram

```mermaid
graph TD
    subgraph Engine
        CTX["OtelVisualizerContext<br/>(project, feature, runId, pipelineDir)"]
    end

    subgraph otel["src/conductor/src/engine/otel/"]
        VIS["OtelVisualizer<br/>(wiring)"]
        RES["buildResource (resource.ts)<br/>service.name = ai-conductor (constant)<br/>service.instance.id = «runId» (NEW)<br/>conductor.run.id / feature / project"]
        MRC["MetricsRecorder (metrics.ts)<br/>constructor-injected identityAttrs (NEW)<br/>{ project, feature }"]
        SEAM["identity-merge seam (NEW)<br/>every record()/add() merges identityAttrs<br/>into per-point attrs"]
    end

    subgraph Backend["Metric backend (e.g. Prometheus)"]
        TI["target_info series<br/>job + instance = «runId» (joinable)"]
        DP["metric series<br/>labels: step, kind, model, obligation<br/>+ project, feature (NEW)"]
    end

    TEMPO["Trace backend (Tempo)<br/>resource-indexed, unchanged"]

    CTX --> VIS
    VIS --> RES
    VIS -->|"identityAttrs {project, feature}"| MRC
    MRC --> SEAM
    RES -->|Resource on both providers| TI
    RES --> TEMPO
    SEAM --> DP
    TI -.->|"join on instance for run-level slicing"| DP
```

## Identity contract (consumer-facing)

| Layer | Carrier | Values | Cardinality |
|-------|---------|--------|-------------|
| Service | `service.name` (resource) | constant `ai-conductor` | 1 |
| Instance | `service.instance.id` (resource) | run id (feature run) | 1 per run, resource-only |
| Dimensions | data-point attributes | `project`, `feature` | bounded (fleet size × features) |

- Cross-project totals: `sum(metric)` — no `by` clause needed; separation never forces per-project queries.
- Per-project/per-feature slicing: `by (project)` / `by (feature)` directly on data points.
- Run-level metric slicing (rare): join `target_info` on `instance`; run id never lands on data points, so series growth per metric stays bounded as runs accumulate.
- Traces: unchanged; run id on the resource ties a trace to the same run's `target_info`.

## Legend

- **(NEW)** — added by this feature; all other nodes exist today.
- The identity-merge seam is one code point inside `MetricsRecorder`, so instruments added
  concurrently (e.g. #1941's cost/dispatch counters) inherit `project`/`feature` automatically.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1938 (two-layer OTel identity) |
