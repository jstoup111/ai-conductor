# Complexity: Operators cannot attach their own metadata to exported telemetry

Tier: M

Rationale: single subsystem (`src/conductor/src/engine/otel/` plus the `OtelConfig` type) with no
new integrations, storage, or state machines — but the change crosses every layer of that subsystem:
a new config key with its own validation contract (reserved-key refusal, bounded count, named
offending key, never-fails-a-run), a `ResourceContext` extension consumed by both signal-scoped
Resources, a widening of the `MetricsRecorder` identity seam that every instrument's data-point
label set inherits, three construction sites (`wireDaemonOtel`, `wireInteractiveOtelMetrics`, the
per-dispatch `OtelVisualizer`), a consumer-facing configuration reference update, and an ADR-014
amendment that must extend the closed data-point label set #1940's in-flight amendment (D10)
declares. That known textual race with #1940 on `adr-014` and `metrics.ts` warrants
conflict-check and coherence-check rather than the S-tier skip. Issue is labeled size: M and
the operator-chosen balanced scope confirms it.
