# Track: Feature-level telemetry lacks size tier for cost, halts and duration

Track: technical

Scope boundary: Operator approved all six tierless feature metrics named by jstoup111/ai-conductor#2528 as of 2026-09-14 — `conductor.feature.cost`, `conductor.feature.usage` totals, `conductor.feature.shipped`, `conductor.feature.halts`, `conductor.feature.duration.wall`/`.active`, and `conductor.feature.dispatches`. Approach A (dimensions ride the events that already describe the feature, per ADR-014 D11): an optional `tier` field is added to `feature_dispatch_started`, `feature_dispatch_ended`, `feature_shipped`, `feature_usage_total`, and `feature_cost_snapshot`, populated from the run's `complexity_tier` at the existing emit sites, and threaded through `MetricsRecorder`'s feature methods as a data-point label. Extending ADR-014's closed data-point label set requires an amendment (a new numbered decision), not a new ADR. An unresolved tier is omitted, never placeholder-filled. Excluded: the generic dimension table (#2483), span-side feature attributes beyond what the label change implies, per-member validation-group telemetry (#2414), any Grafana dashboard edit, and re-deriving tier from step telemetry.

Exporter-internal label plumbing with no product-facing behavior; consumers are operators querying the metrics backend. Every prior OTel feature (#1940, #2056, #2414) took the technical track.

Source: jstoup111/ai-conductor#2528
