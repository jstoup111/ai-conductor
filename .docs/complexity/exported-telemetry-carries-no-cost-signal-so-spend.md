# Complexity: exported-telemetry-carries-no-cost-signal-so-spend

Tier: S

Rationale: Two new OTel instruments in one existing class (`MetricsRecorder`), recorded at the
existing `onStepClose` point from fields (`costUsd`, `costSource`) and a classifier
(`classifyMetering`) that already exist. No new models, integrations, auth, state machines, or
config. Matches the issue's `size: S` label (~1-2h).
