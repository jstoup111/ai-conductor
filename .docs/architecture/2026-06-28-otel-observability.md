# Architecture: OTel Observability — Phase 1 (exporter on the event bus)

**Last updated:** 2026-06-28
**Scope:** The new OpenTelemetry exporter as an additive listener on the existing
`ConductorEventEmitter`, translating `ConductorEvent`s into OTel traces + metrics over two
config-selected transports (OTLP push / file). Phase 2 (build-task spans) and Phase 3 (subagent
spans) are out of scope. Consumed by `/architecture-review`.
**Source:** PRD/stories `2026-06-28-otel-observability.md` (FR-1…FR-10)

---

## Component view — bus fan-out with the new OTel exporter

```mermaid
graph TD
    subgraph engine["conductor engine (existing — unchanged, FR-1)"]
        conductor["Conductor.run()<br/>emits step_started / step_completed(tokenUsage) /<br/>step_failed / step_retry / gate_verdict / kickback /<br/>feature_complete · conductor.ts"]
        bus["ConductorEventEmitter<br/>Map&lt;type, Set&lt;EventHandler&gt;&gt; · multicast<br/>emit() AWAITS async handlers, swallows their errors · ui/events.ts"]
    end

    subgraph existing["existing listeners (unchanged)"]
        ui["UISubscriber<br/>terminal | json-stdout (config-selected)"]
        persist["EventPersister<br/>append → .pipeline/events.jsonl · engine/event-persister.ts"]
        report["report-renderer.ts<br/>reads events.jsonl · conduct --report"]
    end

    subgraph otel["OTel exporter (NEW, Phase 1) — bus listener, opt-in (FR-1/FR-7)"]
        handler["event handler<br/>O(1), non-blocking; hands off then returns"]
        spans["span manager<br/>run span (FR-2) · step spans start→end (FR-3) ·<br/>attributes + span events (FR-4) ·<br/>force-close incomplete on flush (FR-9)"]
        metrics["metric instruments<br/>step.duration histogram · step.retries counter ·<br/>step.tokens counter (skip when absent) (FR-5)"]
        resource["Resource builder<br/>service.name · conductor.run.id · feature · project (FR-6)"]
        batch["BatchSpanProcessor +<br/>PeriodicExportingMetricReader<br/>async, off hot path; flush on exit (FR-8/FR-10)"]
    end

    subgraph transports["transports (config-selected, FR-7)"]
        otlp["OTLP exporter<br/>HTTP/proto (4318) | gRPC (4317)"]
        file["file exporter<br/>→ .pipeline/otel.jsonl"]
    end

    subgraph ext["external (operator-run, out of scope to ship)"]
        collector["OTLP collector / backend<br/>Jaeger · Tempo · Prometheus · Grafana"]
        tool["offline tool tails otel.jsonl"]
    end

    conductor --> bus
    bus --> ui
    bus --> persist
    persist --> report
    bus -->|"on(...) every type (additive)"| handler
    handler --> spans
    handler --> metrics
    spans --> resource
    metrics --> resource
    resource --> batch
    batch -->|exporter: otlp| otlp
    batch -->|exporter: file| file
    otlp -.->|push| collector
    file -.->|append| tool
    batch -.->|"export fail → 1 warning, run unaffected (FR-8)"| handler

    classDef new fill:#dff5e1,stroke:#2e7d32;
    classDef existing fill:#eef,stroke:#3949ab;
    class otel,transports new;
    class engine,existing existing;
```

> **Distinct sinks:** `EventPersister` → `.pipeline/events.jsonl`; OTel file transport →
> `.pipeline/otel.jsonl`. No file or bus contention (see conflict-check clean pass).

---

## Sequence — run lifecycle → spans, metrics, flush

```mermaid
sequenceDiagram
    participant C as Conductor
    participant B as EventEmitter (multicast)
    participant H as OTel handler
    participant P as Batch processor
    participant X as Transport (otlp|file)

    Note over C,B: otel config absent → exporter never constructed (FR-1 no-op)
    C->>B: first event of run
    B->>H: (also → UI + EventPersister)
    H->>H: open run span + Resource{run.id,feature} (FR-2/6)
    C->>B: step_started{step,index}
    B->>H: open step span (FR-3)
    C->>B: step_retry / gate_verdict
    B->>H: add span event on open step span (FR-4)
    C->>B: step_completed{status, tokenUsage?}
    B->>H: close step span (duration, status) (FR-3)
    H->>P: record duration/retries/tokens metrics (skip absent tokens) (FR-5)
    P-->>X: async batch export (off hot path)
    Note over P,X: export fail (dead collector / unwritable) → 1 warning, run continues (FR-8)
    C->>B: feature_complete  (or SIGINT/SIGTERM)
    B->>H: close run span
    H->>P: forceFlush (bounded timeout) (FR-10)
    Note over H: any span still open → close ERROR + conductor.incomplete=true (FR-9)
```

---

## Decision surface for architecture-review (the OPEN question)

How is the exporter installed and wired? Both place it on the same bus; the difference is the
seam it registers through.

```mermaid
graph LR
    A["A: ui_renderer plugin<br/>(like json-stdout)"] -->|pros| A1["config-selectable via registry;<br/>installs through discoverPlugins();<br/>zero edit to index.ts"]
    A -->|cons| A2["a 'renderer' that emits nothing to<br/>the terminal is a semantic stretch;<br/>UISubscriber start/stop lifecycle fit is loose"]
    B["B: engine listener<br/>(like EventPersister)"] -->|pros| B1["exact precedent (EventPersister);<br/>clean listener lifecycle;<br/>not pretending to render"]
    B -->|cons| B2["wired in index.ts explicitly;<br/>not config-discovered as a plugin →<br/>less 'pluggable' per the original ask"]
```

**Other items for architecture-review to settle (do not block Phase 1 shipping):**
- OTLP default protocol: HTTP/proto (4318) vs gRPC (4317).
- Where `conductor.run.id` is sourced (`.pipeline/conduct-session-id` vs generated) — FR-6.
- Whether file transport emits OTLP-JSON lines vs an OTel file-exporter encoding.

## Legend
- **Green** = new Phase-1 surface; **blue** = existing, unchanged.
- **Solid** = data/control flow; **dotted** = best-effort / failure / external push.
- All new flow hangs off `bus.on(...)` — no emission site in the engine is modified (FR-1).

## Change Log
| Date | Change | Reason |
|------|--------|--------|
| 2026-06-28 | Initial OTel exporter component + sequence + decision-surface diagrams | Phase 1 architecture input |
