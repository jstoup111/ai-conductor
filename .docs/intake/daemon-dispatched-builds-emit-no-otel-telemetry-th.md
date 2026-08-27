# Intake origin: daemon-dispatched-builds-emit-no-otel-telemetry-th

Source-Ref: jstoup111/ai-conductor#1934
Owner: jstoup111

## Desired outcome

- With OTel enabled in config, a daemon-dispatched feature produces spans and metrics
  equivalent to those an interactive run of the same feature produces.
- Each dispatched feature is attributable in the exported telemetry — a consumer can tell which
  feature and which project a span or data point came from without reading local files.
- Telemetry is flushed when a feature run ends, including when it ends in HALT or error, not
  only on clean process exit.
- With OTel absent or disabled in config, the daemon's behavior and output are unchanged, and
  an unreachable endpoint degrades the daemon to a bounded warning rather than failing a build.
- A test fails if a signal reaches the interactive path's exporter but not the daemon path's.
