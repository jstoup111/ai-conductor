# Complexity: Amendment notes in common header forms are invisible to coverage_binding

Tier: S

Rationale: One pure function (`amendmentBlocks` in `src/conductor/src/engine/coverage-binding-inputs.ts`) changes its recognition rule. Its two production callers (`assembleAmendmentClaims` and the `coverage_binding` runner's amendment-artifact filter in `step-runners.ts`) and the claim shape, verdicts, events, cache, and envelope all stay unchanged. No new state, schema, event, CLI, or config surface. Risk is limited to which DECIDE text becomes an amendment claim. Unit fixtures plus one runner integration test bound it. The governing ADR change is a single additive DECIDE amendment to `adr-2026-08-31-coverage-binding-judge-step` D18.
