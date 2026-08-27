# Complexity: build_review testQuality preflight discards its materialization error

Tier: S

Rationale: Single-function change in build-review-test-quality-preflight.ts — replace two bare catches with catch (err) and thread a boundedHeadTailExcerpt of the error through failure()'s existing excerpt parameter. No new models, integrations, auth, state machines, or schema; small story count; existing tests extended.
