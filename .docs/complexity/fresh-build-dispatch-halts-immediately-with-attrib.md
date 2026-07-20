# Complexity: fresh-build-dispatch-halts-immediately-with-attrib

Tier: S

## Rationale

An ordering fix to a single existing guard, not a new capability:

- **Models:** none added.
- **Integrations:** none added.
- **Auth:** none.
- **State machines:** none added — reorders one seed relative to an existing pre-dispatch guard
  (`checkAttributionMachineryIntact`, `conductor.ts:584`); reuses the existing `seedTaskStatus`
  (`task-seed.ts`) and `resolveFeaturePlanPath` (`artifacts.ts:233`) primitives.
- **Story count:** ~3 (happy: fresh dispatch seeds task-status.json then proceeds; negative:
  genuinely broken machinery — missing session-hooks / unwritable stamp — still HALTs; negative:
  unresolvable plan surfaces a distinct "plan unresolvable" reason, not "machinery broken").
- **Surface:** engine-internal (`src/conductor/src/engine/`), no CLI/hook/schema change, no
  consumer-visible surface.

## Tier-driven step skipping

Small → skip `/prd` (also technical track), `/architecture-diagram`, `/architecture-review`,
`/conflict-check`. Required artifacts: this complexity marker, `/stories`, `/plan`.
