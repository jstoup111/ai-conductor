# Complexity: New dependencies enter the tree with no review of necessity, pinning, or license

Tier: M

Rationale: The change adds one consumer-facing configuration key (`build_review.custom_rubrics.<id>.paths`)
with load-time validation in `src/conductor/src/engine/config.ts` and resolution into
`ResolvedBuildReviewCustomCatalogEntry` (`src/conductor/src/engine/resolved-config.ts`), one deterministic
pre-dispatch skip branch for custom catalog entries in the build_review step runner
(`src/conductor/src/engine/step-runners.ts`) resolved once per lap in build_review input assembly (`src/conductor/src/engine/build-review-inputs.ts`) before source materialization that emits the existing
`build_review_rubric_skipped` event, one new shipped review-policy skill (`skills/build-review-dependency-hygiene/`),
and enabling that declaration in this repository's `.ai-conductor/config.yml`. It introduces no new module,
service, or dependency and does not grow the closed built-in rubric registry, but it does extend a
public config schema and how a custom rubric settles in the aggregate when skipped, which is a design
decision that warrants a lightweight architecture review rather than Small.
