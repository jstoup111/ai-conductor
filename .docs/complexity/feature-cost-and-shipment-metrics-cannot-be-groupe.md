# Complexity: Feature-level telemetry lacks size tier for cost, halts and duration

Tier: M

Rationale: single subsystem (`src/conductor/src/engine/otel/` plus the `ConductorEvent` union) with
no new integrations, storage, or state machines — but the change crosses every layer of that
subsystem. Five event shapes gain an optional `tier` field (`feature_dispatch_started`,
`feature_dispatch_ended`, `feature_shipped`, `feature_usage_total`, `feature_cost_snapshot`), each
populated at its existing emit site from the run's `complexity_tier`; six `MetricsRecorder` feature
methods (`onFeatureCostSnapshot`, `onFeatureUsageTotal`, `onFeatureShipped`, `onFeatureHalt`,
`onFeatureDuration`, `onFeatureDispatch`) and the `MetricsListener` projection that feeds them must
thread it through; and ADR-014's data-point label set is closed by the #1940 amendment with D10
scoping `tier` to the three step metrics explicitly, so an amendment with a new numbered decision is
required before the change is admissible. Unresolved-tier semantics (omit, never placeholder) and
the series-identity consequence of a feature emitting both before and after its tier resolves are
correctness questions worth a lightweight architecture review and a coherence mapping. Issue is
labeled `size: M`, and the directly analogous predecessor
(`export-the-telemetry-dimensions-the-engine-already`, the step half of the same gap) was assessed M
on the same grounds. Larger than an S (multi-file, cross-layer, contract amendment) but no new
subsystem.
