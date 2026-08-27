# Intake origin: every-project-reports-the-same-otel-identity-so-me

Source-Ref: jstoup111/ai-conductor#1938
Owner: jstoup111

## Desired outcome

- Metrics from two different projects are distinguishable by a consumer using only what the
  harness exports — no collector rewriting, no vendor-specific configuration.
- The same holds for two concurrent feature runs of the same project.
- A single run remains identifiable end-to-end across traces and metrics, so a trace can be tied
  to the data points from the same run.
- Per-run identity does not create unbounded series growth in a metric backend as runs accumulate.
- A consumer aggregating across all projects can still do so — separation must not force
  per-project queries where a total is wanted.
