# Complexity: Lightweight DECIDE flow for size-S bugs (#668)

Tier: M

## Rationale

Medium. A coordinated, multi-site change across the engineer authoring + land seam and the
complexity resolver, introducing one new artifact type (the mini-spec) and a deterministic
expander/validator — but adding **no** new gate readers, new models, integrations, auth, or
subsystems. It reuses the existing gate predicates (`readSpecOwnerStamp`, `isStoriesApproved`,
`parseComplexityTier`, `hasDraftAdr`) and the existing `skippableForTiers: ['S']` build machinery
unchanged.

Signals pushing to M (not S):
- Multi-site edit: label-authoritative tier resolution (`complexity.ts`), claim eligibility
  (`engineer` claim path), a new template, an expander, a new `landSTierSpec` branch in
  `land-spec.ts`, unconditional `writeIntakeMarker`.
- A real trigger→author→expand→validate→build state path with negative branches that MUST hold
  (missing Owner, empty RED list, stray DRAFT ADR, non-bug `size: S`, M/L regression).
- Interacts with three separate live gates (owner, stories-status, ADR-status) whose behaviour must
  be satisfied *by construction* — correctness-critical, adversarial paths matter.

Not Large: bounded, additive surface reusing existing primitives; no new subsystem and no schema or
CLI-contract break. Conflict-check + architecture artifacts are required at M and are included.
