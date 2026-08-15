# Complexity: rubric-cache-identity-is-sha-anchored-so-a-rebase-

Tier: S

Rationale: Focused change to digest derivation in two engine modules
(`build-review-projections.ts`, `build-review-inputs.ts`) plus a projectionVersion
bump and unit tests. No new models, integrations, auth, or state machines; single
provider-free code path; matches the intake issue's `size: S` label (~1-2h).
Source: jstoup111/ai-conductor#1597.
