# Intake origin: stamp-released-harness-version-on-otel-trace-resou

Source-Ref: jstoup111/ai-conductor#2235
Owner: jstoup111

## Desired outcome
- Every trace exported by a published engine build carries the released harness version (the `VERSION` file content at the build's source commit) as a resource attribute alongside the existing dist id.
- Grafana/Tempo can group `conductor.run` span duration by that release value, so several dists from one release aggregate under one label.
- An unpublished dev/tsx run reports an explicit unknown marker rather than omitting the attribute or crashing.
- Metrics resource identity stays feature-stable (no new per-run series); `target_info` cardinality is unchanged.
