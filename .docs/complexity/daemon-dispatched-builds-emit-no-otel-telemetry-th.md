# Complexity: daemon-dispatched-builds-emit-no-otel-telemetry-th

Tier: M

Rationale: single-process engine wiring change across two entry points (index.ts,
daemon-cli.ts) with a new shared seam, lifecycle interaction (per-dispatch attach/flush,
signal handlers), and a cross-path parity test. No new models, integrations, auth, or
state machines; modest story count. Matches the issue's `size: M` label.
