# Complexity: Child BUILD halts needs-human on another child's already-resolved build-review case

Tier: M

## Rationale

- Changes the ownership and lifecycle of three existing engine artifacts
  (`.pipeline/remediation.json`, `.pipeline/build-review-work-order.json`,
  `.pipeline/remediation-plan.json`) from feature-level to per-child, and adds retirement when
  their cases settle. Several engine modules and the conductor's stall path are touched.
- Adds one new routing decision at the BUILD stall seam (cited case is settled or foreign) with a
  bounded retry and a mechanical halt at exhaustion.
- Needs a compatibility read for features already in flight with feature-level artifacts.
- No new service, dependency, CLI flag, hook wiring, or settings schema; no external integration.
- Not Small: it amends remediation-state decisions recorded in existing ADRs and crosses more
  than two production files. Not Large: one bounded subsystem, single-PR delivery expected.
