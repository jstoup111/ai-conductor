# Intake origin: a-kickback-restages-a-skipped-manual-test-as-stale

Source-Ref: jstoup111/ai-conductor#1987
Owner: jstoup111

## Desired outcome

- A step recorded as skipped is never left in a state that the `done || skipped` predicate rejects,
  no matter how many kickbacks the feature takes.
- A feature that skips `manual_test` and takes a kickback reaches FINISH without operator
  intervention.
- A step's recorded gate verdict and its step status cannot disagree about whether it was skipped;
  if they ever do, the run says so at the point of divergence rather than at FINISH.
- `conduct-ts inline --diagnose` reports a legitimately skipped step as skipped, not as missing
  evidence — today it lists `manual_test`, `retro`, and `finish` as gaps for a feature that
  correctly skipped them.
