# Components: Spine-Derived Cumulative Cost Gauges (#2095, absorbs #2086)

**Last updated:** 2026-08-30
**Scope:** The cost path from a provider dispatch to a metric a dashboard can trust — the
event spine (`events.jsonl`), the cost rollup (`cost-rollup.ts`), the Conductor settle
loop (`conductor.ts`), the OTel visualizer lifecycle (`otel-visualizer.ts`) and its metrics
recorder (`metrics.ts`), the daemon's per-feature wiring (`daemon-cli.ts`
`beginFeatureRun`), and the out-of-repo LGTM dashboards that consume the exported series.
Trace/span structure is unchanged and out of scope (#2011).

## Diagram

```mermaid
graph TD
    subgraph Engine["Conductor run (one per dispatch of a feature; N per feature lifetime)"]
        PA["provider_attempt / step_completed<br/>existing — exact per-dispatch cost<br/>(claude, codex, pi: all through TokenUsage)"]
        SETTLE["Step terminal in Conductor (emitExecutionEvent)<br/>NEW hook: after each step_completed / step_failed delivery<br/>suppressed when the ledger had read errors"]
        ROLLUP["computeCostRollup(worktree)<br/>cost-rollup.ts — reads the spine<br/>NEW: byDimension buckets<br/>step × model × source → cumulative costUsd,<br/>plus existing whole-feature totals + unmetered counts"]
        SNAP["NEW spine event: feature_cost_snapshot<br/>EVENT_SINKS: render false · persist false · otel true<br/>(same shape as pipeline_closeout)"]
        FUT["feature_usage_total<br/>existing — finish only, rendered as the log finish line"]
    end

    SPINE[(".pipeline/events.jsonl<br/>EventPersister — durable across<br/>restart / OOM / respawn / re-kick")]

    subgraph Otel["OtelVisualizer (per run; MeterProvider + PeriodicExportingMetricReader, 60s)"]
        REC["MetricsRecorder<br/>NEW gauge conductor.feature.step.cost {step, model, source}<br/>existing gauge conductor.feature.cost {cost_complete}<br/>both recorded from every snapshot, not only at finish<br/>REMOVED: conductor.step.cost counter"]
        STOP["stop()<br/>existing: forceClose spans, forceFlush both providers<br/>NEW: meterProvider.shutdown() — the 60s timer dies with the run"]
        WARN["onWarning → renderer_error<br/>NEW: rendered into daemon.log / terminal<br/>(export failures are visible, bounded by warnOnce)"]
    end

    subgraph Backend["Any OTLP backend (collector → Prometheus/Mimir/other)"]
        SERIES["conductor_feature_step_cost_usd / conductor_feature_cost_usd<br/>one monotonic series per feature × dimension<br/>identity = project/feature labels (ADR-014), never the process"]
        DASH["Dashboards (out of repo)<br/>last value / max_over_time — no increase(), no rate(),<br/>no reset semantics required"]
    end

    PA -->|"persist"| SPINE
    PA --> SETTLE
    SETTLE -->|"re-read the spine (≤ 0.5 MB)"| ROLLUP
    SPINE --> ROLLUP
    ROLLUP --> SNAP
    ROLLUP -->|"finish only (unchanged)"| FUT
    SNAP -->|"bus"| REC
    FUT -->|"bus"| REC
    REC -->|"OTLP export at each 60s tick and on stop()"| SERIES
    STOP -.->|"no zombie readers re-exporting frozen values"| SERIES
    WARN -.->|"daemon.log"| DASH
    SERIES --> DASH
```

## Sequence — a feature that halts, restarts, and re-runs

```mermaid
sequenceDiagram
    participant D as Daemon (beginFeatureRun)
    participant C as Conductor run
    participant S as events.jsonl (spine)
    participant V as OtelVisualizer
    participant B as OTLP backend

    Note over D,B: Run 1 (process lifetime A)
    D->>V: wireOtelVisualizer(feature «slug») → start()
    C->>S: provider_attempt(build, $2.10)
    C->>C: step close → computeCostRollup(worktree)
    C->>V: feature_cost_snapshot {build/opus/reported: 2.10, total: 2.10, complete: true}
    V->>B: gauge conductor.feature.step.cost{build} = 2.10 (60s tick)
    C-->>D: halted
    D->>V: stop() → forceFlush + meterProvider.shutdown()
    Note over V,B: timer cleared — nothing re-exports 2.10 after this point

    Note over D,B: Daemon restart / OOM / stale-engine respawn (process lifetime B)
    D->>V: wireOtelVisualizer(feature «slug») → start() (fresh provider, same labels)
    C->>S: provider_attempt(build, $1.40)
    C->>C: step close → computeCostRollup(worktree) reads BOTH attempts from the spine
    C->>V: feature_cost_snapshot {build: 3.50, total: 3.50}
    V->>B: gauge conductor.feature.step.cost{build} = 3.50 — same series, continues rising
    C->>S: provider_attempt(finish, unmetered)
    C->>V: feature_usage_total {total: 3.50, unmetered: 1} (existing finish line)
    V->>B: gauge conductor.feature.cost{cost_complete=false} = 3.50
    D->>V: stop() → flush + shutdown
    Note over B: last value == shipped-record cost_usd, by construction
```

## Legend

- **NEW / REMOVED** — surfaces this feature adds or deletes; everything else exists today.
- Solid arrows: data flow. Dotted arrows: lifecycle/observability effects.
- The spine is the single source of truth: the finish line, the shipped record, and now every
  exported cost gauge are projections of the same `events.jsonl`, so they cannot disagree.
- Cumulative gauges need no backend reset handling: any OTLP backend stores the last value as-is.
  This is what makes the fix backend-agnostic (operator requirement) — delta temporality was
  rejected because its correctness would live in collector/Prometheus configuration.
- `conductor.step.cost` (the resettable per-process counter behind
  `conductor_step_cost_usd_total`) is removed; `conductor.step.tokens` and
  `conductor.step.dispatches` keep their current semantics and are out of scope (the tokens
  counter shares the splice defect — follow-up intake).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-30 | Initial generation | DECIDE for #2095 / #2086 |
| 2026-08-30 | Plan update: emission hook pinned to the step-terminal path of `emitExecutionEvent`; snapshot suppressed on ledger read errors (`readErrors`) | /plan for #2095 |
