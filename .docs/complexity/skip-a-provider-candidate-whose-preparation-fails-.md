# Complexity: Skip a provider candidate whose preparation fails

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one production file: a pure result constructor beside the existing
unsupported-capability constructor, and one `catch` around the preparation await already inside the
candidate executor's `invoke()` closure. It adds no module, no configuration key, no CLI surface, no
event variant, no field on any event, no record schema, and no storage. It reuses the existing
invoke-result contract, the existing candidate-failure classifier, the existing attempt-metadata
builder, and the existing provider-fallback warning, so the skip becomes observable through
telemetry that already exists rather than through a new channel. The step-level retry budget, the
self-host preparation hook's own capability checks, and run-wide provider disabling are excluded.
Small-tier architecture, conflict, and coherence artifacts are not required.
