# Complexity: fix-otel-step-duration-histogram-bucket-saturation

Tier: S

Rationale: single production file (`src/conductor/src/engine/otel/metrics.ts`), two
histogram instruments gain `advice.explicitBucketBoundaries`; no new models,
integrations, auth, or state machines; expected 1-2 stories.
