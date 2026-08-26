# Complexity: conflict-artifact-stem-is-validated-only-at-build-

Tier: S

Rationale: Single-package engine change — land-gate validation reusing the existing
`STEP_ARTIFACT_CONTRACTS` identity matcher, plus a richer resolver diagnostic. No new models,
integrations, auth, or state machines; small story count; all logic and tests live in
`src/conductor`.
