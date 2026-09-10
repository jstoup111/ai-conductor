# Complexity: export-the-telemetry-dimensions-the-engine-already

Tier: M

Rationale: touches the event union (`step_completed`, `provider_attempt`), both OTel projections (`MetricsRecorder`/`MetricsListener` and `SpanManager`), and an ADR-014 amendment for label placement. Bounded to the otel module and its event inputs; no new instruments beyond attributes, no schema or CLI change. Larger than an S (multi-file, cross-layer) but no new subsystem.
