# Intake origin: exported-step-cost-under-records-spend-20x-so-ever

Source-Ref: jstoup111/ai-conductor#2095
Owner: jstoup111

## Desired outcome

- The recorded cost for a completed feature matches that feature's own finish-line total, within rounding, regardless of how many daemon process lifetimes the feature spanned.
- A 24h spend view includes completed features, not only those still inside the metric staleness window.
- Cost survives a daemon restart, an OOM kill, and a stale-engine respawn without losing the accumulation that preceded it.
- Whatever aggregation the dashboards use is correct for the metric's own type and reset semantics, so two reasonable queries over the same window cannot disagree by two orders of magnitude.
- A cost figure that cannot be trusted reports as unavailable rather than as a small number.
- Summing the exported cost telemetry by feature over any window covering that feature reproduces the shipped record's `cost_usd` (within rounding), regardless of query resolution.
- The same exactness holds for per-step, per-model, and per-project splits, and for cost-over-time (spend per interval).
- Cost accrued by features shipped before the change remains queryable no worse than today.
