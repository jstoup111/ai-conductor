# Intake origin: daemon-reconciliation-delays-first-feature-dispatc

Source-Ref: jstoup111/ai-conductor#1174
Owner: jstoup111

## Desired outcome

- An eligible feature can begin dispatch within 2 seconds of provider readiness at the current approximately 80-entry repository scale.
- Reconciliation still completes and preserves all park, halt, shipped-record, and cleanup safety guarantees.
- Startup, scan, and reconciliation durations are emitted so regressions are visible.
- Repeated scans whose inputs are unchanged do not impose the same foreground delay.
- Negative path: an unresolved state that can make dispatch unsafe still blocks the affected feature with a precise reason.
