# Complexity: Operator acceptance of a build_review finding does not survive a re-raise

Tier: M

## Rationale

- **Not Small:** the change amends an APPROVED ADR decision
  (`adr-2026-08-29-build-review-remediate-case-adjudication` D2, adopted through
  `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`) and touches about six
  existing consumers of accepted risk: the effective verdict, the adjudication coordinator's
  accepted set and decision-stop path, the remediation case reuse classifier, the adjudicator's
  prior-case context, `build-review findings`, and the PR accepted-risk renderer. It also adds one
  `ConductorEvent` variant with sink registration.
- **Not Large:** no new module boundary, store, step, skill, provider member or external service.
  The disposition store and case store keep their schemas and their sole ownership of their state.
  The work is one shared read-side resolver plus wiring it into the existing consumers, inside
  `src/conductor/src/engine/`.
- **Risk concentration:** fail-closed correctness. One consumer left off the shared resolver
  recreates the defect, and a too-broad resolver would suppress findings that the adjudicator did
  not bind. Both are pinned by stories rather than by added architecture.
