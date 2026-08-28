# Track: fix-otel-step-duration-histogram-bucket-saturation

Track: technical

Scope boundary: Minimal — fix bucket boundaries on both duration histograms
(`conductor.step.duration`, `conductor.pipeline.closeout.duration`) via
`advice.explicitBucketBoundaries` and document the bound; no dashboard, collector,
or Prometheus stack changes; no guard machinery for future histograms.

Internal observability fix — no product-facing behavior; acceptance criteria live in stories.
