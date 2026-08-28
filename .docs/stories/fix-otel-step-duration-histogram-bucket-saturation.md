**Status:** Accepted

# Stories: fix-otel-step-duration-histogram-bucket-saturation

Source: jstoup111/ai-conductor#1976. Technical track, tier S. Scope boundary: minimal —
bucket boundaries on the two duration histograms plus a discoverable bound; no dashboard,
collector, or backend changes.

## Story 1: Step-duration histogram resolves minute-scale durations

**Requirement:** conductor.step.duration quantiles must track real step durations instead of saturating at the default 10s top bucket.

As an operator reading harness dashboards, I want step-duration quantiles to reflect actual step wall-clock time so that long steps are distinguishable and panels stop displaying a bucket-boundary artifact as a duration.

### Acceptance Criteria

#### Happy Path
- Given the metrics SDK aggregates conductor.step.duration, when a step lasting several minutes (e.g. 252464 ms) is recorded, then the observation falls inside a finite bucket boundary rather than the +Inf overflow bucket
- Given two steps whose durations differ by minutes (e.g. 90 s and 600 s), when both are recorded, then they land in different finite buckets so quantiles over them are distinguishable
- Given a sub-second observation (e.g. 240 ms) and a few-second observation (e.g. 4 s), when both are recorded, then they land in different finite buckets (short durations are not collapsed by the long-range boundaries)

#### Negative Paths
- Given an observation exceeding the largest finite boundary (e.g. a step longer than the top bucket), when it is recorded, then it is counted in the overflow bucket without error and the histogram sum/count still reflect the exact value
- Given a 0 ms observation, when it is recorded, then it is counted in the lowest bucket and no data point is dropped

### Done When
- [ ] conductor.step.duration is created with an explicit, monotonically increasing bucket-boundary list spanning at least 10 ms through at least 30 minutes
- [ ] A unit test records 252464 ms against the configured boundaries and asserts a finite boundary ≥ that value exists
- [ ] A unit test asserts the boundary list resolves 240 ms, 4 s, 90 s, and 600 s into four distinct buckets
- [ ] The boundary configuration is OTel instrument advice only — no exporter-, collector-, or Prometheus-specific code is introduced

## Story 2: Closeout-duration histogram carries explicit boundaries and the bound is discoverable

**Requirement:** conductor.pipeline.closeout.duration must not silently carry the same saturation defect, and a consumer must be able to tell a real quantile from a saturated one.

As an operator, I want closeout-duration quantiles to be trustworthy on the same terms as step durations, and the histogram's upper bound to be discoverable, so that I can recognize saturation instead of trusting a plausible-looking number.

### Acceptance Criteria

#### Happy Path
- Given the metrics SDK aggregates conductor.pipeline.closeout.duration, when a closeout obligation lasting minutes is recorded, then the observation falls inside a finite bucket boundary rather than the +Inf overflow bucket
- Given a consumer inspecting the exported metric metadata or the harness telemetry documentation, when they look up either duration histogram, then the largest finite boundary (the saturation point of any quantile) is stated

#### Negative Paths
- Given a closeout observation exceeding the largest finite boundary, when it is recorded, then it is counted in the overflow bucket without error and sum/count remain exact

### Done When
- [ ] conductor.pipeline.closeout.duration is created with an explicit bucket-boundary list covering the same overall range as step duration (shared or its own list)
- [ ] A unit test asserts the closeout histogram's boundary list has a largest finite boundary of at least 30 minutes
- [ ] The largest finite boundary for both histograms is stated in the telemetry/observability documentation page that describes exported metrics
