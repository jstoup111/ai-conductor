# Complexity: No DECIDE sweep covers task-versus-task oscillation inside a plan (#1540)

**Issue:** #1540
**Plan stem:** `no-decide-sweep-covers-task-versus-task-oscillatio`

Tier: S

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | None. Reuses the existing coherence `task` row and its blocking `fail` verdict (`src/conductor/src/engine/coherence-parse.ts`); no new row class or parser change. |
| Integrations | Prose edits to three shipped skills: `skills/coherence-check/SKILL.md`, `skills/plan/SKILL.md`, `skills/conflict-check/SKILL.md`. Existing skill-contract tests (e.g. `src/conductor/test/engine/plan-slices-skill-contract.test.ts`, `test/test_skill_pipeline_contract.sh`) read skill text and must stay green. |
| Auth / secrets | None. |
| State machines | None. |
| Story count | ~3–4 (sweep present in coherence-check, plan check split, layer ownership stated, S-tier unchanged). Within the S ceiling of 5. |

## Rationale

**Small.** Operator-confirmed minimal scope: skill prose only, no engine, parser, or gate change.
Enforcement comes from the existing land-time coherence gate, which already blocks a `task` row
recorded `fail`. No architecture decision is introduced, so no ADR, diagram, conflict-check, or
coherence artifact is required for this spec.

Not Medium: single-concern, additive prose across three skills with no cross-spec reconciliation;
no in-flight worktree touches these skills.
