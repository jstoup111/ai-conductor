# Complexity: sliced plans — story ownership and stack eligibility (#2941)

Tier: M

## Rationale

- Touches about five engine modules: `plan-slices.ts` (ownership predicate), `plan-task-parse.ts`
  (multi-id Story lines), `engineer/land-spec.ts` (land refusals), the `coverage_binding` runner in
  `step-runners.ts` (build-entry eligibility re-check and feature-scope contract), and custom-step
  placement from `steps.ts`/config.
- One skill change: `/plan` proposes slices for Large features and records the operator's decision.
- Amends two existing ADRs (`adr-2026-09-29-plan-slice-manifest` D2/D3/D5/D6,
  `adr-2026-08-31-coverage-binding-judge-step` D1); no new state file, CLI, schema, or event type.
- Around six stories, all gated behind a sliced plan plus `stacked_prs.enabled`, so unsliced and
  flag-off paths are unchanged.
- Not Large: no cross-process state, no new persistence, no publication or git-topology change
  (those belong to later tickets in the chain).

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check and
coherence-check are required.
