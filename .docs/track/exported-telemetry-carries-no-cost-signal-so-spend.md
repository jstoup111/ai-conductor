# Track: exported-telemetry-carries-no-cost-signal-so-spend

Track: technical

Scope boundary: Step-level cost telemetry only — a `conductor.step.cost` USD counter (attrs:
step, model, source) plus a `conductor.step.dispatches` counter (attrs: step, metering) in
MetricsRecorder. Feature-level cost export, span attributes, and provider/effort dimensions are
explicitly out of scope (deferred to #1934 and #1940).

Telemetry plumbing with no product requirements; acceptance criteria live in stories.
