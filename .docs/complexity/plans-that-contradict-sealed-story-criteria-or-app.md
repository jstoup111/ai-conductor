# Complexity: plans-that-contradict-sealed-story-criteria-or-app

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One new judge claim class (conflict claim) + its closed verdict shape in the coverage-binding envelope |
| External integrations | None new — reuses the auxiliary provider dispatch coverage_binding already uses |
| Auth / permission surface | None |
| State machines | None new — reuses coverage_binding's existing needs-human refusal path |
| Story count | ~4 (criterion conflict refused, ADR-decision conflict refused incl. Tier S, non-conflicting plan passes, refusal names criterion/decision + tasks) |
| Files touched | Engine: coverage-binding inputs/envelope/runner, event union; skill: `skills/coverage-binding/SKILL.md`; fixtures for six replayed evidence cases |
| ADR impact | Amends adr-2026-08-31-coverage-binding-judge-step (D4 input projection widens to all tasks; S tier ADR inputs) |

## Rationale

Extends one existing engine step with a new LLM judgement class, a widened input projection,
schema-checked verdicts, and an ADR amendment — more than a skill-only Small fix, but no new step,
artifact type, or integration. → **Medium.** Lightweight architecture review; architecture
diagram, conflict-check, and coherence-check apply.
