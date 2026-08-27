# Track: Daemon-dispatched builds emit no OTel telemetry: the visualizer is never wired

Track: technical

Scope boundary: Balanced — wire a per-dispatch OTel visualizer into the daemon's beginFeatureRun via one shared wiring helper used by both index.ts and daemon-cli.ts, reusing the existing durable conductor.run.id (.pipeline/conduct-session-id) for cross-dispatch attribution, plus a parity test that fails if a signal reaches the interactive exporter but not the daemon path. Excluded: durable cross-process trace continuity (persisted trace context), daemon-lifetime spans for non-feature events, signal-handler lifecycle rework for concurrent features.

Engine wiring change with no product-facing requirements; acceptance lives in stories.
