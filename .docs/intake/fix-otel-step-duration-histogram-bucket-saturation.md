# Intake origin: fix-otel-step-duration-histogram-bucket-saturation

Source-Ref: jstoup111/ai-conductor#1976
Owner: jstoup111

## Desired outcome

- A step lasting several minutes yields a p95 that tracks its actual duration instead of
  saturating at a fixed value.
- Two steps whose durations differ by minutes produce visibly different quantiles.
- Short-lived observations stay resolvable: sub-second and few-second durations are not
  collapsed into one bucket by whatever range accommodates the long steps.
- The bound is documented or discoverable, so a consumer can tell a real quantile from a
  saturated one.
