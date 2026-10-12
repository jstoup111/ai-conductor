**Status:** Accepted

# Stories: fix-otel-step-duration-histogram-bucket-saturation

Source: jstoup111/ai-conductor#1976. Technical track, tier S. Scope boundary: minimal —
bucket boundaries on the step-duration histogram plus a discoverable bound; no dashboard,
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

## Story 2: The step-duration histogram's bound is discoverable and no other duration histogram saturates silently

**Requirement:** a consumer must be able to tell a real conductor.step.duration quantile from a saturated one, and no exported duration histogram may carry the default-boundary saturation defect.

As an operator, I want the step-duration histogram's upper bound to be discoverable, and no other duration histogram exported with default boundaries, so that I can recognize saturation instead of trusting a plausible-looking number.

### Acceptance Criteria

#### Happy Path
- Given a consumer inspecting the exported metric metadata or the harness telemetry documentation, when they look up conductor.step.duration, then its largest finite boundary (the saturation point of any quantile) is stated
- Given the conductor's OTel meter, when its instruments are enumerated, then conductor.step.duration is the only duration histogram it creates and no pipeline closeout-duration histogram exists

#### Negative Paths
- Given a leftover pipeline closeout record in a feature's ledger, when the OTel export processes the run, then no histogram observation is recorded for it and no export error occurs

### Done When
- [ ] The largest finite boundary of conductor.step.duration is stated in the telemetry/observability documentation page that describes exported metrics
- [ ] The telemetry documentation lists no pipeline closeout-duration histogram
- [ ] A unit test asserts the OTel visualizer creates no closeout-duration histogram
