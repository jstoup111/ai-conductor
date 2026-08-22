# Complexity: cached-rubric-verdicts-survive-an-engine-change-so

Tier: M

Rationale: touches the cache identity contract (build-review-cache.ts), policy/identity derivation (build-review-registry.ts), coordinator miss handling and a new event on the ConductorEvent spine, plus plumbing the engine version id into step-runners. No new integrations or auth; a few stories, but a persisted-state contract change with at-rest compatibility requirements.
