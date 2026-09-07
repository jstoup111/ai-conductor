# Complexity: coherence-accepts-plans-that-cannot-deliver-sealed

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One optional field on `CriterionCoherenceRow` (correction layer + constraint ref) |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None — land-time validator is stateless |
| Story count | ~5 (parse, require-on-fail, per-layer gap ids, ADR-decision validation, backward compatibility) |
| Files touched | `coherence-parse.ts`, `coherence-validator.ts`, `coherence-waiver.ts`, their tests, `docs/` for the artifact format; skill text lands separately |
| New runtime code | Parser branch, validator layer, gap-id vocabulary |

## Rationale

The change extends a committed artifact contract that the land gate and the waiver mechanism
both parse, so it crosses more than one module and adds vocabulary a later feature must honor —
that is more than a Small prose or one-function fix. It is not Large: no new state, no daemon or
BUILD-path change, no new external boundary, and the schema addition is a single optional cell
that keeps every existing artifact parsing unchanged. → **Medium.** Architecture-diagram,
lightweight architecture-review, conflict-check, and coherence-check all run.
