# Complexity: intake-marker plan-stem keying (fix #207)

Tier: S

Rationale: single-fix-point bug — `land-spec.ts` derives the intake-marker slug from
`slugify(idea)` instead of the plan stem it already resolves. Fix is a slug-derivation
change plus a small shared `planStem()` helper and test updates. No new models,
integrations, auth, or state machines; expected 1–2 stories. Skips (per Tier S):
architecture-diagram, architecture-review, conflict-check. Technical track: no PRD.
